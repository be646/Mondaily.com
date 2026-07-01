import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { isWorkspaceAdmin } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";
import { createCreditPackCheckout } from "../lib/credit-pack";
import { activateTier, normalizeTier } from "../lib/billing-tiers";

/**
 * Billing — embedded Stripe Payment Element (primary) + Customer Portal + one-time credit packs.
 *
 * The actual card entry lives on OUR OWN page: /setup-intent + /subscribe + /confirm-subscription
 * back the embedded flow (apps/app/src/components/billing/stripe-payment-form.tsx) — never a
 * redirect to checkout.stripe.com. /portal still opens Stripe's HOSTED customer portal (cancel,
 * invoice history, update card) — that's the one intentional exception, matching normal SaaS
 * practice. /checkout (hosted Checkout Session) remains only for one-time credit-pack purchases
 * (lib/credit-pack.ts), not for choosing a subscription plan.
 *
 * Everything degrades gracefully: if Stripe isn't configured yet, endpoints return a clear,
 * actionable message instead of 500ing — so the billing UI never dead-ends.
 *
 * Required env to go live:
 *   STRIPE_SECRET_KEY            sk_live_… / sk_test_…            (server-side API calls)
 *   STRIPE_PUBLISHABLE_KEY       pk_live_… / pk_test_…            (embedded Payment Element)
 *   STRIPE_PRICE_OPERATOR_MONTH  price_…   (+ _YEAR)
 *   STRIPE_PRICE_COMMAND_MONTH   price_…   (+ _YEAR)              — Sovereign is contact-sales only
 *   STRIPE_WEBHOOK_SECRET        whsec_…   (for POST /webhooks/stripe — activates the real tier)
 *   APP_URL                      e.g. https://app.mondaily.com (portal return_url)
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

// POST /credits-checkout → { url } — buy a one-time credit pack AND save the card off-session so
// the auto-refill engine can charge it later. Shared logic in lib/credit-pack.ts.
router.post("/credits-checkout", async (c) => {
  const r = await createCreditPackCheckout(c.get("workspaceId"), c.get("userId"));
  return r.url ? c.json({ url: r.url }) : c.json({ error: r.error, configured: r.status !== 503 }, r.status as 503 | 500);
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

async function stripeGet(path: string): Promise<any> {
  const key = process.env.STRIPE_SECRET_KEY!;
  const res = await fetch(`${STRIPE_API}/${path}`, { headers: { Authorization: `Bearer ${key}` } });
  const json = await res.json() as any;
  if (!res.ok) throw new Error(json?.error?.message ?? `Stripe HTTP ${res.status}`);
  return json;
}

/** Get this workspace's Stripe customer, creating one on first use. */
async function ensureCustomer(workspaceId: string, userId: string): Promise<string> {
  const { data: ws } = await supabase.from("workspaces").select("stripe_customer_id").eq("id", workspaceId).maybeSingle();
  const existing = (ws as Record<string, unknown> | null)?.stripe_customer_id as string | undefined;
  if (existing) return existing;
  const { data: member } = await supabase.from("workspace_members").select("email, name").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  const customer = await stripePost("customers", {
    email: (member?.email as string) || undefined,
    name: (member?.name as string) || undefined,
    "metadata[workspace_id]": workspaceId,
  });
  await supabase.from("workspaces").update({ stripe_customer_id: customer.id }).eq("id", workspaceId);
  return customer.id as string;
}

/**
 * Embedded billing — Stripe Payment Element on OUR OWN frontend (never a Stripe-hosted redirect).
 * The card field itself is Stripe's embedded Element (so raw card numbers never touch our
 * servers — required for PCI compliance), rendered inside our page with our styling and a
 * "Powered by Stripe" mark, exactly as requested.
 *
 * Flow: POST /setup-intent (mount the Payment Element) → user enters card, frontend confirms the
 * SetupIntent with Stripe.js → POST /subscribe (create the real subscription using that saved
 * payment method) → we activate the tier immediately (webhook re-confirms it idempotently).
 */
router.post("/setup-intent", async (c) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    return c.json({ error: "Billing isn't connected yet. Add STRIPE_SECRET_KEY to enable upgrades.", configured: false }, 503);
  }
  if (!isWorkspaceAdmin(c.get("role"))) return c.json({ error: "Only owners and admins can manage billing." }, 403);
  try {
    const customer = await ensureCustomer(c.get("workspaceId"), c.get("userId"));
    const intent = await stripePost("setup_intents", {
      customer,
      "automatic_payment_methods[enabled]": "true",
      usage: "off_session", // so the saved card can be charged for future renewals unattended
    });
    return c.json({
      client_secret: intent.client_secret,
      publishable_key: process.env.STRIPE_PUBLISHABLE_KEY ?? null,
    });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : "Could not start card setup." }, 500);
  }
});

