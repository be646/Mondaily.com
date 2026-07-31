import { convert } from "./currency";
import { parseNumeric } from "@mondaily/shared/numbers";

/**
 * Pure, deterministic record aggregation — the math behind POST /records/aggregate. No I/O, no
 * network: the route fetches rows + rates and passes them in, so this is fully unit-testable.
 *
 * Honesty rules baked in:
 *  • Currency sums convert each row to ONE target currency and COUNT the rows a rate was missing for
 *    (fail-closed: a missing rate contributes its face value AND increments `unconverted`, never a
 *    guessed number).  Mirrors the frontend `sumInDisplay`.
 *  • Nothing is fabricated — non-numeric cells are simply skipped, and an empty set aggregates to 0.
 */
export type AggOp = "count" | "sum" | "avg" | "min" | "max" | "filled" | "checked" | "top";
// "none" | "date" (time bucket) | the keyword aliases | any validated column key.
export type AggGroupBy = string;
// Granularity for the "date" group — a generic time bucket over the row's created_at. Default month
// (backward-compatible). No calendar library: pure UTC truncation, so it stays deterministic + testable.
export type DateBucket = "hour" | "day" | "week" | "month" | "quarter" | "year";

export interface AggRow { id?: string | null; data: Record<string, unknown>; created_at?: string | null; updated_at?: string | null }
// Which root timestamp a date bucket reads from. Mirrors the date_filter field so a row is grouped by
// the SAME column it was filtered on (else updated_at-filtered rows would bucket by created_at).
export type DateField = "created_at" | "updated_at";
export interface MoneyCtx { target: string; rates: Record<string, number>; base: string }

export interface AggResult {
  /** count → row count · filled → filled count · checked → checked count · sum/avg/min/max → number */
  value: number;
  /** total rows considered (denominator for a % filled / checked ratio in the UI) */
  count: number;
  /** rows whose currency could not be converted to the target (money ops only) — face value used */
  unconverted: number;
}

// A numeric read that tolerates "$1,200.50" style strings; returns null when there's no number.
// Delegates to THE shared parser — the old regex-strip corrupted European decimals ("1.200,50"
// → 1.2), magnitude suffixes ("€1.2M" → 1.2) and accounting negatives ("(500)" → +500).
export function aggNum(v: unknown): number | null {
  return parseNumeric(v);
}

// Truthy read for checkbox columns — identical semantics to the frontend `truthy` helper.
export function aggChecked(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "paid" || s === "done" || s === "1" || s === "✓";
}

function nonEmpty(v: unknown): boolean {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  const s = String(v).trim();
  return s !== "" && s !== "—";
}

