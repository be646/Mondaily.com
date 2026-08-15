import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart2, LayoutDashboard, Plus, Zap, ArrowRight, X, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, PageSkeletonCards, DelayedLoading, ErrorState } from "../../../components/ui/page-state";
import { CommandPageHeader, FieldSelect } from "../../../components/ui/controls";
import { KPIGrid, KPITile } from "../../../components/ui/kpi";
import { periodRange, previousRange } from "../../../lib/period";
import { apiClient as outcomesClient, BASE_URL } from "../../../lib/api-client";
import { apiClient } from "../../../lib/api-client";
import { useAskContextStore } from "../../../lib/ask-context-store";
import { useRecordAggregate, aggScopeNotes, topGroup, type AggResp, type AggOp } from "../../../hooks/useRecordAggregate";
import { useCurrency, formatMoney } from "../../../hooks/useCurrency";
import { Modal, ModalActions } from "@/components/ui/modal";
import { DatePicker } from "../../../components/ui/date-picker";

interface ObjAttr { name: string; type?: string }
interface DashboardItem { id: string; name?: string; updated_at: string; widgets?: unknown[] }
interface ObjectType   { slug: string; name_plural: string; attributes?: ObjAttr[] }

// What each card reports up to the Executive Overview once its (lazy, in-view) aggregates resolve.
// Everything here is derived from the SAME record aggregates the card already fetched — the overview
// adds no calls of its own, and only ever reflects cards that have actually loaded ("visible cards").
interface CardStat {
  count: number | null;        // record count (null until loaded)
  hasNumeric: boolean;         // object has ≥1 numeric/currency candidate field
  valueField: string | null;   // the selected primary field key (null if none)
  sum: number | null;          // trustworthy sum of the primary field (null if untrustworthy/absent)
  sumCurrency: string | null;   // display currency of that sum, when it's a currency field
  isCurrency: boolean;         // whether the primary field is a currency type
  filledPct: number | null;     // completeness of the primary field
  noData: boolean;             // has a numeric field but it settled empty ("no data yet")
}

// Group live reports by PURPOSE instead of one flat wall of near-identical cards. Each object type is
// matched to the first category whose pattern hits its slug/name; anything unmatched falls to "Other".
// Purely presentational — every object still links to the same live report.
const REPORT_GROUPS: { key: string; label: string; match: RegExp }[] = [
  { key: "revenue",  label: "Revenue & finance", match: /deal|invoice|expense|payment|tax|cost|quote|credit|billing|revenue|order/i },
  { key: "people",   label: "Relationships",     match: /compan|people|person|contact|lead|investor|partner|client|account|employee|patient|doctor/i },
  { key: "ops",      label: "Operations",        match: /task|project|ticket|asset|training|visit|feature|ops|activit|event/i },
  { key: "other",    label: "Other records",     match: /.*/ },
];
// Object names arrive as raw slugs ("contacts", "assets") next to hand-titled ones ("People") —
// the mixed casing read as neglect. Display-only: the slug itself is untouched.
const titleCase = (s: string) => s.replace(/[_-]+/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());

const groupOf = (o: ObjectType) => (REPORT_GROUPS.find(g => g.match.test(`${o.slug} ${o.name_plural}`)) ?? REPORT_GROUPS[REPORT_GROUPS.length - 1]!).key;

// Same attribute-name → data-key normalization the record table + create form use.
const normKey = (s: string) => s.toLowerCase().replace(/\s+/g, "_");
type KpiField = { key: string; type: string };
// How many numeric/currency candidate fields a card will probe for data (Phase 3j). Bounded so a card
// with many numeric columns still fans out only a handful of cheap `filled` checks — never the whole
// schema. Candidates stay in schema order, so candidates[0] is the legacy "first field" fallback.
const MAX_KPI_CANDIDATES = 4;
// Resolve the fields worth a card KPI from the persisted object schema (no inference of finance state —
// a currency column is just a numeric column; paid/unpaid stays a plain checkbox). Returns the ordered
// numeric/currency candidates plus the checkbox + group fields.
function resolveKpiFields(attrs?: ObjAttr[]) {
  const typed: KpiField[] = (attrs ?? []).filter(a => a?.name).map(a => ({ key: normKey(a.name), type: a.type ?? "" }));
  const candidates = typed.filter(t => t.type === "currency" || t.type === "number" || t.type === "percentage").slice(0, MAX_KPI_CANDIDATES);
  const checkbox = typed.find(t => t.type === "checkbox") ?? null;
  const group = typed.find(t => t.type === "select")
    ?? typed.find(t => /(^|_)(status|stage)($|_)/.test(t.key) || t.key === "deal_stage") ?? null;
  return { candidates, checkbox, group };
}

