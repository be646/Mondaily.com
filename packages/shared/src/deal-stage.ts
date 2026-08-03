/**
 * Where a deal's stage actually lives — resolved in ONE place.
 *
 * Deals in this workspace do not agree on a field name: some carry `deal_stage`, some `stage`, some
 * only `status`. The server has always resolved that with a single fallback chain (it was written
 * for the won/lost close-date stamps). The record page did not: it read `data.deal_stage` alone and
 * defaulted to the literal string "Lead".
 *
 * That is not a cosmetic gap. For a deal whose stage lives in `stage`, the record page's pipeline
 * asserted "Lead" — confidently, specifically, and wrongly — while the sheet, the AI score panel
 * and every server-side report said "Negotiation". A widget that says "unknown" is a gap a person
 * can see; one that names the wrong stage is a gap they cannot.
 *
 * So both packages import this. The API's stage-stamps module re-exports it rather than keeping a
 * second copy, because a rule implemented at one call site is not a rule.
 */

/** The ordered pipeline. Won/Lost are terminal and deliberately not steps in it. */
export const PIPE_STAGES = ["Lead", "Qualified", "In Progress", "Proposal", "Negotiation"] as const;
export type PipeStage = (typeof PIPE_STAGES)[number];

export const STAGE_WON = "Closed Won";
export const STAGE_LOST = "Closed Lost";

/**
 * Read a deal's stage from its data bag.
 *
 * Returns "" when the record genuinely has no stage — NOT a default. A caller that wants to render
 * something for an unstaged deal has to choose that itself and say so, rather than inheriting a
 * guess that looks like a fact.
 */
export function dealStageOf(d: Record<string, unknown> | null | undefined): string {
  const data = d ?? {};
  return String(data.deal_stage ?? data.stage ?? "");
}

/**
 * `status` is deliberately NOT in that chain.
 *
 * Measured in this workspace, `status` holds "Not Started / In Progress / Completed / On Hold" —
 * a task-progress vocabulary, not a pipeline. Treating it as a stage was actively wrong in two
 * ways: "In Progress" collides with a real pipeline stage, so an unstaged deal resolved to a
 * plausible-looking stage it never had; and the won-revenue predicate matches /complete/, so four
 * deals whose `status` merely read "Completed" were counted as WON MONEY.
 *
 * Similar names, distinct populations — the same lesson as the schema-truth pass.
 */
export function progressStatusOf(d: Record<string, unknown> | null | undefined): string {
  return String((d ?? {}).status ?? "");
}

/**
 * Is this deal genuinely open?
 *
 * NOT "does its stage fail to say closed". An unstaged deal ("") passed that test and was counted
 * into open pipeline value — the same inflation that `?? "Lead"` caused, surviving the removal of
 * the default. A deal is open when it sits at a real pipeline stage; anything else is disclosed
 * rather than summed.
 */
export function isOpenStage(s: string): boolean {
  return stageIndex(s) >= 0 && !isWonStage(s) && !isLostStage(s);
}

/**
 * Which key this record stores its stage under, so a write lands on the field the rest of the app
 * reads. Writing `deal_stage` onto a record staged via `stage` would leave two fields disagreeing,
 * and `dealStageOf` prefers `deal_stage` — so the record would silently change stage on save.
 */
export function dealStageKey(d: Record<string, unknown> | null | undefined): string {
  const data = d ?? {};
  if (data.deal_stage !== undefined) return "deal_stage";
  if (data.stage !== undefined) return "stage";
  if (data.status !== undefined) return "status";
  return "deal_stage";
}

export const isWonStage = (s: string) => /won/i.test(s);
export const isLostStage = (s: string) => /lost/i.test(s);

/** Index in the pipeline, or -1 for unstaged / terminal stages. */
export function stageIndex(s: string): number {
  return (PIPE_STAGES as readonly string[]).indexOf(s);
}
