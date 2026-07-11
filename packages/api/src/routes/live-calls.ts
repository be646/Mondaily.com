import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sign } from "hono/jwt";
import { supabase } from "@mondaily/db/client";
import { requireAuth } from "../middleware/auth";
import { recordingEnabled, transcriptionEnabled, startRoomEgress, stopRoomEgress } from "../lib/livekit";

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
