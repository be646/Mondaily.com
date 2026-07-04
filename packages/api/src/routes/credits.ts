import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";
import { createCreditPackCheckout } from "../lib/credit-pack";
import { burstStatus, reconcileIncludedCredits } from "../lib/credits";
import { getEntitlement, resolveEntitlement } from "../lib/entitlements";
import { PLAN_TIERS, CREDIT_PACKS, CREDIT_PACK_ORDER, computePackCredits, monthlyCreditsFor, type BillingInterval } from "@mondaily/shared/pricing";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string; financeRole: string } }>();
router.use("*", requireAuth);

/** First day of next calendar month (UTC) — the monthly credit reset date shown to the user. */
function nextResetIso(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)).toISOString();
}

// GET /credits/balance — THE wallet state for the sidebar bar + billing summary. NEVER negative.
// Same shape drives both surfaces, so they can't disagree. Self-heals the wallet on read: if the
// account is entitled to more included credits than the ledger has actually granted (the legacy
// under-grant bug), it tops up the shortfall before computing the balance it returns.
router.get("/balance", async (c) => {
  const ws = c.get("workspaceId");
  const { data: wsRow } = await supabase.from("workspaces").select("plan, settings").eq("id", ws).maybeSingle();
  const settings = (wsRow?.settings ?? {}) as Record<string, unknown>;
  const ent = await getEntitlement(ws);   // resolved tier (paid / trial / free)
  const tier = ent.tier;

  const readLedger = async () => {
    const { data: rows } = await supabase
      .from("ai_credits_ledger").select("amount, transaction_type").eq("workspace_id", ws);
    const list = rows ?? [];
    return {
      enrolled: list.length > 0,
      granted: list.filter(r => r.transaction_type === "grant").reduce((s, r) => s + Number(r.amount), 0),
      purchased: list.filter(r => r.transaction_type === "purchase").reduce((s, r) => s + Number(r.amount), 0),
      usedNeg: list.filter(r => r.transaction_type === "usage").reduce((s, r) => s + Number(r.amount), 0), // ≤ 0
    };
  };

  let { enrolled, granted, purchased, usedNeg } = await readLedger();
  // Self-heal: make included monthly credits ACTUALLY usable before we report the balance.
  const added = await reconcileIncludedCredits(ws, { grantedSoFar: granted, enrolled });
  if (added > 0) ({ enrolled, granted, purchased, usedNeg } = await readLedger());

  const included = ent.includedMonthlyCredits;         // catalog allotment for the resolved tier
  const used = Math.abs(usedNeg);
  const rawBalance = granted + purchased + usedNeg;      // grants + purchases − usage
  const remaining = Math.max(0, rawBalance);            // floor — users never see a negative balance
  // Denominator for the meter: included monthly + anything they purchased on top. Floored at
  // `remaining` so the bar is NEVER < the number it contains (guards the "984k / 550k" impossibility
  // if the entitlement is briefly inconsistent).
  const capacity = Math.max(remaining, (included ?? granted) + purchased);
  const ar = (settings.auto_refill ?? {}) as Record<string, unknown>;
  const burst = enrolled ? await burstStatus(ws) : { limited: false, used: 0, cap: 0, resetsAt: null };
  return c.json({
    enrolled,
    // ── the one balance model, named exactly per spec ──
    entitlement_tier: tier,
    included_monthly_credits: included,
    purchased_credits: purchased,
    used_credits: used,
    remaining_credits: remaining,
    raw_ledger_balance: rawBalance,                      // may be < 0 for an un-reconciled legacy wallet
    reset_at: nextResetIso(),
    // ── back-compat aliases the existing UI already reads ──
    balance: remaining,
    remaining,
    granted,
    purchased,
    used,
    included_monthly: included,
    capacity,
    account_tier: tier,
    source: ent.source,
    trial_ends_at: ent.trialEndsAt,
    low: remaining > 0 && capacity > 0 && remaining < capacity * 0.1,
    exhausted: enrolled && remaining <= 0,
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
  const settings = (wsRow?.settings ?? {}) as { billing_interval?: string };
  const tier = (await getEntitlement(ws)).tier;   // resolved entitlement drives the pack bonus
  const interval: BillingInterval = settings.billing_interval === "year" ? "year" : "month";
  const packs = CREDIT_PACK_ORDER.map((id) => ({ ...CREDIT_PACKS[id]!, quote: computePackCredits(id, tier, interval) }));
  return c.json({ tier, interval, plan_bonus_pct: PLAN_TIERS[tier].packBonusPct, packs });
});

// POST /credits/reconcile — admin-safe manual reconciliation (tops included credits up to the
// resolved entitlement). Idempotent; returns how many credits were added. Backstop for the
// on-read self-heal in /balance.
router.post("/reconcile", requireAdminRole, async (c) => {
  const added = await reconcileIncludedCredits(c.get("workspaceId"));
  return c.json({ ok: true, credits_added: added });
});

// GET /credits/diagnostics — admin-safe, read-only. Exposes BOTH the raw stored fields and the
// resolved entitlement side-by-side, plus WHY it resolved that way and whether the two disagree —
// so a "credits granted but tier still Scout" disconnect is diagnosable without guessing.
router.get("/diagnostics", requireAdminRole, async (c) => {
  const ws = c.get("workspaceId");
  const [{ data: wsRow }, { data: rows }] = await Promise.all([
    supabase.from("workspaces").select("plan, settings").eq("id", ws).maybeSingle(),
    supabase.from("ai_credits_ledger").select("amount, transaction_type").eq("workspace_id", ws),
  ]);
  const settings = (wsRow?.settings ?? {}) as Record<string, unknown>;
  const planColumn = (wsRow as { plan?: string } | null)?.plan ?? null;
  const list = rows ?? [];
  const included = list.filter(r => r.transaction_type === "grant").reduce((s, r) => s + Number(r.amount), 0);
  const purchased = list.filter(r => r.transaction_type === "purchase").reduce((s, r) => s + Number(r.amount), 0);
  const used = Math.abs(list.filter(r => r.transaction_type === "usage").reduce((s, r) => s + Number(r.amount), 0));
  const rawBalance = included + purchased - used;
  const remaining = Math.max(0, rawBalance);

  const ent = resolveEntitlement(settings, planColumn);
  const tier = ent.tier;
  const target = monthlyCreditsFor(tier);                 // included monthly for the RESOLVED tier
  const capacity = Math.max(remaining, (target ?? included) + purchased);
  const trialEndsAt = (settings.trial_ends_at as string) ?? null;
  const trialActive = trialEndsAt ? new Date(trialEndsAt).getTime() > Date.now() : false;
  const trialUsed = Boolean(settings.trial_used);

  // Human-readable reason the resolver landed on this tier.
  let why: string;
  if (settings.billing_status === "cancelled") why = "billing_status is 'cancelled' → Scout";
  else if (settings.billing_status === "active" && settings.stripe_subscription_id) why = `active paid subscription → ${tier}`;
  else if (trialEndsAt && trialActive) why = "trial_ends_at is in the future → Operator (trial)";
  else if (trialEndsAt && !trialActive) why = "trial_ends_at is in the PAST → Scout (expired trial)";
  else if (tier !== "scout") why = `account_tier/plan resolves to '${tier}' with no trial marker → ${tier}`;
  else why = `no trial marker and account_tier/plan ('${(settings.account_tier as string) ?? planColumn ?? "none"}') normalizes to Scout`;

  // The tell-tale disconnect: an Operator-sized grant sitting on a Scout entitlement.
  const grantSuggestsOperator = included >= 1_000_000;
  const tierCreditMismatch = grantSuggestsOperator && tier === "scout";

  const burst = list.length > 0 ? await burstStatus(ws) : { limited: false, used: 0, cap: 0, resetsAt: null };
  return c.json({
    workspace_id: ws,
    // ── raw stored fields ──
    workspaces_plan_column: planColumn,
    settings_account_tier: (settings.account_tier as string) ?? null,
    settings_plan: (settings.plan as string) ?? null,
    settings_track: (settings.track as string) ?? null,
    settings_trial_used: trialUsed,
    settings_trial_ends_at: trialEndsAt,
    settings_billing_status: (settings.billing_status as string) ?? null,
    settings_pending_plan: (settings.pending_plan as string) ?? null,
    // ── resolved entitlement ──
    resolved_tier: tier,
    resolved_source: ent.source,
    resolved_why: why,
    trial_active: trialActive,
    // ── credit model ──
    included_monthly_credits: target,
    grant_row_total: included,
    purchased_total: purchased,
    usage_total: used,
    raw_balance: rawBalance,
    remaining,
    capacity,
    trial_eligible: !trialUsed && tier === "scout",
    // ── what the frontend receives (must agree) ──
    billing_plan_returned: tier,               // GET /billing `plan`
    balance_account_tier_returned: tier,       // GET /credits/balance `account_tier`
    // ── health flags ──
    tier_credit_mismatch: tierCreditMismatch,  // true = Operator-sized grant on a Scout entitlement
    grant_shortfall: target != null ? Math.max(0, target - included) : 0,
    negative_flagged: rawBalance < 0,
    // ── legacy field names kept for back-compat ──
    plan: tier,
    entitlement_source: ent.source,
    monthly_included_credits: target,
    granted_credits: included,
    purchased_credits: purchased,
    used_credits: used,
    remaining_credits: remaining,
    burst: { used: burst.used, cap: burst.cap, window_hours: 5, limited: burst.limited, resets_at: burst.resetsAt },
    reset_date: nextResetIso(),
    trial_ends_at: trialEndsAt,
    on_trial: ent.isTrial,
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
