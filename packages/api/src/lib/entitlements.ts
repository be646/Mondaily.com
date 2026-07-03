import { supabase } from "@mondaily/db/client";
import { PLAN_TIERS, normalizeTierId, monthlyCreditsFor, type TierId } from "@mondaily/shared/pricing";

/**
 * THE single source of truth for "what tier is this workspace actually entitled to right now".
 *
 * Before this existed, every surface resolved the tier its own way — /credits/balance used
 * `account_tier ?? track`, /billing used `account_tier ?? plan-column ?? scout`, billing-tiers
 * defaulted unknowns to *operator* while pricing/plan-limits defaulted to *scout*, and the top-level
 * `plan` column was never written by onboarding. The result: the Current-plan card said Scout while
 * the wallet said Operator on the same account. Everything now funnels through resolveEntitlement().
 *
 * Precedence (highest first):
 *   1. billing_status === "cancelled"  → Scout           (an explicit downgrade always wins)
 *   2. actively PAID (billing_status "active" + a Stripe subscription) → the activated tier, "paid"
 *   3. a trial marker exists (trial_ends_at):
 *        • in the future → Operator, source "trial"
 *        • in the past   → Scout, source "free"   (an EXPIRED trial is not an entitlement)
 *   4. an explicitly-activated real tier (account_tier / plan-column is operator|command|sovereign)
 *        with no trial marker → that tier, source "paid"   (legacy/manually-granted; don't downgrade)
 *   5. otherwise → Scout, source "free"
 *
 * Real paying customers keep NO trial_ends_at (activateTier clears it), so step 3 can never downgrade
 * them — it only catches account_tier=operator left over from an expired trial.
 *
 * A `pending_plan` (chosen at onboarding but NOT paid for) NEVER counts toward the entitlement tier.
 */
export interface Entitlement {
  tier: TierId;                        // resolved, canonical — use this everywhere
  source: "paid" | "trial" | "free";
  isTrial: boolean;
  trialEndsAt: string | null;
  trialActive: boolean;
  pendingPlan: TierId | null;          // chosen-but-unpaid; surfaced for the "activate" nudge only
  includedMonthlyCredits: number | null;
  seats: number;
  billingStatus: string | null;
}

/** Pure resolver over the raw workspace record — no I/O, so it's trivial to unit-test. */
export function resolveEntitlement(
  settings: Record<string, unknown> | null | undefined,
  planColumn?: string | null,
  now: number = Date.now(),
): Entitlement {
  const s = settings ?? {};
  const trialEndsAt = (s.trial_ends_at as string) ?? null;
  const trialActive = trialEndsAt ? new Date(trialEndsAt).getTime() > now : false;
  const billingStatus = (s.billing_status as string) ?? null;

  const pendingRaw = (s.pending_plan as string) ?? null;
  const pendingPlan = pendingRaw ? normalizeTierId(pendingRaw) : null;

  // The tier the workspace has been explicitly ACTIVATED to (account_tier is authoritative; the
  // legacy `plan` column is a fallback). We deliberately do NOT fall back to `track` here — track is
  // a coarse solo/business flag and was the source of the old cross-surface disagreement.
  const explicitTier = normalizeTierId((s.account_tier as string) ?? planColumn);
  const hasPaidTier = explicitTier !== "scout";
  const paid = billingStatus === "active" && Boolean(s.stripe_subscription_id);

  let tier: TierId;
  let source: "paid" | "trial" | "free";
  if (billingStatus === "cancelled") {
    tier = "scout"; source = "free";
  } else if (paid) {
    tier = explicitTier; source = "paid";        // a real, confirmed subscription
  } else if (trialEndsAt) {
    // A trial marker exists — honor it only while it's still running; an expired trial is Scout.
    if (trialActive) { tier = "operator"; source = "trial"; }
    else { tier = "scout"; source = "free"; }
  } else if (hasPaidTier) {
    tier = explicitTier; source = "paid";        // legacy/manually-granted tier, no trial marker
  } else {
    tier = "scout"; source = "free";
  }

  return {
    tier,
    source,
    isTrial: source === "trial",
    trialEndsAt,
    trialActive,
    pendingPlan: pendingPlan && pendingPlan !== tier ? pendingPlan : null,
    includedMonthlyCredits: monthlyCreditsFor(tier),
    seats: PLAN_TIERS[tier].seats,
    billingStatus,
  };
}

/** Load a workspace and resolve its entitlement. The one function the routes should call. */
export async function getEntitlement(workspaceId: string): Promise<Entitlement> {
  const { data } = await supabase.from("workspaces").select("plan, settings").eq("id", workspaceId).maybeSingle();
  return resolveEntitlement(
    (data?.settings as Record<string, unknown> | null) ?? null,
    (data as { plan?: string } | null)?.plan ?? null,
  );
}
