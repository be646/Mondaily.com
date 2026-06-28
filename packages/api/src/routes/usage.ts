import { Hono } from "hono";
import { supabase } from "@mondaily/db/client";
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

export { router as usageRouter };