// Smarter primary-field pick (Phase 3j): from the probed candidates, choose the one with the most
// filled cells; ties prefer a currency/money field over a plain number. While probes are loading, or
// on error, fall back to the first schema numeric field. If every candidate is empty, keep the first
// field (its "no data yet" label stays honest). Returns { field, filled } — filled reused for %.
function pickPrimaryField(
  candidates: KpiField[],
  probes: { field: KpiField; filled: number | null; settled: boolean }[],
): { field: KpiField | null; filled: number | null } {
  if (!candidates.length) return { field: null, filled: null };
  const withData = probes.filter(p => p.filled != null);
  const anyFilled = withData.some(p => (p.filled ?? 0) > 0);
  if (anyFilled) {
    let best = withData[0]!;
    for (const p of withData) {
      const better = (p.filled ?? 0) > (best.filled ?? 0);
      const tieToMoney = (p.filled ?? 0) === (best.filled ?? 0) && p.field.type === "currency" && best.field.type !== "currency";
      if (better || tieToMoney) best = p;
    }
    return { field: best.field, filled: best.filled };
  }
  // No candidate has data → keep the first field. Report its filled only once its probe has settled
  // (so an empty column reads "no data yet", but a still-loading one doesn't prematurely).
  const first = probes.find(p => p.field.key === candidates[0]!.key);
  return { field: candidates[0]!, filled: first?.settled ? (first.filled ?? 0) : null };
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

/**
 * Sheet — one framed section panel. The page reads as a stack of report SHEETS: the panel frames,
 * hairlines divide inside it, and data fills it. (The bare-hairline pass stripped the frames and
 * the page collapsed into lines; the card-wall before it had frames but no hierarchy. This is the
 * deliberate middle.)
 */
function Sheet({ title, sub, right, children, className = "" }: { title: string; sub?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mb-5 rounded-lg border p-4 ${className}`} style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 className="text-[12.5px] font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h2>
        {sub && <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{sub}</span>}
        {right && <><span className="grow" />{right}</>}
      </div>
      {children}
    </section>
  );
}

/**
 * Tiny live trend sparkline for the Report studio header — the SAME bundle the exports render.
 * Deliberately small: it seasons the sheet with real data; the full chart belongs to the files
 * and the dashboard widgets, so a half-panel preview only left the studio looking empty.
 */
function StudioTrendPreview() {
  interface Mini { series: { label: string; won: number; projected?: boolean }[]; forecastFrom: number | null; meta: { base: string } }
  const q = useQuery<Mini>({ queryKey: ["ws-bundle", "monthly"], queryFn: () => apiClient.get("/reports/bundle.json?period=monthly"), staleTime: 120_000 });
  const series = q.data?.series ?? [];
  if (!series.length) return null;                                  // quiet: no skeleton, no filler box
  const W = 132, H = 30, PAD = 3;
  const max = Math.max(1, ...series.map(s => s.won));
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(1, series.length - 1);
  const y = (v: number) => H - 5 - (v / max) * (H - 10);
  const cut = q.data?.forecastFrom ?? series.length;
  const pts = (from: number, to: number) => series.slice(from, to).map((s, i) => `${x(from + i).toFixed(1)},${y(s.won).toFixed(1)}`).join(" ");
  return (
    <span className="inline-flex items-center gap-1.5" title="Closed won this month — live, projection dashed">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[30px] w-[132px]" role="img" aria-label="Closed won trend, projection dashed">
        <polyline points={pts(0, cut)} fill="none" stroke="var(--section-accent)" strokeWidth="1.8" strokeLinejoin="round" />
        {cut < series.length && <polyline points={pts(cut - 1, series.length)} fill="none" stroke="var(--section-accent)" strokeWidth="1.8" strokeDasharray="3 2.5" />}
      </svg>
      <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>won · live</span>
    </span>
  );
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
function ReportObjectCard({ obj, onStat }: { obj: ObjectType; onStat?: (slug: string, stat: CardStat) => void }) {
  const [ref, inView] = useInView<HTMLAnchorElement>();
  const { display } = useCurrency();
  const fields = resolveKpiFields(obj.attributes);

  const countQ = useRecordAggregate({ objectType: obj.slug, column: "name", op: "count", enabled: inView });
  // Probe the completeness of up to MAX_KPI_CANDIDATES numeric/currency fields with cheap `filled`
  // checks, so we can pick the field that actually has data. Fixed slot count keeps the hook order
  // stable; each slot is disabled when there's no candidate or the card isn't in view.
  const cands = fields.candidates;
  const p0 = useRecordAggregate({ objectType: obj.slug, column: cands[0]?.key ?? "", op: "filled", enabled: inView && !!cands[0] });
  const p1 = useRecordAggregate({ objectType: obj.slug, column: cands[1]?.key ?? "", op: "filled", enabled: inView && !!cands[1] });
  const p2 = useRecordAggregate({ objectType: obj.slug, column: cands[2]?.key ?? "", op: "filled", enabled: inView && !!cands[2] });
  const p3 = useRecordAggregate({ objectType: obj.slug, column: cands[3]?.key ?? "", op: "filled", enabled: inView && !!cands[3] });
  const probeQs = [p0, p1, p2, p3];
  const probes = cands.map((field, i) => ({ field, filled: probeQs[i]!.data?.value ?? null, settled: probeQs[i]!.isSuccess || probeQs[i]!.isError }));
  const { field: primary, filled } = pickPrimaryField(cands, probes);

  // Sum of the SELECTED primary field (currency-aware). The completeness (`filled`) is reused from the
  // winning probe, so no extra call is spent on it.
  const moneyQ = useRecordAggregate({ objectType: obj.slug, column: primary?.key ?? "", op: "sum", currency: primary?.type === "currency", enabled: inView && !!primary });
  const checkedQ = useRecordAggregate({ objectType: obj.slug, column: fields.checkbox?.key ?? "", op: "checked", enabled: inView && !primary && !!fields.checkbox });
  // Top status/stage group (a real category, not "unset").
  const groupQ = useRecordAggregate({ objectType: obj.slug, column: "name", op: "count", groupBy: fields.group?.key ?? "none", enabled: inView && !!fields.group });

  const money = moneyQ.data;
  const totalN = countQ.data?.value ?? null;
  // The selected field exists but is entirely empty → show "no data yet", never a misleading "0 Σ".
  const moneyEmpty = !!primary && filled === 0;
  const filledPct = (totalN != null && totalN > 0 && filled != null) ? Math.round((filled / totalN) * 100) : null;
  // A ZERO sum is only trustworthy once we know the column actually has data — otherwise a transient
  // (filled still loading) or errored probe would flash a misleading "0 Σ field". So render the sum
  // only when it's non-zero, OR when the filled probe has settled with filled > 0 (a real all-zeros
  // column). A non-zero sum always renders regardless of the filled probe.
  const sumTrustworthy = money?.value != null && (money.value !== 0 || (filled != null && filled > 0));
  const moneyStr = !moneyEmpty && sumTrustworthy
    ? (primary?.type === "currency" ? formatMoney(money!.value!, money!.currency ?? display)
      : primary?.type === "percentage" ? `${(money!.value! % 1 === 0 ? money!.value! : Number(money!.value!.toFixed(1))).toLocaleString()}%`
      : (money!.value! % 1 === 0 ? money!.value!.toLocaleString() : money!.value!.toFixed(2)))
    : null;
  const top = topGroup(groupQ.data);
  // A card that can only ever show a plain record count (no numeric, checkbox, or group field) is
  // labelled honestly so a sparse card reads as "nothing else to compute", not "broken/generic".
  const noComputableKpi = !cands.length && !fields.checkbox && !fields.group;
  const hasKpis = !!(countQ.data || moneyStr || checkedQ.data || top);

  // Report this card's resolved KPI up to the Executive Overview. Purely derived from the aggregates
  // already fetched above — no extra request. Fires only as values change (count/field/sum/completeness).
  const sumForStat = sumTrustworthy && money?.value != null ? money.value : null;
  useEffect(() => {
    onStat?.(obj.slug, {
      count: countQ.data?.value ?? null,
      hasNumeric: cands.length > 0,
      valueField: primary?.key ?? null,
      sum: sumForStat,
      sumCurrency: money?.currency ?? null,
      isCurrency: primary?.type === "currency",
      filledPct,
      noData: moneyEmpty,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj.slug, countQ.data?.value, cands.length, primary?.key, primary?.type, sumForStat, money?.currency, filledPct, moneyEmpty]);

  // Distribution bar — the REAL top status/stage groups the card already fetched, drawn as one
  // proportional strip (top 3 segments at descending opacity). No group data → no bar, no filler.
  const segs = (groupQ.data?.groups ?? []).filter(g => g.label && g.label !== "—").slice(0, 3);
  const segTotal = segs.reduce((s2, g2) => s2 + g2.count, 0);

  return (
    <Link
      ref={ref}
      to={`/reports/sales?object=${obj.slug}`}
      className="group flex flex-col rounded-md p-3 transition-colors hover:bg-[color-mix(in_srgb,var(--section-accent)_6%,var(--surface-hover))]"
      style={{ background: "var(--surface-hover)" }}
    >
      <div className="flex items-baseline gap-2">
        <p className="min-w-0 truncate text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{titleCase(obj.name_plural)}</p>
        <span className="grow" />
        <ArrowRight size={12} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: "var(--section-accent)" }} />
      </div>
      {hasKpis ? (
        <>
          <p className="mt-0.5 text-[17px] font-semibold tabular-nums leading-tight" style={{ color: "var(--text-primary)" }}>
            {moneyStr ?? countQ.data?.value?.toLocaleString() ?? "—"}
            <span className="ml-1.5 text-[10.5px] font-normal" style={{ color: "var(--text-muted)" }}>
              {moneyStr ? `Σ ${primary!.key.replace(/_/g, " ")}` : (countQ.data?.value ?? 0) === 1 ? "record" : "records"}
            </span>
          </p>
          {moneyStr && countQ.data && (
            <p className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>{countQ.data.value?.toLocaleString()} records{filledPct != null && filledPct < 100 ? ` · ${filledPct}% filled` : ""}</p>
          )}
          {moneyEmpty && <p className="text-[10.5px]" style={{ color: "var(--text-faint)" }}>{primary!.key.replace(/_/g, " ")} · no data yet</p>}
          {!primary && checkedQ.data && <p className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>{(checkedQ.data.value ?? 0).toLocaleString()} checked</p>}
          {segTotal > 0 ? (
            <>
              <div className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded-full">
                {segs.map((g, i) => (
                  <span key={g.label} style={{ width: `${Math.max(4, (g.count / segTotal) * 100)}%`, background: "var(--section-accent)", opacity: 0.85 - i * 0.28 }} />
                ))}
              </div>
              <p className="mt-1 truncate text-[10px]" style={{ color: "var(--text-faint)" }}>{segs.map(g => `${g.label} ${g.count.toLocaleString()}`).join(" · ")}</p>
            </>
          ) : (
            <p className="mt-2 text-[10px]" style={{ color: "var(--text-faint)" }}>all-time{noComputableKpi && " · no numeric field"}</p>
          )}
        </>
      ) : (
        // Loading / no-KPI fallback — the original honest shell, never a fabricated number.
        <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>Computed from your {obj.name_plural.toLowerCase()} on open</p>
      )}
    </Link>
  );
}


// ── Executive Overview (Phase 3k) ──────────────────────────────────────────────
// A calm, compact strip above the object cards. Every number is derived from the cards' OWN record
// aggregates (reported up via CardStat) — the overview issues ZERO extra requests and only ever counts
// cards that have actually loaded, so it says "visible cards only" and never implies whole-workspace
// completeness. No AI, no finance inference — generic record signals + links to real routes.
function ExecutiveOverview({ objects, stats }: { objects: ObjectType[]; stats: Record<string, CardStat> }) {
  const { display } = useCurrency();
  const entries = Object.entries(stats);
  const loaded = entries.filter(([, s]) => s.count != null);
  const loadedCount = loaded.length;
  const totalRecords = loaded.reduce((n, [, s]) => n + (s.count ?? 0), 0);
  const nameOf = (slug: string) => objects.find(o => o.slug === slug)?.name_plural ?? slug;

  // Data readiness — honest completeness signals across the loaded cards.
  //  • withData: a numeric field that actually has values (any fill > 0), including fully-filled.
  //  • partial:  that field is only partially populated (0 < fill < 100).
  //  • empty:    a numeric field that settled with no data. • noField: no numeric field at all.
  const noNumeric = loaded.filter(([, s]) => !s.hasNumeric).length;
  const noDataYet = loaded.filter(([, s]) => s.hasNumeric && s.noData).length;
  const withData  = loaded.filter(([, s]) => s.hasNumeric && !s.noData && s.filledPct != null && s.filledPct > 0).length;
  const partial   = loaded.filter(([, s]) => s.filledPct != null && s.filledPct > 0 && s.filledPct < 100).length;

  // Value signal — a SINGLE top object by trustworthy sum (never a cross-object total; different value
  // fields aren't additive). "Value fields detected" counts objects that expose a numeric/value field.
  const valueDetected = loaded.filter(([, s]) => s.hasNumeric).length;
  let topValue: { slug: string; sum: number; currency: string | null; isCurrency: boolean } | null = null;
  for (const [slug, s] of entries) {
    if (s.sum == null) continue;
    if (!topValue || s.sum > topValue.sum) topValue = { slug, sum: s.sum, currency: s.sumCurrency, isCurrency: s.isCurrency };
  }
  const topValueStr = topValue
    ? (topValue.isCurrency ? formatMoney(topValue.sum, topValue.currency ?? display)
      : (topValue.sum % 1 === 0 ? topValue.sum.toLocaleString() : topValue.sum.toFixed(2)))
    : null;

  // Strongest report = the top-value object, else the highest record count among loaded cards.
  let strongest = topValue?.slug ?? null;
  if (!strongest) { let best = -1; for (const [slug, s] of entries) { if ((s.count ?? -1) > best) { best = s.count ?? -1; strongest = slug; } } }
  // Sparse = an object with a numeric field but no data, else the least-filled primary field.
  let sparse: string | null = null;
  for (const [slug, s] of entries) { if (s.hasNumeric && s.noData) { sparse = slug; break; } }
  if (!sparse) { let low = 101; for (const [slug, s] of entries) { if (s.filledPct != null && s.filledPct > 0 && s.filledPct < low) { low = s.filledPct; sparse = slug; } } }
  // Finance objects (real route target only — no finance recomputation here).
  const financeObj = objects.find(o => groupOf(o) === "revenue");

  const Cell = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="min-w-0 px-4 py-3">
      <p className="text-body" style={{ color: "var(--text-faint)" }}>{label}</p>
      <div className="mt-1 text-[12px]" style={{ color: "var(--text-secondary)" }}>{children}</div>
    </div>
  );

  return (
    <section className="mb-8 overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      <div className="grid divide-y sm:grid-cols-2 lg:grid-cols-4 sm:divide-y-0 sm:divide-x" style={{ borderColor: "var(--border-soft)" }}>
        {/* 1 — Coverage */}
        <Cell label="Coverage">
          {loadedCount === 0 ? (
            <span style={{ color: "var(--text-faint)" }}>Computing as cards load…</span>
          ) : (
            <>
              <span className="tabular-nums font-medium" style={{ color: "var(--text-primary)" }}>{totalRecords.toLocaleString()}</span>
              <span style={{ color: "var(--text-faint)" }}> records · {loadedCount}/{objects.length} types loaded</span>
            </>
          )}
        </Cell>
        {/* 2 — Data readiness */}
        <Cell label="Data readiness">
          {loadedCount === 0 ? <span style={{ color: "var(--text-faint)" }}>—</span> : (
            <span>
              <span className="tabular-nums font-medium" style={{ color: withData ? "#2f9e6b" : "var(--text-secondary)" }}>{withData}</span>
              <span style={{ color: "var(--text-faint)" }}> with data{partial ? ` (${partial} partial)` : ""} · </span>
              <span className="tabular-nums" style={{ color: noDataYet ? "#c6892e" : "var(--text-faint)" }}>{noDataYet} empty</span>
              <span style={{ color: "var(--text-faint)" }}> · {noNumeric} no field</span>
            </span>
          )}
        </Cell>
        {/* 3 — Value signal (generic, no finance inference) */}
        <Cell label="Value signal">
          {topValueStr ? (
            <>
              <span className="tabular-nums font-medium" style={{ color: "var(--text-primary)" }}>{topValueStr}</span>
              <span style={{ color: "var(--text-faint)" }}> · {nameOf(topValue!.slug)} · {valueDetected} value field{valueDetected === 1 ? "" : "s"}</span>
            </>
          ) : (
            <span style={{ color: "var(--text-faint)" }}>No value signal yet</span>
          )}
        </Cell>
        {/* 4 — Next steps (real routes only) */}
        <Cell label="Next steps">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {strongest && (
              <Link to={`/reports/sales?object=${strongest}`} className="inline-flex items-center gap-0.5 hover:underline" style={{ color: "var(--section-accent)" }}>
                Strongest report <ArrowRight size={11} />
              </Link>
            )}
            {sparse && (
              <Link to={`/reports/sales?object=${sparse}`} className="inline-flex items-center gap-0.5 hover:underline" style={{ color: "var(--text-muted)" }}>
                Review sparse data <ArrowRight size={11} />
              </Link>
            )}
            {financeObj && (
              <Link to="/finance/reports" className="inline-flex items-center gap-0.5 hover:underline" style={{ color: "var(--text-muted)" }}>
                Finance reports <ArrowRight size={11} />
              </Link>
            )}
          </div>
        </Cell>
      </div>
      {/* Source / proof line — never implies whole-workspace completeness. */}
      <p className="border-t px-4 py-2 text-[10px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>
        Computed from records · all-time · visible cards only{loadedCount < objects.length ? " (scroll to load the rest)" : ""}
      </p>
    </section>
  );
}

function NewDashboardDialog({ onCreate, onClose }: { onCreate: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Modal title="New dashboard" width="sm" onClose={onClose} footer={
      <ModalActions onCancel={onClose}>
        <button onClick={() => { if (name.trim()) onCreate(name.trim()); }} disabled={!name.trim()}
          className="btn-primary h-8 px-3 text-label font-semibold">
          Create dashboard
        </button>
      </ModalActions>
    }>
        <input
          ref={inputRef}
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && name.trim()) onCreate(name.trim()); if (e.key === "Escape") onClose(); }}
          placeholder="e.g. Sales overview, Q2 metrics…"
          className="key-input w-full mb-3"
        />
    </Modal>
  );
}


/** Sales outcomes strip — the business layer (deal VALUES) from the shared outcomes engine.
 *  Admin-only endpoint: non-admins get a 403 and the strip simply doesn't render. */

// ── Report builder — any sheet → group-by → metric → hairline chart. Saved schema-free
//    (nodes object_type "saved_report"), powered entirely by the existing /records/aggregate
//    engine (workspace-scoped, currency-aware, honest truncation notes). ──────────────────────
interface AggResp2 { op: string; value?: number; currency?: string; unconverted?: number; total_rows?: number; truncated?: boolean; groups?: { label: string; value: number; count: number; unconverted?: number }[] }
interface SavedReport { id: string; data: { name?: string; object_type?: string; group_by?: string; column?: string; op?: string; currency?: boolean } }
function ReportBuilder() {
  const qc = useQueryClient();
  const objectsQ2 = useQuery<{ slug: string; name_plural?: string }[]>({ queryKey: ["object-defs"], queryFn: () => apiClient.get("/objects"), staleTime: 60_000 });
  const [objectType, setObjectType] = useState("");
  const [groupBy, setGroupBy] = useState("none");
  const [op, setOp] = useState<"count" | "sum" | "avg">("count");
  const [column, setColumn] = useState("");
  const [isMoney, setIsMoney] = useState(false);
  const [result, setResult] = useState<AggResp2 | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");

  // Column inventory from real sample rows (same approach as the AI formula builder).
  const colsQ = useQuery<string[]>({
    queryKey: ["report-cols", objectType],
    enabled: !!objectType,
    queryFn: async () => {
      const rows = await apiClient.get<{ data?: Record<string, unknown> }[]>(`/nodes?object_type=${encodeURIComponent(objectType)}&limit=20`);
      const keys = new Set<string>();
      for (const r of rows ?? []) for (const k of Object.keys(r.data ?? {})) keys.add(k);
      return [...keys].sort();
    },
  });

  const savedQ = useQuery<SavedReport[]>({
    queryKey: ["saved-reports"],
    queryFn: () => apiClient.get(`/nodes?object_type=saved_report&limit=50`),
    staleTime: 30_000,
  });

  async function run(cfg?: SavedReport["data"]) {
    const c2 = cfg ?? { object_type: objectType, group_by: groupBy, column: op === "count" ? (column || "name") : column, op, currency: isMoney };
    if (!c2.object_type || (!c2.column && c2.op !== "count")) return;
    setRunning(true); setErr(null);
    try {
      const r = await apiClient.post<AggResp2>("/records/aggregate", {
        object_type: c2.object_type, column: c2.column || "name", op: c2.op ?? "count",
        group_by: c2.group_by ?? "none", currency: !!c2.currency,
      });
      setResult(r);
      if (cfg) { setObjectType(c2.object_type!); setGroupBy(c2.group_by ?? "none"); setOp((c2.op as never) ?? "count"); setColumn(c2.column ?? ""); setIsMoney(!!c2.currency); }
    } catch (e) { setErr(e instanceof Error ? e.message : "Report failed."); }
    finally { setRunning(false); }
  }

  const save = useMutation({
    mutationFn: () => apiClient.post("/nodes", { vertical: "shared", object_type: "saved_report", data: { name: name.trim() || `${objectType} by ${groupBy}`, object_type: objectType, group_by: groupBy, column, op, currency: isMoney } }),
    onSuccess: () => { setName(""); qc.invalidateQueries({ queryKey: ["saved-reports"] }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/nodes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-reports"] }),
  });

  const fmtV = (v: number) => result?.currency ? `${result.currency} ${Math.round(v).toLocaleString()}` : (v % 1 === 0 ? v.toLocaleString() : v.toFixed(1));
  const groups = (result?.groups ?? []).slice(0, 14);
  const max = groups.length ? Math.max(...groups.map(g => g.value), 1) : 1;

  return (
    <Sheet title="Report builder" sub="any sheet → group → metric, savable">
      <div className="flex flex-wrap items-end gap-2">
        {/* The app's OWN dropdown, not the browser's: the native <select> popup ignores the
            theme entirely and read as a foreign control in the middle of the page. */}
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>Sheet
          <FieldSelect ariaLabel="Sheet" value={objectType} placeholder="Choose…" className="mt-1 w-40"
            options={(objectsQ2.data ?? []).map(o => ({ value: o.slug, label: titleCase(o.name_plural ?? o.slug) }))}
            onChange={v => { setObjectType(v); setResult(null); setColumn(""); }} />
        </div>
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>Group by
          <FieldSelect ariaLabel="Group by" value={groupBy} className="mt-1 w-40"
            options={[{ value: "none", label: "Total only" }, { value: "date", label: "Month created" },
              ...(colsQ.data ?? []).map(c2 => ({ value: c2, label: c2.replace(/_/g, " ") }))]}
            onChange={v => setGroupBy(v)} />
        </div>
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>Metric
          <FieldSelect ariaLabel="Metric" value={op} className="mt-1 w-28"
            options={[{ value: "count", label: "Count" }, { value: "sum", label: "Sum" }, { value: "avg", label: "Average" }]}
            onChange={v => setOp(v as never)} />
        </div>
        {op !== "count" && (
          <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>Of column
            <FieldSelect ariaLabel="Of column" value={column} placeholder="Choose…" className="mt-1 w-40"
              options={(colsQ.data ?? []).map(c2 => ({ value: c2, label: c2.replace(/_/g, " ") }))}
              onChange={v => setColumn(v)} />
          </div>
        )}
        {op !== "count" && (
          <label className="flex items-center gap-1.5 pb-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
            <input type="checkbox" checked={isMoney} onChange={e => setIsMoney(e.target.checked)} /> money column
          </label>
        )}
        <button onClick={() => void run()} disabled={running || !objectType || (op !== "count" && !column)} className="btn-primary h-8 px-3 text-[12px] font-semibold">{running ? "Running…" : "Run"}</button>
        {result && (
          <span className="flex items-center gap-1.5">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Save as…" className="key-input h-8 w-32 px-2 text-[12px]" />
            <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-secondary h-8 px-3 text-[12px] font-medium">Save</button>
          </span>
        )}
      </div>
      {err && <p className="mt-2 text-[12px]" style={{ color: "var(--status-error)" }}>{err}</p>}
      {result && (
        <div className="mt-3">
          {result.groups ? groups.length === 0 ? (
            <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>No rows matched — an honest empty, not an error.</p>
          ) : (
            <div className="space-y-1">
              {groups.map(g => (
                <div key={g.label} className="flex items-center gap-2 text-[11.5px]">
                  <span className="w-40 truncate" style={{ color: "var(--text-muted)" }}>{g.label || "—"}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface-hover)" }}>
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(2, Math.round((g.value / max) * 100))}%`, background: "var(--section-accent)" }} />
                  </span>
                  <span className="w-36 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>{fmtV(g.value)}{g.unconverted ? <span title={`${g.unconverted} unconverted`} style={{ color: "var(--status-warn)" }}> ·{g.unconverted}✗</span> : null}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="font-mono text-[22px] font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{fmtV(result.value ?? 0)}</p>
          )}
          {(result.truncated || (result.unconverted ?? 0) > 0) && (
            <p className="mt-1.5 text-[10.5px]" style={{ color: "var(--status-warn)" }}>
              {result.truncated ? `Computed over the first ${result.total_rows?.toLocaleString()} rows. ` : ""}
              {(result.unconverted ?? 0) > 0 ? `${result.unconverted} row(s) could not be currency-converted.` : ""}
            </p>
          )}
        </div>
      )}
      {(savedQ.data?.length ?? 0) > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>Saved reports</p>
          <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
            {savedQ.data!.map(sr => (
              <div key={sr.id} className="flex items-center gap-2 py-1.5 text-[12px]" style={{ borderColor: "var(--border-soft)" }}>
                <button onClick={() => void run(sr.data)} className="min-w-0 flex-1 truncate text-left hover:underline" style={{ color: "var(--text-primary)" }}>{sr.data.name ?? "Untitled report"}</button>
                <span className="text-[10.5px]" style={{ color: "var(--text-faint)" }}>{sr.data.object_type} · {sr.data.op}{sr.data.group_by && sr.data.group_by !== "none" ? ` by ${sr.data.group_by}` : ""}</span>
                <button onClick={() => remove.mutate(sr.id)} className="btn-icon h-6 w-6" title="Delete saved report"><span aria-hidden>×</span></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/**
 * Downloadable workspace report — Excel workbook + HTML with charts (print → PDF).
 *
 * Plain links, not fetch-and-blob: app → api is same-site, so the session cookie rides along and
 * the API streams the file with Content-Disposition. The figures come from lib/money server-side —
 * the same definitions the Brief and Owner Console show, so the file can never disagree with the
 * screens.
 */
function ExportDateButton({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchorRef} onClick={() => setOpen(o => !o)}
        className="rounded-md border px-2 py-1 text-xs"
        style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: value ? "var(--text-primary)" : "var(--text-faint)" }}>
        {value || label}
      </button>
      <DatePicker open={open} anchorRef={anchorRef} value={value}
        onChange={v => { onChange(v.slice(0, 10)); setOpen(false); }} onClose={() => setOpen(false)} />
    </>
  );
}

function DownloadReport() {
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "custom">("monthly");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const customOk = period !== "custom" || (start && end && start <= end);
  // A link click is a top-level navigation — no way to attach the X-Workspace-Id header — so the
  // workspace rides as ?ws= (the one nav exception requireAuth carves out; membership still checked).
  const ws = localStorage.getItem("mondaily_workspace_id") ?? "";
  const qs = `period=${period}${period === "custom" ? `&start=${start}&end=${end}` : ""}&ws=${ws}`;
  return (
    <Sheet title="Report studio" sub="KPIs with deltas, trend, labelled forecast — workspace calendar, base currency"
      right={<StudioTrendPreview />}>
      <div className="flex flex-wrap items-center gap-2">
        {(["daily", "weekly", "monthly", "quarterly", "yearly", "custom"] as const).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className="rounded-full border px-3 py-1 text-xs capitalize transition-colors"
            style={period === p
              ? { borderColor: "var(--section-accent, var(--text-primary))", color: "var(--text-primary)", background: "var(--surface-hover)" }
              : { borderColor: "var(--border-soft)", color: "var(--text-muted)", background: "transparent" }}>
            {p}
          </button>
        ))}
        {period === "custom" && (
          <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
            <ExportDateButton label="Start date" value={start} onChange={setStart} />
            →
            <ExportDateButton label="End date" value={end} onChange={setEnd} />
          </span>
        )}
        <span className="grow" />
        <span className="grow" />
        {customOk ? (
          <>
            <a href={`${BASE_URL}/api/v1/reports/export.xlsx?${qs}`}
              className="rounded-md border px-3 py-1 text-xs font-medium transition-colors hover:opacity-80"
              style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }}>Excel workbook</a>
            <a href={`${BASE_URL}/api/v1/reports/export.pdf?${qs}`}
              className="rounded-md border px-3 py-1 text-xs font-medium transition-colors hover:opacity-80"
              style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }}>PDF report</a>
            <a href={`${BASE_URL}/api/v1/reports/export.html?${qs}`} target="_blank" rel="noreferrer"
              className="rounded-md border px-3 py-1 text-xs font-medium transition-colors hover:opacity-80"
              style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }}>Charts report</a>
          </>
        ) : (
          <span className="text-xs" style={{ color: "var(--text-faint)" }}>Pick a start and end date</span>
        )}
      </div>
      <ReportScheduleRow />
      <PastReports />
    </Sheet>
  );
}

