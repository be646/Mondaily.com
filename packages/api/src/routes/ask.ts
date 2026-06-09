import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

async function searchWeb(query: string): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return "";
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query, max_results: 5, search_depth: "basic" })
    });
    if (!res.ok) return "";
    const data = await res.json() as any;
    const results = (data.results ?? []).slice(0, 5).map((r: any) => `- ${r.title}: ${r.content}`).join("\n");
    return results ? `\n\nWeb search results for "${query}":\n${results}` : "";
  } catch { return ""; }
}

const router = new Hono();

router.post("/", requireAuth, zValidator("json", z.object({
  message: z.string().min(1),
  thread_id: z.string().optional(),
  model: z.enum(["auto", "fast", "smart"]).optional(),
  web_search: z.boolean().optional()
})), async (c) => {
  const { message, model: modelPref, web_search } = c.req.valid("json");
  const modelMap: Record<string, string> = {
    fast: "claude-haiku-4-5-20251001",
    smart: "claude-sonnet-4-6",
    auto: "claude-sonnet-4-6"
  };
  const model = modelMap[modelPref ?? "auto"] ?? "claude-sonnet-4-6";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ reply: "Anthropic API key not configured on server." }, 500);

  try {
    // Web search if enabled
    let webContext = "";
    if (web_search === true || process.env.WEB_SEARCH_DEFAULT === "true") {
      webContext = await searchWeb(message);
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 1024,
        system: `You are Mondaily AI, an intelligent business operating system. You help users manage contacts, deals, tasks, pipelines, and all business operations. Be concise, smart, and actionable. Never mention Claude, Anthropic, OpenAI, or any underlying AI technology — you are simply Mondaily AI.${webContext}`,
        messages: [{ role: "user", content: message }]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return c.json({ reply: `Claude error: ${err}` }, 500);
    }

    const data = await res.json() as any;
    const reply = data.content?.[0]?.text || "No response from Claude.";

    // Track usage in Supabase
    try {
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
      await supabase.from("ai_usage").insert({
        workspace_id: c.get("workspaceId"),
        user_id: c.get("userId"),
        model: model,
        message_count: 1,
        period_start: periodStart,
        period_end: periodEnd
      });
    } catch (_) { /* don't fail if tracking fails */ }

    return c.json({ reply, thread_id: null });
  } catch (err: any) {
    return c.json({ reply: `Connection error: ${err.message}` }, 500);
  }
});

router.get("/credits", requireAuth, async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

  const { data, error } = await supabase
    .from("ai_usage")
    .select("message_count")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .gte("created_at", periodStart)
    .lte("created_at", periodEnd);

  if (error) return c.json({ used: 0, limit: 1000, period_end: periodEnd });

  const used = (data ?? []).reduce((sum, row) => sum + row.message_count, 0);
  return c.json({ used, limit: 1000, period_end: periodEnd });
});

router.post("/stream", requireAuth, zValidator("json", z.object({
  message: z.string().min(1),
  thread_id: z.string().uuid().optional()
})), async (c) => {
  const { message, model: modelPref, web_search } = c.req.valid("json");
  const modelMap: Record<string, string> = {
    fast: "claude-haiku-4-5-20251001",
    smart: "claude-sonnet-4-6",
    auto: "claude-sonnet-4-6"
  };
  const model = modelMap[modelPref ?? "auto"] ?? "claude-sonnet-4-6";
  return c.json({ ok: true, message: `Received: ${message}` });
});

router.get("/threads", requireAuth, async (c) => c.json([]));

export { router as askRouter };
