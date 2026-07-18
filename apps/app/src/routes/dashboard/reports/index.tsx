import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart2, LayoutDashboard, Plus, Zap, ArrowRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, PageSkeletonCards, DelayedLoading, ErrorState } from "../../../components/ui/page-state";
import { CommandPageHeader } from "../../../components/ui/controls";
import { apiClient } from "../../../lib/api-client";
import { useAskContextStore } from "../../../lib/ask-context-store";
import { useRecordAggregate, aggScopeNotes, topGroup, type AggResp, type AggOp } from "../../../hooks/useRecordAggregate";
import { useCurrency, formatMoney } from "../../../hooks/useCurrency";

interface ObjAttr { name: string; type?: string }
interface DashboardItem { id: string; name?: string; updated_at: string; widgets?: unknown[] }
interface ObjectType   { slug: string; name_plural: string; attributes?: ObjAttr[] }

// Group live reports by PURPOSE instead of one flat wall of near-identical cards. Each object type is
// matched to the first category whose pattern hits its slug/name; anything unmatched falls to "Other".
// Purely presentational — every object still links to the same live report.
const REPORT_GROUPS: { key: string; label: string; match: RegExp }[] = [
  { key: "revenue",  label: "Revenue & finance", match: /deal|invoice|expense|payment|tax|cost|quote|credit|billing|revenue|order/i },
  { key: "people",   label: "Relationships",     match: /compan|people|person|contact|lead|investor|partner|client|account|employee|patient|doctor/i },
  { key: "ops",      label: "Operations",        match: /task|project|ticket|asset|training|visit|feature|ops|activit|event/i },
  { key: "other",    label: "Other records",     match: /.*/ },
];
const groupOf = (o: ObjectType) => (REPORT_GROUPS.find(g => g.match.test(`${o.slug} ${o.name_plural}`)) ?? REPORT_GROUPS[REPORT_GROUPS.length - 1]!).key;

// Same attribute-name → data-key normalization the record table + create form use.
const normKey = (s: string) => s.toLowerCase().replace(/\s+/g, "_");
// Resolve the few fields worth a card KPI from the persisted object schema (no inference of finance
// state — a currency column is just a numeric column; paid/unpaid stays a plain checkbox).
function resolveKpiFields(attrs?: ObjAttr[]) {
  const typed = (attrs ?? []).filter(a => a?.name).map(a => ({ key: normKey(a.name), type: a.type ?? "" }));
  const money = typed.find(t => t.type === "currency") ?? typed.find(t => t.type === "number" || t.type === "percentage") ?? null;
  const checkbox = typed.find(t => t.type === "checkbox") ?? null;
  const group = typed.find(t => t.type === "select")
    ?? typed.find(t => /(^|_)(status|stage)($|_)/.test(t.key) || t.key === "deal_stage") ?? null;
  return { money, checkbox, group };
}

// Lazy-in-view: only fire a card's aggregate calls once it scrolls near the viewport, so an index with
// many object types doesn't fan out dozens of requests on first paint.
function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setInView(true); io.disconnect(); } }, { rootMargin: "160px" });
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);
  return [ref, inView] as const;
}

function ScopeNotes({ resp, op }: { resp: AggResp; op: AggOp }) {
  const notes = aggScopeNotes(resp, op);
  if (!notes.length) return null;
  return <>{notes.map((n, i) => <span key={i} className="ml-1" style={{ color: n.warn ? "#c6892e" : "var(--text-faint)" }}>· {n.text}</span>)}</>;
}
function Kpi({ label, value, resp, op }: { label: string; value: string; resp?: AggResp; op: AggOp }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="tabular-nums font-medium" style={{ color: "var(--text-primary)" }}>{value}</span>
      <span style={{ color: "var(--text-faint)" }}>{label}</span>
      {resp && <ScopeNotes resp={resp} op={op} />}
    </span>
  );
}

