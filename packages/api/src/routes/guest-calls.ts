import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { supabase } from "@mondaily/db/client";

/**
 * PUBLIC (no account) guest-call redemption. A guest opens a shareable link the host minted
 * (/calendar/events/:id/guest-link) and redeems it here for a LiveKit join token scoped to THAT one
 * room. Security: the guest token is a signed, expiring, event+room-scoped JWT (AUTH_JWT_SECRET); this
 * endpoint verifies it, confirms the meeting still exists and isn't cancelled, and mints a join token
 * with roomJoin ONLY — never roomAdmin. A guest never receives a workspace session, and this token
 * exposes nothing else in the workspace. Mounted OUTSIDE requireAuth.
 */
const router = new Hono();

const callsEnabled = () => !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);

interface GuestClaims { kind?: string; ev?: string; ws?: string; room?: string; exp?: number; epoch?: number; jti?: string }

router.post("/token", zValidator("json", z.object({ token: z.string().min(1), name: z.string().max(60).optional() })), async (c) => {
  const { token, name } = c.req.valid("json");
  if (!callsEnabled()) return c.json({ error: "Calls aren't available right now." }, 503);
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) return c.json({ error: "Guest access isn't available." }, 503);

  // verify() enforces the signature AND the exp claim — an expired/tampered link fails here.
  let claims: GuestClaims;
  try { claims = (await verify(token, secret, "HS256")) as GuestClaims; }
  catch { return c.json({ error: "This guest link is invalid or has expired." }, 401); }
  if (claims.kind !== "call_guest" || !claims.ev || !claims.ws || !claims.room) {
    return c.json({ error: "This isn't a valid guest link." }, 401);
  }

  // Confirm the meeting still exists and wasn't cancelled (service-role read — the guest has no session).
  const { data: node } = await supabase.from("nodes")
    .select("data").eq("workspace_id", claims.ws).eq("object_type", "calendar_event").eq("id", claims.ev).maybeSingle();
  if (!node) return c.json({ error: "This meeting no longer exists." }, 404);
  if ((node.data as { status?: string })?.status === "cancelled") return c.json({ error: "This meeting was cancelled." }, 410);
  // Revocation: the host can invalidate all outstanding links by bumping the event's guest-link epoch.
  // A link whose epoch is older than the event's current epoch has been revoked. (Legacy links minted
  // before this feature have no epoch claim → treated as 0, matching a never-revoked event.)
  const currentEpoch = Number((node.data as { guest_link_epoch?: number })?.guest_link_epoch ?? 0);
  if (Number(claims.epoch ?? 0) < currentEpoch) {
    return c.json({ error: "This guest link has been revoked by the host." }, 403);
  }

  const guestName = (String(name ?? "").trim().slice(0, 40)) || "Guest";
  const identity = `guest_${Math.random().toString(36).slice(2, 10)}`;   // guest_ prefix → UI badges it
  const now = Math.floor(Date.now() / 1000);
  const lkToken = await sign(
    {
      iss: process.env.LIVEKIT_API_KEY, sub: identity, name: guestName, nbf: now, iat: now, exp: now + 60 * 60,
      video: { room: claims.room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true }, // NO roomAdmin
    },
    process.env.LIVEKIT_API_SECRET as string, "HS256",
  );
  return c.json({ token: lkToken, url: process.env.LIVEKIT_URL, room: claims.room, name: guestName, event_title: (node.data as { title?: string })?.title ?? "Meeting" });
});

export { router as guestCallsRouter };
