import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { sign, verify } from "hono/jwt";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { supabase } from "@mondaily/db/client";
import { recordingEnabled, liveCaptionsAllowed, captionChunk, CAPTION_CHUNK_MAX_BYTES } from "../lib/livekit";
import { rateLimit } from "../middleware/rate-limit";
import { guestSafeMeetingLabel, normalizeMeetingType } from "@mondaily/shared/meeting-types";

/**
 * Waiting-room state (Phase 2A) is stored as generic `nodes` rows (object_type "call_waiting_request")
 * — the SAME schema-free pattern support tickets use, so NO migration is needed. A request stores only
 * { event_id, room, guest_name, status, request_id, created_at } — never the guest token, never a profile.
 * Requests older than this window are treated as stale (auto-expired on read).
 */
const WAITING_OBJECT = "call_waiting_request";
const WAITING_TTL_MS = 30 * 60_000;
type WaitStatus = "waiting" | "admitted" | "denied";
interface WaitingData { event_id: string; room: string; guest_name: string; status: WaitStatus; request_id: string; created_at: string }

/**
 * PUBLIC (no account) guest-call surface. A guest opens a shareable link the host minted
 * (/calendar/events/:id/guest-link) and:
 *   • POST /meta  — reads a SAFE preview (title, host, time, whether recording may occur) before joining;
 *   • POST /token — redeems it for a LiveKit join token scoped to THAT one room.
 *
 * Security: the guest token is a signed, expiring, event+room-scoped JWT (AUTH_JWT_SECRET). Both routes
 * verify it, confirm the meeting still exists / isn't cancelled / isn't revoked, and NEVER leak workspace
 * internals. The join token grants roomJoin ONLY — never roomAdmin. A guest gets no workspace session and
 * no API access. Mounted OUTSIDE requireAuth.
 */
const router = new Hono();

const callsEnabled = () => !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);

interface GuestClaims { kind?: string; ev?: string; ws?: string; room?: string; exp?: number; epoch?: number; jti?: string }
type GuestStatus = "ok" | "expired" | "revoked" | "cancelled" | "ended" | "not_configured";
interface EventData { title?: string; start_at?: string; status?: string; guest_link_epoch?: number; organizer_id?: string; guest_waiting_room?: boolean; meeting_type?: string }

// Read a waiting request by its (unguessable) request_id, scoped to the event's workspace. Returns null
// when missing or stale (older than the TTL). The guest holds the request_id it received from /request.
async function readWaitingNode(ws: string, eventId: string, requestId: string): Promise<{ id: string; d: WaitingData } | null> {
  const { data } = await supabase.from("nodes")
    .select("id,data").eq("workspace_id", ws).eq("object_type", WAITING_OBJECT).eq("data->>request_id", requestId).maybeSingle();
  if (!data) return null;
  const d = data.data as WaitingData;
  if (d.event_id !== eventId) return null;                                   // never cross-event
  if (Date.now() - new Date(d.created_at).getTime() > WAITING_TTL_MS) return null; // stale
  return { id: data.id as string, d };
}

/**
 * Shared verification for both guest routes — enforces signature + exp, then confirms the meeting's
 * validity. Returns a coarse status + (when found) the event data. Never throws; never returns secrets.
 */
async function resolveGuest(token: string): Promise<{ status: GuestStatus; claims?: GuestClaims; data?: EventData }> {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) return { status: "not_configured" };

  let claims: GuestClaims;
  try { claims = (await verify(token, secret, "HS256")) as GuestClaims; }  // enforces signature AND exp
  catch { return { status: "expired" }; }
  if (claims.kind !== "call_guest" || !claims.ev || !claims.ws || !claims.room) return { status: "expired" };

  const { data: node } = await supabase.from("nodes")
    .select("data").eq("workspace_id", claims.ws).eq("object_type", "calendar_event").eq("id", claims.ev).maybeSingle();
  if (!node) return { status: "ended", claims };  // meeting no longer exists
  const d = (node.data ?? {}) as EventData;

  if (d.status === "cancelled") return { status: "cancelled", claims, data: d };
  if (d.status === "completed" || d.status === "ended") return { status: "ended", claims, data: d };
  // Revocation: a link whose epoch is older than the event's current epoch has been revoked.
  if (Number(claims.epoch ?? 0) < Number(d.guest_link_epoch ?? 0)) return { status: "revoked", claims, data: d };
  return { status: "ok", claims, data: d };
}

