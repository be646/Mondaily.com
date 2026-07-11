import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { denyViewerWrites } from "../middleware/rbac";
import { aiGateway } from "../lib/ai-gateway";
import { inngest } from "../lib/inngest";
import { ingestRecording, RECORDINGS_BUCKET } from "../jobs/meeting-memory";

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
    transcript: Array.isArray(data.transcript) ? data.transcript : [],
    // Per-action-item promotion status (index → { type:'task'|'decision', id }). Drives the detail
    // UI so a promoted item stays "task created"/"decision queued" across reloads. Never fabricated.
    action_item_promotions: (data.action_item_promotions && typeof data.action_item_promotions === "object")
      ? data.action_item_promotions as Record<string, { type: string; id: string; at?: string }> : {},
    // Provenance (never the raw storage path): where this record came from + whether a recording
    // exists (playback is via the signed-URL endpoint, never a raw path/public URL).
    source: String(data.source ?? ""),
    origin_filename: data.origin_filename ? String(data.origin_filename) : undefined,
    has_recording: Boolean(data.has_recording || data.audio_url),
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

// ── Phase 1 Meeting Memory: manual audio upload → transcript → summary ────────────────────────────
// Sovereign + fail-closed + honest: audio lives in a PRIVATE bucket (never public), transcription
// runs only against SOVEREIGN_STT_URL, summary only through the AI gateway; both fail closed.
const AUDIO_MIMES = new Set(["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg"]);
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB (API-enforced; storage stays private)
const sanitizeFilename = (name: string) => (name || "recording").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "recording";

/** Same idempotent handoff the egress webhook uses: Inngest when configured, else inline. */
function enqueueIngest(sessionId: string) {
  if (process.env.INNGEST_EVENT_KEY) inngest.send({ name: "meeting/recording.ready", data: { sessionId } }).catch(() => {});
  else void ingestRecording(sessionId);
}

// POST /calls/upload/init — validate + create the upload session, return a signed direct-to-storage
// upload URL (bypasses serverless body limits). Consent attestation is REQUIRED.
router.post("/upload/init", zValidator("json", z.object({
  filename: z.string().min(1).max(200),
  content_type: z.string().min(1).max(120),
  size: z.number().int().positive(),
  consent_attestation: z.literal(true),   // must be exactly true → false/missing is a 400 here
  title: z.string().max(200).optional(),
  language: z.string().max(20).optional(),
})), async (c) => {
  const ws = c.get("workspaceId"); const userId = c.get("userId");
  const b = c.req.valid("json");
  if (!AUDIO_MIMES.has(b.content_type)) return c.json({ error: "unsupported_type", message: "Audio files only (mp3, m4a, wav, webm, ogg)." }, 415);
  if (b.size > MAX_UPLOAD_BYTES) return c.json({ error: "too_large", message: "Recording exceeds the 500 MB limit." }, 413);

  const room = `upload:${crypto.randomUUID()}`;
  const consent = { attested_by: userId, method: "upload_attestation", text_version: "v1", at: new Date().toISOString() };
  const { data: session, error } = await supabase.from("call_sessions").insert({
    workspace_id: ws, room, initiator_id: userId, invitee_id: userId, kind: "audio", status: "ended",
    source: "upload", record: true, recording_status: "uploading", transcript_status: "queued",
    origin_filename: b.title?.trim() ? `${sanitizeFilename(b.title)}` : sanitizeFilename(b.filename),
    language: b.language ?? null, consent,
  }).select("id").single();
  if (error || !session) return c.json({ error: "could_not_create_session" }, 500);

  const path = `${ws}/${session.id}/${sanitizeFilename(b.filename)}`;
  await supabase.from("call_sessions").update({ recording_url: path }).eq("id", session.id).eq("workspace_id", ws);
  const { data: signed, error: upErr } = await supabase.storage.from(RECORDINGS_BUCKET).createSignedUploadUrl(path);
  if (upErr || !signed) return c.json({ error: "storage_unavailable", message: "Recording storage isn't configured. Create the private 'meeting-recordings' bucket." }, 503);
  return c.json({ id: session.id, upload_url: signed.signedUrl, token: signed.token, path, content_type: b.content_type }, 201);
});

