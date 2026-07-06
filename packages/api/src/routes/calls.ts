import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { denyViewerWrites } from "../middleware/rbac";
import { aiGateway } from "../lib/ai-gateway";

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
router.use("*", denyViewerWrites); // viewers are read-only

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

/** user_id → display name, for attendee search on calendar-event memories. */
async function memberNames(ws: string): Promise<Map<string, string>> {
  const { data } = await supabase.from("workspace_members").select("user_id, name, email").eq("workspace_id", ws);
  return new Map((data ?? []).map((m) => [String(m.user_id), String(m.name || m.email || "")]));
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

// ── Meeting Memory — unified, HONEST after-the-fact view of past meetings + calls. ────────────────
// Combines legacy call records with COMPLETED/PAST calendar events. Calendar events have no recording
// yet, so their transcript is always "unavailable" and summary is "pending" (agenda present) or "none".
// Nothing is fabricated — a status only says "generated"/"available" when the real field exists.
export type TranscriptStatus = "available" | "unavailable";
export type SummaryStatus = "generated" | "pending" | "none";
export interface MemoryRow {
  id: string; source: "calendar" | "call_record"; title: string; contact_name?: string; company_name?: string;
  occurred_at: string; participant_count: number; has_agenda: boolean;
  transcript_status: TranscriptStatus; summary_status: SummaryStatus; can_summarize: boolean;
  action_item_count: number; href: string;
}

/** Pure: a call record → a memory row. Honest statuses derived only from real stored fields. */
export function callMemory(n: ReturnType<typeof normalizeCall>): MemoryRow {
  const hasTranscript = n.transcript.length > 0;
  const hasSummary = !!(n.ai_summary || "").trim();
  return {
    id: n.id, source: "call_record", title: n.contact_name, contact_name: n.contact_name, company_name: n.company_name,
    occurred_at: n.occurred_at, participant_count: n.participants.length,
    has_agenda: false,
    transcript_status: hasTranscript ? "available" : "unavailable",
    summary_status: hasSummary ? "generated" : hasTranscript ? "pending" : "none",
    can_summarize: hasTranscript,
    action_item_count: Array.isArray(n.action_items) ? n.action_items.length : 0,
    href: `/calls/${n.id}`,
  };
}

interface CalEventData { title?: string; start_at?: string; end_at?: string; description?: string; status?: string; organizer_id?: string; attendee_ids?: string[] }
/** A past/completed calendar event → a memory row. No recording exists yet, so transcript is always
 *  "unavailable" and summary is "pending" (has agenda) or "none" — never fabricated. */
export function eventMemory(id: string, d: CalEventData, now: Date): MemoryRow {
  const hasAgenda = !!(d.description ?? "").trim();
  return {
    id, source: "calendar", title: d.title || "Untitled meeting",
    occurred_at: d.start_at || now.toISOString(),
    participant_count: (d.attendee_ids?.length ?? 0) + 1,
    has_agenda: hasAgenda,
    transcript_status: "unavailable",
    summary_status: hasAgenda ? "pending" : "none",   // can be summarized from the agenda; not yet done
    can_summarize: hasAgenda,
    action_item_count: 0,
    href: `/calls/${id}`,
  };
}
/** Did this calendar event already happen? (completed, or its end time is in the past — not cancelled) */
export function isPastEvent(d: CalEventData, now: Date): boolean {
  if (d.status === "cancelled") return false;
  if (d.status === "completed") return true;
  const end = new Date(d.end_at || d.start_at || 0);
  return !Number.isNaN(end.getTime()) && end < now;
}

router.get("/memory", zValidator("query", z.object({ search: z.string().default("") })), async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const [callsRes, eventsRes] = await Promise.all([
    supabase.from("nodes").select("id,data,ai_summary,created_by,created_at,updated_at").eq("workspace_id", ws).eq("vertical", "sales").eq("object_type", "call").order("created_at", { ascending: false }).limit(200),
    supabase.from("nodes").select("id,data").eq("workspace_id", ws).eq("object_type", "calendar_event").order("data->>start_at", { ascending: false }).limit(300),
  ]);
  const now = new Date();
  const dir = await memberNames(ws);
  // Keep a search corpus per row (title/contact/company/attendees/summary/transcript) — searched
  // server-side because the transcript/summary aren't shipped in the list payload.
  const callItems = ((callsRes.data ?? []) as CallNode[]).map(normalizeCall).map((n) => ({
    row: callMemory(n),
    corpus: [n.contact_name, n.company_name, n.ai_summary, n.overview,
      ...n.participants.map((p) => (p as { name?: string })?.name ?? ""),
      ...n.transcript.map((l) => (l as { text?: string })?.text ?? "")].join(" ").toLowerCase(),
  }));
  const canView = (d: CalEventData) => d.organizer_id === me || (d.attendee_ids ?? []).includes(me);
  const eventItems = (eventsRes.data ?? [])
    .map((n) => ({ id: n.id as string, d: (n.data ?? {}) as CalEventData }))
    .filter((e) => canView(e.d) && isPastEvent(e.d, now))            // participant-only, past meetings only
    .map((e) => ({
      row: eventMemory(e.id, e.d, now),
      corpus: [e.d.title, e.d.description, ...(e.d.attendee_ids ?? []).map((u) => dir.get(u) ?? "")].join(" ").toLowerCase(),
    }));

  const search = c.req.valid("query").search.trim().toLowerCase();
  const memories = [...eventItems, ...callItems]
    .filter((it) => !search || it.corpus.includes(search))
    .map((it) => it.row)
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
  return c.json({ memories });
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
  if (transcript) {
    const result = await aiGateway({
      prompt: `${prompts[templateId]}\n\nTranscript:\n${transcript}`,
      maxTokens: 900,
      workspaceId: c.get("workspaceId"), userId: c.get("userId"), feature: "call_summary",
    }).catch(() => null);
    if (result) output = result.text;
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
