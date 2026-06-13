import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3, Gauge, LayoutDashboard, LineChart, Plus, Route,
  Sparkles, Loader2, TrendingUp, TrendingDown, Minus,
  ChevronDown, ChevronUp, BarChart2, ArrowRight, Zap,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bar, BarChart, ResponsiveContainer, Cell } from "recharts";
import { EmptyState, PageHeader, PageSkeleton } from "../../../components/ui/page-state";
import { apiClient } from "../../../lib/api-client";

interface DashboardItem { id: string; name: string; updated_at: string; widgets: string[] }
interface ReportItem { id: string; name: string; type: "insight" | "funnel" | "time_in_stage" | "historical"; chart_type?: string; created_by?: string; updated_at: string }
interface Insight { title: string; value: string; trend?: "up" | "down" | "neutral"; description: string; category: "performance" | "risk" | "opportunity" | "summary" }
interface ObjectType { slug: string; name_plural: string; name_singular: string; color?: string }

const reportIcons = { insight: LineChart, funnel: Route, time_in_stage: BarChart3, historical: Gauge };

const CATEGORY_STYLE: Record<string, { card: string; bar: string }> = {
  performance: { card: "border-blue-500/20 bg-blue-500/[.05]",      bar: "#3b82f6" },
  risk:        { card: "border-red-500/20 bg-red-500/[.05]",         bar: "#ef4444" },
  opportunity: { card: "border-emerald-500/20 bg-emerald-500/[.05]", bar: "#10b981" },
  summary:     { card: "border-slate-500/20 bg-slate-500/[.05]",     bar: "#64748b" },
};

