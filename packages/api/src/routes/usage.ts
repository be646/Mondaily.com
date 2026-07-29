import { Hono } from "hono";
import { supabase } from "@mondaily/db/client";
import { ledgerBreakdown } from "../lib/credits";
import { requireAuth } from "../middleware/auth";

/**
 * AI usage — read-only per-tenant token telemetry.
 *
 * Reads the `ai_usage` ledger that the gateway writes (recordAiUsage) so you can
 * eyeball cost per workspace without querying the DB directly. Workspace-scoped
 * via requireAuth — a caller only ever sees their own workspace's totals.
 */
type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

interface UsageRow {
  model: string | null;
  message_count: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
}

/**
 * GET /api/v1/usage — current-month token totals for the caller's workspace,
 * with a per-model breakdown. Pass ?period=all to total across all time.
 */
router.get("/", async (c) => {
  const workspaceId = c.get("workspaceId");
  const allTime = c.req.query("period") === "all";

  let q = supabase
    .from("ai_usage")
    .select("model, message_count, prompt_tokens, completion_tokens, total_tokens")
    .eq("workspace_id", workspaceId);

  if (!allTime) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    q = q.gte("created_at", monthStart);
  }

  const { data, error } = await q;
  if (error) return c.json({ error: error.message }, 500);

  const rows = (data ?? []) as UsageRow[];
  const totals = { messages: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const byModel: Record<string, { messages: number; prompt_tokens: number; completion_tokens: number; total_tokens: number }> = {};

  for (const r of rows) {
    const prompt = r.prompt_tokens ?? 0;
    const completion = r.completion_tokens ?? 0;
    const total = r.total_tokens ?? prompt + completion;
    const messages = r.message_count ?? 1;
    totals.messages += messages;
    totals.prompt_tokens += prompt;
    totals.completion_tokens += completion;
    totals.total_tokens += total;

    const key = r.model ?? "unknown";
    const m = (byModel[key] ??= { messages: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    m.messages += messages;
    m.prompt_tokens += prompt;
    m.completion_tokens += completion;
    m.total_tokens += total;
  }

  return c.json({
    workspace_id: workspaceId,
    period: allTime ? "all" : "month",
    records: rows.length,
    totals,
    by_model: byModel,
  });
});

/**
 * GET /api/v1/usage/summary — everything a usage dashboard needs in one call: this month's credit
 * (token) spend, a per-model breakdown, and the wallet/plan status (tier, remaining, reset).
 */
router.get("/summary", async (c) => {
  const ws = c.get("workspaceId");
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  const [{ data: usage }, wallet, { data: wsRow }] = await Promise.all([
    supabase.from("ai_usage").select("*").eq("workspace_id", ws).gte("created_at", monthStart),
    ledgerBreakdown(ws),   // server-side aggregate; a JS sum truncates past the row cap
    supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle(),
  ]);

  let monthTokens = 0, monthCalls = 0;
  const byModel: Record<string, number> = {};
  const byFeature: Record<string, number> = {};
  // Phase-1 observability aggregates — all derived from real rows; fields stay null/absent when the
  // 20260711 columns aren't populated yet, so this degrades cleanly during rollout.
  const byClass: Record<string, number> = {};
  let latencySum = 0, latencyN = 0, cacheHits = 0, cacheSeen = 0, refusals = 0;
  const providers = new Set<string>();
  for (const r of (usage ?? []) as Record<string, unknown>[]) {
    const t = Number(r.total_tokens ?? 0);
    monthTokens += t; monthCalls += Number(r.message_count ?? 1);
    const model = String(r.model ?? "unknown");
    byModel[model] = (byModel[model] ?? 0) + t;
    const feature = String(r.feature ?? "other");
    byFeature[feature] = (byFeature[feature] ?? 0) + t;
    if (r.task_class != null) byClass[String(r.task_class)] = (byClass[String(r.task_class)] ?? 0) + Number(r.message_count ?? 1);
    if (r.latency_ms != null) { latencySum += Number(r.latency_ms); latencyN += 1; }
    if (r.cache_status != null) { cacheSeen += 1; if (r.cache_status === "hit") cacheHits += 1; }
    if (r.refusal_reason != null) refusals += 1;
    if (r.provider != null) providers.add(String(r.provider));
  }

  const enrolled = wallet.enrolled;
  const granted = wallet.granted + wallet.purchased;   // everything added to the wallet
  const used = wallet.used;
  const settings = (wsRow?.settings ?? {}) as Record<string, unknown>;

  return c.json({
    period: { start: monthStart, resets_at: nextMonth },
    month: { credits_used: monthTokens, ai_calls: monthCalls, by_model: byModel, by_feature: byFeature },
    // Observability rollup — null when there's no signal yet (honest, never fabricated).
    observability: {
      by_class: byClass,
      avg_latency_ms: latencyN > 0 ? Math.round(latencySum / latencyN) : null,
      cache_hit_rate: cacheSeen > 0 ? Math.round((cacheHits / cacheSeen) * 100) : null,
      cache_samples: cacheSeen,
      refusals,
      providers: [...providers],
    },
    wallet: {
      enrolled,
      tier: (settings.account_tier as string) ?? (settings.track as string) ?? "scout",
      granted,
      used,
      balance: enrolled ? granted - used : null,
    },
  });
});

export { router as usageRouter };
