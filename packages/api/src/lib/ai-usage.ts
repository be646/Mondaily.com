/**
 * AI cost telemetry — per-tenant token ledger.
 *
 * Records the real `prompt_tokens` / `completion_tokens` returned by the
 * Cerebras / openai-compat completion endpoint into the `ai_usage` table so we
 * have exact, per-`workspace_id` cost tracing for billing guards.
 *
 * Hard guarantee: this is FIRE-AND-FORGET and NEVER throws. Telemetry must never
 * add latency to — or fail — a real inference call. Call it without `await`.
 */
import { supabase } from "@mondaily/db/client";
import { recordCreditUsage } from "./credits";

export type UsageMetrics = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

/**
 * Log one inference's token usage. Detached: returns immediately; the insert
 * runs in the background and swallows its own errors.
 */
export function recordAiUsage(
  workspaceId: string | undefined,
  model: string,
  usage: UsageMetrics | undefined | null,
  opts?: { userId?: string; messageCount?: number },
): void {
  if (!workspaceId || !usage) return;
  const prompt = Math.max(0, Math.round(usage.prompt_tokens ?? 0));
  const completion = Math.max(0, Math.round(usage.completion_tokens ?? 0));
  const total = Math.max(0, Math.round(usage.total_tokens ?? prompt + completion));
  if (prompt === 0 && completion === 0 && total === 0) return;

  // Real-time credit deduction from the wallet (no-op for non-enrolled workspaces).
  recordCreditUsage(workspaceId, total, `AI usage · ${model}`);

  // Monthly billing window — same shape the chat route used to write inline.
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

  // Detached background write — not awaited, errors swallowed.
  void supabase
    .from("ai_usage")
    .insert({
      workspace_id: workspaceId,
      user_id: opts?.userId ?? null,
      model,
      message_count: opts?.messageCount ?? 1,
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: total,
      period_start: periodStart,
      period_end: periodEnd,
    })
    .then(
      () => {},
      (err: unknown) => console.error("[ai-usage] ledger write failed (non-fatal):", err),
    );
}
