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
 * Phase-1 observability metadata for one AI run. ALL fields optional/null-safe — every column is
 * nullable (migration 20260711_ai_usage_observability.sql) and the writer falls back to the older
 * schema if a column doesn't exist yet, so metering never breaks during rollout.
 */
export type RunMeta = {
  userId?: string;
  messageCount?: number;
  feature?: string;
  taskClass?: string;      // fast | reasoning | extraction | summarization | support | meeting | discovery
  provider?: string;       // non-secret backend label (never the URL/key)
  latencyMs?: number;      // wall-clock of the inference call
  sourceCount?: number;    // grounding sources the caller used, when provided
  refusalReason?: string;  // set when the model refused / had insufficient data
  cacheStatus?: string;    // "hit" | "miss" | null (from prompt_tokens_details.cached_tokens if the backend exposes it)
};

/**
 * Log one inference's token usage + observability metadata. Detached: returns immediately; the
 * insert runs in the background and swallows its own errors.
 */
export function recordAiUsage(
  workspaceId: string | undefined,
  model: string,
  usage: UsageMetrics | undefined | null,
  opts?: RunMeta,
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

  // GUARANTEED-legacy columns (present since the ai_usage table existed).
  const base = {
    workspace_id: workspaceId,
    user_id: opts?.userId ?? null,
    model,
    message_count: opts?.messageCount ?? 1,
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    period_start: periodStart,
    period_end: periodEnd,
  };
  // feature (added 20260703) + the Phase-1 observability columns (added 20260711).
  const extended = {
    ...base,
    feature: opts?.feature ?? null,
    task_class: opts?.taskClass ?? null,
    provider: opts?.provider ?? null,
    latency_ms: opts?.latencyMs != null ? Math.max(0, Math.round(opts.latencyMs)) : null,
    source_count: opts?.sourceCount != null ? Math.max(0, Math.round(opts.sourceCount)) : null,
    refusal_reason: opts?.refusalReason ?? null,
    cache_status: opts?.cacheStatus ?? null,
  };

  // Detached background write — not awaited, errors swallowed. Degrade the row shape column-by-column
  // so metering keeps working on EVERY schema state (full → feature-only → pre-feature).
  void supabase
    .from("ai_usage")
    .insert(extended)
    .then(
      () => {},
      () => {
        void supabase
          .from("ai_usage")
          .insert({ ...base, feature: opts?.feature ?? null })
          .then(
            () => {},
            () => { void supabase.from("ai_usage").insert(base).then(() => {}, () => {}); },
          );
      },
    );
}