// A single generic-object report card — the same link/target as before, now with REAL all-time KPIs
// pulled from /records/aggregate. Any failing/loading call simply omits its KPI (never a fake number),
// so the card always degrades cleanly to its original shell.
function ReportObjectCard({ obj }: { obj: ObjectType }) {
  const [ref, inView] = useInView<HTMLAnchorElement>();
  const { display } = useCurrency();
  const fields = resolveKpiFields(obj.attributes);

  const countQ = useRecordAggregate({ objectType: obj.slug, column: "name", op: "count", enabled: inView });
  // One "primary value" KPI: a money/number sum, else a checked-count. (≤1 heavier call per card.)
  const moneyQ = useRecordAggregate({ objectType: obj.slug, column: fields.money?.key ?? "", op: "sum", currency: fields.money?.type === "currency", enabled: inView && !!fields.money });
  // Completeness of the primary numeric field — turns a bare "0 Σ" on an empty column into an honest
  // "no data yet" instead of a misleading zero. One extra call, only on cards that have a numeric field.
  const filledQ = useRecordAggregate({ objectType: obj.slug, column: fields.money?.key ?? "", op: "filled", enabled: inView && !!fields.money });
  const checkedQ = useRecordAggregate({ objectType: obj.slug, column: fields.checkbox?.key ?? "", op: "checked", enabled: inView && !fields.money && !!fields.checkbox });
  // Top status/stage group (a real category, not "unset").
  const groupQ = useRecordAggregate({ objectType: obj.slug, column: "name", op: "count", groupBy: fields.group?.key ?? "none", enabled: inView && !!fields.group });

  const money = moneyQ.data;
  const filled = filledQ.data?.value ?? null;
  const totalN = countQ.data?.value ?? null;
  // The primary field exists but is entirely empty → show "no data yet", never a misleading "0 Σ".
  const moneyEmpty = !!fields.money && filled === 0;
  const filledPct = (totalN != null && totalN > 0 && filled != null) ? Math.round((filled / totalN) * 100) : null;
  const moneyStr = !moneyEmpty && money?.value != null
    ? (fields.money?.type === "currency" ? formatMoney(money.value, money.currency ?? display)
      : fields.money?.type === "percentage" ? `${(money.value % 1 === 0 ? money.value : Number(money.value.toFixed(1))).toLocaleString()}%`
      : (money.value % 1 === 0 ? money.value.toLocaleString() : money.value.toFixed(2)))
    : null;
  const top = topGroup(groupQ.data);
  // A card that can only ever show a plain record count (no numeric, checkbox, or group field) is
  // labelled honestly so a sparse card reads as "nothing else to compute", not "broken/generic".
  const noComputableKpi = !fields.money && !fields.checkbox && !fields.group;
  const hasKpis = !!(countQ.data || moneyStr || checkedQ.data || top);

  return (
    <Link
      ref={ref}
      to={`/reports/sales?object=${obj.slug}`}
      className="group flex items-start gap-3 overflow-hidden rounded-sm border p-3.5 transition-colors hover:border-[var(--section-accent)]"
      style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border"
        style={{ borderColor: "var(--section-accent-line)", background: "var(--section-accent-soft)", color: "var(--section-accent)" }}>
        <BarChart2 size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{obj.name_plural}</p>
        {hasKpis ? (
          <>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px]" style={{ color: "var(--text-muted)" }}>
              {countQ.data && <Kpi label={(countQ.data.value ?? 0) === 1 ? "record" : "records"} value={countQ.data.value?.toLocaleString() ?? "0"} op="count" />}
              {moneyStr && <Kpi label={`Σ ${fields.money!.key}`} value={moneyStr} resp={money} op="sum" />}
              {/* Numeric field exists but is empty → honest "no data yet", not a misleading 0. */}
              {moneyEmpty && <span className="inline-flex items-baseline gap-1 whitespace-nowrap"><span style={{ color: "var(--text-faint)" }}>{fields.money!.key} · no data yet</span></span>}
              {/* Completeness of the primary numeric field, shown only when partially filled (signal, not noise). */}
              {moneyStr && filledPct != null && filledPct < 100 && <span className="whitespace-nowrap" style={{ color: "var(--text-faint)" }}>{filledPct}% filled</span>}
              {!fields.money && checkedQ.data && <Kpi label="checked" value={(checkedQ.data.value ?? 0).toLocaleString()} resp={checkedQ.data} op="checked" />}
              {top && <span className="inline-flex items-baseline gap-1 whitespace-nowrap"><span className="font-medium" style={{ color: "var(--text-secondary)" }}>{top.label}</span><span style={{ color: "var(--text-faint)" }}>top · {top.count.toLocaleString()}</span></span>}
            </div>
            <p className="mt-1 text-[10px]" style={{ color: "var(--text-faint)" }}>Computed from records · all-time{noComputableKpi && " · no numeric field"}</p>
          </>
        ) : (
          // Loading / no-KPI fallback — the original honest shell, never a fabricated number.
          <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--text-muted)" }}>Computed from your {obj.name_plural.toLowerCase()} on open</p>
        )}
      </div>
      <ArrowRight size={14} className="mt-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: "var(--section-accent)" }} />
    </Link>
  );
}


