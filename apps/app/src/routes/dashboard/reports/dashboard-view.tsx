import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GripVertical, Plus, Save, Trash2, BarChart2, LineChart as LineChartIcon,
  Loader2, X, Zap, FileBarChart,
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
interface LiveWidget   { id: string; type: "live";   slug: string; title: string }
interface ReportWidget { id: string; type: "report"; report_id: string; title: string; chart_type?: "line" | "bar" }
type Widget = LiveWidget | ReportWidget;

interface Dashboard { id: string; name: string; access: "private" | "workspace"; widgets: Widget[]; updated_at: string }
interface ReportOption { id: string; name: string; type: string }
interface ObjectType  { slug: string; name_plural: string }

// ─── Live widget: fetches fresh data for any object type ──────────────────────
function LiveWidgetCard({
  widget,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  widget: LiveWidget;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const recordsQ = useQuery({
    queryKey: ["records", widget.slug],
    queryFn: () => apiClient.get<any[]>(`/nodes?object_type=${encodeURIComponent(widget.slug)}&limit=300`),
    staleTime: 30_000,
  });

  const records = recordsQ.data ?? [];

  // Auto-detect value column
  const valueCol = (() => {
    const candidates = ["deal_value","value","amount","price","revenue","arr","budget","cost","total","fee"];
    const keys = Array.from(new Set(records.flatMap(r => Object.keys((r.data as Record<string,unknown>) ?? {}))));
    for (const c of candidates) if (keys.includes(c)) return c;
    return keys.find(k => records.some(r => !isNaN(Number((r.data as any)?.[k])) && Number((r.data as any)?.[k]) > 0)) ?? null;
  })();

  // Monthly trend last 6 months
  const trendData = (() => {
    const months: Record<string, { count: number; value: number }> = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      const label = d.toLocaleDateString("en", { month: "short" });
      months[label] = { count: 0, value: 0 };
    }
    for (const r of records) {
      const raw = r.updated_at ?? r.created_at;
      if (!raw) continue;
      const d = new Date(raw);
      const label = d.toLocaleDateString("en", { month: "short" });
      if (!(label in months)) continue;
      months[label]!.count += 1;
      if (valueCol) {
        const v = Number((r.data as any)?.[valueCol] ?? 0);
        months[label]!.value += isNaN(v) ? 0 : v;
      }
    }
    return Object.entries(months).map(([label, { count, value }]) => ({ label, count, value }));
  })();

  const totalValue = records.reduce((s, r) => {
    const v = valueCol ? Number(r.data?.[valueCol] ?? 0) : 0;
    return s + (isNaN(v) ? 0 : v);
  }, 0);

  const fmtMoney = (n: number) => n >= 1_000_000 ? `$${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n/1_000).toFixed(0)}K` : `$${n.toLocaleString()}`;

  return (
    <section
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="rounded-xl border border-white/[.08] bg-white/[.02] p-5"
    >
      <div className="mb-4 flex items-center gap-2">
        <GripVertical size={14} className="cursor-grab text-slate-600" />
        <Zap size={13} className="text-emerald-400" />
        <h2 className="flex-1 text-sm font-medium text-white">{widget.title}</h2>
        <Link to={`/reports/sales?object=${widget.slug}`} className="text-[11px] text-slate-600 hover:text-slate-300 transition-colors">
          Full report →
        </Link>
        <button onClick={onRemove} className="text-slate-600 hover:text-red-400 transition-colors">
          <Trash2 size={13} />
        </button>
      </div>

      {recordsQ.isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 size={16} className="animate-spin text-slate-600" />
        </div>
      ) : records.length === 0 ? (
        <div className="flex h-48 items-center justify-center">
          <p className="text-xs text-slate-600">No records found for {widget.title}</p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-end gap-4">
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">{valueCol ? "Total value" : "Records"}</p>
              <p className="text-2xl font-bold text-white">{valueCol ? fmtMoney(totalValue) : records.length}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">This month</p>
              <p className="text-lg font-semibold text-white">{trendData[trendData.length - 1]?.count ?? 0}</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={trendData} barSize={10}>
              <CartesianGrid stroke="#1e222a" strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke="#475569" tick={{ fontSize: 10 }} />
              <YAxis stroke="#475569" tick={{ fontSize: 10 }} width={28} />
              <Tooltip
                contentStyle={{ background: "#1a1d24", border: "1px solid rgba(255,255,255,.08)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#94a3b8" }}
              />
              <Bar dataKey={valueCol ? "value" : "count"} name={valueCol ? "Value" : "Records"} radius={[3, 3, 0, 0]}>
                {trendData.map((_, i) => (
                  <Cell key={i} fill={i === trendData.length - 1 ? "#10b981" : "#10b98160"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </section>
  );
}

// ─── Report widget: re-runs the saved report on mount for fresh data ──────────
function ReportWidgetCard({
  widget,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  widget: ReportWidget;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const runQ = useQuery({
    queryKey: ["report-run-widget", widget.report_id],
    queryFn: () => apiClient.post<{ data: { label: string; value: number }[]; chart_type?: "line" | "bar" }>(
      `/reports/${widget.report_id}/run`, {}
    ),
    staleTime: 60_000,
  });

  const data = runQ.data?.data ?? [];
  const chartType = runQ.data?.chart_type ?? widget.chart_type ?? "bar";

  return (
    <section
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="rounded-xl border border-white/[.08] bg-white/[.02] p-5"
    >
      <div className="mb-4 flex items-center gap-2">
        <GripVertical size={14} className="cursor-grab text-slate-600" />
        <FileBarChart size={13} className="text-red-400" />
        <h2 className="flex-1 text-sm font-medium text-white">{widget.title}</h2>
        <Link to={`/reports/${widget.report_id}`} className="text-[11px] text-slate-600 hover:text-slate-300 transition-colors">
          Edit →
        </Link>
        <button onClick={onRemove} className="text-slate-600 hover:text-red-400 transition-colors">
          <Trash2 size={13} />
        </button>
      </div>

      {runQ.isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 size={16} className="animate-spin text-slate-600" />
        </div>
      ) : !data.length ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2">
          <p className="text-xs text-slate-600">No data for this report</p>
          <Link to={`/reports/${widget.report_id}`} className="text-xs text-red-400 hover:text-red-300">
            Configure report →
          </Link>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          {chartType === "bar" ? (
            <BarChart data={data}>
              <CartesianGrid stroke="#1e222a" strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke="#475569" tick={{ fontSize: 10 }} />
              <YAxis stroke="#475569" tick={{ fontSize: 10 }} width={28} />
              <Tooltip contentStyle={{ background: "#1a1d24", border: "1px solid rgba(255,255,255,.08)", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="value" fill="#ef4444" radius={[3, 3, 0, 0]} />
            </BarChart>
          ) : (
            <LineChart data={data}>
              <CartesianGrid stroke="#1e222a" strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke="#475569" tick={{ fontSize: 10 }} />
              <YAxis stroke="#475569" tick={{ fontSize: 10 }} width={28} />
              <Tooltip contentStyle={{ background: "#1a1d24", border: "1px solid rgba(255,255,255,.08)", borderRadius: 8, fontSize: 12 }} />
              <Line dataKey="value" stroke="#ef4444" strokeWidth={2} dot={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      )}
    </section>
  );
}

// ─── Add widget modal ─────────────────────────────────────────────────────────
function AddWidgetModal({
  objects,
  reports,
  onAdd,
  onClose,
}: {
  objects: ObjectType[];
  reports: ReportOption[];
  onAdd: (widget: Widget) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"live" | "report">("live");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-white/[.08] bg-[#111419] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[.06]">
          <h2 className="text-sm font-semibold text-white">Add widget</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={15} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/[.06]">
          <button
            onClick={() => setTab("live")}
            className={`flex flex-1 items-center justify-center gap-2 py-2.5 text-xs font-medium transition-colors ${tab === "live" ? "border-b-2 border-emerald-500 text-white" : "text-slate-500 hover:text-slate-300"}`}
          >
            <Zap size={12} /> Live Object
          </button>
          <button
            onClick={() => setTab("report")}
            className={`flex flex-1 items-center justify-center gap-2 py-2.5 text-xs font-medium transition-colors ${tab === "report" ? "border-b-2 border-red-500 text-white" : "text-slate-500 hover:text-slate-300"}`}
          >
            <FileBarChart size={12} /> Saved Report
          </button>
        </div>

        <div className="p-4">
          {tab === "live" ? (
            objects.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-600">No object types found in this workspace.</p>
            ) : (
              <div className="space-y-2">
                <p className="mb-3 text-[11px] text-slate-500">
                  Always shows live data. Auto-detects value and trend columns.
                </p>
                {objects.map(obj => (
                  <button
                    key={obj.slug}
                    onClick={() => { onAdd({ id: crypto.randomUUID(), type: "live", slug: obj.slug, title: obj.name_plural }); onClose(); }}
                    className="flex w-full items-center gap-3 rounded-lg border border-white/[.06] p-3 text-left hover:bg-white/[.04] transition-colors"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-400">
                      <BarChart2 size={14} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{obj.name_plural}</p>
                      <p className="text-[11px] text-slate-500">KPIs + 6-month trend chart</p>
                    </div>
                    <Plus size={14} className="ml-auto text-slate-600" />
                  </button>
                ))}
              </div>
            )
          ) : (
            reports.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-xs text-slate-500 mb-3">No saved reports yet.</p>
                <Link to="/reports" className="text-xs text-red-400 hover:text-red-300">
                  Create a report first →
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="mb-3 text-[11px] text-slate-500">
                  Configured reports from the Report Builder. Data refreshes on load.
                </p>
                {reports.map(report => (
                  <button
                    key={report.id}
                    onClick={() => { onAdd({ id: crypto.randomUUID(), type: "report", report_id: report.id, title: report.name }); onClose(); }}
                    className="flex w-full items-center gap-3 rounded-lg border border-white/[.06] p-3 text-left hover:bg-white/[.04] transition-colors"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-red-500/10 text-red-400">
                      <LineChartIcon size={14} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{report.name}</p>
                      <p className="text-[11px] text-slate-500 capitalize">{report.type?.replace(/_/g, " ") ?? "report"}</p>
                    </div>
                    <Plus size={14} className="ml-auto text-slate-600" />
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
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
    mutationFn: (value: Dashboard) => apiClient.patch(`/dashboards/${id}`, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard", id] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  useEffect(() => { if (query.data) setDashboard(query.data); }, [query.data]);

  if (query.isLoading || !dashboard) return <div className="p-8"><PageSkeleton rows={7} /></div>;

  const widgets: Widget[] = Array.isArray(dashboard.widgets) ? dashboard.widgets : [];

  function moveWidget(sourceId: string, targetId: string) {
    if (!dashboard) return;
    const source = widgets.findIndex(w => w.id === sourceId);
    const target = widgets.findIndex(w => w.id === targetId);
    if (source < 0 || target < 0 || source === target) return;
    const next = [...widgets];
    const [item] = next.splice(source, 1);
    if (item) next.splice(target, 0, item);
    setDashboard({ ...dashboard, widgets: next });
  }

  function removeWidget(widgetId: string) {
    if (!dashboard) return;
    setDashboard({ ...dashboard, widgets: widgets.filter(w => w.id !== widgetId) });
  }

  function addWidget(widget: Widget) {
    if (!dashboard) return;
    setDashboard({ ...dashboard, widgets: [...widgets, widget] });
  }

  const dragHandlers = (wid: string) => ({
    onDragStart: (e: React.DragEvent) => e.dataTransfer.setData("widget-id", wid),
    onDragOver:  (e: React.DragEvent) => e.preventDefault(),
    onDrop:      (e: React.DragEvent) => moveWidget(e.dataTransfer.getData("widget-id"), wid),
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <input
          value={dashboard.name}
          onChange={e => setDashboard({ ...dashboard, name: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-xl font-semibold text-white outline-none"
        />
        <button
          onClick={() => setAdding(true)}
          className="flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-slate-300 hover:text-white transition-colors"
        >
          <Plus size={14} /> Add widget
        </button>
        <button
          onClick={() => save.mutate(dashboard)}
          disabled={save.isPending}
          className="flex h-9 items-center gap-2 rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60 transition-colors"
        >
          {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saved ? "Saved!" : save.isPending ? "Saving…" : "Save"}
        </button>
      </header>

      {/* Widgets */}
      {widgets.length === 0 ? (
        <EmptyState
          icon={BarChart2}
          title="No widgets yet"
          description="Add a Live Object widget for instant KPIs, or pin a saved Report Builder chart."
          action={
            <button onClick={() => setAdding(true)} className="rounded-md bg-red-600 px-3 py-2 text-sm text-white">
              Add first widget
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {widgets.map(widget => {
            const dh = dragHandlers(widget.id);
            if (widget.type === "live") {
              return (
                <LiveWidgetCard
                  key={widget.id}
                  widget={widget}
                  onRemove={() => removeWidget(widget.id)}
                  {...dh}
                />
              );
            }
            return (
              <ReportWidgetCard
                key={widget.id}
                widget={widget}
                onRemove={() => removeWidget(widget.id)}
                {...dh}
              />
            );
          })}
        </div>
      )}

      {/* Add widget modal */}
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