// POST /calls/upload/complete — the client finished PUT-ing to the signed URL; verify the object and
// kick off the honest pipeline (STT → summary).
router.post("/upload/complete", zValidator("json", z.object({ id: z.string().uuid() })), async (c) => {
  const ws = c.get("workspaceId");
  const { data: s } = await supabase.from("call_sessions")
    .select("id, workspace_id, recording_url, source").eq("id", c.req.valid("json").id).eq("workspace_id", ws).eq("source", "upload").maybeSingle();
  if (!s?.recording_url) return c.json({ error: "session_not_found" }, 404);
  if (!s.recording_url.startsWith(`${ws}/`)) return c.json({ error: "forbidden" }, 403);
  // Confirm the object actually landed in the private bucket.
  const folder = s.recording_url.split("/").slice(0, -1).join("/");
  const fname = s.recording_url.split("/").pop();
  const { data: list } = await supabase.storage.from(RECORDINGS_BUCKET).list(folder);
  if (!list?.some((f) => f.name === fname)) return c.json({ error: "upload_not_found", message: "No uploaded file found for this session." }, 400);
  await supabase.from("call_sessions").update({ recording_status: "ready", transcript_status: "queued" }).eq("id", s.id).eq("workspace_id", ws);
  enqueueIngest(s.id);
  return c.json({ id: s.id, status: "queued" }, 202);
});

// GET /calls/:id/recording-url — short-lived signed playback URL. Participant or admin/owner only;
// workspace-scoped; verifies the stored path prefix. NEVER returns a public URL or the raw path.
router.get("/:id/recording-url", async (c) => {
  const ws = c.get("workspaceId"); const userId = c.get("userId"); const role = c.get("role");
  const call = await getCall(ws, c.req.param("id"));
  const sessId = call?.data?.call_session_id as string | undefined;
  if (!sessId) return c.json({ error: "no_recording" }, 404);
  const { data: sess } = await supabase.from("call_sessions")
    .select("recording_url, workspace_id, initiator_id, invitee_id").eq("id", sessId).eq("workspace_id", ws).maybeSingle();
  if (!sess?.recording_url) return c.json({ error: "no_recording" }, 404);
  const isParticipant = userId === sess.initiator_id || userId === sess.invitee_id;
  const isAdmin = role === "owner" || role === "admin";
  if (!isParticipant && !isAdmin) return c.json({ error: "forbidden" }, 403);
  if (!String(sess.recording_url).startsWith(`${ws}/`)) return c.json({ error: "forbidden" }, 403);
  const { data: signed } = await supabase.storage.from(RECORDINGS_BUCKET).createSignedUrl(sess.recording_url, 120);
  if (!signed?.signedUrl) return c.json({ error: "no_recording" }, 404);
  return c.json({ url: signed.signedUrl, expires_in: 120 });
});

// POST /calls/:id/reprocess — re-run STT/summary for a failed/partial upload (idempotent).
router.post("/:id/reprocess", async (c) => {
  const ws = c.get("workspaceId"); const userId = c.get("userId"); const role = c.get("role");
  const call = await getCall(ws, c.req.param("id"));
  const sessId = call?.data?.call_session_id as string | undefined;
  if (!sessId) return c.json({ error: "no_recording" }, 404);
  const { data: sess } = await supabase.from("call_sessions")
    .select("id, initiator_id, invitee_id, memory_node_id").eq("id", sessId).eq("workspace_id", ws).maybeSingle();
  if (!sess) return c.json({ error: "no_recording" }, 404);
  if (!(role === "owner" || role === "admin" || userId === sess.initiator_id)) return c.json({ error: "forbidden" }, 403);
  // Clear a failed transcript flag so the atomic-claim in ingestRecording can re-run; node reuse keeps it idempotent.
  await supabase.from("call_sessions").update({ transcript_status: "queued" }).eq("id", sess.id).eq("workspace_id", ws).eq("transcript_status", "failed");
  enqueueIngest(sess.id);
  return c.json({ ok: true, status: "queued" }, 202);
});

