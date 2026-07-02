import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Sparkles, Loader2, GripVertical, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { PageSkeleton } from "../../../components/ui/page-state";
import { apiClient } from "../../../lib/api-client";
import { useAskContextStore } from "../../../lib/ask-context-store";
import { AutoChart, type Point } from "../../../components/charts/charts";

type ReportType = "insight" | "funnel" | "time_in_stage" | "historical" | "forecast";
type ChartType = "line" | "bar" | "donut" | "number";
interface ReportConfig { object_type: string; metric: string; field?: string; group_by: string; chart_type: ChartType; compare: boolean; stage_field: string; stages: string[]; record_id?: string; range: string; horizon?: number }
interface Report { id: string; name: string; type: ReportType; config: ReportConfig }
interface RunData { data: (Point & { average_days?: number; dropoff?: number; forecast?: boolean })[]; total?: number; change?: number; chart_type?: ChartType; forecast_from?: number; slope?: number }
interface ObjectType { slug: string; name_plural: string }

const defaults: ReportConfig = { object_type: "", metric: "count", group_by: "month", chart_type: "line", compare: false, stage_field: "stage", stages: ["Lead", "Qualified", "Proposal", "Negotiation", "Closed won"], range: "90d" };

// AI insight panel — grounded narrative computed from the report's REAL data (server-side).
function InsightPanel({ reportId, type, config }: { reportId: string; type: ReportType; config: ReportConfig }) {
  const insight = useMutation({
    mutationFn: () => apiClient.post<{ insight: string }>(`/reports/${reportId}/insight`, { type, config }),
  });
  return (
    <div className="mt-4 rounded-sm border p-4" style={{ borderColor: "var(--section-accent-line)", background: "var(--section-accent-soft)" }}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "var(--section-accent)" }}>
          <Sparkles size={13} /> AI insight
        </span>
        <button onClick={() => insight.mutate()} disabled={insight.isPending}
          className="rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)] disabled:opacity-60"
          style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
          {insight.isPending ? <Loader2 size={11} className="inline animate-spin" /> : insight.data ? "Regenerate" : "Analyze"}
        </button>
      </div>
      {insight.data && <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{insight.data.insight}</p>}
      {!insight.data && !insight.isPending && <p className="mt-2 text-[11.5px]" style={{ color: "var(--text-faint)" }}>Generate a grounded read of this report's real numbers — trend, peak, and direction.</p>}
    </div>
  );
}

