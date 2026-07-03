import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { supabase } from "@mondaily/db/client";
import { grantAmountFor, burstCapFor, normalizeTierId, BURST_WINDOW_HOURS } from "@mondaily/shared/pricing";
import { maybeAutoRefill } from "./auto-refill";
import { getEntitlement } from "./entitlements";

export { BURST_WINDOW_HOURS };

/**
 * AI credit wallet (ai_credits_ledger). Balance = SUM(amount): grant/purchase add, usage subtracts.
 * The wallet is FLOORED AT ZERO — usage is clamped so a balance can never go negative (the -166k
 * bug), and enforcement fails CLOSED at zero across every AI path (see assertCreditsOk + the
 * gateway pre-flight). All amounts come from the shared pricing catalog — no hardcoded credits here.
 *
 * GRANDFATHERING: a workspace is only gated once ENROLLED (≥1 ledger row). Workspaces with no ledger
 * are never blocked, so this can't brick existing accounts while the feature rolls out.
 */

/** Raised when a workspace has no remaining credits / has hit its burst cap. Fails closed. */
export class CreditsExhaustedError extends Error {
  constructor(public readonly kind: "credits" | "burst", public readonly resetsAt: string | null, message: string) {
    super(message);
    this.name = "CreditsExhaustedError";
  }
}

/** Bring a workspace's balance up to EXACTLY its tier's allotment — grants only the shortfall
 *  (target - current), so calling twice is a no-op and it never stacks. */
export async function grantTierCredits(workspaceId: string, tier: string, description: string): Promise<void> {
  const target = grantAmountFor(normalizeTierId(tier));
  const { balance } = await creditStatus(workspaceId);
  const delta = target - balance;
  if (delta > 0) await grantCredits(workspaceId, delta, "grant", description);
}

async function resolveTier(workspaceId: string): Promise<string> {
  return (await getEntitlement(workspaceId)).tier;   // single source of truth
}

/**
 * RECONCILE included credits — bring a workspace's GRANT rows up to its resolved entitlement.
 *
 * This heals the class of bug behind the screenshot: a wallet whose grant rows were seeded at an old
 * value (e.g. the legacy 50k Scout seed) while the account was later entitled to Operator (1,000,000)
 * — so the "1M included" the UI advertised was never actually usable. We compare the sum of `grant`
 * rows to the tier's allotment and, if short, insert ONE top-up grant for exactly the shortfall.
 *
 * Idempotent: re-running computes a shortfall of ≤ 0 and inserts nothing. Never touches `purchase`
 * or `usage` rows, so purchased credits are always preserved and it can never double-grant.
 *
 * Pass `grantedSoFar` when the caller already has the ledger rows in hand (e.g. /credits/balance) to
 * avoid a redundant round-trip. Returns the number of credits added (0 when already reconciled).
 */
export async function reconcileIncludedCredits(
  workspaceId: string,
  opts: { grantedSoFar?: number; enrolled?: boolean } = {},
): Promise<number> {
  const ent = await getEntitlement(workspaceId);
  const target = grantAmountFor(ent.tier);

  let granted = opts.grantedSoFar;
  let enrolled = opts.enrolled;
  if (granted === undefined || enrolled === undefined) {
    const { data: rows } = await supabase
      .from("ai_credits_ledger").select("amount, transaction_type").eq("workspace_id", workspaceId);
    const list = rows ?? [];
    enrolled = list.length > 0;
    granted = list.filter(r => r.transaction_type === "grant").reduce((s, r) => s + Number(r.amount), 0);
  }
  if (!enrolled) return 0;                       // never enroll a workspace just by looking at it
  const shortfall = target - granted;
  if (shortfall <= 0) return 0;                  // already at/above entitlement — idempotent no-op
  await grantCredits(workspaceId, shortfall, "grant", `reconcile: included-credits top-up to ${ent.tier} entitlement`);
  return shortfall;
}

