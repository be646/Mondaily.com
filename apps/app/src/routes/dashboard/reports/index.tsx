import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3, Gauge, LayoutDashboard, LineChart, Plus, Route,
  Sparkles, Loader2, TrendingUp, TrendingDown, Minus,
  ChevronDown, ChevronUp, BarChart2, ArrowRight,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Cell } from "recharts";
import { EmptyState, PageHeader, PageSkeleton } from "../../../components/ui/page-state";
import { apiClient } from "../../../lib/api-client";

interface DashboardItem { id: string; name: string; updated_at: string; widgets: string[] }
interface ReportItem { id: string; name: string; type: "insight" | "funnel" | "time_in_stage" | "historical"; chart_type?: string; created_by?: string; updated_at: string }
interface Insight { title: string; value: string; trend?: "up" | "down" | "neutral"; description: string; category: "performance" | "risk" | "opportunity" | "summary" }

const reportIcons = { insight: LineChart, funnel: Route, time_in_stage: BarChart3, historical: Gauge };

const CATEGORY_STYLE: Record<string, { card: string; bar: string }> = {
  performance: { card: "border-blue-500/20 bg-blue-500/[.05]", bar: "#3b82f6" },
  risk:        { card: "border-red-500/20 bg-red-500/[.05]",  bar: "#ef4444" },
  opportunity: { card: "border-emerald-500/20 bg-emerald-500/[.05]", bar: "#10b981" },
  summary:     { card: "border-slate-500/20 bg-slate-500/[.05]", bar: "#64748b" },
};

