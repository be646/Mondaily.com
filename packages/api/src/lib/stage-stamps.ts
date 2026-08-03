/**
 * Close-date stamping for deal stage transitions.
 *
 * This lives in ONE place because it was written in one place and then bypassed by another. The
 * REST update path (routes/nodes.ts) stamped `won_at`/`lost_at` on a transition; the workflow
 * engine's `update_field` action writes `nodes.data` straight to Supabase and could set `stage` to
 * "Closed Won" without ever passing through it. An AI-driven automation closing a deal therefore
 * produced a brand-new UNDATED win — the exact condition the money model now excludes and
 * discloses, being manufactured by the product itself.
 *
 * That is the same lesson as the win-date fallback: a rule implemented at one call site is not a
 * rule. Both writers now call this.
 */

// The resolver moved to @mondaily/shared so the RECORD PAGE can import the same one. It used to
// read `data.deal_stage` alone and default to "Lead", so a deal staged via `stage` had its pipeline
// widget assert the wrong stage while every server-side number said otherwise. Re-exported here so
// this module's callers are untouched.
export { dealStageOf } from "@mondaily/shared/deal-stage";
import { dealStageOf } from "@mondaily/shared/deal-stage";

/**
 * Apply the stamps for a transition from `prevData` to `nextData`, in place on a copy.
 *
 * Two behaviours that are easy to lose and expensive to lose:
 *  - Stamped ONLY on the transition, so re-saving an already-won deal never refreshes its close
 *    date — otherwise "closed this month" drifts forward every time somebody edits the record.
 *  - An existing stamp is CARRIED FORWARD. Both writers replace `data` wholesale, so a client that
 *    fetched the record before the stamp existed and edited any other field would silently erase
 *    it. A server-stamped fact has to survive round-trips the client knows nothing about.
 */
export function withStageStamps(
  objectType: string,
  prevData: Record<string, unknown> | null | undefined,
  nextData: Record<string, unknown>,
  now: () => string = () => new Date().toISOString(),
): Record<string, unknown> {
  if (!String(objectType ?? "").toLowerCase().includes("deal")) return nextData;

  const prev = prevData ?? {};
  const out = { ...nextData };
  const before = dealStageOf(prev);
  const after = dealStageOf({ ...prev, ...out });

  if (/won/i.test(after) && !/won/i.test(before) && !out.won_at) out.won_at = now();
  if (/lost/i.test(after) && !/lost/i.test(before) && !out.lost_at) out.lost_at = now();
  if (prev.won_at && !out.won_at) out.won_at = prev.won_at;
  if (prev.lost_at && !out.lost_at) out.lost_at = prev.lost_at;

  /**
   * Keep the two stage fields IN STEP from here on.
   *
   * Deals in this workspace carry both `deal_stage` and `stage`, and measured 2026-08-03 they
   * disagreed on 28 of 44 records — one saying "Closed Won" while the other said "Lead" on the same
   * 500,000 deal. Every won/pipeline figure depends on which one a given surface happens to read.
   *
   * No resolver can fix the history: both fields are schema-declared, both draw from the same seven
   * values, both are actively edited (88 vs 96 changes across the conflicting records), and on 20 of
   * the 28 they were last written in the SAME instant by an import — so there is nothing to prefer.
   *
   * What CAN be fixed is the future. A stage write now lands on both keys, so the two can never
   * diverge again and the precedence in `dealStageOf` stops mattering for anything written from
   * today. This is the cheap half of the problem, and unlike a backfill it invents nothing.
   */
  if (after && after !== dealStageOf(prev)) {
    if (prev.deal_stage !== undefined || out.deal_stage !== undefined) out.deal_stage = after;
    if (prev.stage !== undefined || out.stage !== undefined) out.stage = after;
  }
  return out;
}
