import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Gauge, LayoutDashboard, LineChart, Plus, Route } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, PageHeader, PageSkeleton } from "../../../components/ui/page-state";
import { apiClient } from "../../../lib/api-client";

interface DashboardItem { id: string; name: string; updated_at: string; widgets: string[] }
interface ReportItem { id: string; name: string; type: "insight" | "funnel" | "time_in_stage" | "historical"; chart_type?: string; created_by?: string; updated_at: string }

const reportIcons = { insight: LineChart, funnel: Route, time_in_stage: BarChart3, historical: Gauge };

export function ReportsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"dashboards" | "reports">("dashboards");
  const dashboards = useQuery({ queryKey: ["dashboards"], queryFn: () => apiClient.get<DashboardItem[]>("/dashboards") });
  const reports = useQuery({ queryKey: ["reports"], queryFn: () => apiClient.get<ReportItem[]>("/reports") });
  const createDashboard = useMutation({
    mutationFn: () => apiClient.post<DashboardItem>("/dashboards", { name: "Untitled dashboard" }),
    onSuccess: (item) => { qc.invalidateQueries({ queryKey: ["dashboards"] }); navigate(`/reports/dashboards/${item.id}`); }
  });
  const createReport = useMutation({
    mutationFn: () => apiClient.post<ReportItem>("/reports", { name: "Untitled report", type: "insight", config: { object_type: "deal", metric: "count", group_by: "month", chart_type: "line" } }),
    onSuccess: (item) => { qc.invalidateQueries({ queryKey: ["reports"] }); navigate(`/reports/${item.id}`); }
  });
  const isLoading = tab === "dashboards" ? dashboards.isLoading : reports.isLoading;
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Reports" description="Business intelligence built directly from your live records." action={<div className="flex gap-2"><button onClick={() => createDashboard.mutate()} className="flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm"><Plus size={14} /> New dashboard</button><button onClick={() => createReport.mutate()} className="flex h-9 items-center gap-2 rounded-md bg-red-600 px-3 text-sm font-medium"><Plus size={14} /> New report</button></div>} />
      <div className="mb-6 flex gap-1 border-b border-white/10">
        <button onClick={() => setTab("dashboards")} className={`border-b-2 px-4 py-2 text-sm ${tab === "dashboards" ? "border-red-500 text-white" : "border-transparent text-slate-500"}`}>Dashboards</button>
        <button onClick={() => setTab("reports")} className={`border-b-2 px-4 py-2 text-sm ${tab === "reports" ? "border-red-500 text-white" : "border-transparent text-slate-500"}`}>All reports</button>
      </div>
      {isLoading ? <PageSkeleton rows={6} /> : tab === "dashboards" ? dashboards.data?.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{dashboards.data.map((dashboard) => <Link key={dashboard.id} to={`/reports/dashboards/${dashboard.id}`} className="overflow-hidden rounded-lg border border-white/10 hover:border-white/20"><div className="grid h-36 grid-cols-2 gap-2 bg-white/[.015] p-4"><div className="rounded border border-white/10 bg-gradient-to-t from-red-500/10 to-transparent" /><div className="space-y-2"><div className="h-16 rounded border border-white/10 bg-white/[.025]" /><div className="h-10 rounded border border-white/10 bg-white/[.025]" /></div></div><div className="p-4"><div className="flex items-center gap-2"><LayoutDashboard size={14} className="text-red-400" /><h2 className="text-sm font-medium">{dashboard.name}</h2></div><p className="mt-2 text-xs text-slate-600">Updated {new Date(dashboard.updated_at).toLocaleDateString()} · {dashboard.widgets.length} widgets</p></div></Link>)}</div>
      ) : <EmptyState icon={LayoutDashboard} title="No dashboards yet" description="Create a dashboard to arrange your most important reports." action={<button onClick={() => createDashboard.mutate()} className="rounded-md bg-red-600 px-3 py-2 text-sm">Create dashboard</button>} /> : reports.data?.length ? (
        <div className="grid gap-3 sm:grid-cols-2">{reports.data.map((report) => { const Icon = reportIcons[report.type] ?? BarChart3; return <Link key={report.id} to={`/reports/${report.id}`} className="flex items-center gap-4 rounded-lg border border-white/10 p-4 hover:bg-white/[.025]"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-red-500/10 text-red-400"><Icon size={17} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{report.name}</p><p className="mt-1 text-xs text-slate-600">Created by {report.created_by || "Workspace member"}</p></div><span className="rounded-full border border-white/10 px-2 py-1 text-[10px] capitalize text-slate-500">{report.type.replaceAll("_", " ")}</span></Link>; })}</div>
      ) : <EmptyState icon={BarChart3} title="No reports yet" description="Build your first report from live business records." action={<button onClick={() => createReport.mutate()} className="rounded-md bg-red-600 px-3 py-2 text-sm">Create report</button>} />}
    </div>
  );
}