export function ReportBuilderPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [report, setReport] = useState<Report>();

  const objectsQuery = useQuery({
    queryKey: ["sidebar-objects"],
    queryFn: () => apiClient.get<ObjectType[]>("/objects"),
    staleTime: 60_000,
  });
  const objects = objectsQuery.data ?? [];

  const query = useQuery({ queryKey: ["report", id], queryFn: () => apiClient.get<Report>(`/reports/${id}`) });
  const run = useQuery({
    queryKey: ["report-run", id, report?.type, report?.config],
    queryFn: () => apiClient.post<RunData>(`/reports/${id}/run`, { type: report?.type, config: report?.config }),
    enabled: Boolean(report),
  });
  const save = useMutation({
    mutationFn: (value: Report) => apiClient.post(`/reports/${id}`, value),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["report", id] }); qc.invalidateQueries({ queryKey: ["reports"] }); },
  });

  useEffect(() => {
    if (query.data) {
      const firstSlug = objects[0]?.slug ?? "deals";
      const savedConfig = query.data.config ?? {};
      setReport({ ...query.data, config: { ...defaults, ...savedConfig, object_type: savedConfig.object_type || firstSlug } });
    }
  }, [query.data, objects]);

  // While this report is open in the builder, the right-side Ask AI drawer
  // should know which report is in scope so "this report" resolves.
  useEffect(() => {
    if (!id || !query.data) return;
    useAskContextStore.getState().setContext({
      report_id: id,
      report_title: query.data.name,
      route: `/reports/${id}`,
      scope_label: `the report "${query.data.name}"`,
    });
    return () => useAskContextStore.getState().setContext(null);
  }, [id, query.data]);

  if (query.isLoading || !report) return <div className="p-8"><PageSkeleton rows={7} /></div>;

  const updateConfig = (updates: Partial<ReportConfig>) => setReport({ ...report, config: { ...report.config, ...updates } });

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border-soft)] px-4 py-4 sm:px-6">
        <input
          value={report.name}
          onChange={e => setReport({ ...report, name: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
        />
        <select
          value={report.type}
          onChange={e => setReport({ ...report, type: e.target.value as ReportType })}
          className="h-9 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-card)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-stone-500/40"
        >
          <option value="insight">Insight</option>
          <option value="forecast">Forecast</option>
          <option value="funnel">Funnel</option>
          <option value="time_in_stage">Time in stage</option>
          <option value="historical">Historical values</option>
        </select>
        <button
          onClick={() => save.mutate(report)}
          className="flex h-9 items-center gap-2 rounded-md bg-stone-600 px-3 text-sm font-medium text-[var(--text-primary)] hover:bg-stone-500"
        >
          <Save size={14} /> {save.isPending ? "Saving…" : "Save report"}
        </button>
      </header>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_320px]">
        <main className="min-w-0 p-4 sm:p-6">
          <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] p-5">
            <h2 className="mb-5 text-sm font-medium text-[var(--text-primary)]">{report.name}</h2>
            {run.isLoading ? <PageSkeleton rows={5} /> : <ReportChart type={report.type} result={run.data} config={report.config} />}
          </div>
          {/* Grounded AI insight over the report's real numbers */}
          {!run.isLoading && (run.data?.data?.length ?? 0) >= 2 && (
            <InsightPanel reportId={id} type={report.type} config={report.config} />
          )}
        </main>
        <aside className="border-t border-[var(--border-soft)] p-5 lg:border-l lg:border-t-0">
          <h2 className="mb-5 text-sm font-semibold text-[var(--text-primary)]">Configuration</h2>
          <ConfigPanel report={report} update={updateConfig} objects={objects} />
        </aside>
      </div>
    </div>
  );
}