// POST /calls/:id/action-items/:index/promote { target } — promote a REAL extracted action item into
// a Task or the Decision Queue. Workspace-scoped, idempotent (a second click returns the same id and
// never creates a duplicate), and honest (only promotes an item that actually exists on the record).
router.post("/:id/action-items/:index/promote", zValidator("json", z.object({ target: z.enum(["task", "decision"]) })), async (c) => {
  const ws = c.get("workspaceId"); const userId = c.get("userId");
  const node = await getCall(ws, c.req.param("id"));
  if (!node) return c.json({ error: "Call not found" }, 404);
  const items = Array.isArray(node.data?.action_items) ? (node.data.action_items as unknown[]) : [];
  const idx = Number(c.req.param("index"));
  if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) return c.json({ error: "invalid_index" }, 400);
  const item = String(items[idx] ?? "").trim();
  if (!item) return c.json({ error: "empty_item" }, 400);
  const target = c.req.valid("json").target;

  const promoMap = (v: unknown) => (v && typeof v === "object" ? { ...(v as Record<string, { type: string; id: string; at?: string }>) } : {} as Record<string, { type: string; id: string; at?: string }>);
  const statusFor = (t: string) => (t === "task" ? "task_created" : "decision_queued");

  // Idempotent: already promoted → return the existing task/decision, never a duplicate row.
  const existing = promoMap(node.data?.action_item_promotions)[String(idx)];
  if (existing?.id) return c.json({ index: idx, type: existing.type, id: existing.id, status: statusFor(existing.type), idempotent: true });

  // Create via the existing task / decision_queue shapes (mirrors discovery buildLeadTask/Decision).
  let createdId: string | null = null;
  if (target === "task") {
    const { data, error } = await supabase.from("tasks").insert({
      workspace_id: ws, title: item.slice(0, 300), assignee_id: userId, completed: false, due_date: null,
      record_id: node.id, priority: "medium", status: "todo", created_by: userId, notes: "From Meeting Memory",
    }).select("id").single();
    if (error || !data) return c.json({ error: "create_failed", reason: error?.message ?? "insert failed", status: "failed" }, 500);
    createdId = data.id as string;
  } else {
    const { data, error } = await supabase.from("decision_queue").insert({
      workspace_id: ws, source_type: "call_record", source_id: node.id, agent_name: "meeting_memory",
      title: item.slice(0, 200), summary: item, recommended_action: "Review this action item from the call.",
      risk_level: "low", evidence: [{ type: "call_record", title: item, node_id: node.id }],
    }).select("id").single();
    if (error || !data) return c.json({ error: "create_failed", reason: error?.message ?? "insert failed", status: "failed" }, 500);
    createdId = data.id as string;
  }

  // Persist the promotion. Re-read first so a fast double-click can't double-write (prefer whatever
  // landed first; workspace-scoped throughout).
  const { data: fresh } = await supabase.from("nodes").select("data").eq("workspace_id", ws).eq("id", node.id).maybeSingle();
  const map = promoMap((fresh?.data as Record<string, unknown> | undefined)?.action_item_promotions);
  const raced = map[String(idx)];
  if (raced?.id) return c.json({ index: idx, type: raced.type, id: raced.id, status: statusFor(raced.type), idempotent: true });
  map[String(idx)] = { type: target, id: createdId!, at: new Date().toISOString() };
  await supabase.from("nodes").update({ data: { ...((fresh?.data as object) ?? node.data), action_item_promotions: map } }).eq("workspace_id", ws).eq("id", node.id);
  return c.json({ index: idx, type: target, id: createdId, status: statusFor(target) });
});

export { router as callsRouter };
