import { supabase } from "@mondaily/db/client";

/**
 * THE money model — the single place "closed won", "pipeline created", "cash collected" and
 * "overdue AR" are defined. The Brief, the Owner Console, Team goals and Reports must all import
 * these instead of re-deriving their own, or the numbers disagree across surfaces and every one of
 * them becomes untrustworthy (the state that made the old brief "poor": volume KPIs, no money, no
 * deltas, and an unbounded invoice read that silently truncated at the row cap).
 *
 * Field access is measured, not assumed (prod, 2026-07-30, 44 deals):
 *   - stage lives in BOTH `stage` (38) and `deal_stage` (25) — read the union, deal_stage first
 *   - owner lives in `deal_owner` (25) and `assigned_to` (28)
 *   - ZERO deals carried a close date, so wonDate() falls back to updated_at for legacy rows —
 *     an approximation (updated_at moves on any edit) that self-heals: routes/nodes.ts stamps
 *     `won_at` on every stage transition into Won from now on.
 *
 * FLOW metrics (closed won, pipeline created, cash collected) are counted within a range.
 * BALANCE metrics (open pipeline, outstanding, overdue) are as-of-now and ignore the range.
 * Same doctrine as apps/app/src/lib/period.ts.
 */

export interface MsRange { start: number; end: number }

/** Month-to-date, local server time. The Brief's lens. */
export function monthToDate(now: Date = new Date()): MsRange {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: start.getTime(), end: now.getTime() };
}

/** The SAME window inside the previous month (Jul 1–15 vs Jun 1–15), not the whole prior month —
 *  comparing 15 days against 31 would make every month look like a collapse until the 20th. */
export function prevMonthSamePoint(now: Date = new Date()): MsRange {
  const prev = new Date(now);
  prev.setMonth(prev.getMonth() - 1);
  const start = new Date(prev.getFullYear(), prev.getMonth(), 1);
  return { start: start.getTime(), end: prev.getTime() };
}

const inRange = (iso: string | undefined | null, r: MsRange): boolean => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= r.start && t <= r.end;
};

export const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// ── Paged reads — an unbounded select truncates at the row cap and UNDERSTATES every total ──────
export interface NodeRow { id: string; data: Record<string, unknown> | null; created_at: string; updated_at: string }

