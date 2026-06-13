import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GripVertical, Plus, Save, Trash2, BarChart2, LineChart as LineChartIcon,
  Loader2, X, Zap, FileBarChart, Settings2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Cell,
} from "recharts";
import { EmptyState, PageSkeleton } from "../../../components/ui/page-state";
import { apiClient } from "../../../lib/api-client";

// ─── Types ────────────────────────────────────────────────────────────────────
// "live"   — fetches records directly from an object type (always fresh)
// "report" — re-runs a saved Report Builder report on mount
// legacy   — old format: has embedded `data` array, no `type` field

interface LiveWidget   { id: string; type: "live";   slug: string;      title?: string }
interface ReportWidget { id: string; type: "report"; report_id: string; title?: string; chart_type?: "line"|"bar" }
interface LegacyWidget { id: string; type?: undefined; report_id?: string; title?: string; chart_type?: "line"|"bar"; data?: { label: string; value: number }[] }
type AnyWidget = LiveWidget | ReportWidget | LegacyWidget;

interface Dashboard { id: string; name?: string; access?: "private"|"workspace"; widgets?: AnyWidget[]; updated_at?: string }
interface ReportOption { id: string; name: string; type: string }
interface ObjectType  { slug: string; name_plural: string }

// ─── Shared widget wrapper ────────────────────────────────────────────────────
function WidgetShell({ title, icon, link, linkLabel, onRemove, onDragStart, onDragOver, onDrop, children }: {
  title: string;
  icon: React.ReactNode;
  link?: string;
  linkLabel?: string;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver:  (e: React.DragEvent) => void;
  onDrop:      (e: React.DragEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <section
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="rounded-xl border border-white/[.08] bg-white/[.02] p-5"
    >
      <div className="mb-4 flex items-center gap-2 min-w-0">
        <GripVertical size={14} className="shrink-0 cursor-grab text-slate-600" />
        <span className="shrink-0">{icon}</span>
        <h2 className="flex-1 truncate text-sm font-semibold text-white">{title || "Untitled widget"}</h2>
        {link && (
          <Link to={link} className="shrink-0 text-[11px] text-slate-600 hover:text-slate-300 transition-colors">
            {linkLabel ?? "Open →"}
          </Link>
        )}
        <button onClick={onRemove} className="shrink-0 text-slate-600 hover:text-red-400 transition-colors">
          <Trash2 size={13} />
        </button>
      </div>
      {children}
    </section>
  );
}

const CHART_TOOLTIP_STYLE = {
  contentStyle: { background: "#1a1d24", border: "1px solid rgba(255,255,255,.08)", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#94a3b8" },
};

// ─── Live widget ──────────────────────────────────────────────────────────────
function LiveWidgetCard({ widget, onRemove, onDragStart, onDragOver, onDrop }: {
  widget: LiveWidget;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver:  (e: React.DragEvent) => void;
  onDrop:      (e: React.DragEvent) => void;
}) {
  const slug = widget.slug ?? "";
  const title = widget.title || slug || "Live Report";

  const recordsQ = useQuery({
    queryKey: ["records", slug],
    queryFn: () => apiClient.get<any[]>(`/nodes?object_type=${encodeURIComponent(slug)}&limit=300`),
    staleTime: 30_000,
    enabled: !!slug,
  });

  const records = recordsQ.data ?? [];

  const valueCol = (() => {
    const candidates = ["deal_value","value","amount","price","revenue","arr","budget","cost","total","fee"];
    const keys = Array.from(new Set(records.flatMap((r: any) => Object.keys(r.data ?? {}))));
    for (const c of candidates) if (keys.includes(c)) return c;
    return keys.find(k => records.some((r: any) => !isNaN(Number(r.data?.[k])) && Number(r.data?.[k]) > 0)) ?? null;
  })();

  const trendData = (() => {
    const months: Record<string, { count: number; value: number }> = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      months[d.toLocaleDateString("en", { month: "short" })] = { count: 0, value: 0 };
    }
    for (const r of records) {
      const raw = r.updated_at ?? r.created_at;
      if (!raw) continue;
      const label = new Date(raw as string).toLocaleDateString("en", { month: "short" });
      if (!(label in months)) continue;
      months[label]!.count += 1;
      if (valueCol) {
        const v = Number(r.data?.[valueCol] ?? 0);
        months[label]!.value += isNaN(v) ? 0 : v;
      }
    }
    return Object.entries(months).map(([label, { count, value }]) => ({ label, count, value }));
  })();

  const totalValue = records.reduce((s: number, r: any) => {
    const v = valueCol ? Number(r.data?.[valueCol] ?? 0) : 0;
    return s + (isNaN(v) ? 0 : v);
  }, 0);
  const fmtMoney = (n: number) => n >= 1_000_000 ? `$${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n/1_000).toFixed(0)}K` : `$${n.toLocaleString()}`;

  return (
    <WidgetShell
      title={title}
      icon={<Zap size={13} className="text-emerald-400" />}
      link={`/reports/sales?object=${slug}`}
      linkLabel="Full report →"
      onRemove={onRemove} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}
    >
      {recordsQ.isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 size={16} className="animate-spin text-slate-600" />
        </div>
      ) : records.length === 0 ? (
        <div className="flex h-48 items-center justify-center">
          <p className="text-xs text-slate-600">No records found for {title}</p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-end gap-6">
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">{valueCol ? "Total value" : "Total records"}</p>
              <p className="text-2xl font-bold text-white">{valueCol ? fmtMoney(totalValue) : records.length}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">This month</p>
              <p className="text-xl font-semibold text-white">{trendData[trendData.length - 1]?.count ?? 0}</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={trendData} barSize={10}>
              <CartesianGrid stroke="#1e222a" strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke="#475569" tick={{ fontSize: 10 }} />
              <YAxis stroke="#475569" tick={{ fontSize: 10 }} width={28} />
              <Tooltip {...CHART_TOOLTIP_STYLE} />
              <Bar dataKey={valueCol ? "value" : "count"} name={valueCol ?? "Records"} radius={[3, 3, 0, 0]}>
                {trendData.map((_, i) => (
                  <Cell key={i} fill={i === trendData.length - 1 ? "#10b981" : "#10b98150"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </WidgetShell>
  );
}

// ─── Report widget (re-runs report on mount) ──────────────────────────────────
function ReportWidgetCard({ widget, onRemove, onDragStart, onDragOver, onDrop }: {
  widget: ReportWidget | LegacyWidget;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver:  (e: React.DragEvent) => void;
  onDrop:      (e: React.DragEvent) => void;
}) {
  const reportId = widget.report_id ?? "";
  const title = widget.title || "Report widget";

  // If it's a legacy widget with embedded data and no valid report_id, just use the data directly
  const legacyData = (widget as LegacyWidget).data;
  const hasLegacyData = Array.isArray(legacyData) && legacyData.length > 0;

  const runQ = useQuery({
    queryKey: ["report-run-widget", reportId],
    queryFn: () => apiClient.post<{ data: { label: string; value: number }[]; chart_type?: "line"|"bar" }>(
      `/reports/${reportId}/run`, {}
    ),
    staleTime: 60_000,
    enabled: !!reportId && !hasLegacyData,
  });

  const data = hasLegacyData ? (legacyData ?? []) : (runQ.data?.data ?? []);
  const chartType = runQ.data?.chart_type ?? widget.chart_type ?? "bar";
  const isLoading = !hasLegacyData && runQ.isLoading && !!reportId;

  return (
    <WidgetShell
      title={title}
      icon={<FileBarChart size={13} className="text-red-400" />}
      link={reportId ? `/reports/${reportId}` : undefined}
      linkLabel="Edit →"
      onRemove={onRemove} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}
    >
      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 size={16} className="animate-spin text-slate-600" />
        </div>
      ) : !data.length ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
          <p className="text-xs text-slate-600">No data for this report.</p>
          {reportId && (
            <Link to={`/reports/${reportId}`} className="text-xs text-red-400 hover:text-red-300">
              Configure report →
            </Link>
          )}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          {chartType === "bar" ? (
            <BarChart data={data}>
              <CartesianGrid stroke="#1e222a" strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke="#475569" tick={{ fontSize: 10 }} />
              <YAxis stroke="#475569" tick={{ fontSize: 10 }} width={28} />
              <Tooltip {...CHART_TOOLTIP_STYLE} />
              <Bar dataKey="value" fill="#ef4444" radius={[3, 3, 0, 0]} />
            </BarChart>
          ) : (
            <LineChart data={data}>
              <CartesianGrid stroke="#1e222a" strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke="#475569" tick={{ fontSize: 10 }} />
              <YAxis stroke="#475569" tick={{ fontSize: 10 }} width={28} />
              <Tooltip {...CHART_TOOLTIP_STYLE} />
              <Line dataKey="value" stroke="#ef4444" strokeWidth={2} dot={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      )}
    </WidgetShell>
  );
}

// ─── Add widget modal ─────────────────────────────────────────────────────────
function CustomChartTab({ objects, onAdd, onClose }: {
  objects: ObjectType[];
  onAdd: (widget: AnyWidget) => void;
  onClose: () => void;
}) {
  const [name,      setName]      = useState("Custom chart");
  const [slug,      setSlug]      = useState(objects[0]?.slug ?? "");
  const [metric,    setMetric]    = useState<"count"|"sum"|"average">("count");
  const [field,     setField]     = useState("value");
  const [groupBy,   setGroupBy]   = useState<"day"|"week"|"month"|"quarter">("month");
  const [chartType, setChartType] = useState<"line"|"bar">("bar");
  const [creating,  setCreating]  = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  async function handleAdd() {
    if (!slug) return;
    setCreating(true);
    setError(null);
    try {
      const report = await apiClient.post<{ id: string }>("/reports", {
        name,
        type: "insight",
        config: { object_type: slug, metric, field, group_by: groupBy, chart_type: chartType, compare: false, stage_field: "stage", stages: [], range: "90d" },
      });
      onAdd({ id: crypto.randomUUID(), type: "report", report_id: report.id, title: name, chart_type: chartType });
      onClose();
    } catch {
      setError("Could not create chart. Please try again.");
      setCreating(false);
    }
  }

  return (
    <div className="space-y-3 p-4">
      <p className="text-[11px] text-slate-500 mb-1">Configure a custom chart — re-runs live every time the dashboard loads.</p>
      <label className="block">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-600 mb-1 block">Widget name</span>
        <input value={name} onChange={e => setName(e.target.value)} className="w-full rounded-lg border border-white/[.08] bg-white/[.03] px-3 py-2 text-sm text-white outline-none focus:border-red-500/50"/>
      </label>
      <label className="block">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-600 mb-1 block">Object</span>
        <select value={slug} onChange={e => setSlug(e.target.value)} className="w-full rounded-lg border border-white/[.08] bg-[#0b0d10] px-3 py-2 text-sm text-white outline-none">
          {objects.map(o => <option key={o.slug} value={o.slug}>{o.name_plural}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-600 mb-1 block">Metric</span>
          <select value={metric} onChange={e => setMetric(e.target.value as "count"|"sum"|"average")} className="w-full rounded-lg border border-white/[.08] bg-[#0b0d10] px-3 py-2 text-sm text-white outline-none">
            <option value="count">Count of records</option>
            <option value="sum">Sum of field</option>
            <option value="average">Average of field</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-600 mb-1 block">Group by</span>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value as "day"|"week"|"month"|"quarter")} className="w-full rounded-lg border border-white/[.08] bg-[#0b0d10] px-3 py-2 text-sm text-white outline-none">
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="quarter">Quarter</option>
          </select>
        </label>
      </div>
      {metric !== "count" && (
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-600 mb-1 block">Numeric field name</span>
          <input value={field} onChange={e => setField(e.target.value)} placeholder="e.g. value, amount, revenue" className="w-full rounded-lg border border-white/[.08] bg-white/[.03] px-3 py-2 text-sm text-white outline-none focus:border-red-500/50"/>
        </label>
      )}
      <label className="block">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-600 mb-1 block">Chart type</span>
        <div className="flex gap-2">
          {(["bar","line"] as const).map(t => (
            <button key={t} onClick={() => setChartType(t)}
              className={`flex-1 rounded-md border py-2 text-xs capitalize transition-colors ${chartType === t ? "border-red-500 bg-red-500/10 text-white" : "border-white/10 text-slate-400"}`}>
              {t}
            </button>
          ))}
        </div>
      </label>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button onClick={handleAdd} disabled={creating || !slug}
        className="w-full rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
        {creating ? <><Loader2 size={13} className="animate-spin"/> Creating…</> : "Add chart to dashboard"}
      </button>
    </div>
  );
}

function AddWidgetModal({ objects, reports, onAdd, onClose }: {
  objects: ObjectType[];
  reports: ReportOption[];
  onAdd: (widget: AnyWidget) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"live"|"report"|"custom">("live");

  const TABS = [
    { id: "live"   as const, label: "Live Object",   icon: <Zap size={11}/>,         accent: "border-emerald-500" },
    { id: "report" as const, label: "Saved Report",  icon: <FileBarChart size={11}/>, accent: "border-red-500"     },
    { id: "custom" as const, label: "Custom Chart",  icon: <Settings2 size={11}/>,    accent: "border-blue-500"    },
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-white/[.08] bg-[#111419] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[.06]">
          <h2 className="text-sm font-semibold text-white">Add widget</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={15} /></button>
        </div>

        <div className="flex border-b border-white/[.06]">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium transition-colors ${tab === t.id ? `border-b-2 text-white ${t.accent}` : "text-slate-500 hover:text-slate-300"}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="max-h-[28rem] overflow-y-auto">
          {tab === "live" ? (
            <div className="p-4">
              {objects.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-600">No object types found in this workspace.</p>
              ) : (
                <div className="space-y-2">
                  <p className="mb-3 text-[11px] text-slate-500">Always shows live data — auto-detects value and trend columns.</p>
                  {objects.map(obj => (
                    <button key={obj.slug}
                      onClick={() => { onAdd({ id: crypto.randomUUID(), type: "live", slug: obj.slug, title: obj.name_plural }); onClose(); }}
                      className="flex w-full items-center gap-3 rounded-lg border border-white/[.06] p-3 text-left hover:bg-white/[.04] transition-colors">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-400">
                        <BarChart2 size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white">{obj.name_plural}</p>
                        <p className="text-[11px] text-slate-500">KPIs + 6-month trend</p>
                      </div>
                      <Plus size={14} className="shrink-0 text-slate-600" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : tab === "report" ? (
            <div className="p-4">
              {reports.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-xs text-slate-500 mb-3">No saved reports yet.</p>
                  <Link to="/reports" onClick={onClose} className="text-xs text-red-400 hover:text-red-300">
                    Go to Reports →
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="mb-3 text-[11px] text-slate-500">Data re-runs fresh each time the dashboard loads.</p>
                  {reports.map(report => (
                    <button key={report.id}
                      onClick={() => { onAdd({ id: crypto.randomUUID(), type: "report", report_id: report.id, title: report.name }); onClose(); }}
                      className="flex w-full items-center gap-3 rounded-lg border border-white/[.06] p-3 text-left hover:bg-white/[.04] transition-colors">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-500/10 text-red-400">
                        <LineChartIcon size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{report.name}</p>
                        <p className="text-[11px] text-slate-500 capitalize">{report.type?.replace(/_/g," ") ?? "report"}</p>
                      </div>
                      <Plus size={14} className="shrink-0 text-slate-600" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <CustomChartTab objects={objects} onAdd={onAdd} onClose={onClose}/>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function DashboardViewPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [dashboard, setDashboard] = useState<Dashboard | undefined>();
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState(false);

  const query = useQuery({
    queryKey: ["dashboard", id],
    queryFn: () => apiClient.get<Dashboard>(`/dashboards/${id}`),
  });
  const objectsQ = useQuery({
    queryKey: ["sidebar-objects"],
    queryFn: () => apiClient.get<ObjectType[]>("/objects"),
    staleTime: 60_000,
  });
  const reportsQ = useQuery({
    queryKey: ["reports"],
    queryFn: () => apiClient.get<ReportOption[]>("/reports"),
    enabled: adding,
  });
  const save = useMutation({
    mutationFn: (d: Dashboard) =>
      // Only send the fields the API needs — don't store updated_at inside data
      apiClient.patch(`/dashboards/${id}`, { name: d.name, access: d.access ?? "private", widgets: d.widgets ?? [] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard", id] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  useEffect(() => { if (query.data) setDashboard(query.data); }, [query.data]);

  if (query.isLoading || !dashboard) return <div className="p-8"><PageSkeleton rows={7} /></div>;

  const widgets: AnyWidget[] = Array.isArray(dashboard.widgets) ? dashboard.widgets : [];
  const dashName = dashboard.name || "Untitled dashboard";

  function moveWidget(srcId: string, dstId: string) {
    if (!dashboard) return;
    const src = widgets.findIndex(w => w.id === srcId);
    const dst = widgets.findIndex(w => w.id === dstId);
    if (src < 0 || dst < 0 || src === dst) return;
    const next = [...widgets];
    const [item] = next.splice(src, 1);
    if (item) next.splice(dst, 0, item);
    setDashboard({ ...dashboard, widgets: next });
  }

  function removeWidget(wid: string) {
    if (!dashboard) return;
    setDashboard({ ...dashboard, widgets: widgets.filter(w => w.id !== wid) });
  }

  function addWidget(w: AnyWidget) {
    if (!dashboard) return;
    setDashboard({ ...dashboard, widgets: [...widgets, w] });
  }

  const dh = (wid: string) => ({
    onDragStart: (e: React.DragEvent) => e.dataTransfer.setData("widget-id", wid),
    onDragOver:  (e: React.DragEvent) => e.preventDefault(),
    onDrop:      (e: React.DragEvent) => moveWidget(e.dataTransfer.getData("widget-id"), wid),
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <input
          value={dashName}
          onChange={e => setDashboard({ ...dashboard, name: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-xl font-semibold text-white outline-none placeholder-slate-600"
          placeholder="Dashboard name"
        />
        <button onClick={() => setAdding(true)}
          className="flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-slate-300 hover:text-white transition-colors">
          <Plus size={14} /> Add widget
        </button>
        <button onClick={() => save.mutate(dashboard)} disabled={save.isPending}
          className="flex h-9 items-center gap-2 rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60 transition-colors">
          {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saved ? "Saved!" : save.isPending ? "Saving…" : "Save"}
        </button>
      </header>

      {widgets.length === 0 ? (
        <EmptyState
          icon={BarChart2}
          title="No widgets yet"
          description='Click "Add widget" — pick a Live Object for instant KPIs, or a saved Report Builder chart.'
          action={
            <button onClick={() => setAdding(true)} className="rounded-md bg-red-600 px-3 py-2 text-sm text-white">
              Add first widget
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {widgets.map(w => {
            const handlers = dh(w.id);
            if (w.type === "live") {
              return <LiveWidgetCard key={w.id} widget={w} onRemove={() => removeWidget(w.id)} {...handlers} />;
            }
            // "report" type OR legacy (no type) — both render as ReportWidgetCard
            return <ReportWidgetCard key={w.id} widget={w as ReportWidget | LegacyWidget} onRemove={() => removeWidget(w.id)} {...handlers} />;
          })}
        </div>
      )}

      {adding && (
        <AddWidgetModal
          objects={objectsQ.data ?? []}
          reports={reportsQ.data ?? []}
          onAdd={addWidget}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