/**
 * The email schedule — real state from /reports/schedule, saved on toggle. The first email for a
 * newly enabled cadence arrives when the CURRENT period ends (the API anchors last_sent on enable),
 * and covers that completed period on the workspace's calendar.
 */
function ReportScheduleRow() {
  const qc = useQueryClient();
  const schedQ = useQuery({
    queryKey: ["report-schedule"],
    queryFn: () => apiClient.get<{ enabled: Partial<Record<string, boolean>> }>("/reports/schedule"),
  });
  const save = useMutation({
    mutationFn: (enabled: Record<string, boolean>) =>
      apiClient.post("/reports/schedule", { enabled }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["report-schedule"] }),
  });
  const [testState, setTestState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const sendTest = async () => {
    setTestState("sending");
    try {
      await apiClient.post("/reports/schedule/send-test", { period: "monthly" });
      setTestState("sent");
    } catch { setTestState("failed"); }
  };
  const enabled = schedQ.data?.enabled ?? {};
  const toggle = (cad: string) => save.mutate({ ...Object.fromEntries(Object.entries(enabled).filter(([, v]) => v).map(([k]) => [k, true])), [cad]: !enabled[cad] });
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: "var(--border-soft)" }}>
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>Email this report automatically:</span>
      {(["daily", "weekly", "monthly", "quarterly", "yearly"] as const).map(cad => (
        <button key={cad} onClick={() => toggle(cad)} disabled={schedQ.isLoading || save.isPending}
          aria-pressed={!!enabled[cad]}
          className="rounded-full border px-2.5 py-0.5 text-[11px] capitalize transition-colors"
          style={enabled[cad]
            ? { borderColor: "var(--section-accent, var(--text-primary))", color: "var(--text-primary)", background: "var(--surface-hover)" }
            : { borderColor: "var(--border-soft)", color: "var(--text-faint)", background: "transparent" }}>
          {cad}
        </button>
      ))}
      <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
        {Object.values(enabled).some(Boolean)
          ? "sent to owners & admins when each period ends, on your workspace calendar"
          : "off — nothing is sent"}
      </span>
      <span className="grow" />
      <button onClick={() => void sendTest()} disabled={testState === "sending"}
        className="rounded-md border px-2.5 py-1 text-[11px] transition-colors hover:opacity-80"
        style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
        {testState === "sending" ? "Sending…" : testState === "sent" ? "Test sent — check your inbox" : testState === "failed" ? "Send failed — check /status" : "Email me a test"}
      </button>
    </div>
  );
}


