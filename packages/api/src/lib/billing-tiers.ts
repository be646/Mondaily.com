import { supabase } from "@mondaily/db/client";
import { grantTierCredits } from "./credits";
import { normalizeTierId } from "@mondaily/shared/pricing";

/** Canonicalize a tier string. Delegates to the shared catalog normalizer (unknown → scout).
 *  NOTE: this used to default unknowns to "operator", which silently upgraded bad input — one of the
 *  sources of the cross-surface tier disagreement. It now matches every other resolver. */
export function normalizeTier(raw: string | undefined): string {
  return normalizeTierId(raw);
}

/** Flip a workspace to a real, PAID tier after a Stripe subscription is actually confirmed active —
 *  writes settings.account_tier (the source of truth the rest of the app reads), clears any
 *  pending_plan (the "chosen but unpaid" flag from onboarding), stamps subscription bookkeeping, and
 *  tops credits up to the tier's real allotment. Shared by the embedded-Payment-Element subscribe
 *  path AND the Stripe webhook, so both apply the exact same activation logic. */
export async function activateTier(workspaceId: string, tier: string, subscriptionId?: string): Promise<void> {
  const { data: ws } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle();
  const settings: Record<string, unknown> = { ...((ws?.settings as Record<string, unknown> | null) ?? {}) };
  delete settings.pending_plan;
  delete settings.trial_ends_at; // a paid tier supersedes any trial countdown
  settings.account_tier = tier;
  settings.plan = tier;
  settings.track = tier === "scout" ? "solo" : "business";
  settings.billing_status = "active";
  if (subscriptionId) settings.stripe_subscription_id = subscriptionId;
  await supabase.from("workspaces").update({ settings, plan: tier }).eq("id", workspaceId);
  await grantTierCredits(workspaceId, tier, `${tier} plan activated via Stripe`);
}

/** A subscription is gone/cancelled/unpaid — fall back to the free Scout baseline (never lock the
 *  workspace out; Scout keeps the workspace usable while they decide whether to resubscribe). */
export async function downgradeToScout(workspaceId: string): Promise<void> {
  const { data: ws } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle();
  const settings: Record<string, unknown> = { ...((ws?.settings as Record<string, unknown> | null) ?? {}) };
  settings.account_tier = "scout";
  settings.plan = "scout";
  settings.track = "solo";
  settings.billing_status = "cancelled";
  delete settings.stripe_subscription_id;
  await supabase.from("workspaces").update({ settings, plan: "scout" }).eq("id", workspaceId);
}
