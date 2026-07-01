import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { supabase } from "@mondaily/db/client";
import { maybeAutoRefill } from "./auto-refill";

/**
 * AI credit wallet (ai_credits_ledger). Balance = SUM(amount): grant/purchase add, usage subtracts.
 *
 * GRANDFATHERING: a workspace is only gated once it's ENROLLED (has ≥1 ledger row). Workspaces
 * with no ledger (pre-existing, or before the migration runs) are never blocked — so this can't
 * brick existing accounts or AI when the feature is half-rolled-out.
 */
export const SOLO_GRANT = 50_000;
export const BUSINESS_TRIAL_GRANT = 500_000;
export const COMMAND_GRANT = 2_000_000;

/** Single source of truth for the monthly credit allotment per real (paid or free) tier — used by
 *  onboarding, the Stripe subscription webhook, and the embedded subscribe endpoint so they never
 *  drift out of sync with each other. */
export const TIER_GRANTS: Record<string, number> = {
  scout: SOLO_GRANT,
  operator: BUSINESS_TRIAL_GRANT,
  command: COMMAND_GRANT,
  sovereign: COMMAND_GRANT,
};

/** Bring a workspace's credit balance up to EXACTLY its tier's allotment — grants only the
 *  shortfall (target - current), so calling this twice for the same tier is a no-op and it never
 *  stacks on top of an existing balance. */
export async function grantTierCredits(workspaceId: string, tier: string, description: string): Promise<void> {
  const target = TIER_GRANTS[tier] ?? SOLO_GRANT;
  const { balance } = await creditStatus(workspaceId);
  const delta = target - balance;
  if (delta > 0) await grantCredits(workspaceId, delta, "grant", description);
}

/**
 * Rolling burst limits (Claude/Codex-style). Separate from the monthly wallet: a workspace can
 * have plenty of credits left but still hit a short-window ceiling that RESETS, so a runaway
 * agent loop can't drain a month of credits in minutes. The window slides — the cap frees up as
 * the oldest usage in the window ages out. Caps are tier-scaled (~a few hours of heavy use).
 */
export const BURST_WINDOW_HOURS = 5;
const BURST_CAP: Record<string, number> = {
  scout: 12_000,
  operator: 90_000,
  command: 320_000,
  sovereign: 1_000_000,
};

async function resolveTier(workspaceId: string): Promise<string> {
  const { data } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).single();
  const tier = (data?.settings as { account_tier?: string } | null)?.account_tier;
  return tier && tier in BURST_CAP ? tier : "scout";
}

export interface BurstStatus { limited: boolean; used: number; cap: number; resetsAt: string | null }

/** Sum usage in the trailing window; report whether the burst cap is hit and when it frees up. */
export async function burstStatus(workspaceId: string): Promise<BurstStatus> {
  const tier = await resolveTier(workspaceId);
  const cap = BURST_CAP[tier] ?? BURST_CAP.scout!;
  const since = new Date(Date.now() - BURST_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("ai_credits_ledger")
    .select("amount, created_at")
    .eq("workspace_id", workspaceId)
    .eq("transaction_type", "usage")
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  if (error || !data || data.length === 0) return { limited: false, used: 0, cap, resetsAt: null };
  const used = data.reduce((s, r) => s + Math.abs(Number(r.amount) || 0), 0);
  // Window resets when the OLDEST usage row ages out of the window.
  const oldest = new Date(data[0]!.created_at as string).getTime();
  const resetsAt = new Date(oldest + BURST_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  return { limited: used >= cap, used, cap, resetsAt };
}

export async function creditStatus(workspaceId: string): Promise<{ balance: number; enrolled: boolean }> {
  const { data: probe, error } = await supabase
    .from("ai_credits_ledger").select("id").eq("workspace_id", workspaceId).limit(1);
  if (error) return { balance: 0, enrolled: false };       // table missing → don't gate
  if (!probe || probe.length === 0) return { balance: 0, enrolled: false };
  const { data: bal } = await supabase.rpc("ai_credit_balance", { ws: workspaceId });
  return { balance: Number(bal ?? 0), enrolled: true };
}

export async function grantCredits(workspaceId: string, amount: number, type: "grant" | "purchase", description: string): Promise<void> {
  if (amount <= 0) return;
  await supabase.from("ai_credits_ledger")
    .insert({ workspace_id: workspaceId, amount: Math.round(amount), transaction_type: type, description })
    .then(() => {}, () => {});
}

/** Deduct token usage (negative). Fire-and-forget — called from recordAiUsage after each AI call. */
export function recordCreditUsage(workspaceId: string | undefined, tokens: number | undefined, description = "AI usage"): void {
  if (!workspaceId || !tokens || tokens <= 0) return;
  void supabase.from("ai_credits_ledger")
    .insert({ workspace_id: workspaceId, amount: -Math.round(tokens), transaction_type: "usage", description })
    // After the deduction lands, check whether auto-refill should top the wallet back up.
    .then(() => maybeAutoRefill(workspaceId), () => {});
}

/**
 * Gate generative/agent routes. Mount AFTER requireAuth. 402 only when the workspace is enrolled
 * AND its balance has hit zero/negative.
 */
export const verifyAiCredits = createMiddleware<{ Variables: { workspaceId: string } }>(async (c, next) => {
  const ws = c.get("workspaceId");
  if (ws) {
    const { balance, enrolled } = await creditStatus(ws);
    if (enrolled && balance <= 0) {
      throw new HTTPException(402, { message: "AI credits exhausted. Upgrade or purchase more to keep using AI features." });
    }
    // Rolling burst ceiling — only enforced for enrolled workspaces (never bricks pre-migration ones).
    if (enrolled) {
      const burst = await burstStatus(ws);
      if (burst.limited) {
        const resetLabel = burst.resetsAt
          ? new Date(burst.resetsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
          : "shortly";
        throw new HTTPException(429, {
          message: `You've hit your usage limit for now. It resets around ${resetLabel}. (${BURST_WINDOW_HOURS}-hour rolling window)`,
        });
      }
    }
  }
  await next();
});