// Resolve the host's display NAME only (never the email — no PII leak to guests).
async function hostDisplayName(ws: string, organizerId?: string): Promise<string> {
  if (!organizerId) return "Meeting host";
  const { data } = await supabase.from("workspace_members").select("name").eq("workspace_id", ws).eq("user_id", organizerId).maybeSingle();
  return (data?.name as string | undefined)?.trim() || "Meeting host";
}
async function workspaceDisplayName(ws: string): Promise<string> {
  const { data } = await supabase.from("workspaces").select("name").eq("id", ws).maybeSingle();
  return (data?.name as string | undefined)?.trim() || "Mondaily workspace";
}

/**
 * POST /public/calls/meta { token } — SAFE pre-join preview. Returns ONLY a whitelist: event title,
 * start time, host + workspace display names, whether recording may occur, calls_enabled, and a coarse
 * status. No attendee list, room name, notes, transcript, storage paths, IDs, or secrets ever leave here.
 */
// Abuse guard (Phase 1.1): reuse the shared per-IP sliding-window limiter the auth routes use. It keys
// by path+IP (the guest body carries no email, so nothing token-derived enters the key — the raw token
// is never stored or logged). In-memory, bounded, per-warm-instance — a solid first layer for a public
// endpoint. Limits are generous so a real guest (or a group behind one office NAT) is never blocked.
router.post("/meta", rateLimit({ max: 20, windowMs: 60_000 }), zValidator("json", z.object({ token: z.string().min(1).max(4000) })), async (c) => {
  const { token } = c.req.valid("json");
  const r = await resolveGuest(token);
  const calls_enabled = callsEnabled();
  // recording MAY occur when the platform can record (LiveKit egress + operator flag). No per-event flag
  // exists; this is the honest capability signal the guest consents against.
  const recording_may_occur = recordingEnabled();

  const base = {
    calls_enabled,
    recording_may_occur,
    waiting_room: !!r.data?.guest_waiting_room,   // guest must be admitted by the host before getting a token
    live_captions_available: liveCaptionsAllowed(r.claims?.ws),   // env + per-workspace canary gate; false until Phase 2 staging
    // If the token is otherwise valid but calls aren't wired, report not_configured.
    status: (r.status === "ok" && !calls_enabled) ? ("not_configured" as GuestStatus) : r.status,
  };
  if (!r.data) return c.json({ ...base, event_title: null, start_time: null, host_display_name: null, workspace_display_name: null });

  const ws = r.claims!.ws!;
  const [host_display_name, workspace_display_name] = await Promise.all([
    hostDisplayName(ws, r.data.organizer_id),
    workspaceDisplayName(ws),
  ]);
  return c.json({
    ...base,
    event_title: r.data.title ?? "Meeting",
    start_time: r.data.start_at ?? null,
    host_display_name,
    workspace_display_name,
    // GUEST-SAFE label only — sensitive/internal types collapse to a neutral "Meeting"; never the raw
    // type id or any private meeting note.
    meeting_type_label: guestSafeMeetingLabel(normalizeMeetingType(r.data.meeting_type)),
  });
});

/**
 * POST /public/calls/request { token, name?, consent? } — the guest asks to join. When the event's
 * waiting room is OFF this is a no-op (waiting:false) and the client goes straight to /token (Phase 1
 * behaviour). When ON, it records a waiting request (generic node) and returns an unguessable request_id
 * the guest polls with — NO token is issued until the host admits. Consent is enforced here too.
 */
