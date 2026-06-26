/**
 * Free-trial configuration — the SINGLE source of truth for trial length.
 *
 * Every workspace-creation path (onboarding bootstrap, explicit workspace POST,
 * any future path) must use this so the trial window — and the billing logic
 * that later reads `settings.trial_ends_at` — can never drift between code paths.
 */
import { supabase } from "@mondaily/db/client";

export const TRIAL_DAYS = 14;
export const TRIAL_PLAN = "trial" as const;

const DAY_MS = 86_400_000;

/** ISO timestamp for when a trial that starts at `from` (default: now) ends. */
export function trialEndsAtISO(from: number = Date.now()): string {
  return new Date(from + TRIAL_DAYS * DAY_MS).toISOString();
}

/**
 * Create a workspace that starts on a trial — the SINGLE creation routine every
 * registration path uses, so the trial window can never drift.
 *
 * Always writes `settings.trial_ends_at` (the field billing reads). Prefers
 * `plan='trial'`; if the DB `workspaces_plan_check` constraint doesn't yet allow
 * that value, it falls back to `plan='free'` so signup NEVER hard-fails — the
 * trial still works because billing keys off `settings.trial_ends_at`, not plan.
 */
export async function insertTrialWorkspace(
  base: Record<string, unknown>,
): Promise<{ id: string; trialEndsAt: string }> {
  const trialEndsAt = trialEndsAtISO();
  const settings = { trial_ends_at: trialEndsAt };
  let res = await supabase.from("workspaces").insert({ ...base, plan: TRIAL_PLAN, settings }).select("id").single();
  if (res.error && /check constraint/i.test(res.error.message)) {
    res = await supabase.from("workspaces").insert({ ...base, plan: "free", settings }).select("id").single();
  }
  if (res.error || !res.data) throw new Error(res.error?.message ?? "workspace insert failed");
  return { id: (res.data as { id: string }).id, trialEndsAt };
}