interface SavedAnalysis { id: string; name?: string; type?: string; updated_at: string }

function SavedAnalyses() {
  const qc = useQueryClient();
  const q = useQuery<SavedAnalysis[]>({ queryKey: ["saved-analyses"], queryFn: () => apiClient.get("/reports") });
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/reports/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["saved-analyses"] }),
  });
  const items = q.data ?? [];
  if (q.isLoading || items.length === 0) return null;   // nothing saved → no empty shell taking space
  const TYPE_LABEL: Record<string, string> = { insight: "trend", funnel: "funnel", time_in_stage: "time in stage", historical: "history", forecast: "forecast" };
  return (
    <Sheet title="Saved analyses" sub="saved by you or built by Ask · recomputed live on open">
      <div className="flex flex-wrap gap-1.5">
        {items.map(r => (
          <span key={r.id} className="group inline-flex items-center gap-1.5 rounded-full border py-1 pl-3 pr-1.5 transition-colors hover:bg-[var(--surface-hover)]"
            style={{ borderColor: "var(--border-soft)" }}>
            <Link to={`/reports/${r.id}`} className="flex min-w-0 items-baseline gap-1.5">
              <span className="max-w-[16rem] truncate text-[11.5px] font-medium" style={{ color: "var(--text-primary)" }}>{r.name || "Untitled report"}</span>
              <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>{TYPE_LABEL[r.type ?? ""] ?? r.type ?? "report"}</span>
            </Link>
            <button onClick={() => remove.mutate(r.id)} disabled={remove.isPending}
              className="btn-icon h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100" title="Delete report">
              <Trash2 size={11} />
            </button>
          </span>
        ))}
      </div>
    </Sheet>
  );
}


