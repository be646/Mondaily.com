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