// ─── Sparkline for each insight card ─────────────────────────────────────────
function InsightBar({ value, color }: { value: number; color: string }) {
  const bars = Array.from({ length: 6 }, (_, i) => ({
    v: Math.max(10, Math.round(value * (0.4 + Math.random() * 0.6))),
    i,
  }));
  bars[5] = { v: value, i: 5 };
  return (
    <ResponsiveContainer width="100%" height={40}>
      <BarChart data={bars} barSize={6} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <Bar dataKey="v" radius={[2, 2, 0, 0]}>
          {bars.map((_, i) => <Cell key={i} fill={i === 5 ? color : color + "40"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── AI Insights Panel ────────────────────────────────────────────────────────
function AIInsightsPanel() {
  const [objectType, setObjectType] = useState("");
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
  const selected = objectType || objectTypes[0]?.slug || "companies";

  const generate = async () => {
    setLoading(true); setError(""); setInsights([]);
    try {
      const records = await apiClient.get<any[]>(`/nodes?object_type=${encodeURIComponent(selected)}&limit=50`);
      if (!records.length) { setError("No records found for this object type."); setLoading(false); return; }
      const res = await apiClient.post<{ insights: Insight[] }>("/generate/insights", { objectType: selected, records });
      setInsights(res.insights ?? []);
    } catch (e: any) { setError(e.message || "Failed to generate insights"); }
    finally { setLoading(false); }
  };

  return (
    <div className="mb-8 overflow-hidden rounded-xl border border-violet-500/20 bg-violet-500/[.03]">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Sparkles size={15} className="text-violet-400"/>
          <span className="text-sm font-semibold text-white">AI Insights</span>
          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-400">Live</span>
        </div>
        {open ? <ChevronUp size={14} className="text-slate-500"/> : <ChevronDown size={14} className="text-slate-500"/>}
      </button>

      {open && (
        <div className="border-t border-violet-500/10 px-5 pb-5">
          <p className="mt-3 text-xs text-slate-500 mb-3">
            Pick any object type — AI reads your live records and surfaces key metrics, risks, and opportunities.
          </p>
          <div className="flex items-center gap-2">
            <select
              value={selected}
              onChange={e => setObjectType(e.target.value)}
              className="h-9 rounded-lg border border-white/10 bg-[#0b0d10] px-3 text-sm text-white outline-none"
            >
              {objectTypes.length > 0
                ? objectTypes.map(o => <option key={o.slug} value={o.slug}>{o.name_plural}</option>)
                : <option value="companies">Companies</option>}
            </select>
            <button onClick={generate} disabled={loading}
              className="flex h-9 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white disabled:opacity-60 hover:bg-violet-500 transition-colors">
              {loading
                ? <><Loader2 size={13} className="animate-spin"/> Analyzing…</>
                : <><Sparkles size={13}/> Generate insights</>}
            </button>
          </div>

          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

          {insights.length > 0 && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {insights.map((ins, i) => {
                const style = CATEGORY_STYLE[ins.category] ?? CATEGORY_STYLE.summary;
                const numVal = parseFloat(ins.value.replace(/[^0-9.]/g, ""));
                return (
                  <div key={i} className={`rounded-xl border p-4 ${style.card}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                        ins.category === "performance" ? "text-blue-400" :
                        ins.category === "risk" ? "text-red-400" :
                        ins.category === "opportunity" ? "text-emerald-400" : "text-slate-400"
                      }`}>{ins.category}</span>
                      {ins.trend === "up" && <TrendingUp size={12} className="text-emerald-400"/>}
                      {ins.trend === "down" && <TrendingDown size={12} className="text-red-400"/>}
                      {ins.trend === "neutral" && <Minus size={12} className="text-slate-600"/>}
                    </div>
                    <p className="text-2xl font-bold text-white leading-none">{ins.value}</p>
                    <p className="mt-1 text-[11px] font-medium text-slate-300">{ins.title}</p>
                    {!isNaN(numVal) && numVal > 0 && (
                      <div className="mt-3">
                        <InsightBar value={numVal} color={style.bar} />
                      </div>
                    )}
                    <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">{ins.description}</p>
                  </div>
                );
              })}
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
      <PageHeader
        title="Reports"
        description="Business intelligence built directly from your live records."
        action={
          <div className="flex gap-2">
            <button onClick={() => createDashboard.mutate()} className="flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm">
              <Plus size={14} /> New dashboard
            </button>
            <button onClick={() => createReport.mutate()} className="flex h-9 items-center gap-2 rounded-md bg-red-600 px-3 text-sm font-medium">
              <Plus size={14} /> New report
            </button>
          </div>
        }
      />

      {/* ── Featured: Sales Report ── */}
      <Link to="/reports/sales"
        className="group mb-8 flex items-center gap-5 overflow-hidden rounded-xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/[.07] to-blue-500/[.04] p-5 hover:border-emerald-500/40 transition-all">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <BarChart2 size={22} className="text-emerald-400"/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-semibold text-white">Sales Report</p>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">Live</span>
          </div>
          <p className="text-xs text-slate-500">KPIs, pipeline funnel, revenue trends, deal breakdown — with period filter (Today / Week / Month / Quarter). Printable.</p>
        </div>
        <ArrowRight size={16} className="text-slate-600 group-hover:text-emerald-400 transition-colors shrink-0"/>
      </Link>

      {/* ── AI Insights ── */}
      <AIInsightsPanel />

      {/* ── Tabs ── */}
      <div className="mb-6 flex gap-1 border-b border-white/10">
        <button onClick={() => setTab("dashboards")} className={`border-b-2 px-4 py-2 text-sm ${tab === "dashboards" ? "border-red-500 text-white" : "border-transparent text-slate-500"}`}>
          Dashboards
        </button>
        <button onClick={() => setTab("reports")} className={`border-b-2 px-4 py-2 text-sm ${tab === "reports" ? "border-red-500 text-white" : "border-transparent text-slate-500"}`}>
          All reports
        </button>
      </div>

      {isLoading ? <PageSkeleton rows={6} /> : tab === "dashboards" ? (
        dashboards.data?.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dashboards.data.map(dashboard => (
              <Link key={dashboard.id} to={`/reports/dashboards/${dashboard.id}`} className="overflow-hidden rounded-lg border border-white/10 hover:border-white/20">
                <div className="grid h-36 grid-cols-2 gap-2 bg-white/[.015] p-4">
                  <div className="rounded border border-white/10 bg-gradient-to-t from-red-500/10 to-transparent"/>
                  <div className="space-y-2">
                    <div className="h-16 rounded border border-white/10 bg-white/[.025]"/>
                    <div className="h-10 rounded border border-white/10 bg-white/[.025]"/>
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex items-center gap-2">
                    <LayoutDashboard size={14} className="text-red-400"/>
                    <h2 className="text-sm font-medium">{dashboard.name}</h2>
                  </div>
                  <p className="mt-2 text-xs text-slate-600">Updated {new Date(dashboard.updated_at).toLocaleDateString()} · {dashboard.widgets.length} widgets</p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState icon={LayoutDashboard} title="No dashboards yet" description="Create a dashboard to arrange your most important reports."
            action={<button onClick={() => createDashboard.mutate()} className="rounded-md bg-red-600 px-3 py-2 text-sm">Create dashboard</button>}/>
        )
      ) : (
        reports.data?.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {reports.data.map(report => {
              const Icon = reportIcons[report.type] ?? BarChart3;
              return (
                <Link key={report.id} to={`/reports/${report.id}`} className="flex items-center gap-4 rounded-lg border border-white/10 p-4 hover:bg-white/[.025]">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-red-500/10 text-red-400"><Icon size={17}/></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{report.name}</p>
                    <p className="mt-1 text-xs text-slate-600">Created by {report.created_by || "Workspace member"}</p>
                  </div>
                  <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] capitalize text-slate-500">{report.type.replaceAll("_", " ")}</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={BarChart3} title="No reports yet" description="Build your first report from live business records."
            action={<button onClick={() => createReport.mutate()} className="rounded-md bg-red-600 px-3 py-2 text-sm">Create report</button>}/>
        )
      )}
    </div>
  );
}
