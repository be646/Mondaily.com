import { supabase } from "@mondaily/db/client";
import { sendPendingPlanReminderEmail } from "../lib/pending-plan-email";

/**
 * Activation-email reminder cadence — a polite day-2 / day-7 follow-up to workspaces that picked a
 * paid plan (Command/Sovereign) at onboarding but never activated it. Runs in the daily cron
 * (runAllDaily → /api/cron/daily). Strictly idempotent, fail-safe, and never spams:
 *   - only fires while settings.pending_plan is still "command" or "sovereign" (cleared/activated ⇒ nothing)
 *   - each reminder is stamped in settings.pending_plan_reminders and never re-sent
 *   - the send is stamped only when the mail provider ACCEPTS it, so a missing mail env retries later
 *     rather than silently burning the reminder — and never crashes the job
 *   - Scout/Operator are never touched (they have no pending_plan)
 */

export type ReminderPhase = "day2" | "day7";
type PaidPlan = "command" | "sovereign";

export interface ReminderDecision {
  action: "none" | "backfill_anchor" | "send";
  phase?: ReminderPhase;
  sentKey?: string;      // pending_plan_reminders key to stamp on a successful send
  alsoStampKey?: string; // a stale earlier-phase key to stamp (skip) so it never fires later
}

const DAY_MS = 86_400_000;

/** PURE decision — given the workspace's pending-plan state + now, what (if anything) to send.
 *  Reminder keys are plan-prefixed (e.g. command_day2_sent_at) so switching plans stays independent. */
export function pendingReminderDecision(input: {
  plan: string | undefined;
  setAt: string | undefined;
  reminders: Record<string, string | undefined>;
  nowMs: number;
}): ReminderDecision {
  const { plan, setAt, reminders, nowMs } = input;
  if (plan !== "command" && plan !== "sovereign") return { action: "none" };   // Scout/Operator/none
  if (!setAt) return { action: "backfill_anchor" };                            // start the clock; no send yet
  const anchor = Date.parse(setAt);
  if (!Number.isFinite(anchor)) return { action: "none" };
  const ageDays = (nowMs - anchor) / DAY_MS;
  const day2 = `${plan}_day2_sent_at`;
  const day7 = `${plan}_day7_sent_at`;
  if (ageDays >= 7 && !reminders[day7]) {
    // If the day-2 window was missed entirely (cron gap), send day-7 and mark day-2 as handled so a
    // stale day-2 never fires afterward. At most one email per run.
    return { action: "send", phase: "day7", sentKey: day7, alsoStampKey: reminders[day2] ? undefined : day2 };
  }
  // Never send day-2 once day-7 has gone out (day-7 supersedes it).
  if (ageDays >= 2 && !reminders[day2] && !reminders[day7]) {
    return { action: "send", phase: "day2", sentKey: day2 };
  }
  return { action: "none" };
}

export async function runPendingPlanReminders(nowMs: number = Date.now()): Promise<{ scanned: number; backfilled: number; sent: number }> {
  const { data } = await supabase.from("workspaces").select("id, settings");
  let scanned = 0, backfilled = 0, sent = 0;
  const stamp = new Date(nowMs).toISOString();
  for (const w of data ?? []) {
    const settings = { ...((w.settings ?? {}) as Record<string, unknown>) };
    const plan = settings.pending_plan as string | undefined;
    if (plan !== "command" && plan !== "sovereign") continue;   // never Scout/Operator/none
    scanned++;
    const reminders = { ...((settings.pending_plan_reminders ?? {}) as Record<string, string | undefined>) };
    const d = pendingReminderDecision({ plan, setAt: settings.pending_plan_set_at as string | undefined, reminders, nowMs });

    if (d.action === "backfill_anchor") {
      // Existing pending workspaces (set before this feature) start their clock now — never retroactive.
      await supabase.from("workspaces").update({ settings: { ...settings, pending_plan_set_at: stamp } }).eq("id", w.id as string);
      backfilled++;
      continue;
    }
    if (d.action !== "send") continue;

    const ok = await sendPendingPlanReminderEmail(w.id as string, plan as PaidPlan, d.phase!);
    if (!ok) continue;   // mail missing / declined → don't stamp; retry next run (no dup, no crash)
    reminders[d.sentKey!] = stamp;
    if (d.alsoStampKey) reminders[d.alsoStampKey] = stamp;
    await supabase.from("workspaces").update({ settings: { ...settings, pending_plan_reminders: reminders } }).eq("id", w.id as string);
    sent++;
  }
  return { scanned, backfilled, sent };
}
