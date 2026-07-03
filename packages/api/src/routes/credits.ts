import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";
import { createCreditPackCheckout } from "../lib/credit-pack";
import { burstStatus } from "../lib/credits";
import { PLAN_TIERS, CREDIT_PACKS, CREDIT_PACK_ORDER, computePackCredits, monthlyCreditsFor, normalizeTierId, type BillingInterval } from "@mondaily/shared/pricing";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string; financeRole: string } }>();
router.use("*", requireAuth);

/** First day of next calendar month (UTC) — the monthly credit reset date shown to the user. */
function nextResetIso(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)).toISOString();
}

// GET /credits/balance — current wallet state for the sidebar bar + billing summary. NEVER negative.
router.get("/balance", async (c) => {
  const ws = c.get("workspaceId");
  const { data: rows } = await supabase
    .from("ai_credits_ledger").select("amount, transaction_type").eq("workspace_id", ws);
  const list = rows ?? [];
  const granted = list.filter(r => r.transaction_type === "grant").reduce((s, r) => s + Number(r.amount), 0);
  const purchased = list.filter(r => r.transaction_type === "purchase").reduce((s, r) => s + Number(r.amount), 0);
  const usedNeg = list.filter(r => r.transaction_type === "usage").reduce((s, r) => s + Number(r.amount), 0); // ≤ 0
  const rawBalance = granted + purchased + usedNeg;
  const remaining = Math.max(0, rawBalance); // floor — users never see a negative balance
  const { data: wsRow } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const settings = (wsRow?.settings ?? {}) as Record<string, unknown>;
  const ar = (settings.auto_refill ?? {}) as Record<string, unknown>;
  const tier = normalizeTierId((settings.account_tier as string) ?? (settings.track as string));
  const burst = list.length > 0 ? await burstStatus(ws) : { limited: false, used: 0, cap: 0, resetsAt: null };
  return c.json({
    enrolled: list.length > 0,
    balance: remaining,          // floored (never < 0)
    remaining,
    granted,
    purchased,
    used: Math.abs(usedNeg),
    included_monthly: monthlyCreditsFor(tier),
    account_tier: tier,
    reset_at: nextResetIso(),
    trial_ends_at: (settings.trial_ends_at as string) ?? null,
    low: remaining > 0 && remaining < (monthlyCreditsFor(tier) ?? 100_000) * 0.1,
    exhausted: list.length > 0 && remaining <= 0,
    burst: { used: burst.used, cap: burst.cap, limited: burst.limited, resets_at: burst.resetsAt },
    auto_refill: {
      enabled: Boolean(ar.enabled),
      threshold: Number(ar.threshold ?? 5000),
      amount_usd: Number(ar.amount_usd ?? 10),
    },
  });
});

// GET /credits/packs — the catalog packs with the credits THIS workspace would get (tier + interval
// bonus applied). One source of truth: same computePackCredits the checkout + webhook use.
router.get("/packs", async (c) => {
  const ws = c.get("workspaceId");
  const { data: wsRow } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const settings = (wsRow?.settings ?? {}) as { account_tier?: string; billing_interval?: string };
  const tier = normalizeTierId(settings.account_tier);
  const interval: BillingInterval = settings.billing_interval === "year" ? "year" : "month";
  const packs = CREDIT_PACK_ORDER.map((id) => ({ ...CREDIT_PACKS[id]!, quote: computePackCredits(id, tier, interval) }));
  return c.json({ tier, interval, plan_bonus_pct: PLAN_TIERS[tier].packBonusPct, packs });
});

// GET /credits/diagnostics — admin-safe explanation of the whole wallet (item 8). Read-only.
router.get("/diagnostics", requireAdminRole, async (c) => {
  const ws = c.get("workspaceId");
  const { data: rows } = await supabase.from("ai_credits_ledger").select("amount, transaction_type").eq("workspace_id", ws);
  const list = rows ?? [];
  const included = list.filter(r => r.transaction_type === "grant").reduce((s, r) => s + Number(r.amount), 0);
  const purchased = list.filter(r => r.transaction_type === "purchase").reduce((s, r) => s + Number(r.amount), 0);
  const used = Math.abs(list.filter(r => r.transaction_type === "usage").reduce((s, r) => s + Number(r.amount), 0));
  const rawBalance = included + purchased - used;
  const { data: wsRow } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const settings = (wsRow?.settings ?? {}) as { account_tier?: string; trial_ends_at?: string };
  const tier = normalizeTierId(settings.account_tier);
  const burst = list.length > 0 ? await burstStatus(ws) : { limited: false, used: 0, cap: 0, resetsAt: null };
  return c.json({
    plan: tier,
    monthly_included_credits: monthlyCreditsFor(tier),
    granted_credits: included,
    purchased_credits: purchased,
    used_credits: used,
    remaining_credits: Math.max(0, rawBalance),        // floored
    raw_balance: rawBalance,                            // may be < 0 for an un-reconciled legacy wallet
    negative_flagged: rawBalance < 0,                  // if true, run migration 0021 to floor it
    burst: { used: burst.used, cap: burst.cap, window_hours: 5, limited: burst.limited, resets_at: burst.resetsAt },
    reset_date: nextResetIso(),
    trial_ends_at: settings.trial_ends_at ?? null,
    on_trial: tier === "operator" && Boolean(settings.trial_ends_at),
  });
});

// POST /credits/auto-refill — persist the auto-recharge policy onto the workspace record.
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

// POST /credits/checkout-session — admin-gated credit-pack checkout. Body: { pack_id }.
router.post("/checkout-session", requireAdminRole, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { pack_id?: string };
  const packId = body.pack_id && CREDIT_PACKS[body.pack_id] ? body.pack_id : "standard";
  const r = await createCreditPackCheckout(c.get("workspaceId"), c.get("userId"), packId);
  return r.url ? c.json({ url: r.url }) : c.json({ error: r.error }, r.status as 400 | 503 | 500);
});

export { router as creditsRouter };
