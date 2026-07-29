import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sign } from "hono/jwt";
import { supabase } from "@mondaily/db/client";
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import { recordingEnabled, transcriptionEnabled, startRoomEgress, stopRoomEgress, liveCaptionsAllowed, captionChunk, CAPTION_CHUNK_MAX_BYTES } from "../lib/livekit";
import { meetingRoom } from "../lib/rooms";
import { liveTranscriptProvenance } from "../lib/live-transcript";
import { sanitizeLiveTranscriptLine, LIVE_TRANSCRIPT_SOURCE, type SanitizedLiveTranscriptLine } from "@mondaily/shared/captions";
import { translateLines } from "../lib/translation";

/**
 * Live calls — member-to-member audio/video over a self-hosted LiveKit server (sovereign:
 * LiveKit is open-source and self-hostable, no third-party SaaS). A LiveKit access token is
 * just an HS256 JWT with a `video` grant, so we mint it directly with hono/jwt — NO SDK, no
 * new dependency. Every write is workspace + participant scoped.
 *
 * FAIL-CLOSED: without LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET the capability probe
 * returns { enabled:false } and room/join/end 503, so the UI simply hides calling — exactly
 * like the AI gateway refuses to run without its env.
 */
type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

const liveKitEnv = () => ({
  url: process.env.LIVEKIT_URL,
  key: process.env.LIVEKIT_API_KEY,
  secret: process.env.LIVEKIT_API_SECRET,
});
const isEnabled = () => { const e = liveKitEnv(); return !!(e.url && e.key && e.secret); };

/** Mint a LiveKit join token (JWT with a video grant) for one identity + room. */
async function mintToken(identity: string, name: string, room: string, canPublish = true): Promise<string> {
  const { key, secret } = liveKitEnv();
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      iss: key,                 // LiveKit API key
      sub: identity,            // participant identity (our user_id)
      name,                     // display name
      nbf: now,
      iat: now,
      exp: now + 60 * 60,       // 1-hour join window
      video: { room, roomJoin: true, canPublish, canSubscribe: true, canPublishData: true },
    },
    secret as string,
    "HS256",
  );
}

async function members(workspaceId: string) {
  const { data } = await supabase.from("workspace_members").select("user_id, name, email, avatar_url").eq("workspace_id", workspaceId);
  return new Map((data ?? []).map((m) => [String(m.user_id), m]));
}

/** GET /live-calls/capability — is calling configured on this deployment? Also reports whether
 *  opt-in recording + sovereign transcription are available, so the UI shows the record toggle
 *  only when it would actually do something (never a dead switch). */
router.get("/capability", (c) => c.json({
  enabled: isEnabled(),
  url: liveKitEnv().url ?? null,
  recording: recordingEnabled(),
  transcription: transcriptionEnabled(),
}));

/** POST /live-calls/rooms — start a call to a member: create session, notify, return join token.
 *  `record` is OPT-IN and only honored when recording is configured; otherwise it's a no-op and the
 *  session is simply not recorded (never a fake "recording" state). */
router.post("/rooms", zValidator("json", z.object({ invitee_id: z.string().min(1), kind: z.enum(["audio", "video"]).default("audio"), record: z.boolean().default(false) })), async (c) => {
  if (!isEnabled()) return c.json({ error: "Calling isn't configured on this workspace." }, 503);
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const { invitee_id, kind, record } = c.req.valid("json");
  if (invitee_id === me) return c.json({ error: "You can't call yourself." }, 400);

  const dir = await members(ws);
  const invitee = dir.get(invitee_id);
  if (!invitee) return c.json({ error: "Member not found in this workspace." }, 404);

  const willRecord = record && recordingEnabled();
  // Room name namespaced by workspace so tokens can never cross tenants.
  const room = `ws_${ws}__${me}__${invitee_id}__${Math.floor(Date.now() / 1000)}`;
  const { data: session, error } = await supabase
    .from("call_sessions")
    .insert({ workspace_id: ws, room, initiator_id: me, invitee_id, kind, status: "ringing", record: willRecord })
    .select("id, room, created_at")
    .single();
  if (error) return c.json({ error: error.message }, 400);

  // Kick egress up-front so the whole conversation is captured; persist the id for webhook
  // correlation. If egress won't start, we leave recording null — the call proceeds unrecorded.
  if (willRecord) {
    const eg = await startRoomEgress(room);
    if (eg) await supabase.from("call_sessions").update({ egress_id: eg.egressId, recording_status: "recording" }).eq("id", session.id);
  }

  const meM = dir.get(me);
  const callerName = meM?.name || meM?.email || "A teammate";
  await supabase.from("notifications").insert({
    workspace_id: ws, user_id: invitee_id,
    title: `Incoming ${kind} call from ${callerName}`,
    message: `Incoming ${kind} call from ${callerName}`,
    body: `Join room ${room}`,
    type: "call", is_read: false,
  }).then(() => {}, () => {});

  const token = await mintToken(me, callerName, room, true);
  return c.json({ session_id: session.id, room, token, url: liveKitEnv().url, recording: willRecord }, 201);
});