router.post("/request", rateLimit({ max: 15, windowMs: 60_000 }), zValidator("json", z.object({
  token: z.string().min(1).max(4000),
  name: z.string().max(60).optional(),
  consent: z.boolean().optional(),
})), async (c) => {
  const { token, name, consent } = c.req.valid("json");
  if (!callsEnabled()) return c.json({ error: "Calls aren't available right now." }, 503);
  const r = await resolveGuest(token);
  if (r.status === "not_configured") return c.json({ error: "Guest access isn't available." }, 503);
  if (r.status === "expired")   return c.json({ error: "This guest link is invalid or has expired." }, 401);
  if (r.status === "cancelled") return c.json({ error: "This meeting was cancelled." }, 410);
  if (r.status === "ended")     return c.json({ error: "This meeting has ended or no longer exists." }, 410);
  if (r.status === "revoked")   return c.json({ error: "This guest link has been revoked by the host." }, 403);
  if (recordingEnabled() && consent !== true) {
    return c.json({ error: "This meeting may be recorded — you must consent to join.", code: "consent_required" }, 400);
  }

  if (!r.data!.guest_waiting_room) return c.json({ waiting: false });   // no waiting room → join directly

  const request_id = randomUUID();
  const guest_name = (String(name ?? "").trim().slice(0, 40)) || "Guest";
  const waiting: WaitingData = { event_id: r.claims!.ev!, room: r.claims!.room!, guest_name, status: "waiting", request_id, created_at: new Date().toISOString() };
  const { error } = await supabase.from("nodes").insert({ workspace_id: r.claims!.ws, vertical: "shared", object_type: WAITING_OBJECT, created_by: null, data: waiting });
  if (error) return c.json({ error: "Couldn't request entry — please try again." }, 500);
  return c.json({ waiting: true, request_id, status: "waiting" });
});

/**
 * POST /public/calls/wait-status { token, request_id } — the guest polls their admission status.
 * Returns { status: "waiting"|"admitted"|"denied"|"expired" }. Nothing else — no host/workspace data.
 */
router.post("/wait-status", rateLimit({ max: 60, windowMs: 60_000 }), zValidator("json", z.object({
  token: z.string().min(1).max(4000), request_id: z.string().uuid(),
})), async (c) => {
  const { token, request_id } = c.req.valid("json");
  const r = await resolveGuest(token);
  if (r.status !== "ok") return c.json({ status: "expired" });   // link no longer valid → stop polling
  const node = await readWaitingNode(r.claims!.ws!, r.claims!.ev!, request_id);
  return c.json({ status: node ? node.d.status : "expired" });
});

/**
 * POST /public/calls/token { token, name?, consent?, request_id? } — redeem for a room-scoped LiveKit
 * join token. When recording may occur, `consent === true` is REQUIRED. When the event's waiting room is
 * ON, a request_id whose status is "admitted" is REQUIRED (else 403 not_admitted). roomJoin ONLY.
 */