/**
 * The archive — scheduled sends re-download EXACTLY as sent (filed bytes, not a recomputation).
 * Empty until the first scheduled email goes out; hidden entirely until then.
 */
function PastReports() {
  interface ArchiveRow { id: string; cadence?: string; period_key?: string; subject?: string; generated_at?: string; close_key?: string | null; formats?: string[] }
  const q = useQuery<ArchiveRow[]>({ queryKey: ["report-archive"], queryFn: () => apiClient.get("/reports/archive") });
  const [open, setOpen] = useState(false);
  const items = q.data ?? [];
  if (items.length === 0) return null;
  const ws = localStorage.getItem("mondaily_workspace_id") ?? "";
  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border-soft)" }}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
        <ArrowRight size={11} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        Past reports ({items.length}) — exactly as emailed, never recomputed
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {items.map(a => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span style={{ color: "var(--text-primary)" }}>{a.subject || `${a.cadence} — ${a.period_key}`}</span>
              {a.close_key && <span className="rounded-full border px-1.5 py-px text-[10px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }} title="Matches the filed close snapshot">closed {a.close_key}</span>}
              <span className="grow" />
              {(a.formats ?? []).map(f => (
                <a key={f} href={`${BASE_URL}/api/v1/reports/archive/${a.id}/${f}?ws=${ws}`}
                  className="rounded-md border px-2 py-0.5 uppercase text-[10px] transition-colors hover:opacity-80"
                  style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
                  {f}
                </a>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SalesOutcomes() {
  const r = periodRange("month"); const pr = previousRange("month");
  const qs = new URLSearchParams({ start: r.start.toISOString(), end: r.end.toISOString() });
  if (pr) { qs.set("prev_start", pr.start.toISOString()); qs.set("prev_end", pr.end.toISOString()); }
  const q = useQuery<{ base_currency: string; team: { value_won: number; deals_won: number; value_lost: number; deals_lost: number; pipeline_value: number; pipeline_deals: number; win_rate_pct: number | null; avg_deal_size: number | null; deltas: null | { value_won: { kind: string; label: string; direction: number; detail: string } } } }>({
    queryKey: ["outcomes", "reports-month"],
    queryFn: () => outcomesClient.get(`/activities/outcomes?${qs}`),
    staleTime: 60_000, retry: false,
  });
  const t = q.data?.team; if (!t) return null;
  const cur = q.data!.base_currency;
  const money = (v: number) => `${cur} ${Math.round(v).toLocaleString()}`;
  const d = t.deltas?.value_won;
  return (
    <div className="mb-6">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Sales · this month</p>
      <KPIGrid>
        <KPITile label="Value won" accent value={money(t.value_won)}
          delta={d && d.label ? <span className="text-[10px] font-semibold tabular-nums" title={d.detail} style={{ color: d.direction >= 0 ? "var(--status-ok)" : "var(--status-error)" }}>{d.direction >= 0 ? "▲" : "▼"} {d.label}</span> : undefined}
          sub={`${t.deals_won} deal${t.deals_won === 1 ? "" : "s"} won`} />
        <KPITile label="Value lost" valueColor={t.value_lost > 0 ? "var(--status-error)" : undefined} value={money(t.value_lost)} sub={`${t.deals_lost} lost`} />
        <KPITile label="Open pipeline" value={money(t.pipeline_value)} sub={`${t.pipeline_deals} open · as of today`} />
        <KPITile label="Win rate" value={t.win_rate_pct != null ? `${t.win_rate_pct}%` : "—"} sub={t.win_rate_pct != null ? "of closed deals" : "no closed deals yet"} />
      </KPIGrid>
    </div>
  );
}

export function ReportsPage() {
  const navigate  = useNavigate();
  const qc        = useQueryClient();
  const [creating, setCreating] = useState(false);

  // Cross-object KPI state, fed by each card as its aggregates resolve. Drives the Executive Overview
  // with zero extra requests. A shallow-equality guard prevents a card's repeated reports from looping.
  const [cardStats, setCardStats] = useState<Record<string, CardStat>>({});
  const reportStat = useCallback((slug: string, stat: CardStat) => {
    setCardStats(prev => {
      const p = prev[slug];
      if (p && p.count === stat.count && p.hasNumeric === stat.hasNumeric && p.valueField === stat.valueField
        && p.sum === stat.sum && p.sumCurrency === stat.sumCurrency && p.isCurrency === stat.isCurrency
        && p.filledPct === stat.filledPct && p.noData === stat.noData) return prev;
      return { ...prev, [slug]: stat };
    });
  }, []);

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
    <div className="mx-auto max-w-6xl px-4 pt-2 pb-6 sm:px-6 sm:pt-2 sm:pb-8">
      {/* Shared command header — same pattern as Decisions / Discovery / Agents. Honest state:
          reports recompute from live records; no fabricated "AI ran" claim. */}
      <CommandPageHeader
        variant="bar"
        icon={BarChart2}
        callsign="SIGNAL"
        title="Reports"
        subtitle="Live analytics computed from your records — AI insight where a run exists."
        status={[{ label: "computed from records", kind: "monitoring" }]}
      />

      {/* ── Downloadable report — Excel + charts, built server-side from THE money model ── */}
      <DownloadReport />

      {/* ── Sales — business outcomes (admins; hidden otherwise) ── */}
      <SalesOutcomes />

      {/* ── Report builder — any sheet, grouped, charted, savable ── */}
      <ReportBuilder />

      {/* ── Saved analyses — the reports Ask and the builder actually SAVE. Until now nothing
          listed them: create_report answered "It's saved under Reports" and this page never
          showed them, so every AI-built report was reachable only by knowing its URL. ── */}
      <SavedAnalyses />

      {/* ── Live Reports ── */}
      <Sheet title="Live reports" sub="computed live from your records · AI insights on demand" className="mb-10">
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
          <>
            {/* Executive Overview — derived from the cards' own aggregates (no extra calls). */}
            <ExecutiveOverview objects={objects} stats={cardStats} />
            <div className="space-y-6">
              {REPORT_GROUPS.filter(g => objects.some(o => groupOf(o) === g.key)).map(group => (
                <div key={group.key}>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>{group.label}</p>
                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {objects.filter(o => groupOf(o) === group.key).map(obj => (
                      <ReportObjectCard key={obj.slug} obj={obj} onStat={reportStat} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Sheet>

      {/* ── Dashboards ── */}
      <Sheet title="Dashboards" sub="pin live widgets &amp; custom charts"
        right={<button onClick={() => setCreating(true)} disabled={createDashboard.isPending} className="btn-secondary text-xs"><Plus size={11} /> New dashboard</button>}>
        {dashboardsQ.isLoading ? (
          <DelayedLoading onRetry={() => dashboardsQ.refetch()}><PageSkeletonCards count={3} label="Loading dashboards…"/></DelayedLoading>
        ) : dashboardsQ.data?.length ? (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {dashboardsQ.data.map(dashboard => {
              const allWidgets = Array.isArray(dashboard.widgets) ? dashboard.widgets as Array<{ type?: string }> : [];
              const liveCount   = allWidgets.filter(w => w.type === "live").length;
              const reportCount = allWidgets.filter(w => w.type === "report").length;
              const wsCount     = allWidgets.filter(w => w.type === "workspace").length;
              const parts = [
                liveCount ? `${liveCount} live` : "",
                wsCount ? `${wsCount} workspace` : "",
                reportCount ? `${reportCount} chart${reportCount !== 1 ? "s" : ""}` : "",
              ].filter(Boolean).join(" · ");
              return (
                <Link
                  key={dashboard.id}
                  to={`/reports/dashboards/${dashboard.id}`}
                  className="group flex flex-col rounded-md p-3 transition-colors hover:bg-[color-mix(in_srgb,var(--section-accent)_6%,var(--surface-hover))]"
                  style={{ background: "var(--surface-hover)" }}
                >
                  <div className="flex items-baseline gap-2">
                    <LayoutDashboard size={13} className="shrink-0 self-center" style={{ color: "var(--section-accent)" }} />
                    <h3 className="min-w-0 truncate text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{dashboard.name || "Untitled dashboard"}</h3>
                    <span className="grow" />
                    <ArrowRight size={12} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: "var(--section-accent)" }} />
                  </div>
                  <p className="mt-1 text-[10.5px]" style={{ color: "var(--text-muted)" }}>
                    {allWidgets.length === 0 ? "empty · click to add widgets" : parts || `${allWidgets.length} widget${allWidgets.length !== 1 ? "s" : ""}`}
                    <span style={{ color: "var(--text-faint)" }}> · {new Date(dashboard.updated_at).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                  </p>
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
      </Sheet>

      {creating && (
        <NewDashboardDialog
          onCreate={name => { setCreating(false); createDashboard.mutate(name); }}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
