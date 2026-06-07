import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, Funnel, FunnelChart, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageSkeleton } from "../../../components/ui/page-state";
import { apiClient } from "../../../lib/api-client";

type ReportType = "insight" | "funnel" | "time_in_stage" | "historical";
interface ReportConfig { object_type: string; metric: string; field?: string; group_by: string; chart_type: "line" | "bar" | "number"; compare: boolean; stage_field: string; stages: string[]; record_id?: string; range: string }
interface Report { id: string; name: string; type: ReportType; config: ReportConfig }
interface RunData { data: { label: string; value: number; previous?: number; average_days?: number; dropoff?: number }[]; total?: number; change?: number; chart_type?: "line" | "bar" | "number" }

const defaults: ReportConfig = { object_type: "deal", metric: "count", group_by: "month", chart_type: "line", compare: false, stage_field: "stage", stages: ["Lead", "Qualified", "Proposal", "Negotiation", "Closed won"], range: "90d" };

export function ReportBuilderPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [report, setReport] = useState<Report>();
  const query = useQuery({ queryKey: ["report", id], queryFn: () => apiClient.get<Report>(`/reports/${id}`) });
  const run = useQuery({ queryKey: ["report-run", id, report?.type, report?.config], queryFn: () => apiClient.post<RunData>(`/reports/${id}/run`, { type: report?.type, config: report?.config }), enabled: Boolean(report) });
  const save = useMutation({ mutationFn: (value: Report) => apiClient.post(`/reports/${id}`, value), onSuccess: () => { qc.invalidateQueries({ queryKey: ["report", id] }); qc.invalidateQueries({ queryKey: ["reports"] }); } });
  useEffect(() => { if (query.data) setReport({ ...query.data, config: { ...defaults, ...query.data.config } }); }, [query.data]);
  if (query.isLoading || !report) return <div className="p-8"><PageSkeleton rows={7} /></div>;
  const updateConfig = (updates: Partial<ReportConfig>) => setReport({ ...report, config: { ...report.config, ...updates } });
  return <div className="flex min-h-full flex-col">
    <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-4 sm:px-6"><input value={report.name} onChange={(event) => setReport({ ...report, name: event.target.value })} className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none" /><select value={report.type} onChange={(event) => setReport({ ...report, type: event.target.value as ReportType })} className="h-9 rounded-md border border-white/10 bg-[#0b0d10] px-3 text-sm"><option value="insight">Insight</option><option value="funnel">Funnel</option><option value="time_in_stage">Time in stage</option><option value="historical">Historical values</option></select><button onClick={() => save.mutate(report)} className="flex h-9 items-center gap-2 rounded-md bg-red-600 px-3 text-sm"><Save size={14} /> Save report</button></header>
    <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_320px]">
      <main className="min-w-0 p-4 sm:p-6"><div className="rounded-lg border border-white/10 p-5"><h2 className="mb-5 text-sm font-medium">{report.name}</h2>{run.isLoading ? <PageSkeleton rows={5} /> : <ReportChart type={report.type} result={run.data} config={report.config} />}</div></main>
      <aside className="border-t border-white/10 p-5 lg:border-l lg:border-t-0"><h2 className="mb-5 text-sm font-semibold">Report configuration</h2><ConfigPanel report={report} update={updateConfig} /></aside>
    </div>
  </div>;
}