/** POST /live-calls/rooms/:id/join — invitee (or initiator reconnecting) gets a join token. */
router.post("/rooms/:id/join", async (c) => {
  if (!isEnabled()) return c.json({ error: "Calling isn't configured on this workspace." }, 503);
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const { data: session } = await supabase
    .from("call_sessions").select("id, room, initiator_id, invitee_id, status")
    .eq("workspace_id", ws).eq("id", c.req.param("id")).maybeSingle();
  if (!session) return c.json({ error: "Call not found." }, 404);
  if (me !== session.initiator_id && me !== session.invitee_id) return c.json({ error: "You are not part of this call." }, 403);

  if (session.status === "ringing") await supabase.from("call_sessions").update({ status: "active", started_at: new Date().toISOString() }).eq("id", session.id);
  const dir = await members(ws);
  const meM = dir.get(me);
  const token = await mintToken(me, meM?.name || meM?.email || "Member", session.room, true);
  return c.json({ room: session.room, token, url: liveKitEnv().url });
});

/** POST /live-calls/rooms/:id/end — mark a call ended/declined (participant only). */
router.post("/rooms/:id/end", zValidator("json", z.object({ status: z.enum(["ended", "declined", "missed"]).default("ended") })), async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const { data: session } = await supabase
    .from("call_sessions").select("id, initiator_id, invitee_id, status, egress_id, recording_status")
    .eq("workspace_id", ws).eq("id", c.req.param("id")).maybeSingle();
  if (!session) return c.json({ error: "Call not found." }, 404);
  if (me !== session.initiator_id && me !== session.invitee_id) return c.json({ error: "You are not part of this call." }, 403);
  // Terminal states are terminal: without this, an already-ended call could be re-ended (or
  // flipped to declined/missed) by any participant, rewriting status and ended_at — and
  // re-triggering the egress stop below.
  const TERMINAL = new Set(["ended", "declined", "missed"]);
  if (TERMINAL.has(String(session.status ?? ""))) {
    return c.json({ ok: true, already: session.status });
  }
  await supabase.from("call_sessions").update({ status: c.req.valid("json").status, ended_at: new Date().toISOString() }).eq("id", session.id);
  // Stop the recording if one is running — egress finalizes the file and fires the egress_ended
  // webhook, which is what kicks transcription. LiveKit also auto-stops on empty room, so this is
  // just prompt cleanup.
  if (session.egress_id && session.recording_status === "recording") await stopRoomEgress(session.egress_id);
  return c.json({ ok: true });
});

// ── Native recording controls (start/stop/status) ────────────────────────────────────────────────
// Mid-call recording toggle for a live session. FAIL-CLOSED: no egress env → 503 recording_not_configured
// (never a fake "recording"). Only the ORGANIZER (session initiator) can start/stop; any participant
// can read status. Reuses the same egress + webhook + meeting-memory pipeline as everything else.
async function loadSession(ws: string, id: string) {
  const { data } = await supabase.from("call_sessions")
    .select("id, initiator_id, invitee_id, room, egress_id, recording_status, status")
    .eq("workspace_id", ws).eq("id", id).maybeSingle();
  return data as { id: string; initiator_id: string; invitee_id: string; room: string; egress_id: string | null; recording_status: string | null; status: string } | null;
}

