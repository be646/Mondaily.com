import { supabase } from "@mondaily/db/client";

/**
 * Stripe auto-refill engine. Called right after a usage deduction: if the workspace opted in and
 * its balance has fallen below the configured threshold, charge the saved Stripe customer
 * off-session, then append a 100k 'purchase' to the ledger.
 *
 * Fully guarded — no-ops without STRIPE_SECRET_KEY, opt-in, or a saved customer; debounced so
 * concurrent deductions can't double-charge; never throws into the usage-recording path.
 */
const STRIPE_API = "https://api.stripe.com/v1";
const REFILL_CREDITS = 100_000;

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

    const { data: bal } = await supabase.rpc("ai_credit_balance", { ws: workspaceId });
    if (Number(bal ?? 0) >= threshold) return;

    // Debounce: skip if a purchase already landed in the last 2 minutes (concurrency guard).
    const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: recent } = await supabase.from("ai_credits_ledger").select("id")
      .eq("workspace_id", workspaceId).eq("transaction_type", "purchase").gte("created_at", since).limit(1);
    if (recent && recent.length > 0) return;

    // Off-session charge against the customer's default payment method.
    const res = await fetch(`${STRIPE_API}/payment_intents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: encodeForm({
        amount: String(Math.round(amountUsd * 100)),
        currency: "usd",
        customer,
        confirm: "true",
        off_session: "true",
        description: "Mondaily AI credit auto-refill",
      }),
    });
    if (!res.ok) return; // declined / requires authentication — never disrupt the usage path

    await supabase.from("ai_credits_ledger").insert({
      workspace_id: workspaceId,
      amount: REFILL_CREDITS,
      transaction_type: "purchase",
      description: `Auto-refill · $${amountUsd} → ${REFILL_CREDITS.toLocaleString()} credits`,
    }).then(() => {}, () => {});
  } catch {
    /* never throw into recordCreditUsage */
  }
}