function ConfigPanel({ report, update }: { report: Report; update: (updates: Partial<ReportConfig>) => void }) {
  const config = report.config;
  return <div className="space-y-4">
    <Field label="Object"><select value={config.object_type} onChange={(event) => update({ object_type: event.target.value })} className="input"><option value="contact">Contacts</option><option value="company">Companies</option><option value="deal">Deals</option><option value="property">Properties</option><option value="invoice">Invoices</option></select></Field>
    {report.type === "insight" ? <>
      <Field label="Metric"><select value={config.metric} onChange={(event) => update({ metric: event.target.value })} className="input"><option value="count">Count of records</option><option value="sum">Sum of field</option><option value="average">Average of field</option></select></Field>
      {config.metric !== "count" ? <Field label="Numeric field"><input value={config.field ?? "value"} onChange={(event) => update({ field: event.target.value })} className="input" /></Field> : null}
      <Field label="Group by"><select value={config.group_by} onChange={(event) => update({ group_by: event.target.value })} className="input"><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="quarter">Quarter</option></select></Field>
      <Field label="Chart type"><div className="grid grid-cols-3 gap-1">{(["line", "bar", "number"] as const).map((type) => <button key={type} onClick={() => update({ chart_type: type })} className={`rounded-md border px-2 py-2 text-xs capitalize ${config.chart_type === type ? "border-red-500 bg-red-500/10" : "border-white/10"}`}>{type}</button>)}</div></Field>
      <label className="flex items-center justify-between text-sm text-slate-400">Compare previous period<input type="checkbox" checked={config.compare} onChange={(event) => update({ compare: event.target.checked })} className="accent-red-500" /></label>
    </> : report.type === "funnel" ? <>
      <Field label="Stage field"><input value={config.stage_field} onChange={(event) => update({ stage_field: event.target.value })} className="input" /></Field>
      <Field label="Stages"><div className="space-y-2">{config.stages.map((stage, index) => <div key={`${stage}-${index}`} draggable onDragStart={(event) => event.dataTransfer.setData("stage-index", String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const source = Number(event.dataTransfer.getData("stage-index")); const next = [...config.stages]; const [item] = next.splice(source, 1); if (item) next.splice(index, 0, item); update({ stages: next }); }} className="flex items-center gap-2"><GripVertical size={13} className="text-slate-600" /><input value={stage} onChange={(event) => update({ stages: config.stages.map((value, itemIndex) => itemIndex === index ? event.target.value : value) })} className="input flex-1" /><button onClick={() => update({ stages: config.stages.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={13} /></button></div>)}<button onClick={() => update({ stages: [...config.stages, `Stage ${config.stages.length + 1}`] })} className="flex items-center gap-2 text-xs text-red-400"><Plus size={12} /> Add stage</button></div></Field>
    </> : report.type === "time_in_stage" ? <><Field label="Stage field"><input value={config.stage_field} onChange={(event) => update({ stage_field: event.target.value })} className="input" /></Field><Field label="Date range"><select value={config.range} onChange={(event) => update({ range: event.target.value })} className="input"><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="1y">Last year</option></select></Field></> : <><Field label="Numeric field"><input value={config.field ?? "value"} onChange={(event) => update({ field: event.target.value })} className="input" /></Field><Field label="Record ID or all"><input value={config.record_id ?? ""} onChange={(event) => update({ record_id: event.target.value })} placeholder="Leave empty for all records" className="input" /></Field></>}
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm text-slate-400"><span className="mb-2 block text-xs font-medium uppercase text-slate-600">{label}</span>{children}</label>; }

function ReportChart({ type, result, config }: { type: ReportType; result?: RunData; config: ReportConfig }) {
  const data = result?.data ?? [];
  if (type === "insight" && config.chart_type === "number") return <div className="grid h-80 place-items-center text-center"><div><p className="text-6xl font-semibold">{result?.total ?? 0}</p>{config.compare ? <p className={`mt-3 text-sm ${(result?.change ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{(result?.change ?? 0) >= 0 ? "+" : ""}{result?.change ?? 0}% vs previous period</p> : null}</div></div>;
  if (type === "funnel") return <ResponsiveContainer width="100%" height={360}><FunnelChart><Tooltip /><Funnel data={data} dataKey="value" nameKey="label" fill="#ef4444"><LabelList position="right" dataKey="label" fill="#cbd5e1" /><LabelList position="center" dataKey="value" fill="#fff" /></Funnel></FunnelChart></ResponsiveContainer>;
  if (type === "time_in_stage") return <ResponsiveContainer width="100%" height={360}><BarChart data={data} layout="vertical"><CartesianGrid stroke="#22262d" /><XAxis type="number" stroke="#64748b" /><YAxis dataKey="label" type="category" width={100} stroke="#64748b" /><Tooltip /><Bar dataKey="value">{data.map((item) => <Cell key={item.label} fill={item.value <= 3 ? "#10b981" : item.value <= 7 ? "#f59e0b" : "#ef4444"} />)}</Bar></BarChart></ResponsiveContainer>;
  const chart = type === "historical" || config.chart_type === "line" ? <LineChart data={data}><CartesianGrid stroke="#22262d" /><XAxis dataKey="label" stroke="#64748b" /><YAxis stroke="#64748b" /><Tooltip /><Line dataKey="value" stroke="#ef4444" strokeWidth={2} /></LineChart> : <BarChart data={data}><CartesianGrid stroke="#22262d" /><XAxis dataKey="label" stroke="#64748b" /><YAxis stroke="#64748b" /><Tooltip /><Bar dataKey="value" fill="#ef4444" /></BarChart>;
  return <ResponsiveContainer width="100%" height={320}>{chart}</ResponsiveContainer>;
}