const OBJECT_ACCENTS: Record<string, { border: string; bg: string; icon: string; arrow: string }> = {
  deals:       { border: "border-emerald-500/20", bg: "from-emerald-500/[.07] to-blue-500/[.04]",    icon: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400", arrow: "text-emerald-400" },
  contacts:    { border: "border-blue-500/20",    bg: "from-blue-500/[.07] to-violet-500/[.04]",     icon: "bg-blue-500/10 border-blue-500/20 text-blue-400",          arrow: "text-blue-400" },
  companies:   { border: "border-violet-500/20",  bg: "from-violet-500/[.07] to-blue-500/[.04]",     icon: "bg-violet-500/10 border-violet-500/20 text-violet-400",    arrow: "text-violet-400" },
  properties:  { border: "border-amber-500/20",   bg: "from-amber-500/[.07] to-orange-500/[.04]",    icon: "bg-amber-500/10 border-amber-500/20 text-amber-400",       arrow: "text-amber-400" },
  invoices:    { border: "border-cyan-500/20",    bg: "from-cyan-500/[.07] to-blue-500/[.04]",       icon: "bg-cyan-500/10 border-cyan-500/20 text-cyan-400",          arrow: "text-cyan-400" },
  projects:    { border: "border-rose-500/20",    bg: "from-rose-500/[.07] to-pink-500/[.04]",       icon: "bg-rose-500/10 border-rose-500/20 text-rose-400",          arrow: "text-rose-400" },
};
const DEFAULT_ACCENT = { border: "border-slate-500/20", bg: "from-slate-500/[.07] to-slate-700/[.04]", icon: "bg-slate-700/50 border-slate-600/30 text-slate-400", arrow: "text-slate-400" };

// ─── Sparkline ────────────────────────────────────────────────────────────────
function InsightBar({ value, color }: { value: number; color: string }) {
  const bars = Array.from({ length: 6 }, (_, i) => ({ v: Math.max(10, Math.round(value * (0.4 + Math.random() * 0.6))), i }));
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

// ─── Live Reports: one card per workspace object type ─────────────────────────
function LiveReportsSection({ objects }: { objects: ObjectType[] }) {
  if (!objects.length) return null;
  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <Zap size={14} className="text-slate-500" />
        <h2 className="text-sm font-semibold text-white">Live Reports</h2>
        <span className="rounded-full border border-white/10 bg-white/[.04] px-2 py-0.5 text-[10px] text-slate-500">
          KPIs · charts · trends · printable
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {objects.map(obj => {
          const c = OBJECT_ACCENTS[obj.slug] ?? DEFAULT_ACCENT;
          return (
            <Link
              key={obj.slug}
              to={`/reports/sales?object=${obj.slug}`}
              className={`group flex items-center gap-4 overflow-hidden rounded-xl border ${c.border} bg-gradient-to-r ${c.bg} p-4 hover:brightness-110 transition-all`}
            >
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${c.icon}`}>
                <BarChart2 size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{obj.name_plural}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Auto-detects value, status &amp; trends</p>
              </div>
              <ArrowRight size={14} className={`shrink-0 ${c.arrow} opacity-0 group-hover:opacity-100 transition-opacity`} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ─── AI Insights Panel ────────────────────────────────────────────────────────
function AIInsightsPanel({ objects }: { objects: ObjectType[] }) {
  const [objectType, setObjectType] = useState("");
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(true);

  const selected = objectType || objects[0]?.slug || "companies";

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
          <Sparkles size={15} className="text-violet-400" />
          <span className="text-sm font-semibold text-white">AI Insights</span>
          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-400">Live</span>
        </div>
        {open ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
      </button>

      {open && (
        <div className="border-t border-violet-500/10 px-5 pb-5">
          <p className="mt-3 text-xs text-slate-500 mb-3">
            Pick any object type — AI reads your live records and surfaces key metrics, risks, and opportunities.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={selected}
              onChange={e => setObjectType(e.target.value)}
              className="h-9 rounded-lg border border-white/10 bg-[#0b0d10] px-3 text-sm text-white outline-none"
            >
              {objects.length > 0
                ? objects.map(o => <option key={o.slug} value={o.slug}>{o.name_plural}</option>)
                : <option value="companies">Companies</option>}
            </select>
            <button onClick={generate} disabled={loading}
              className="flex h-9 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white disabled:opacity-60 hover:bg-violet-500 transition-colors">
              {loading
                ? <><Loader2 size={13} className="animate-spin" /> Analysing…</>
                : <><Sparkles size={13} /> Generate insights</>}
            </button>
          </div>

          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

          {insights.length > 0 && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {insights.map((ins, i) => {
                const style = CATEGORY_STYLE[ins.category] ?? CATEGORY_STYLE["summary"]!;
                const numVal = parseFloat(ins.value.replace(/[^0-9.]/g, ""));
                return (
                  <div key={i} className={`rounded-xl border p-4 ${style.card}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                        ins.category === "performance" ? "text-blue-400" :
                        ins.category === "risk"        ? "text-red-400" :
                        ins.category === "opportunity" ? "text-emerald-400" : "text-slate-400"
                      }`}>{ins.category}</span>
                      {ins.trend === "up"      && <TrendingUp   size={12} className="text-emerald-400" />}
                      {ins.trend === "down"    && <TrendingDown  size={12} className="text-red-400" />}
                      {ins.trend === "neutral" && <Minus        size={12} className="text-slate-600" />}
                    </div>
                    <p className="text-2xl font-bold text-white leading-none">{ins.value}</p>
                    <p className="mt-1 text-[11px] font-medium text-slate-300">{ins.title}</p>
                    {!isNaN(numVal) && numVal > 0 && (
                      <div className="mt-3"><InsightBar value={numVal} color={style.bar} /></div>
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

// ─── Main page ─────────────────────────────────────────────────────────────────
export function ReportsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"dashboards" | "reports">("dashboards");

  const objectsQuery = useQuery({
    queryKey: ["sidebar-objects"],
    queryFn: () => apiClient.get<ObjectType[]>("/objects"),
    staleTime: 60_000,
  });
  const objects = objectsQuery.data ?? [];

  const dashboards = useQuery({ queryKey: ["dashboards"], queryFn: () => apiClient.get<DashboardItem[]>("/dashboards") });
  const reports    = useQuery({ queryKey: ["reports"],    queryFn: () => apiClient.get<ReportItem[]>("/reports") });

  const createDashboard = useMutation({
    mutationFn: () => apiClient.post<DashboardItem>("/dashboards", { name: "Untitled dashboard" }),
    onSuccess: item => { qc.invalidateQueries({ queryKey: ["dashboards"] }); navigate(`/reports/dashboards/${item.id}`); },
  });
  const createReport = useMutation({
    mutationFn: () => apiClient.post<ReportItem>("/reports", { name: "Untitled report", type: "insight", config: { object_type: objects[0]?.slug ?? "deals", metric: "count", group_by: "month", chart_type: "line" } }),
    onSuccess: item => { qc.invalidateQueries({ queryKey: ["reports"] }); navigate(`/reports/${item.id}`); },
  });

  const isLoading = tab === "dashboards" ? dashboards.isLoading : reports.isLoading;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Reports"
        description="Business intelligence built directly from your live records."
        action={
          <div className="flex gap-2">
            <button onClick={() => createDashboard.mutate()}
              className="flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-slate-300 hover:text-white transition-colors">
              <Plus size={14} /> New dashboard
            </button>
            <button onClick={() => createReport.mutate()}
              className="flex h-9 items-center gap-2 rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-500 transition-colors">
              <Plus size={14} /> New report
            </button>
          </div>
        }
      />

      {/* Live Reports — one card per workspace object */}
      {objectsQuery.isLoading
        ? <div className="mb-8 h-28 animate-pulse rounded-xl border border-white/[.06] bg-white/[.02]" />
        : <LiveReportsSection objects={objects} />
      }

      {/* AI Insights */}
      <AIInsightsPanel objects={objects} />

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b border-white/10">
        <button onClick={() => setTab("dashboards")}
          className={`border-b-2 px-4 py-2 text-sm transition-colors ${tab === "dashboards" ? "border-red-500 text-white" : "border-transparent text-slate-500 hover:text-slate-300"}`}>
          Dashboards
        </button>
        <button onClick={() => setTab("reports")}
          className={`border-b-2 px-4 py-2 text-sm transition-colors ${tab === "reports" ? "border-red-500 text-white" : "border-transparent text-slate-500 hover:text-slate-300"}`}>
          Saved reports
        </button>
      </div>

      {isLoading ? <PageSkeleton rows={6} /> : tab === "dashboards" ? (
        dashboards.data?.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dashboards.data.map(dashboard => (
              <Link key={dashboard.id} to={`/reports/dashboards/${dashboard.id}`}
                className="overflow-hidden rounded-lg border border-white/10 hover:border-white/20 transition-colors">
                <div className="grid h-36 grid-cols-2 gap-2 bg-white/[.015] p-4">
                  <div className="rounded border border-white/10 bg-gradient-to-t from-red-500/10 to-transparent" />
                  <div className="space-y-2">
                    <div className="h-16 rounded border border-white/10 bg-white/[.025]" />
                    <div className="h-10 rounded border border-white/10 bg-white/[.025]" />
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex items-center gap-2">
                    <LayoutDashboard size={14} className="text-red-400" />
                    <h2 className="text-sm font-medium text-white">{dashboard.name}</h2>
                  </div>
                  <p className="mt-2 text-xs text-slate-600">
                    Updated {new Date(dashboard.updated_at).toLocaleDateString()} · {dashboard.widgets.length} widgets
                  </p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState icon={LayoutDashboard} title="No dashboards yet"
            description="Create a dashboard to pin your most important saved reports as widgets."
            action={<button onClick={() => createDashboard.mutate()} className="rounded-md bg-red-600 px-3 py-2 text-sm text-white">Create dashboard</button>} />
        )
      ) : (
        reports.data?.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {reports.data.map(report => {
              const Icon = reportIcons[report.type] ?? BarChart3;
              return (
                <Link key={report.id} to={`/reports/${report.id}`}
                  className="flex items-center gap-4 rounded-lg border border-white/10 p-4 hover:bg-white/[.025] transition-colors">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-red-500/10 text-red-400">
                    <Icon size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{report.name}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {report.created_by ? `By ${report.created_by}` : "Saved report"} · {report.type.replaceAll("_", " ")}
                    </p>
                  </div>
                  <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] capitalize text-slate-500">
                    {report.type.replaceAll("_", " ")}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={BarChart3} title="No saved reports yet"
            description='Click "New report" to build a configurable insight, funnel, or time-in-stage report from your live records.'
            action={<button onClick={() => createReport.mutate()} className="rounded-md bg-red-600 px-3 py-2 text-sm text-white">Create report</button>} />
        )
      )}
    </div>
  );
}
