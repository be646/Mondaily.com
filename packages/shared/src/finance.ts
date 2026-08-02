/**
 * THE definitions of what invoice statuses mean for money.
 *
 * These sets answer questions the whole product asks — "what have we billed?", "what is owed?",
 * "what came in?" — and they were written out by hand in six places (invoices.ts, money.ts,
 * reports, invoices list, insights, the invoice detail page). Copies drift: the Reports monthly
 * chart counted DRAFT and CANCELLED invoices as billed while the server's own rollup excluded
 * them, so the same word meant two different numbers depending on which screen you were on.
 *
 * If a status set needs to change, it changes here.
 */

/** Committed billing. A draft was never sent, and a cancelled invoice was withdrawn. */
export const BILLED_STATUSES = ["sent", "viewed", "overdue", "paid"] as const;

/** Money the client owes right now. Excludes paid (settled) and draft/cancelled (never billed). */
export const OUTSTANDING_STATUSES = ["sent", "viewed", "overdue"] as const;

/** Cash actually received. */
export const COLLECTED_STATUSES = ["paid"] as const;

/** Not real billing in any sense — never counted toward revenue or receivables. */
export const NON_BILLED_STATUSES = ["draft", "cancelled"] as const;

const billed = new Set<string>(BILLED_STATUSES);
const outstanding = new Set<string>(OUTSTANDING_STATUSES);
const collected = new Set<string>(COLLECTED_STATUSES);

export const isBilled = (status: unknown): boolean => billed.has(String(status ?? ""));
export const isOutstanding = (status: unknown): boolean => outstanding.has(String(status ?? ""));
export const isCollected = (status: unknown): boolean => collected.has(String(status ?? ""));

/**
 * The date a money event actually happened — which is NOT when the record was created.
 *
 * A June invoice paid in July is JULY revenue. Bucketing collected cash by `created_at` put
 * £95,801 of July receipts into June on the reports chart (measured on live data 2026-08-02):
 * 93% of the period's cash attributed to the wrong month.
 */
export function moneyEventDate(inv: { status?: string; paid_at?: string | null; created_at?: string | null }): string {
  if (isCollected(inv.status) && inv.paid_at) return inv.paid_at;
  return inv.created_at ?? "";
}