// Truncate a date to a generic time-bucket KEY (sortable string). Pure UTC math — no calendar lib, so
// it's deterministic. ISO-8601 week for "week" (Monday-based). These keys sort lexicographically into
// chronological order, which is exactly what aggregateGrouped's label sort relies on.
export function dateBucketKey(dt: Date, bucket: DateBucket): string {
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const da = String(dt.getUTCDate()).padStart(2, "0");
  if (bucket === "year") return `${y}`;
  if (bucket === "quarter") return `${y}-Q${Math.floor(dt.getUTCMonth() / 3) + 1}`;
  if (bucket === "month") return `${y}-${mo}`;
  if (bucket === "day") return `${y}-${mo}-${da}`;
  if (bucket === "hour") return `${y}-${mo}-${da}T${String(dt.getUTCHours()).padStart(2, "0")}`;
  // ISO week: Thursday-of-week determines the year+week number.
  const t = new Date(Date.UTC(y, dt.getUTCMonth(), dt.getUTCDate()));
  const day = t.getUTCDay() || 7;            // Sun=0 → 7
  t.setUTCDate(t.getUTCDate() + 4 - day);    // shift to Thursday
  const isoYear = t.getUTCFullYear();
  const week1 = new Date(Date.UTC(isoYear, 0, 1));
  const wk = Math.ceil(((t.getTime() - week1.getTime()) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(wk).padStart(2, "0")}`;
}

/** The value used to group a row — resolved from the common alias keys, honestly ("—" when absent).
 *  For group_by:"date", buckets on `dateField` (defaults to created_at) so a row is grouped by the same
 *  timestamp it was filtered on. */
export function groupKeyOf(row: AggRow, groupBy: AggGroupBy, bucket: DateBucket = "month", dateField: DateField = "created_at", exact = false): string {
  const d = row.data ?? {};
  if (groupBy === "none") return "all";
  // exact: the record table groups by a REAL column key and reads it verbatim on ITS side —
  // aliasing here attached server subtotals to groups the client considers different rows
  // (deal_stage-only rows folded into "stage" while the client filed them under "—").
  if (exact && groupBy !== "date") return String(aggValueOf(row, groupBy) ?? "—") || "—";
  if (groupBy === "status") return String(d.status ?? "—") || "—";
  if (groupBy === "stage") return String(d.stage ?? d.deal_stage ?? d.deal_status ?? "—") || "—";
  if (groupBy === "owner") return String(d.owner ?? d.deal_owner ?? d.assigned_to ?? d.assignee ?? "—") || "—";
  if (groupBy === "date") {
    const iso = (dateField === "updated_at" ? row.updated_at : row.created_at) ?? "";
    const dt = new Date(String(iso));
    if (isNaN(dt.getTime())) return "—";
    return dateBucketKey(dt, bucket);
  }
  return String(d[groupBy] ?? "—") || "—"; // any other validated column key — read the value directly
}

// Equality filters (AND-combined, case-insensitive) — the exact safe subset the record table applies
// as `quickFilters`. Pure + in-memory, so no dynamic SQL is ever built from a user-supplied key.
// Props are accepted as optional so the zod-inferred input type assigns cleanly under strict configs;
// a filter missing its column is simply skipped (honest no-op, never a crash).
/** A column's value for aggregation: data first, then the row root — lead_score and
 *  relationship_health are stored at the node root, and reading data[column] alone made every
 *  server total for them 0 (which then replaced the correct client subtotal in the footer). */
export function aggValueOf(r: AggRow, column: string): unknown {
  return r.data?.[column] ?? (r as unknown as Record<string, unknown>)[column];
}

export function applyFilters(rows: AggRow[], filters?: { column?: string | null; value?: string | null }[]): AggRow[] {
  if (!filters?.length) return rows;
  return rows.filter((r) => filters.every((f) => {
    if (!f.column) return true;
    // EXACT compare, matching the SQL .eq() the grid list uses — this was case-insensitive, so
    // "status is Paid" counted rows the grid didn't show ("paid"), and the footer disagreed with
    // the visible list while claiming to represent it.
    return String(aggValueOf(r, f.column) ?? "") === String(f.value ?? "");
  }));
}

/** Aggregate one flat set of rows for a single column + op. Money context makes sum/avg/min/max
 *  currency-aware toward `money.target`, counting unconvertible rows. */
export function aggregateRows(rows: AggRow[], op: AggOp, column: string, money?: MoneyCtx): AggResult {
  const count = rows.length;
  if (op === "count") return { value: count, count, unconverted: 0 };
  if (op === "filled") return { value: rows.filter((r) => nonEmpty(aggValueOf(r, column))).length, count, unconverted: 0 };
  if (op === "checked") return { value: rows.filter((r) => aggChecked(aggValueOf(r, column))).length, count, unconverted: 0 };

  // Numeric ops (sum/avg/min/max)
  let unconverted = 0;
  const nums: number[] = [];
  for (const r of rows) {
    const n = aggNum(aggValueOf(r, column));
    if (n == null) continue;
    if (money) {
      const cur = String(r.data?.currency ?? money.base).toUpperCase();
      if (cur === money.target) { nums.push(n); continue; }
      const v = convert(n, cur, money.target, money.rates);
      if (v == null) { unconverted += 1; nums.push(n); } // fail-closed: face value, flagged
      else nums.push(v);
    } else {
      nums.push(n);
    }
  }
  if (!nums.length) return { value: 0, count, unconverted };
  const value =
    op === "sum" ? nums.reduce((a, b) => a + b, 0) :
    op === "avg" ? nums.reduce((a, b) => a + b, 0) / nums.length :
    op === "min" ? Math.min(...nums) :
    Math.max(...nums);
  return { value, count, unconverted };
}

export interface AggGroup { label: string; value: number; count: number; unconverted: number }

/** Group rows by the chosen dimension and aggregate each group; returns groups sorted by label.
 *  `dateField` selects which root timestamp a date bucket reads from (mirrors the date_filter field). */
export function aggregateGrouped(rows: AggRow[], op: AggOp, column: string, groupBy: AggGroupBy, money?: MoneyCtx, bucket: DateBucket = "month", dateField: DateField = "created_at", exact = false): AggGroup[] {
  const buckets = new Map<string, AggRow[]>();
  for (const r of rows) {
    const k = groupKeyOf(r, groupBy, bucket, dateField, exact);
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(r);
  }
  return [...buckets.entries()]
    .map(([label, rs]) => { const a = aggregateRows(rs, op, column, money); return { label, value: a.value, count: a.count, unconverted: a.unconverted }; })
    .sort((a, b) => a.label.localeCompare(b.label));
}

// One ranked row for the "top" op — the record id (for a row link), its display name, the numeric
// value (currency-converted toward the target when money context is given), and whether the rate was
// missing (fail-closed: face value used, flagged). Nothing finance-specific — it's generic column math.
export interface AggTopRow { id: string | null; label: string; value: number; currency: string | null; unconverted: boolean }

/** Rank rows by a numeric/currency column, highest first, keeping only the top `limit`. Currency-aware
 *  and fail-closed exactly like aggregateRows. Rows with no numeric value in the column are skipped. */
export function aggregateTop(rows: AggRow[], column: string, limit: number, money?: MoneyCtx): { rows: AggTopRow[]; unconverted: number } {
  let unconverted = 0;
  const scored: AggTopRow[] = [];
  for (const r of rows) {
    const n = aggNum(aggValueOf(r, column));
    if (n == null) continue;
    let value = n;
    let unconv = false;
    if (money) {
      const cur = String(r.data?.currency ?? money.base).toUpperCase();
      if (cur !== money.target) {
        const v = convert(n, cur, money.target, money.rates);
        if (v == null) { unconv = true; unconverted += 1; } // fail-closed: face value, flagged
        else value = v;
      }
    }
    const label = String(r.data?.name ?? r.data?.title ?? r.data?.label ?? "—") || "—";
    scored.push({ id: r.id ?? null, label, value, currency: money ? money.target : null, unconverted: unconv });
  }
  scored.sort((a, b) => b.value - a.value);
  return { rows: scored.slice(0, Math.max(0, limit)), unconverted };
}
