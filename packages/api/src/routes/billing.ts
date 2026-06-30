import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

/**
 * Billing — Stripe Checkout + Customer Portal.
 *
 * These are authed POST endpoints that return a Stripe-hosted URL ({ url }),
 * which the frontend then redirects to. (A plain GET/window.location can't
 * carry the Clerk token, so checkout must be an authenticated POST.)
 *
 * Everything degrades gracefully: if Stripe isn't configured yet
 * (STRIPE_SECRET_KEY / price IDs missing), the endpoints return a clear,
 * actionable message instead of 500ing — so the billing UI never dead-ends.
 *
 * Required env to go live:
 *   STRIPE_SECRET_KEY            sk_live_… / sk_test_…
 *   STRIPE_PRICE_PRO_MONTH       price_…   (and _YEAR / BUSINESS variants)
 *   STRIPE_WEBHOOK_SECRET        whsec_…   (for the /webhooks/stripe handler)
 *   APP_URL                      e.g. https://app.mondaily.com (success/return)
 */

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();
router.use("*", requireAuth);

const STRIPE_API = "https://api.stripe.com/v1";
const appUrl = () => (process.env.APP_URL ?? "https://app.mondaily.com").replace(/\/$/, "");

function encodeForm(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
    .join("&");
}

async function stripePost(path: string, params: Record<string, string | undefined>): Promise<any> {
  const key = process.env.STRIPE_SECRET_KEY!;
  const res = await fetch(`${STRIPE_API}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: encodeForm(params),
  });
  const json = await res.json() as any;
  if (!res.ok) throw new Error(json?.error?.message ?? `Stripe HTTP ${res.status}`);
  return json;
}

/** Resolve the configured Stripe price id for a plan + interval, from env. */
function priceFor(plan: string, interval: string): string | undefined {
  const key = `STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`;
  return process.env[key];
}

// POST /checkout { plan, interval } → { url }
router.post("/checkout", async (c) => {
  const body = await c.req.json<{ plan?: string; interval?: string }>().catch(() => ({} as { plan?: string; interval?: string }));
  const plan = (body.plan ?? "").toLowerCase();
  const interval = (body.interval ?? "month").toLowerCase();

  if (!process.env.STRIPE_SECRET_KEY) {
    return c.json({ error: "Billing isn't connected yet. Add STRIPE_SECRET_KEY to enable upgrades.", configured: false }, 503);
  }
  const price = priceFor(plan, interval);
  if (!price) {
    return c.json({ error: `No price configured for ${plan}/${interval}. Set STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}.`, configured: false }, 400);
  }

  const workspaceId = c.get("workspaceId");
  const { data: member } = await supabase
    .from("workspace_members").select("email")
    .eq("workspace_id", workspaceId).eq("user_id", c.get("userId")).maybeSingle();

  try {
    const session = await stripePost("checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      success_url: `${appUrl()}/settings/billing?billing=success`,
      cancel_url: `${appUrl()}/settings/billing?billing=cancelled`,
      client_reference_id: workspaceId,
      "metadata[workspace_id]": workspaceId,
      "metadata[plan]": plan,
      "subscription_data[metadata][workspace_id]": workspaceId,
      "subscription_data[metadata][plan]": plan,
      customer_email: member?.email || undefined,
      allow_promotion_codes: "true",
    });
    return c.json({ url: session.url });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : "Could not start checkout." }, 500);
  }
});

// One-time AI credit pack. price_data is inline so no Stripe Price needs pre-creating.
const CREDIT_PACK = { credits: 100_000, amount_usd: 10 };

// POST /credits-checkout → { url } — buy a one-time credit pack AND save the card off-session so
// the auto-refill engine can charge it later. mode=payment + setup_future_usage=off_session.
router.post("/credits-checkout", async (c) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    return c.json({ error: "Billing isn't connected yet. Add STRIPE_SECRET_KEY to enable credit purchases.", configured: false }, 503);
  }
  const workspaceId = c.get("workspaceId");
  const [{ data: ws }, { data: member }] = await Promise.all([
    supabase.from("workspaces").select("stripe_customer_id").eq("id", workspaceId).maybeSingle(),
    supabase.from("workspace_members").select("email").eq("workspace_id", workspaceId).eq("user_id", c.get("userId")).maybeSingle(),
  ]);
  const existingCustomer = (ws as Record<string, unknown> | null)?.stripe_customer_id as string | undefined;

  try {
    const session = await stripePost("checkout/sessions", {
      mode: "payment",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(CREDIT_PACK.amount_usd * 100),
      "line_items[0][price_data][product_data][name]": `${CREDIT_PACK.credits.toLocaleString()} AI credits`,
      "line_items[0][quantity]": "1",
      // Persist the card for off-session auto-refill charges.
      "payment_intent_data[setup_future_usage]": "off_session",
      success_url: `${appUrl()}/settings/billing?credits=success`,
      cancel_url: `${appUrl()}/settings/billing?credits=cancelled`,
      client_reference_id: workspaceId,
      "metadata[workspace_id]": workspaceId,
      "metadata[kind]": "credit_pack",
      "metadata[credits]": String(CREDIT_PACK.credits),
      // Reuse the saved customer if we have one; otherwise create one we can charge again later.
      ...(existingCustomer ? { customer: existingCustomer } : { customer_creation: "always", customer_email: member?.email || undefined }),
    });
    return c.json({ url: session.url });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : "Could not start the credit purchase." }, 500);
  }
});

// POST /portal → { url } — manage an existing subscription.
router.post("/portal", async (c) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    return c.json({ error: "Billing isn't connected yet.", configured: false }, 503);
  }
  const workspaceId = c.get("workspaceId");
  const { data: ws } = await supabase.from("workspaces").select("stripe_customer_id").eq("id", workspaceId).single();
  const customer = (ws as Record<string, unknown> | null)?.stripe_customer_id as string | undefined;
  if (!customer) {
    return c.json({ error: "No active subscription yet — choose a plan to get started.", needs_checkout: true }, 400);
  }
  try {
    const session = await stripePost("billing_portal/sessions", {
      customer,
      return_url: `${appUrl()}/settings/billing`,
    });
    return c.json({ url: session.url });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : "Could not open the billing portal." }, 500);
  }
});

export { router as billingRouter };