router.post("/rooms/:id/recording/start", async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const session = await loadSession(ws, c.req.param("id"));
  if (!session) return c.json({ error: "Call not found." }, 404);
  if (me !== session.initiator_id && me !== session.invitee_id) return c.json({ error: "You are not part of this call." }, 403);
  if (me !== session.initiator_id) return c.json({ error: "Only the call organizer can start recording." }, 403);
  if (!recordingEnabled()) return c.json({ error: "recording_not_configured" }, 503);
  // Idempotent — already recording ⇒ return current state, no second egress.
  if (session.recording_status === "recording" && session.egress_id) return c.json({ recording_status: "recording", egress_id: session.egress_id });
  const eg = await startRoomEgress(session.room);
  if (!eg) { await supabase.from("call_sessions").update({ recording_status: "failed_start" }).eq("id", session.id); return c.json({ error: "egress_start_failed", recording_status: "failed_start" }, 502); }
  await supabase.from("call_sessions").update({ egress_id: eg.egressId, record: true, recording_status: "recording" }).eq("id", session.id);
  return c.json({ recording_status: "recording", egress_id: eg.egressId });
});

router.post("/rooms/:id/recording/stop", async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const session = await loadSession(ws, c.req.param("id"));
  if (!session) return c.json({ error: "Call not found." }, 404);
  if (me !== session.initiator_id && me !== session.invitee_id) return c.json({ error: "You are not part of this call." }, 403);
  if (me !== session.initiator_id) return c.json({ error: "Only the call organizer can stop recording." }, 403);
  if (!recordingEnabled()) return c.json({ error: "recording_not_configured" }, 503);
  // Idempotent — not recording ⇒ return current state, no-op.
  if (session.recording_status !== "recording" || !session.egress_id) return c.json({ recording_status: session.recording_status ?? null });
  await stopRoomEgress(session.egress_id);
  // Egress finalizes the file then fires egress_ended → the webhook flips ready/failed + triggers STT.
  await supabase.from("call_sessions").update({ recording_status: "processing" }).eq("id", session.id);
  return c.json({ recording_status: "processing" });
});

router.get("/rooms/:id/recording/status", async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const session = await loadSession(ws, c.req.param("id"));
  if (!session) return c.json({ error: "Call not found." }, 404);
  if (me !== session.initiator_id && me !== session.invitee_id) return c.json({ error: "You are not part of this call." }, 403);
  return c.json({
    recording_status: session.recording_status ?? null,   // null | recording | processing | ready | failed | failed_start
    configured: recordingEnabled(),
    can_control: me === session.initiator_id,              // organizer-only start/stop
  });
});

/**
 * POST /live-calls/caption-chunk — Live Captions Phase 2 (staging/canary). Accepts ONE short local-mic
 * audio chunk as a RAW application/octet-stream body (PCM), with metadata in the query string
 * (?format&sample_rate&session&seq&language) from an authenticated member, and proxies it to the
 * sovereign STT appliance, returning { text, no_speech } only. Raw body (not multipart): multipart
 * parseBody() throws in the Vercel Node adapter, whereas arrayBuffer() reads reliably like the JSON
 * bodies used everywhere else. The caller publishes the CaptionPacket itself — this endpoint neither
 * stores audio nor persists the transcript, and adds SOVEREIGN_STT_KEY server-side (never to the browser).
 * FAIL-CLOSED: 503 when captions aren't configured/allowed for this workspace; never invents text.
 */
router.post("/caption-chunk", rateLimit({ max: 300, windowMs: 60_000 }), async (c) => {
  const ws = c.get("workspaceId");
  if (!liveCaptionsAllowed(ws)) return c.json({ error: "live_captions_unavailable" }, 503);

  const audio = await c.req.arrayBuffer();
  if (!audio || audio.byteLength === 0) return c.json({ error: "audio_required" }, 400);
  if (audio.byteLength > CAPTION_CHUNK_MAX_BYTES) return c.json({ error: "payload_too_large" }, 413);

  const q = c.req.query();
  const r = await captionChunk({
    audio,
    format: q.format ?? "pcm_s16le",
    sampleRate: Number(q.sample_rate ?? 0),
    session: q.session ?? "",
    seq: Number(q.seq ?? 0),
    language: q.language || undefined,
  });
  // Fail-closed: no fabricated text. 413 passes through; other failures are transient → 502 so the client backs off.
  if (!r.ok) return c.json({ text: "", no_speech: false, error: r.status === 413 ? "payload_too_large" : "stt_unavailable" }, r.status === 413 ? 413 : 502);
  return c.json({ text: r.text, no_speech: r.no_speech, language: r.language, confidence: r.confidence });
});