router.post("/token", rateLimit({ max: 15, windowMs: 60_000 }), zValidator("json", z.object({
  token: z.string().min(1).max(4000),
  name: z.string().max(60).optional(),
  consent: z.boolean().optional(),
  request_id: z.string().uuid().optional(),
})), async (c) => {
  const { token, name, consent, request_id } = c.req.valid("json");
  if (!callsEnabled()) return c.json({ error: "Calls aren't available right now." }, 503);

  const r = await resolveGuest(token);
  if (r.status === "not_configured") return c.json({ error: "Guest access isn't available." }, 503);
  if (r.status === "expired")   return c.json({ error: "This guest link is invalid or has expired." }, 401);
  if (r.status === "cancelled") return c.json({ error: "This meeting was cancelled." }, 410);
  if (r.status === "ended")     return c.json({ error: "This meeting has ended or no longer exists." }, 410);
  if (r.status === "revoked")   return c.json({ error: "This guest link has been revoked by the host." }, 403);

  // Consent gate — enforced server-side, not just in the UI. Only required when recording may occur.
  if (recordingEnabled() && consent !== true) {
    return c.json({ error: "This meeting may be recorded — you must consent to join.", code: "consent_required" }, 400);
  }

  // Waiting-room gate — when enabled, a token is minted ONLY for an admitted request. The waiting node is
  // consumed (deleted) once redeemed so it can't be reused.
  if (r.data!.guest_waiting_room) {
    const node = request_id ? await readWaitingNode(r.claims!.ws!, r.claims!.ev!, request_id) : null;
    if (!node || node.d.status !== "admitted") {
      return c.json({ error: "The host hasn't admitted you yet.", code: "not_admitted" }, 403);
    }
    await supabase.from("nodes").delete().eq("id", node.id).eq("workspace_id", r.claims!.ws);   // one-time use
  }

  const guestName = (String(name ?? "").trim().slice(0, 40)) || "Guest";
  const identity = `guest_${Math.random().toString(36).slice(2, 10)}`;   // guest_ prefix → UI badges it
  const now = Math.floor(Date.now() / 1000);
  const lkToken = await sign(
    {
      iss: process.env.LIVEKIT_API_KEY, sub: identity, name: guestName, nbf: now, iat: now, exp: now + 60 * 60,
      video: { room: r.claims!.room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true }, // NO roomAdmin
    },
    process.env.LIVEKIT_API_SECRET as string, "HS256",
  );
  return c.json({ token: lkToken, url: process.env.LIVEKIT_URL, room: r.claims!.room, name: guestName, event_title: r.data?.title ?? "Meeting" });
});

/**
 * POST /public/calls/caption-chunk — guest twin of the member caption proxy (Live Captions Phase 2,
 * staging/canary). Multipart: token, consent, audio, format, sample_rate, session, seq, language?. Stays
 * on /public/calls/* so guests never touch an authenticated workspace API. Requires a VALID guest token
 * (same signature+meeting checks as /token) AND explicit consent (live captions send the guest's mic to
 * the sovereign STT). Canary-gated by the token's workspace. Forwards to the appliance with the
 * server-side key, returns { text, no_speech } only — no audio stored, no transcript persisted, no
 * invented text. Rate-limited like the other public routes.
 */
router.post("/caption-chunk", rateLimit({ max: 300, windowMs: 60_000 }), async (c) => {
  if (!callsEnabled()) return c.json({ error: "unavailable" }, 503);
  const body = await c.req.parseBody();
  const token = String(body["token"] ?? "");
  if (!token) return c.json({ error: "token_required" }, 400);

  const r = await resolveGuest(token);
  if (r.status !== "ok") return c.json({ error: "invalid_or_expired" }, 401);
  if (!liveCaptionsAllowed(r.claims?.ws)) return c.json({ error: "live_captions_unavailable" }, 503);
  // Explicit consent required — captions are a live audio egress of the guest's own mic.
  if (String(body["consent"] ?? "") !== "true") return c.json({ error: "consent_required" }, 400);

  const audio = body["audio"];
  if (!(audio instanceof File)) return c.json({ error: "audio_required" }, 400);
  if (audio.size > CAPTION_CHUNK_MAX_BYTES) return c.json({ error: "payload_too_large" }, 413);

  const out = await captionChunk({
    audio: await audio.arrayBuffer(),
    format: String(body["format"] ?? ""),
    sampleRate: Number(body["sample_rate"] ?? 0),
    session: String(body["session"] ?? ""),
    seq: Number(body["seq"] ?? 0),
    language: body["language"] ? String(body["language"]) : undefined,
  });
  if (!out.ok) return c.json({ text: "", no_speech: false, error: out.status === 413 ? "payload_too_large" : "stt_unavailable" }, out.status === 413 ? 413 : 502);
  return c.json({ text: out.text, no_speech: out.no_speech, language: out.language, confidence: out.confidence });
});

export { router as guestCallsRouter };