export async function pagedNodes(ws: string, match: { eq?: string; ilike?: string }): Promise<NodeRow[]> {
  const rows: NodeRow[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 100_000; from += PAGE) {
    let q = supabase.from("nodes").select("id, data, created_at, updated_at").eq("workspace_id", ws);
    q = match.eq ? q.eq("object_type", match.eq) : q.ilike("object_type", match.ilike!);
    const { data, error } = await q.order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`money: paged read failed: ${error.message}`);
    const page = (data ?? []) as NodeRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

// ── Deals ────────────────────────────────────────────────────────────────────────────────────────
export const dealStage = (d: Record<string, unknown> | null): string =>
  String((d ?? {}).deal_stage ?? (d ?? {}).stage ?? (d ?? {}).status ?? "").trim();
export const dealValue = (d: Record<string, unknown> | null): number =>
  num((d ?? {}).deal_value ?? (d ?? {}).value ?? (d ?? {}).amount);
export const dealOwner = (d: Record<string, unknown> | null): string =>
  String((d ?? {}).deal_owner ?? (d ?? {}).assigned_to ?? (d ?? {}).owner ?? "").trim();

export const isWon = (stage: string) => /won/i.test(stage);
export const isLost = (stage: string) => /lost/i.test(stage);
export const isOpen = (stage: string) => !isWon(stage) && !isLost(stage) && !/closed/i.test(stage);

/** When the deal closed: the stamped fact when present, updated_at as the labeled legacy fallback. */
export const wonDate = (row: NodeRow): string =>
  String((row.data ?? {}).won_at ?? row.updated_at ?? row.created_at);

export interface FlowMetric { count: number; value: number }

export function closedWonIn(rows: NodeRow[], range: MsRange): FlowMetric {
  let count = 0, value = 0;
  for (const r of rows) {
    if (!isWon(dealStage(r.data))) continue;
    if (!inRange(wonDate(r), range)) continue;
    count++; value += dealValue(r.data);
  }
  return { count, value };
}

export function pipelineCreatedIn(rows: NodeRow[], range: MsRange): FlowMetric {
  let count = 0, value = 0;
  for (const r of rows) {
    if (!inRange(r.created_at, range)) continue;
    count++; value += dealValue(r.data);
  }
  return { count, value };
}

/** BALANCE: everything still open, as of now. */
export function openPipeline(rows: NodeRow[]): FlowMetric {
  let count = 0, value = 0;
  for (const r of rows) {
    if (!isOpen(dealStage(r.data))) continue;
    count++; value += dealValue(r.data);
  }
  return { count, value };
}

/**
 * Stage-weighted forecast over OPEN deals. The weights are a declared editorial judgment, not
 * data — they live here so every surface forecasts identically, and changing them changes the
 * whole app at once. Unknown stages weight 0.2: counted, but barely.
 */
export const STAGE_WEIGHTS: [RegExp, number][] = [
  [/negotiat/i, 0.75],
  [/proposal|quote/i, 0.5],
  [/qualif/i, 0.25],
  [/lead|new/i, 0.1],
  [/hold/i, 0.05],
];
export function weightedForecast(rows: NodeRow[]): number {
  let v = 0;
  for (const r of rows) {
    const stage = dealStage(r.data);
    if (!isOpen(stage)) continue;
    const w = STAGE_WEIGHTS.find(([re]) => re.test(stage))?.[1] ?? 0.2;
    v += dealValue(r.data) * w;
  }
  return v;
}

/** Who closed, in the range — the list an owner actually reads. Sorted by value closed. */
export function closersIn(rows: NodeRow[], range: MsRange): { owner: string; count: number; value: number }[] {
  const by = new Map<string, { count: number; value: number }>();
  for (const r of rows) {
    if (!isWon(dealStage(r.data)) || !inRange(wonDate(r), range)) continue;
    const owner = dealOwner(r.data) || "Unassigned";
    const b = by.get(owner) ?? { count: 0, value: 0 };
    b.count++; b.value += dealValue(r.data);
    by.set(owner, b);
  }
  return [...by].map(([owner, b]) => ({ owner, ...b })).sort((a, b) => b.value - a.value);
}

// ── Invoices ─────────────────────────────────────────────────────────────────────────────────────
const OUTSTANDING = new Set(["sent", "viewed", "overdue"]);

export interface InvoiceMetrics {
  collected: number;            // paid within the range (flow)
  invoiced: number;             // issued within the range (flow)
  outstanding: number;          // unpaid as of now (balance)
  overdue: { count: number; total: number; aging: { bucket: string; count: number; total: number }[] };
}

export function invoiceMetrics(
  rows: NodeRow[],
  toBase: (amount: number, currency: string) => number,
  base: string,
  range: MsRange,
): InvoiceMetrics {
  let collected = 0, invoiced = 0, outstanding = 0;
  const aging = [
    { bucket: "1-30d", max: 30, count: 0, total: 0 },
    { bucket: "31-60d", max: 60, count: 0, total: 0 },
    { bucket: "61-90d", max: 90, count: 0, total: 0 },
    { bucket: "90d+", max: Infinity, count: 0, total: 0 },
  ];
  let overdueCount = 0, overdueTotal = 0;
  const now = Date.now();

  for (const r of rows) {
    const d = (r.data ?? {}) as Record<string, unknown>;
    const amt = toBase(num(d.total), String(d.currency ?? base));
    const status = String(d.status ?? "draft");
    if (status === "paid" && inRange(String(d.paid_at ?? r.created_at), range)) collected += amt;
    if (status !== "draft" && inRange(String(d.issued_at ?? r.created_at), range)) invoiced += amt;
    if (OUTSTANDING.has(status)) outstanding += amt;
    if (status === "overdue") {
      overdueCount++; overdueTotal += amt;
      const due = Date.parse(String(d.due_date ?? ""));
      const days = Number.isFinite(due) ? Math.max(0, (now - due) / 86_400_000) : 91; // undated → oldest bucket
      const b = aging.find(a => days <= a.max)!;
      b.count++; b.total += amt;
    }
  }
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    collected: r2(collected), invoiced: r2(invoiced), outstanding: r2(outstanding),
    overdue: { count: overdueCount, total: r2(overdueTotal), aging: aging.map(({ bucket, count, total }) => ({ bucket, count, total: r2(total) })) },
  };
}

/** Period-over-period percentage, null when the prior value is 0 (a delta from nothing is noise). */
export function deltaPct(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}
