import { useQuery } from "@tanstack/react-query";
import { BarChart3, Plus } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiClient } from "../../../lib/api-client";
import { EmptyState, PageHeader, PageSkeleton } from "../../../components/ui/page-state";

interface ReportData { charts: { id: string; title: string; type: "line" | "bar"; data: Record<string, string | number>[] }[]; reports: { id: string; name: string; updated_at: string }[] }

export function ReportsPage() {
  const [tab, setTab] = useState<"dashboards" | "reports" | "builder">("dashboards");
  const [metric, setMetric] = useState("revenue");
  const [range, setRange] = useState("90d");
  const query = useQuery({ queryKey: ["reports", range], queryFn: () => apiClient.get<ReportData>(`/reports?range=${range}`) });
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader title="Reports" description="Live business metrics and AI-assisted analysis." action={<button onClick={() => setTab("builder")} className="flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm"><Plus size={14} /> Build report</button>} />
      <div className="mb-6 flex justify-between"><div className="flex gap-2">{(["dashboards", "reports", "builder"] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`rounded-md px-3 py-1.5 text-sm capitalize ${tab === item ? "bg-white/10" : "text-slate-500"}`}>{item}</button>)}</div><select value={range} onChange={(event) => setRange(event.target.value)} className="rounded-md border border-white/10 bg-[#0b0d10] px-3 text-sm"><option value="30d">30 days</option><option value="90d">90 days</option><option value="1y">12 months</option></select></div>
      {query.isLoading ? <PageSkeleton rows={5} /> : tab === "builder" ? (
        <div className="grid grid-cols-[280px_1fr] gap-5"><aside className="rounded-lg border border-white/10 p-4"><label className="mb-4 block text-sm">Metric<select value={metric} onChange={(event) => setMetric(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-white/10 bg-[#0b0d10] px-3"><option value="revenue">Revenue</option><option value="deals">Deals won</option><option value="pipeline">Pipeline value</option></select></label><label className="block text-sm">Filter<input placeholder="Stage, owner, source..." className="mt-2 h-10 w-full rounded-md border border-white/10 bg-transparent px-3" /></label></aside><div className="rounded-lg border border-white/10 p-5"><h2 className="mb-5 text-sm font-medium capitalize">{metric} preview</h2><ResponsiveContainer width="100%" height={320}><LineChart data={query.data?.charts[0]?.data ?? []}><CartesianGrid stroke="#22262d" /><XAxis dataKey="label" stroke="#64748b" /><YAxis stroke="#64748b" /><Tooltip /><Line dataKey="value" stroke="#ef4444" strokeWidth={2} /></LineChart></ResponsiveContainer></div></div>
      ) : tab === "reports" ? (
        query.data?.reports.length ? <div className="divide-y divide-white/10 rounded-lg border border-white/10">{query.data.reports.map((report) => <div key={report.id} className="flex items-center justify-between p-4"><span className="text-sm">{report.name}</span><span className="text-xs text-slate-500">{new Date(report.updated_at).toLocaleDateString()}</span></div>)}</div> : <EmptyState icon={BarChart3} title="No saved reports" description="Build and save a report for your workspace." />
      ) : (
        query.data?.charts.length ? <div className="grid grid-cols-2 gap-4">{query.data.charts.map((chart) => <section key={chart.id} className="rounded-lg border border-white/10 p-5"><h2 className="mb-5 text-sm font-medium">{chart.title}</h2><ResponsiveContainer width="100%" height={260}>{chart.type === "line" ? <LineChart data={chart.data}><CartesianGrid stroke="#22262d" /><XAxis dataKey="label" stroke="#64748b" /><YAxis stroke="#64748b" /><Tooltip /><Line dataKey="value" stroke="#ef4444" strokeWidth={2} /></LineChart> : <BarChart data={chart.data}><CartesianGrid stroke="#22262d" /><XAxis dataKey="label" stroke="#64748b" /><YAxis stroke="#64748b" /><Tooltip /><Bar dataKey="value" fill="#ef4444" /></BarChart>}</ResponsiveContainer></section>)}</div> : <EmptyState icon={BarChart3} title="No report data" description="Create records or connect integrations to populate analytics." />
      )}
    </div>
  );
}