/**
 * POST /live-calls/transcript — Live Multilingual Meeting Intelligence Phase B: SAVE the finalized
 * live-caption lines DURING the call, so Meeting Memory keeps a transcript even if recording is never
 * opted-in, is still processing, or fails. Members only (guest save is deferred to Phase B.1). The room
 * is SERVER-DERIVED from the event/session (never trusted from the client), so a caller can only ever
 * write into their own workspace's room. Idempotent: unique (workspace_id, room, line_id) + ignore
 * duplicates ⇒ a resent packet never creates a duplicate line. FAIL-CLOSED behind the same canary gate as
 * captions; NO translation (Phase C), NO recording changes, NO fabricated/interim text.
 */
router.post("/transcript", rateLimit({ max: 120, windowMs: 60_000 }), zValidator("json", z.object({
  event_id: z.string().min(1).max(200).optional(),
  session_id: z.string().uuid().optional(),
  lines: z.array(z.object({
    id: z.string().min(1),
    participantId: z.string().optional(),
    name: z.string().optional(),
    text: z.string(),
    ts: z.number().optional(),
    lang: z.string().optional(),
    final: z.boolean().optional(),
  })).min(1).max(50),
})), async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  // Consent + workspace gate: captions are opt-in (turning CC on) and behave exactly like caption-chunk.
  if (!liveCaptionsAllowed(ws)) return c.json({ error: "live_captions_unavailable" }, 503);
  const body = c.req.valid("json");

  // Resolve the room this transcript belongs to — ALWAYS server-derived so the client can't target
  // another tenant's room. Meeting calls: room = meetingRoom(ws, eventId). Direct calls: from the
  // call_sessions row, validated to this workspace + participant.
  let room: string;
  let eventId: string | null = null;
  let callSessionId: string | null = null;
  if (body.session_id) {
    const { data: s } = await supabase.from("call_sessions")
      .select("id, room, initiator_id, invitee_id").eq("workspace_id", ws).eq("id", body.session_id).maybeSingle();
    if (!s) return c.json({ error: "session_not_found" }, 404);
    if (me !== s.initiator_id && me !== s.invitee_id) return c.json({ error: "not_a_participant" }, 403);
    room = s.room; callSessionId = s.id;
  } else if (body.event_id) {
    eventId = body.event_id;
    room = meetingRoom(ws, body.event_id);
  } else {
    return c.json({ error: "event_id_or_session_id_required" }, 400);
  }

  // Sanitize: only FINAL, non-empty lines survive (interim/fabricated dropped by the shared sanitizer).
  const clean = body.lines.map(sanitizeLiveTranscriptLine).filter((l): l is SanitizedLiveTranscriptLine => l !== null);
  if (clean.length === 0) return c.json({ ok: true, saved: 0 });   // nothing persistable — honest no-op

  const rows = clean.map((l) => ({
    workspace_id: ws, room, event_id: eventId, call_session_id: callSessionId,
    line_id: l.line_id, participant_id: l.participant_id, speaker_name: l.speaker_name,
    text: l.text, lang: l.lang, ts: l.ts, source: LIVE_TRANSCRIPT_SOURCE,
  }));
  const { error } = await supabase.from("call_transcript_lines")
    .upsert(rows, { onConflict: "workspace_id,room,line_id", ignoreDuplicates: true });
  if (error) return c.json({ error: "save_failed" }, 500);
  return c.json({ ok: true, saved: clean.length });
});

/**
 * GET /live-calls/transcript?event_id=…|session_id=… — read the saved live transcript for a call, ordered
 * oldest→newest, with HONEST provenance (live_only | recording_pending | recording_available |
 * recording_failed_live_fallback) so the UI never silently mixes it with a recording transcript. Workspace
 * + participant scoped. This is the Meeting Memory / call-detail read path for live transcripts.
 */
