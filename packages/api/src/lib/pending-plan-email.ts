import { supabase } from "@mondaily/db/client";
import { sendTransactionalEmail } from "./mail";

/**
 * Onboarding activation nudge — ONE email when a user picks a paid plan (Command/Sovereign) at
 * onboarding but hasn't paid. It never claims the plan is active (it isn't until checkout/setup) and
 * is strictly best-effort: if no mail provider is configured, or the owner has no email, it returns
 * false and onboarding still completes. It reads/sends only — it mutates NO tier/credits/Stripe state.
 *
 * Called exactly once, from POST /onboarding/complete, only when pending_plan is newly set. Never
 * from page/billing/dashboard loads.
 */

const appUrl = () => (process.env.APP_URL ?? "https://app.mondaily.com").replace(/\/$/, "");

type PaidPlan = "command" | "sovereign";

function copyFor(plan: PaidPlan, billingUrl: string): { subject: string; html: string } {
  if (plan === "sovereign") {
    return {
      subject: "Let’s set up your Mondaily Sovereign workspace",
      html: `
        <p>Hi,</p>
        <p>You selected the <strong>Sovereign</strong> plan during onboarding.</p>
        <p>Sovereign is a custom, private setup — our team configures it with you, so there’s no
        instant checkout. Your workspace is running on the free <strong>Scout</strong> tier until
        setup is complete.</p>
        <p><a href="${billingUrl}" style="display:inline-block;background:#a3946b;color:#000;
        text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:600">Talk to us</a></p>
        <p style="color:#6b7280;font-size:12px">Or open Billing → your selected plan any time:
        <a href="${billingUrl}">${billingUrl}</a></p>`,
    };
  }
  return {
    subject: "Complete your Mondaily Command setup",
    html: `
      <p>Hi,</p>
      <p>You selected the <strong>Command</strong> plan during onboarding.</p>
      <p>Your workspace is running on the free <strong>Scout</strong> tier until you complete
      checkout — <strong>Command isn’t active yet</strong>. Finish checkout to activate it.</p>
      <p><a href="${billingUrl}" style="display:inline-block;background:#a3946b;color:#000;
      text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:600">Complete checkout</a></p>
      <p style="color:#6b7280;font-size:12px">Or open Billing directly:
      <a href="${billingUrl}">${billingUrl}</a></p>`,
  };
}

// Follow-up REMINDER copy (day 2 / day 7). Distinct from the initial nudge, still never claims the
// plan is active before payment/setup. `phase` only tweaks the lead-in line.
function reminderCopyFor(plan: PaidPlan, phase: "day2" | "day7", billingUrl: string): { subject: string; html: string } {
  const lead = phase === "day7" ? "Following up again —" : "Just checking in —";
  if (plan === "sovereign") {
    return {
      subject: "Reminder: let’s set up your Mondaily Sovereign workspace",
      html: `
        <p>Hi,</p>
        <p>${lead} you selected the <strong>Sovereign</strong> plan during onboarding and it isn’t
        set up yet.</p>
        <p>Sovereign is a custom, private setup — our team configures it with you, so there’s no
        instant checkout. Your workspace is still on the free <strong>Scout</strong> tier until setup
        is complete. Reach out whenever you’re ready and we’ll take it from there.</p>
        <p><a href="${billingUrl}" style="display:inline-block;background:#a3946b;color:#000;
        text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:600">Talk to us</a></p>
        <p style="color:#6b7280;font-size:12px">Billing → your selected plan: <a href="${billingUrl}">${billingUrl}</a></p>`,
    };
  }
  return {
    subject: "Reminder: activate your Mondaily Command plan",
    html: `
      <p>Hi,</p>
      <p>${lead} you picked the <strong>Command</strong> plan during onboarding but haven’t completed
      checkout yet.</p>
      <p>Your workspace is still on the free <strong>Scout</strong> tier — <strong>Command isn’t
      active yet</strong>. Complete checkout whenever you’re ready to activate it.</p>
      <p><a href="${billingUrl}" style="display:inline-block;background:#a3946b;color:#000;
      text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:600">Complete checkout</a></p>
      <p style="color:#6b7280;font-size:12px">Or open Billing directly: <a href="${billingUrl}">${billingUrl}</a></p>`,
  };
}

/** Best-effort follow-up reminder to the workspace OWNER. Resolves the owner's email itself; returns
 *  true only if the provider accepted the send. Never throws (mail must not break the cron job). */
export async function sendPendingPlanReminderEmail(workspaceId: string, plan: PaidPlan, phase: "day2" | "day7"): Promise<boolean> {
  try {
    const { data: owner } = await supabase
      .from("workspace_members").select("email, name")
      .eq("workspace_id", workspaceId).eq("role", "owner").maybeSingle();
    const email = (owner as { email?: string } | null)?.email;
    if (!email) return false;
    const name = (owner as { name?: string } | null)?.name;
    const { subject, html } = reminderCopyFor(plan, phase, `${appUrl()}/settings/billing`);
    return await sendTransactionalEmail({ subject, body: html, to: [{ email, ...(name ? { name } : {}) }] });
  } catch {
    return false;
  }
}

/** Best-effort. Returns true only if an email was actually accepted by the provider. Never throws. */
export async function sendPendingPlanEmail(workspaceId: string, userId: string, plan: PaidPlan): Promise<boolean> {
  try {
    const { data: member } = await supabase
      .from("workspace_members").select("email, name")
      .eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
    const email = (member as { email?: string } | null)?.email;
    if (!email) return false;                              // no address → nothing to send, safe
    const name = (member as { name?: string } | null)?.name;
    const { subject, html } = copyFor(plan, `${appUrl()}/settings/billing`);
    return await sendTransactionalEmail({ subject, body: html, to: [{ email, ...(name ? { name } : {}) }] });
  } catch {
    return false;                                          // mail must never break onboarding
  }
}
