import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Gauge, LayoutDashboard, LineChart, Plus, Route, Sparkles, Loader2, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, PageHeader, PageSkeleton } from "../../../components/ui/page-state";
import { apiClient } from "../../../lib/api-client";

interface DashboardItem { id: string; name: string; updated_at: string; widgets: string[] }
interface ReportItem { id: string; name: string; type: "insight" | "funnel" | "time_in_stage" | "historical"; chart_type?: string; created_by?: string; updated_at: string }
interface Insight { title: string; value: string; trend?: "up" | "down" | "neutral"; description: string; category: "performance" | "risk" | "opportunity" | "summary" }

const reportIcons = { insight: LineChart, funnel: Route, time_in_stage: BarChart3, historical: Gauge };

const CATEGORY_STYLE: Record<string, string> = {
  performance: "border-blue-500/20 bg-blue-500/5 text-blue-400",
  risk: "border-red-500/20 bg-red-500/5 text-red-400",
  opportunity: "border-emerald-500/20 bg-emerald-500/5 text-emerald-400",
  summary: "border-slate-500/20 bg-slate-500/5 text-slate-400",
};

function AIInsightsPanel() {
  const [objectType, setObjectType] = useState("companies");
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(true);

  const objectsQuery = useQuery({
    queryKey: ["sidebar-objects"],
    queryFn: () => apiClient.get<Array<{ slug: string; name_plural: string }>>("/objects"),
    staleTime: 60_000,
  });
  const objectTypes = objectsQuery.data ?? [];

  const generate = async () => {
    setLoading(true); setError(""); setInsights([]);
    try {
      const records = await apiClient.get<any[]>(`/nodes?object_type=${encodeURIComponent(objectType)}&limit=50`);
      const res = await apiClient.post<{ insights: Insight[] }>("/generate/insights", {
        objectType, records,
      });
      setInsights(res.insights ?? []);
    } catch (e: any) { setError(e.message || "Failed to generate insights"); }
    finally { setLoading(false); }
  };

  return (
    <div className="mb-8 rounded-xl border border-violet-500/20 bg-violet-500/[.04]">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Sparkles size={15} className="text-violet-400"/>
          <span className="text-sm font-semibold text-white">AI Insights</span>
          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-400">Beta</span>
        </div>
        {open ? <ChevronUp size={14} className="text-slate-500"/> : <ChevronDown size={14} className="text-slate-500"/>}
      </button>

      {open && (
        <div className="border-t border-violet-500/10 px-5 pb-5">
          <p className="mt-3 text-xs text-slate-500">Choose an object type and AI will analyze your live records and surface key insights.</p>

          <div className="mt-3 flex items-center gap-2">
            <select value={objectType} onChange={e => setObjectType(e.target.value)}
              className="h-9 rounded-lg border border-white/10 bg-[#0b0d10] px-3 text-sm text-white outline-none">
              {objectTypes.length > 0
                ? objectTypes.map(o => <option key={o.slug} value={o.slug}>{o.name_plural}</option>)
                : <option value="companies">Companies</option>}
            </select>
            <button onClick={generate} disabled={loading}
              className="flex h-9 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white disabled:opacity-60 hover:bg-violet-500 transition-colors">
              {loading ? <><Loader2 size={13} className="animate-spin"/> Analyzing…</> : <><Sparkles size={13}/> Generate insights</>}
            </button>
          </div>

          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

          {insights.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {insights.map((ins, i) => (
                <div key={i} className={`rounded-lg border p-4 ${CATEGORY_STYLE[ins.category] ?? CATEGORY_STYLE.summary}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70 capitalize">{ins.category}</span>
                    {ins.trend === "up" && <TrendingUp size={13}/>}
                    {ins.trend === "down" && <TrendingDown size={13}/>}
                    {ins.trend === "neutral" && <Minus size={13} className="opacity-50"/>}
                  </div>
                  <p className="text-lg font-bold text-white leading-tight">{ins.value}</p>
                  <p className="mt-0.5 text-[11px] font-medium text-white/70">{ins.title}</p>
                  <p className="mt-2 text-[11px] leading-relaxed opacity-70">{ins.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
      <AIInsightsPanel />
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
