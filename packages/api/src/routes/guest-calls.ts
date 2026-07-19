import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { supabase } from "@mondaily/db/client";
import { recordingEnabled } from "../lib/livekit";
import { rateLimit } from "../middleware/rate-limit";

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
interface EventData { title?: string; start_at?: string; status?: string; guest_link_epoch?: number; organizer_id?: string }

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
  });
});

/**
 * POST /public/calls/token { token, name?, consent? } — redeem for a room-scoped LiveKit join token.
 * When recording may occur, `consent === true` is REQUIRED before a token is minted. roomJoin ONLY.
 */
router.post("/token", rateLimit({ max: 15, windowMs: 60_000 }), zValidator("json", z.object({
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

  // Consent gate — enforced server-side, not just in the UI. Only required when recording may occur.
  if (recordingEnabled() && consent !== true) {
    return c.json({ error: "This meeting may be recorded — you must consent to join.", code: "consent_required" }, 400);
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

export { router as guestCallsRouter };
