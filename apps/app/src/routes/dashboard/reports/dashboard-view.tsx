import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, PageSkeleton } from "../../../components/ui/page-state";
import { apiClient } from "../../../lib/api-client";

interface Widget { id: string; report_id: string; title: string; chart_type: "line" | "bar"; data: { label: string; value: number }[] }
interface Dashboard { id: string; name: string; access: "private" | "workspace"; widgets: Widget[]; updated_at: string }
interface ReportOption { id: string; name: string }

export function DashboardViewPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [dashboard, setDashboard] = useState<Dashboard>();
  const [range, setRange] = useState("30d");
  const [adding, setAdding] = useState(false);
  const query = useQuery({ queryKey: ["dashboard", id, range], queryFn: () => apiClient.get<Dashboard>(`/dashboards/${id}?range=${range}`) });
  const reports = useQuery({ queryKey: ["reports"], queryFn: () => apiClient.get<ReportOption[]>("/reports"), enabled: adding });
  const save = useMutation({ mutationFn: (value: Dashboard) => apiClient.patch(`/dashboards/${id}`, value), onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard", id] }) });
  useEffect(() => { if (query.data) setDashboard(query.data); }, [query.data]);
  if (query.isLoading || !dashboard) return <div className="p-8"><PageSkeleton rows={7} /></div>;

  function moveWidget(sourceId: string, targetId: string) {
    const source = dashboard!.widgets.findIndex((item) => item.id === sourceId);
    const target = dashboard!.widgets.findIndex((item) => item.id === targetId);
    if (source < 0 || target < 0 || source === target) return;
    const next = [...dashboard!.widgets];
    const [item] = next.splice(source, 1);
    if (item) next.splice(target, 0, item);
    setDashboard({ ...dashboard!, widgets: next });
  }

  async function addReport(report: ReportOption) {
    const current = dashboard;
    if (!current) return;
    const run = await apiClient.post<{ data: { label: string; value: number }[]; chart_type?: "line" | "bar" }>(`/reports/${report.id}/run`, { range });
    setDashboard({ ...current, widgets: [...current.widgets, { id: crypto.randomUUID(), report_id: report.id, title: report.name, chart_type: run.chart_type ?? "line", data: run.data }] });
    setAdding(false);
  }

  return <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
    <header className="mb-6 flex flex-wrap items-center gap-3"><input value={dashboard.name} onChange={(event) => setDashboard({ ...dashboard, name: event.target.value })} className="min-w-0 flex-1 bg-transparent text-xl font-semibold outline-none" /><select value={range} onChange={(event) => setRange(event.target.value)} className="h-9 rounded-md border border-white/10 bg-[#0b0d10] px-3 text-sm"><option value="7d">Last 7d</option><option value="30d">Last 30d</option><option value="90d">Last 90d</option><option value="quarter">This quarter</option><option value="custom">Custom</option></select><button onClick={() => setAdding(true)} className="flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm"><Plus size={14} /> Add report</button><button onClick={() => save.mutate(dashboard)} className="flex h-9 items-center gap-2 rounded-md bg-red-600 px-3 text-sm"><Save size={14} /> Save</button></header>
    {dashboard.widgets.length ? <div className="grid gap-4 lg:grid-cols-2">{dashboard.widgets.map((widget) => <section key={widget.id} draggable onDragStart={(event) => event.dataTransfer.setData("widget-id", widget.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => moveWidget(event.dataTransfer.getData("widget-id"), widget.id)} className="rounded-lg border border-white/10 p-5"><div className="mb-5 flex items-center gap-2"><GripVertical size={14} className="cursor-grab text-slate-600" /><h2 className="flex-1 text-sm font-medium">{widget.title}</h2><button onClick={() => setDashboard({ ...dashboard, widgets: dashboard.widgets.filter((item) => item.id !== widget.id) })} className="text-slate-600 hover:text-red-400"><Trash2 size={14} /></button></div><ResponsiveContainer width="100%" height={260}>{widget.chart_type === "bar" ? <BarChart data={widget.data}><CartesianGrid stroke="#22262d" /><XAxis dataKey="label" stroke="#64748b" /><YAxis stroke="#64748b" /><Tooltip /><Bar dataKey="value" fill="#ef4444" /></BarChart> : <LineChart data={widget.data}><CartesianGrid stroke="#22262d" /><XAxis dataKey="label" stroke="#64748b" /><YAxis stroke="#64748b" /><Tooltip /><Line dataKey="value" stroke="#ef4444" strokeWidth={2} /></LineChart>}</ResponsiveContainer><p className="mt-3 text-xs text-slate-600">Updated {new Date(dashboard.updated_at).toLocaleString()}</p></section>)}</div> : <EmptyState icon={Plus} title="No report widgets" description="Add a saved report to begin building this dashboard." action={<button onClick={() => setAdding(true)} className="rounded-md bg-red-600 px-3 py-2 text-sm">Add report</button>} />}
    {adding ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"><div className="w-full max-w-lg rounded-lg border border-white/10 bg-[#111419] p-5"><h2 className="mb-4 font-medium">Add report widget</h2><div className="space-y-2">{reports.data?.map((report) => <button key={report.id} onClick={() => addReport(report)} className="flex w-full items-center justify-between rounded-md border border-white/10 p-3 text-sm hover:bg-white/[.03]"><span>{report.name}</span><Plus size={14} /></button>)}</div><button onClick={() => setAdding(false)} className="mt-4 text-sm text-slate-500">Cancel</button></div></div> : null}
  </div>;
}
