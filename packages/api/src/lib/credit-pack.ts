import { supabase } from "@mondaily/db/client";
import { CREDIT_PACKS, computePackCredits, type BillingInterval, type TierId } from "@mondaily/shared/pricing";
import { getEntitlement } from "./entitlements";

/**
 * Pay-as-you-go AI credit-pack Stripe Checkout. The pack's BONUS (plan + annual) is computed by the
 * shared catalog and stamped into Stripe metadata, so the backend grants exactly what the UI showed
 * — the bonus is enforced here, not just displayed. Card is saved (off_session) for auto-refill.
 */
const STRIPE_API = "https://api.stripe.com/v1";
const appUrl = () => (process.env.APP_URL ?? "https://app.mondaily.com").replace(/\/$/, "");

function encodeForm(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
    .join("&");
}

async function stripePost(path: string, params: Record<string, string | undefined>): Promise<{ url?: string }> {
  const key = process.env.STRIPE_SECRET_KEY!;
  const res = await fetch(`${STRIPE_API}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: encodeForm(params),
  });
  const json = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok) throw new Error(json?.error?.message ?? `Stripe HTTP ${res.status}`);
  return json;
}

/** Read a workspace's tier + billing interval (for pack-bonus computation). */
async function workspacePlanContext(workspaceId: string): Promise<{ tier: TierId; interval: BillingInterval; customer?: string }> {
  const { data } = await supabase.from("workspaces").select("settings, stripe_customer_id").eq("id", workspaceId).maybeSingle();
  const settings = (data?.settings ?? {}) as { billing_interval?: string };
  return {
    tier: (await getEntitlement(workspaceId)).tier,   // resolved entitlement — same tier the bonus UI shows
    interval: settings.billing_interval === "year" ? "year" : "month",
    customer: (data as { stripe_customer_id?: string } | null)?.stripe_customer_id,
  };
}

export async function createCreditPackCheckout(workspaceId: string, userId: string, packId: string): Promise<{ status: number; url?: string; error?: string }> {
  const pack = CREDIT_PACKS[packId];
  if (!pack) return { status: 400, error: "Unknown credit pack." };
  if (!process.env.STRIPE_SECRET_KEY) {
    return { status: 503, error: "Billing isn't connected yet. Add STRIPE_SECRET_KEY to enable credit purchases." };
  }

  const [{ tier, interval, customer }, { data: member }] = await Promise.all([
    workspacePlanContext(workspaceId),
    supabase.from("workspace_members").select("email").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle(),
  ]);
  const quote = computePackCredits(packId, tier, interval); // { base, plan_bonus, annual_bonus, final, … }

  try {
    const session = await stripePost("checkout/sessions", {
      mode: "payment",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(pack.price_usd * 100),
      "line_items[0][price_data][product_data][name]": `${pack.name} pack — ${quote.final_credits.toLocaleString()} AI credits`,
      "line_items[0][quantity]": "1",
      "payment_intent_data[setup_future_usage]": "off_session",
      success_url: `${appUrl()}/settings/billing?credits=success`,
      cancel_url: `${appUrl()}/settings/billing?credits=cancelled`,
      client_reference_id: workspaceId,
      // FULL metadata — the webhook grants final_credits (base+bonus). Enforced server-side.
      "metadata[kind]": "credit_pack",
      "metadata[pack_id]": packId,
      "metadata[base_credits]": String(quote.base_credits),
      "metadata[bonus_credits]": String(quote.plan_bonus + quote.annual_bonus),
      "metadata[final_credits]": String(quote.final_credits),
      "metadata[plan_tier]": tier,
      "metadata[billing_interval]": interval,
      "metadata[workspace_id]": workspaceId,
      "metadata[user_id]": userId,
      ...(customer ? { customer } : { customer_creation: "always", customer_email: member?.email || undefined }),
    });
    return { status: 200, url: session.url };
  } catch (e: unknown) {
    return { status: 500, error: e instanceof Error ? e.message : "Could not start the credit purchase." };
  }
}
