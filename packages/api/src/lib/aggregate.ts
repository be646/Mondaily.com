import { convert } from "./currency";

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
export type AggOp = "count" | "sum" | "avg" | "min" | "max" | "filled" | "checked";
export type AggGroupBy = "none" | "status" | "stage" | "owner" | "date";

export interface AggRow { data: Record<string, unknown>; created_at?: string | null }
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
export function aggNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isNaN(n) ? null : n;
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

/** The value used to group a row — resolved from the common alias keys, honestly ("—" when absent). */
export function groupKeyOf(row: AggRow, groupBy: AggGroupBy): string {
  const d = row.data ?? {};
  if (groupBy === "status") return String(d.status ?? "—") || "—";
  if (groupBy === "stage") return String(d.stage ?? d.deal_stage ?? d.deal_status ?? "—") || "—";
  if (groupBy === "owner") return String(d.owner ?? d.deal_owner ?? d.assigned_to ?? d.assignee ?? "—") || "—";
  if (groupBy === "date") {
    const iso = row.created_at ?? "";
    const dt = new Date(String(iso));
    if (isNaN(dt.getTime())) return "—";
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`; // month bucket
  }
  return "all";
}

/** Aggregate one flat set of rows for a single column + op. Money context makes sum/avg/min/max
 *  currency-aware toward `money.target`, counting unconvertible rows. */
export function aggregateRows(rows: AggRow[], op: AggOp, column: string, money?: MoneyCtx): AggResult {
  const count = rows.length;
  if (op === "count") return { value: count, count, unconverted: 0 };
  if (op === "filled") return { value: rows.filter((r) => nonEmpty(r.data?.[column])).length, count, unconverted: 0 };
  if (op === "checked") return { value: rows.filter((r) => aggChecked(r.data?.[column])).length, count, unconverted: 0 };

  // Numeric ops (sum/avg/min/max)
  let unconverted = 0;
  const nums: number[] = [];
  for (const r of rows) {
    const n = aggNum(r.data?.[column]);
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

/** Group rows by the chosen dimension and aggregate each group; returns groups sorted by label. */
export function aggregateGrouped(rows: AggRow[], op: AggOp, column: string, groupBy: AggGroupBy, money?: MoneyCtx): AggGroup[] {
  const buckets = new Map<string, AggRow[]>();
  for (const r of rows) {
    const k = groupKeyOf(r, groupBy);
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(r);
  }
  return [...buckets.entries()]
    .map(([label, rs]) => { const a = aggregateRows(rs, op, column, money); return { label, value: a.value, count: a.count, unconverted: a.unconverted }; })
    .sort((a, b) => a.label.localeCompare(b.label));
}
