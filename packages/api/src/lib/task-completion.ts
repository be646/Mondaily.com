/**
 * Completion-timestamp rule for tasks (pure + tested). Given the task's prior `completed` state and
 * the incoming `completed` value, decide what should happen to `completed_at`.
 *
 *  • false/null → true : set completed_at = now (a fresh, accurate completion time).
 *  • already completed  : return {} — NEVER overwrite an existing completed_at.
 *  • true → false       : clear completed_at (documented choice) so a later re-completion records a
 *                         new timestamp instead of a stale one.
 *  • anything else      : {} (no change to completed_at).
 */
export function resolveCompletedAt(opts: { wasCompleted: boolean; nextCompleted: unknown; nowIso: string }): { completed_at?: string | null } {
  if (opts.nextCompleted === true && !opts.wasCompleted) return { completed_at: opts.nowIso };
  if (opts.nextCompleted === false && opts.wasCompleted) return { completed_at: null };
  return {};
}