function NewDashboardDialog({ onCreate, onClose }: { onCreate: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 p-4">
      <div className="surface-modal w-full max-w-sm rounded-sm p-5 shadow-[0_24px_64px_rgba(0,0,0,0.35)] dark:shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>New dashboard</h2>
          <button onClick={onClose} className="btn-icon h-7 w-7"><X size={14}/></button>
        </div>
        <input
          ref={inputRef}
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && name.trim()) onCreate(name.trim()); if (e.key === "Escape") onClose(); }}
          placeholder="e.g. Sales overview, Q2 metrics…"
          className="key-input w-full mb-3"
        />
        <button
          onClick={() => { if (name.trim()) onCreate(name.trim()); }}
          disabled={!name.trim()}
          className="btn-primary w-full py-2.5 text-sm font-semibold"
        >
          Create dashboard
        </button>
      </div>
    </div>
  );
}

export function ReportsPage() {
  const navigate  = useNavigate();
  const qc        = useQueryClient();
  const [creating, setCreating] = useState(false);

  // Page-level reports context — no specific report/dashboard selected yet.
  useEffect(() => {
    useAskContextStore.getState().setContext({
      route: "/reports",
      scope_label: "the Reports page",
    });
    return () => useAskContextStore.getState().setContext(null);
  }, []);

  const objectsQ = useQuery({
    queryKey: ["sidebar-objects"],
    queryFn:  () => apiClient.get<ObjectType[]>("/objects"),
    staleTime: 60_000,
  });
  const objects = objectsQ.data ?? [];

  const dashboardsQ = useQuery({
    queryKey: ["dashboards"],
    queryFn:  () => apiClient.get<DashboardItem[]>("/dashboards"),
  });

  const createDashboard = useMutation({
    mutationFn: (name: string) => apiClient.post<DashboardItem>("/dashboards", { name }),
    onSuccess:  item => { qc.invalidateQueries({ queryKey: ["dashboards"] }); navigate(`/reports/dashboards/${item.id}`); },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Shared command header — same pattern as Decisions / Discovery / Agents. Honest state:
          reports recompute from live records; no fabricated "AI ran" claim. */}
      <CommandPageHeader
        icon={BarChart2}
        callsign="SIGNAL"
        title="Reports"
        subtitle="Live analytics computed from your records — AI insight where a run exists."
        status={[{ label: "computed from records", kind: "monitoring" }]}
      />

      {/* ── Live Reports ── */}
      <section className="mb-10">
        <div className="mb-3 flex items-center gap-2">
          <Zap size={14} style={{ color: "var(--text-muted)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Live Reports</h2>
          <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)", color: "var(--text-muted)" }}>
            Computed live from your records · AI insights on demand
          </span>
        </div>

        {objectsQ.isLoading ? (
          <DelayedLoading onRetry={() => objectsQ.refetch()}><PageSkeletonCards count={3} label="Loading reports…"/></DelayedLoading>
        ) : objectsQ.isError ? (
          <ErrorState error={objectsQ.error as Error} onRetry={() => objectsQ.refetch()} />
        ) : objects.length === 0 ? (
          <EmptyState icon={BarChart2} title="No object types yet" description="Reports appear here once your workspace has record types to analyse." />
        ) : (
          // Grouped by purpose (Revenue / Relationships / Operations / Other) so the list is scannable
          // instead of one wall of identical cards. The repeated per-card capability chips are gone —
          // "AI insights on demand" is stated once in the section badge above.
          <div className="space-y-6">
            {REPORT_GROUPS.filter(g => objects.some(o => groupOf(o) === g.key)).map(group => (
              <div key={group.key}>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>{group.label}</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {objects.filter(o => groupOf(o) === group.key).map(obj => (
                    <ReportObjectCard key={obj.slug} obj={obj} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Dashboards ── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutDashboard size={14} style={{ color: "var(--text-muted)" }} />
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Dashboards</h2>
            <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)", color: "var(--text-muted)" }}>
              Pin live widgets &amp; custom charts
            </span>
          </div>
          <button
            onClick={() => setCreating(true)}
            disabled={createDashboard.isPending}
            className="btn-secondary text-xs"
          >
            <Plus size={11} /> New dashboard
          </button>
        </div>

        {dashboardsQ.isLoading ? (
          <DelayedLoading onRetry={() => dashboardsQ.refetch()}><PageSkeletonCards count={3} label="Loading dashboards…"/></DelayedLoading>
        ) : dashboardsQ.data?.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dashboardsQ.data.map(dashboard => {
              const allWidgets = Array.isArray(dashboard.widgets) ? dashboard.widgets as Array<{ type?: string }> : [];
              const liveCount   = allWidgets.filter(w => w.type === "live").length;
              const reportCount = allWidgets.filter(w => w.type === "report").length;
              const totalCount  = allWidgets.length;
              const otherCount  = Math.max(0, totalCount - liveCount - reportCount);
              // Real widget composition (live / chart / other) — heights proportional to actual counts,
              // not decorative noise.
              const comp = [
                { n: liveCount, color: "#2f9e6b" },
                { n: reportCount, color: "var(--text-secondary)" },
                { n: otherCount, color: "var(--border-strong)" },
              ].filter(x => x.n > 0);
              const compMax = Math.max(1, ...comp.map(x => x.n));
              return (
                <Link
                  key={dashboard.id}
                  to={`/reports/dashboards/${dashboard.id}`}
                  className="surface-card group overflow-hidden rounded-sm transition-colors hover:border-[var(--border-strong)]"
                  style={{ borderColor: "var(--border-soft)" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-soft)"; }}
                >
                  {/* Preview area */}
                  <div className="relative h-28 overflow-hidden px-4 pt-3 pb-0" style={{ background: "var(--surface-hover)" }}>
                    {totalCount === 0 ? (
                      <div className="flex h-full items-center justify-center">
                        <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>Empty · click to add widgets</p>
                      </div>
                    ) : (
                      <>
                        {/* Widget type badges */}
                        <div className="mb-2 flex gap-1.5">
                          {liveCount > 0 && (
                            <span className="rounded-sm border border-[#2f9e6b]/25 bg-[#2f9e6b]/10 px-2 py-0.5 text-[10px] font-medium text-[#2f9e6b]">
                              {liveCount} live
                            </span>
                          )}
                          {reportCount > 0 && (
                            <span className="rounded-sm border border-stone-500/30 bg-stone-600/10 px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
                              {reportCount} chart{reportCount !== 1 ? "s" : ""}
                            </span>
                          )}
                          {totalCount > 0 && liveCount === 0 && reportCount === 0 && (
                            <span className="rounded-sm border px-2 py-0.5 text-[10px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
                              {totalCount} widget{totalCount !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                        {/* Real widget composition — bar per widget type, height ∝ actual count. */}
                        <div className="flex items-end gap-1.5 h-12">
                          {comp.map((seg, i) => (
                            <div key={i} className="flex-1 rounded-t-sm transition-all"
                              style={{ height: `${Math.max(14, (seg.n / compMax) * 100)}%`, background: seg.color, opacity: 0.55 }} />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  {/* Info row */}
                  <div className="flex items-center gap-2 px-4 py-3 border-t" style={{ borderColor: "var(--border-soft)" }}>
                    <LayoutDashboard size={13} className="text-[var(--text-muted)] shrink-0"/>
                    <h3 className="flex-1 truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>{dashboard.name || "Untitled dashboard"}</h3>
                    <span className="shrink-0 text-[10px]" style={{ color: "var(--text-faint)" }}>
                      {new Date(dashboard.updated_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={LayoutDashboard}
            title="No dashboards yet"
            description="Create a dashboard to pin live object widgets and custom charts side by side."
            action={
              <button onClick={() => setCreating(true)} className="btn-primary text-sm">
                Create dashboard
              </button>
            }
          />
        )}
      </section>

      {creating && (
        <NewDashboardDialog
          onCreate={name => { setCreating(false); createDashboard.mutate(name); }}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