router.get("/transcript", async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const eventId = (c.req.query("event_id") || "").trim();
  const sessionId = (c.req.query("session_id") || "").trim();

  let room: string;
  let session: { record: boolean | null; recording_status: string | null; transcript_status: string | null; memory_node_id: string | null } | null = null;
  if (sessionId) {
    const { data: s } = await supabase.from("call_sessions")
      .select("id, room, initiator_id, invitee_id, record, recording_status, transcript_status, memory_node_id")
      .eq("workspace_id", ws).eq("id", sessionId).maybeSingle();
    if (!s) return c.json({ error: "session_not_found" }, 404);
    if (me !== s.initiator_id && me !== s.invitee_id) return c.json({ error: "not_a_participant" }, 403);
    room = s.room;
    session = { record: s.record, recording_status: s.recording_status, transcript_status: s.transcript_status, memory_node_id: s.memory_node_id };
  } else if (eventId) {
    // Meeting call: verify the caller is organizer/attendee of the event before exposing its transcript.
    const { data: ev } = await supabase.from("nodes").select("data")
      .eq("workspace_id", ws).eq("object_type", "calendar_event").eq("id", eventId).maybeSingle();
    if (!ev) return c.json({ error: "event_not_found" }, 404);
    const d = (ev.data ?? {}) as { organizer_id?: string; attendee_ids?: string[] };
    if (d.organizer_id !== me && !(d.attendee_ids ?? []).includes(me)) return c.json({ error: "forbidden" }, 403);
    room = meetingRoom(ws, eventId);
  } else {
    return c.json({ error: "event_id_or_session_id_required" }, 400);
  }

  const { data: lines } = await supabase.from("call_transcript_lines")
    .select("line_id, participant_id, speaker_name, text, lang, ts, source")
    .eq("workspace_id", ws).eq("room", room).order("ts", { ascending: true }).limit(5000);

  return c.json({
    lines: lines ?? [],
    count: (lines ?? []).length,
    provenance: liveTranscriptProvenance(session),
    source: LIVE_TRANSCRIPT_SOURCE,
  });
});

/**
 * POST /live-calls/translate — Live Multilingual Meeting Intelligence Phase C.1: translate transcript lines
 * into ONE target language for the CALLER only (a per-viewer read-time overlay). Sovereign: translation runs
 * ONLY through aiGateway (metered feature "live_translation"); NO browser/third-party translator, NO STT or
 * recording changes. Workspace-scoped + auth-required. It NEVER reads or writes call_transcript_lines — the
 * caller passes the already-fetched original text; the original transcript is never mutated. Cached +
 * idempotent by (workspace_id, text_hash, source_lang, target_lang). Same-language lines are passed through
 * with no AI call; failures return state "unavailable" (the UI shows the original) — never fabricated text.
 */
router.post("/translate", rateLimit({ max: 120, windowMs: 60_000 }), zValidator("json", z.object({
  target: z.string().min(2).max(16),
  lines: z.array(z.object({
    text: z.string(),
    source_lang: z.string().max(16).optional(),
  })).min(1).max(50),
})), async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const { target, lines } = c.req.valid("json");
  const out = await translateLines(ws, me, target, lines);
  return c.json(out);
});

/** GET /live-calls/incoming — ringing calls addressed to the caller in the last 60s. */
router.get("/incoming", async (c) => {
  if (!isEnabled()) return c.json({ incoming: [] });
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const { data } = await supabase
    .from("call_sessions")
    .select("id, room, initiator_id, kind, created_at")
    .eq("workspace_id", ws).eq("invitee_id", me).eq("status", "ringing")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(5);
  const dir = await members(ws);
  const incoming = (data ?? []).map((s) => { const m = dir.get(s.initiator_id); return { ...s, caller_name: m?.name || m?.email || "A teammate", caller_avatar: m?.avatar_url ?? null }; });
  return c.json({ incoming });
});

/** GET /live-calls/history — recent calls the caller was part of. */
router.get("/history", async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const { data } = await supabase
    .from("call_sessions")
    .select("id, room, initiator_id, invitee_id, kind, status, started_at, ended_at, created_at")
    .eq("workspace_id", ws)
    .or(`initiator_id.eq.${me},invitee_id.eq.${me}`)
    .order("created_at", { ascending: false })
    .limit(50);
  const dir = await members(ws);
  const rows = (data ?? []).map((s) => {
    const otherId = s.initiator_id === me ? s.invitee_id : s.initiator_id;
    const m = dir.get(otherId);
    return { ...s, outgoing: s.initiator_id === me, other_name: m?.name || m?.email || "Member", other_avatar: m?.avatar_url ?? null };
  });
  return c.json({ calls: rows });
});

export { router as liveCallsRouter };
