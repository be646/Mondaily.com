import { supabase } from "@mondaily/db/client";

/**
 * One-time AI credit-pack Stripe Checkout. Shared by POST /billing/credits-checkout and
 * POST /credits/checkout-session so both expose the identical, card-saving (off_session) flow.
 */
const STRIPE_API = "https://api.stripe.com/v1";
const appUrl = () => (process.env.APP_URL ?? "https://app.mondaily.com").replace(/\/$/, "");
export const CREDIT_PACK = { credits: 100_000, amount_usd: 10 };

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

export async function createCreditPackCheckout(workspaceId: string, userId: string): Promise<{ status: number; url?: string; error?: string }> {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { status: 503, error: "Billing isn't connected yet. Add STRIPE_SECRET_KEY to enable credit purchases." };
  }
  const [{ data: ws }, { data: member }] = await Promise.all([
    supabase.from("workspaces").select("stripe_customer_id").eq("id", workspaceId).maybeSingle(),
    supabase.from("workspace_members").select("email").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle(),
  ]);
  const existingCustomer = (ws as Record<string, unknown> | null)?.stripe_customer_id as string | undefined;

  try {
    const session = await stripePost("checkout/sessions", {
      mode: "payment",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(CREDIT_PACK.amount_usd * 100),
      "line_items[0][price_data][product_data][name]": `${CREDIT_PACK.credits.toLocaleString()} AI Token Operational Refill Pack`,
      "line_items[0][quantity]": "1",
      "payment_intent_data[setup_future_usage]": "off_session", // attach card for auto-refill
      success_url: `${appUrl()}/settings/billing?credits=success`,
      cancel_url: `${appUrl()}/settings/billing?credits=cancelled`,
      client_reference_id: workspaceId,
      "metadata[workspace_id]": workspaceId,
      "metadata[kind]": "credit_pack",
      "metadata[credits]": String(CREDIT_PACK.credits),
      ...(existingCustomer ? { customer: existingCustomer } : { customer_creation: "always", customer_email: member?.email || undefined }),
    });
    return { status: 200, url: session.url };
  } catch (e: unknown) {
    return { status: 500, error: e instanceof Error ? e.message : "Could not start the credit purchase." };
  }
}