function ConfigPanel({ report, update, objects }: {
  report: Report;
  update: (updates: Partial<ReportConfig>) => void;
  objects: ObjectType[];
}) {
  const config = report.config;
  return (
    <div className="space-y-4">
      <Field label="Object">
        <select
          value={config.object_type}
          onChange={e => update({ object_type: e.target.value })}
          className="key-input w-full"
        >
          {objects.length > 0
            ? objects.map(o => <option key={o.slug} value={o.slug}>{o.name_plural}</option>)
            : <option value="">Loading…</option>}
        </select>
      </Field>

      {(report.type === "insight" || report.type === "forecast") && <>
        <Field label="Metric">
          <select value={config.metric} onChange={e => update({ metric: e.target.value })} className="key-input w-full">
            <option value="count">Count of records</option>
            <option value="sum">Sum of field</option>
            <option value="average">Average of field</option>
          </select>
        </Field>
        {config.metric !== "count" && (
          <Field label="Numeric field">
            <input value={config.field ?? "value"} onChange={e => update({ field: e.target.value })} className="key-input w-full" />
          </Field>
        )}
        <Field label="Group by">
          <select value={config.group_by} onChange={e => update({ group_by: e.target.value })} className="key-input w-full">
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="quarter">Quarter</option>
          </select>
        </Field>
        {report.type !== "forecast" && (
          <Field label="Chart type">
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
              {(["line","bar","donut","number"] as const).map(t => (
                <button key={t} onClick={() => update({ chart_type: t })}
                  className={`rounded-md border px-2 py-2 text-xs capitalize ${config.chart_type === t ? "border-stone-500 bg-stone-500/10 text-[var(--text-primary)]" : "border-[var(--border-soft)] text-[var(--text-faint)]"}`}>
                  {t}
                </button>
              ))}
            </div>
          </Field>
        )}
        {report.type === "forecast" && (
          <Field label="Forecast periods ahead">
            <select value={config.horizon ?? 3} onChange={e => update({ horizon: Number(e.target.value) })} className="key-input w-full">
              {[1,2,3,4,6].map(h => <option key={h} value={h}>{h} period{h === 1 ? "" : "s"}</option>)}
            </select>
          </Field>
        )}
        <label className="flex items-center justify-between text-sm text-[var(--text-faint)]">
          Compare previous period
          <input type="checkbox" checked={config.compare} onChange={e => update({ compare: e.target.checked })} className="accent-red-500" />
        </label>
      </>}

      {report.type === "funnel" && <>
        <Field label="Stage field">
          <input value={config.stage_field} onChange={e => update({ stage_field: e.target.value })} className="key-input w-full" />
        </Field>
        <Field label="Stages">
          <div className="space-y-2">
            {config.stages.map((stage, i) => (
              <div key={`${stage}-${i}`} draggable
                onDragStart={e => e.dataTransfer.setData("stage-index", String(i))}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  const src = Number(e.dataTransfer.getData("stage-index"));
                  const next = [...config.stages];
                  const [item] = next.splice(src, 1);
                  if (item) next.splice(i, 0, item);
                  update({ stages: next });
                }}
                className="flex items-center gap-2"
              >
                <GripVertical size={13} className="cursor-grab text-[var(--text-secondary)]" />
                <input value={stage} onChange={e => update({ stages: config.stages.map((v, j) => j === i ? e.target.value : v) })} className="input flex-1" />
                <button onClick={() => update({ stages: config.stages.filter((_,j) => j !== i) })} className="text-[var(--text-secondary)] hover:text-[var(--text-faint)]">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <button onClick={() => update({ stages: [...config.stages, `Stage ${config.stages.length + 1}`] })}
              className="flex items-center gap-2 text-xs text-[var(--text-faint)] hover:text-[var(--text-faint)]">
              <Plus size={12} /> Add stage
            </button>
          </div>
        </Field>
      </>}

      {report.type === "time_in_stage" && <>
        <Field label="Stage field">
          <input value={config.stage_field} onChange={e => update({ stage_field: e.target.value })} className="key-input w-full" />
        </Field>
        <Field label="Date range">
          <select value={config.range} onChange={e => update({ range: e.target.value })} className="key-input w-full">
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="1y">Last year</option>
          </select>
        </Field>
      </>}

      {report.type === "historical" && <>
        <Field label="Numeric field">
          <input value={config.field ?? "value"} onChange={e => update({ field: e.target.value })} className="key-input w-full" />
        </Field>
        <Field label="Record ID (leave empty for all)">
          <input value={config.record_id ?? ""} onChange={e => update({ record_id: e.target.value })} placeholder="All records" className="key-input w-full" />
        </Field>
      </>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm text-[var(--text-faint)]">
      <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">{label}</span>
      {children}
    </label>
  );
}

function ReportChart({ type, result, config }: { type: ReportType; result?: RunData; config: ReportConfig }) {
  const data = result?.data ?? [];

  if (!data.length && !result?.total) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-[var(--text-muted)]">No data yet for this configuration.</p>
        <p className="text-xs text-[var(--text-secondary)]">Try changing the object type, metric, or date range.</p>
      </div>
    );
  }

  if (type === "insight" && config.chart_type === "number") return (
    <div className="grid h-80 place-items-center text-center">
      <div>
        <p className="text-6xl font-semibold text-[var(--text-primary)]">{result?.total ?? 0}</p>
        {config.compare && (
          <p className={`mt-3 text-sm ${(result?.change ?? 0) >= 0 ? "text-emerald-400" : "text-[var(--text-faint)]"}`}>
            {(result?.change ?? 0) >= 0 ? "+" : ""}{result?.change ?? 0}% vs previous period
          </p>
        )}
      </div>
    </div>
  );

  // Pick the chart for the report type: funnel→funnel bars; time_in_stage→bar; forecast→line with a
  // shaded projection band; otherwise the configured chart type. Real data only.
  const chartType = type === "funnel" ? "funnel"
    : type === "time_in_stage" ? "bar"
    : type === "forecast" ? "line"
    : config.chart_type === "number" ? "line"
    : config.chart_type;
  return (
    <AutoChart
      chartType={chartType}
      data={data}
      height={type === "funnel" || type === "time_in_stage" ? Math.max(300, data.length * 46) : 320}
      forecastFrom={result?.forecast_from}
    />
  );
}
