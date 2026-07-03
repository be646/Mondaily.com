import { supabase } from "@mondaily/db/client";
import { CREDIT_PACKS, computePackCredits, normalizeTierId, type BillingInterval } from "@mondaily/shared/pricing";

/**
 * Stripe auto-refill engine. Called right after a usage deduction: if the workspace opted in and
 * its balance has fallen below the configured threshold, charge the saved Stripe customer
 * off-session, then append the matching pack's FINAL credits (base + plan/annual bonus) to the
 * ledger — consistent with the shared catalog.
 *
 * Fully guarded — no-ops without STRIPE_SECRET_KEY, opt-in, or a saved customer; debounced so
 * concurrent deductions can't double-charge; never throws into the usage-recording path.
 */
const STRIPE_API = "https://api.stripe.com/v1";

/** Map an auto-refill dollar amount to the catalog pack of that price (default: standard/$10). */
function packForAmount(amountUsd: number): string {
  return Object.values(CREDIT_PACKS).find((p) => p.price_usd === amountUsd)?.id ?? "standard";
}

function encodeForm(params: Record<string, string>): string {
  return Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

export async function maybeAutoRefill(workspaceId: string): Promise<void> {
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return;

    const { data: ws } = await supabase.from("workspaces").select("settings, stripe_customer_id").eq("id", workspaceId).maybeSingle();
    if (!ws) return;
    const settings = (ws.settings ?? {}) as Record<string, unknown>;
    const ar = (settings.auto_refill ?? {}) as { enabled?: boolean; threshold?: number; amount_usd?: number };
    const customer = (ws as { stripe_customer_id?: string | null }).stripe_customer_id;
    if (!ar.enabled || !customer) return;

    const threshold = Number(ar.threshold ?? 5000);
    const amountUsd = Number(ar.amount_usd ?? 10);
    const tier = normalizeTierId((settings as { account_tier?: string }).account_tier);
    const interval: BillingInterval = (settings as { billing_interval?: string }).billing_interval === "year" ? "year" : "month";
    const refillCredits = computePackCredits(packForAmount(amountUsd), tier, interval).final_credits;

    const { data: bal } = await supabase.rpc("ai_credit_balance", { ws: workspaceId });
    if (Number(bal ?? 0) >= threshold) return;

    // Debounce: skip if a purchase already landed in the last 2 minutes (concurrency guard).
    const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: recent } = await supabase.from("ai_credits_ledger").select("id")
      .eq("workspace_id", workspaceId).eq("transaction_type", "purchase").gte("created_at", since).limit(1);
    if (recent && recent.length > 0) return;

    // Find the card saved on the customer (set up off-session during a credit-pack purchase).
    const pmRes = await fetch(`${STRIPE_API}/payment_methods?customer=${encodeURIComponent(customer)}&type=card&limit=1`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const pmJson = await pmRes.json().catch(() => ({})) as { data?: Array<{ id?: string }> };
    const paymentMethod = pmJson?.data?.[0]?.id;
    if (!paymentMethod) return; // no card on file yet — user must buy a pack once to enable auto-refill

    // Off-session charge against the saved card.
    const res = await fetch(`${STRIPE_API}/payment_intents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: encodeForm({
        amount: String(Math.round(amountUsd * 100)),
        currency: "usd",
        customer,
        payment_method: paymentMethod,
        confirm: "true",
        off_session: "true",
        description: "Mondaily AI credit auto-refill",
      }),
    });
    if (!res.ok) return; // declined / requires authentication — never disrupt the usage path

    await supabase.from("ai_credits_ledger").insert({
      workspace_id: workspaceId,
      amount: refillCredits,
      transaction_type: "purchase",
      description: `Auto-refill · $${amountUsd} → ${refillCredits.toLocaleString()} AI credits`,
    }).then(() => {}, () => {});
  } catch {
    /* never throw into recordCreditUsage */
  }
}