export interface BurstStatus { limited: boolean; used: number; cap: number; resetsAt: string | null }

/** Sum usage in the trailing window; report whether the burst cap is hit and when it frees up.
 *  The burst cap is a FRACTION of the monthly wallet, so it can never let a user spend beyond their
 *  total credits — the wallet floor (assertCreditsOk) is the hard stop; burst just paces bursts. */
export async function burstStatus(workspaceId: string): Promise<BurstStatus> {
  const cap = burstCapFor(normalizeTierId(await resolveTier(workspaceId)));
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

/** User-facing remaining credits — NEVER negative (the wallet is floored at 0). */
export async function remainingCredits(workspaceId: string): Promise<number> {
  const { balance } = await creditStatus(workspaceId);
  return Math.max(0, balance);
}

export async function grantCredits(workspaceId: string, amount: number, type: "grant" | "purchase", description: string): Promise<void> {
  if (amount <= 0) return;
  await supabase.from("ai_credits_ledger")
    .insert({ workspace_id: workspaceId, amount: Math.round(amount), transaction_type: type, description })
    .then(() => {}, () => {});
}

/**
 * Deduct token usage (negative). CLAMPED so the wallet can NEVER go below zero: we only deduct down
 * to the current balance. Fire-and-forget from the caller; the async body reads the balance first.
 * Only charges for work actually performed (real provider tokens) — a failed call reports 0 tokens.
 */
export function recordCreditUsage(workspaceId: string | undefined, tokens: number | undefined, description = "AI usage"): void {
  if (!workspaceId || !tokens || tokens <= 0) return;
  void (async () => {
    try {
      const { balance, enrolled } = await creditStatus(workspaceId);
      if (!enrolled) return; // not on the metered ledger → nothing to deduct
      const deduct = Math.min(Math.round(tokens), Math.max(0, balance)); // floor at zero
      if (deduct <= 0) return;
      await supabase.from("ai_credits_ledger")
        .insert({ workspace_id: workspaceId, amount: -deduct, transaction_type: "usage", description });
      await maybeAutoRefill(workspaceId);
    } catch { /* ledger is best-effort telemetry — never block the user's action */ }
  })();
}

/**
 * THE enforcement gate — call BEFORE running any AI/generative/agent action. Throws
 * CreditsExhaustedError (fail closed) when an enrolled workspace has no credits left or has hit its
 * rolling burst cap. Used by the route middleware (clean 402/429) AND the AI-gateway pre-flight (so
 * Discovery, agents, reports, and decision reasoning all fail closed too — not just /ask).
 */
export async function assertCreditsOk(workspaceId?: string): Promise<void> {
  if (!workspaceId) return;
  const { balance, enrolled } = await creditStatus(workspaceId);
  if (!enrolled) return;
  if (balance <= 0) {
    throw new CreditsExhaustedError("credits", null, "AI credits exhausted. Upgrade your plan or add a credit pack to keep using AI.");
  }
  const burst = await burstStatus(workspaceId);
  if (burst.limited) {
    throw new CreditsExhaustedError("burst", burst.resetsAt, `You've hit your short-term usage limit. It resets ${burst.resetsAt ? "around " + new Date(burst.resetsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "shortly"}.`);
  }
}

/** Route middleware — mount AFTER requireAuth on AI-consuming routes. Fails closed with a clear
 *  402 (out of credits) or 429 (burst), or falls through when the workspace isn't enrolled. */
export const verifyAiCredits = createMiddleware<{ Variables: { workspaceId: string } }>(async (c, next) => {
  const ws = c.get("workspaceId");
  if (ws) {
    try {
      await assertCreditsOk(ws);
    } catch (e) {
      if (e instanceof CreditsExhaustedError) {
        throw new HTTPException(e.kind === "credits" ? 402 : 429, { message: e.message });
      }
      throw e;
    }
  }
  await next();
});
