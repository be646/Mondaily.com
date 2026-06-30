import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";
import { createCreditPackCheckout } from "../lib/credit-pack";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string; financeRole: string } }>();
router.use("*", requireAuth);

// GET /credits/balance — current wallet state for the sidebar bar + billing summary.
router.get("/balance", async (c) => {
  const ws = c.get("workspaceId");
  const { data: rows } = await supabase
    .from("ai_credits_ledger").select("amount, transaction_type").eq("workspace_id", ws);
  const list = rows ?? [];
  const granted = list.filter(r => r.transaction_type !== "usage").reduce((s, r) => s + Number(r.amount), 0);
  const usedNeg = list.filter(r => r.transaction_type === "usage").reduce((s, r) => s + Number(r.amount), 0); // ≤ 0
  const { data: wsRow } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const settings = (wsRow?.settings ?? {}) as Record<string, unknown>;
  const ar = (settings.auto_refill ?? {}) as Record<string, unknown>;
  return c.json({
    enrolled: list.length > 0,
    balance: granted + usedNeg,
    granted,
    used: Math.abs(usedNeg),
    account_tier: (settings.track as string) ?? "personal",
    trial_ends_at: (settings.trial_ends_at as string) ?? null,
    auto_refill: {
      enabled: Boolean(ar.enabled),
      threshold: Number(ar.threshold ?? 5000),
      amount_usd: Number(ar.amount_usd ?? 10),
    },
  });
});

// POST /credits/auto-refill — persist the auto-recharge policy onto the workspace record so the
// Stripe charge engine can read {enabled, threshold, amount_usd} when the wallet dips below threshold.
router.post("/auto-refill", async (c) => {
  const ws = c.get("workspaceId");
  const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean; threshold?: number; amount_usd?: number };
  const { data: wsRow } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const settings = (wsRow?.settings ?? {}) as Record<string, unknown>;
  const prev = (settings.auto_refill ?? {}) as Record<string, unknown>;
  const auto_refill = {
    enabled: body.enabled ?? Boolean(prev.enabled),
    threshold: Number(body.threshold ?? prev.threshold ?? 5000),
    amount_usd: Number(body.amount_usd ?? prev.amount_usd ?? 10),
  };
  const { error } = await supabase.from("workspaces").update({ settings: { ...settings, auto_refill } }).eq("id", ws);
  return error ? c.json({ error: error.message }, 400) : c.json({ ok: true, auto_refill });
});

// GET /credits/ledger — recent transaction history for the billing ledger card.
router.get("/ledger", async (c) => {
  const ws = c.get("workspaceId");
  const { data } = await supabase
    .from("ai_credits_ledger")
    .select("id, amount, transaction_type, description, created_at")
    .eq("workspace_id", ws)
    .order("created_at", { ascending: false })
    .limit(100);
  return c.json({ ledger: data ?? [] });
});

// POST /credits/checkout-session — admin-gated alias of the one-time credit-pack checkout.
// Launches a real Stripe Checkout (mode=payment, $10 → 100k pack) that attaches the card
// off-session for the auto-refill engine. Returns { url } for the frontend to redirect to.
router.post("/checkout-session", requireAdminRole, async (c) => {
  const r = await createCreditPackCheckout(c.get("workspaceId"), c.get("userId"));
  return r.url ? c.json({ url: r.url }) : c.json({ error: r.error }, r.status as 503 | 500);
});

export { router as creditsRouter };
