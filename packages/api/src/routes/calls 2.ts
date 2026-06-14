import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";

type Variables = { userId: string; workspaceId: string; role: string };
type CallNode = {
  id: string;
  data: Record<string, unknown>;
  ai_summary: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

function normalizeCall(node: CallNode) {
  const data = node.data ?? {};
  return {
    id: node.id,
    contact_name: String(data.contact_name ?? data.name ?? "Unknown contact"),
    company_name: data.company_name ? String(data.company_name) : undefined,
    occurred_at: String(data.occurred_at ?? data.date ?? node.created_at),
    duration_seconds: Number(data.duration_seconds ?? data.duration ?? 0),
    direction: data.direction === "inbound" ? "inbound" : "outbound",
    status: ["processed", "processing", "failed"].includes(String(data.status)) ? data.status : node.ai_summary ? "processed" : "processing",
    audio_url: data.audio_url ? String(data.audio_url) : undefined,
    ai_summary: node.ai_summary ?? String(data.ai_summary ?? ""),
    overview: String(data.overview ?? node.ai_summary ?? ""),
    key_topics: Array.isArray(data.key_topics) ? data.key_topics : [],
    action_items: Array.isArray(data.action_items) ? data.action_items : [],
    buyer_signals: Array.isArray(data.buyer_signals) ? data.buyer_signals : [],
    next_steps: Array.isArray(data.next_steps) ? data.next_steps : [],
    participants: Array.isArray(data.participants) ? data.participants : [],
    linked_records: Array.isArray(data.linked_records) ? data.linked_records : [],
    transcript: Array.isArray(data.transcript) ? data.transcript : []
  };
}

async function getCall(workspaceId: string, id: string) {
  const { data } = await supabase.from("nodes").select("id,data,ai_summary,created_by,created_at,updated_at").eq("workspace_id", workspaceId).eq("vertical", "sales").eq("object_type", "call").eq("id", id).maybeSingle();
  return data as CallNode | null;
}

router.get("/", zValidator("query", z.object({
  filter: z.enum(["all", "mine", "week", "month"]).default("all"),
  search: z.string().default("")
})), async (c) => {
  const input = c.req.valid("query");
  let query = supabase.from("nodes").select("id,data,ai_summary,created_by,created_at,updated_at").eq("workspace_id", c.get("workspaceId")).eq("vertical", "sales").eq("object_type", "call").order("created_at", { ascending: false });
  if (input.filter === "mine") query = query.eq("created_by", c.get("userId"));
  if (input.filter === "week") query = query.gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString());
  if (input.filter === "month") query = query.gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString());
  const { data, error } = await query.limit(100);
  if (error) return c.json({ error: error.message }, 400);
  const search = input.search.trim().toLowerCase();
  const calls = ((data ?? []) as CallNode[]).map(normalizeCall).filter((call) => !search || `${call.contact_name} ${call.company_name ?? ""} ${call.ai_summary}`.toLowerCase().includes(search));
  return c.json(calls);
});

router.get("/:id", async (c) => {
  const node = await getCall(c.get("workspaceId"), c.req.param("id"));
  return node ? c.json(normalizeCall(node)) : c.json({ error: "Call not found" }, 404);
});

router.post("/:id/link", zValidator("json", z.object({ node_id: z.string().uuid() })), async (c) => {
  const workspaceId = c.get("workspaceId");
  const call = await getCall(workspaceId, c.req.param("id"));
  if (!call) return c.json({ error: "Call not found" }, 404);
  const { data: target } = await supabase.from("nodes").select("id").eq("workspace_id", workspaceId).eq("id", c.req.valid("json").node_id).maybeSingle();
  if (!target) return c.json({ error: "Record not found" }, 404);
  const { error } = await supabase.from("edges").upsert({ workspace_id: workspaceId, from_node_id: call.id, to_node_id: target.id, relationship: "call_linked_to" });
  if (error) return c.json({ error: error.message }, 400);
  await supabase.from("activities").insert({ node_id: target.id, workspace_id: workspaceId, actor_type: "human", actor_id: c.get("userId"), action: "call_linked", diff: { call_id: call.id } });
  return c.json({ ok: true });
});

router.post("/:id/analyze", zValidator("json", z.object({ template_id: z.enum(["objections", "quality", "upsell", "competitors", "commitments"]) })), async (c) => {
  const call = await getCall(c.get("workspaceId"), c.req.param("id"));
  if (!call) return c.json({ error: "Call not found" }, 404);
  const normalized = normalizeCall(call);
  const transcript = normalized.transcript.map((line: unknown) => {
    const entry = line as { speaker?: string; text?: string };
    return `${entry.speaker ?? "Speaker"}: ${entry.text ?? ""}`;
  }).join("\n");
  const templateId = c.req.valid("json").template_id;
  const prompts = {
    objections: "Extract every objection raised. Group duplicates and include concise supporting context.",
    quality: "Score this discovery call from 1 to 10 and explain the score using discovery depth, listening, qualification, and agreed next steps.",
    upsell: "Identify credible upsell or cross-sell opportunities. Explain the evidence and recommended follow-up.",
    competitors: "Summarize every competitor mention, the buyer's sentiment, and any product comparison.",
    commitments: "List every commitment made, who owns it, and any stated deadline."
  };

  let output = "";
  if (process.env.ANTHROPIC_API_KEY && transcript) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 900,
        messages: [{ role: "user", content: `${prompts[templateId]}\n\nTranscript:\n${transcript}` }]
      })
    });
    if (response.ok) {
      const payload = await response.json() as { content?: { type: string; text?: string }[] };
      output = payload.content?.filter((item) => item.type === "text").map((item) => item.text ?? "").join("") ?? "";
    }
  }
  if (!output) {
    const summary = normalized.ai_summary || normalized.overview || "No AI summary is available.";
    output = `${prompts[templateId]}\n\nCurrent call evidence:\n${summary}\n\n${transcript ? `Transcript reviewed: ${normalized.transcript.length} segments.` : "A transcript is not available, so this result is limited to stored call insights."}`;
  }

  const encoder = new TextEncoder();
  const words = output.split(/(\s+)/);
  const stream = new ReadableStream({
    async start(controller) {
      for (let index = 0; index < words.length; index += 8) {
        controller.enqueue(encoder.encode(words.slice(index, index + 8).join("")));
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      controller.close();
    }
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } });
});

export { router as callsRouter };