// POST /subscribe { plan, interval, payment_method_id } — creates the real Stripe subscription
// against the payment method the user just entered in our embedded Payment Element, and activates
// the tier immediately (no waiting on a webhook round-trip for the UI to update).
router.post("/subscribe", async (c) => {
  const body = await c.req.json<{ plan?: string; interval?: string; payment_method_id?: string }>().catch(() => ({} as Record<string, never>));
  const plan = normalizeTier(body.plan);
  const interval = (body.interval ?? "month").toLowerCase();
  const paymentMethodId = body.payment_method_id;

  if (!process.env.STRIPE_SECRET_KEY) {
    return c.json({ error: "Billing isn't connected yet. Add STRIPE_SECRET_KEY to enable upgrades.", configured: false }, 503);
  }
  if (!isWorkspaceAdmin(c.get("role"))) return c.json({ error: "Only owners and admins can manage billing." }, 403);
  if (plan === "sovereign") return c.json({ error: "Sovereign is custom pricing — contact sales@mondaily.com." }, 400);
  if (!paymentMethodId) return c.json({ error: "No payment method — complete the card form first." }, 400);
  const price = priceFor(plan, interval);
  if (!price) {
    return c.json({ error: `No price configured for ${plan}/${interval}. Set STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}.`, configured: false }, 400);
  }

  const workspaceId = c.get("workspaceId");
  try {
    const customer = await ensureCustomer(workspaceId, c.get("userId"));
    // Attach the payment method to the customer (idempotent — Stripe 400s harmlessly if it's
    // already attached to this same customer) and make it the default for future invoices.
    await stripePost(`payment_methods/${paymentMethodId}/attach`, { customer }).catch(() => {});
    await stripePost(`customers/${customer}`, { "invoice_settings[default_payment_method]": paymentMethodId });

    const sub = await stripePost("subscriptions", {
      customer,
      "items[0][price]": price,
      default_payment_method: paymentMethodId,
      "metadata[workspace_id]": workspaceId,
      "metadata[plan]": plan,
      "expand[0]": "latest_invoice.payment_intent",
      "payment_settings[save_default_payment_method]": "on_subscription",
    });

    const pi = sub?.latest_invoice?.payment_intent as { status?: string; client_secret?: string } | undefined;
    // Most cards confirm instantly; some require 3D Secure — hand the client_secret back so the
    // frontend can complete that one extra step. We don't activate the tier until it's genuinely paid.
    if (pi?.status && pi.status !== "succeeded" && pi.status !== "processing" && pi.client_secret) {
      return c.json({ requires_action: true, client_secret: pi.client_secret, subscription_id: sub.id });
    }

    await activateTier(workspaceId, plan, sub.id as string);
    return c.json({ ok: true, plan, subscription_id: sub.id });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : "Could not start your subscription." }, 500);
  }
});

// POST /confirm-subscription { subscription_id } — after the frontend completes 3D Secure via
// Stripe.js, re-check the subscription's real status server-side before activating the tier
// (never trust the client's word alone for something this important).
router.post("/confirm-subscription", async (c) => {
  if (!process.env.STRIPE_SECRET_KEY) return c.json({ error: "Billing isn't connected yet.", configured: false }, 503);
  if (!isWorkspaceAdmin(c.get("role"))) return c.json({ error: "Only owners and admins can manage billing." }, 403);
  const body = await c.req.json<{ subscription_id?: string }>().catch(() => ({} as Record<string, never>));
  if (!body.subscription_id) return c.json({ error: "Missing subscription_id" }, 400);
  try {
    const sub = await stripeGet(`subscriptions/${body.subscription_id}`);
    if (!["active", "trialing"].includes(sub.status)) {
      return c.json({ error: `Payment not completed (status: ${sub.status}).` }, 400);
    }
    const plan = normalizeTier((sub.metadata as Record<string, unknown> | undefined)?.plan as string | undefined);
    await activateTier(c.get("workspaceId"), plan, sub.id);
    return c.json({ ok: true, plan });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : "Could not confirm the subscription." }, 500);
  }
});

export { router as billingRouter };
