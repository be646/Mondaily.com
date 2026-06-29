import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { supabase } from "@mondaily/db/client";

/**
 * AI credit wallet (ai_credits_ledger). Balance = SUM(amount): grant/purchase add, usage subtracts.
 *
 * GRANDFATHERING: a workspace is only gated once it's ENROLLED (has ≥1 ledger row). Workspaces
 * with no ledger (pre-existing, or before the migration runs) are never blocked — so this can't
 * brick existing accounts or AI when the feature is half-rolled-out.
 */
export const SOLO_GRANT = 50_000;
export const BUSINESS_TRIAL_GRANT = 500_000;

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
    .then(() => {}, () => {});
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
  }
  await next();
});
