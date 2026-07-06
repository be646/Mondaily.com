import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { sign } from "hono/jwt";
import { supabase } from "@mondaily/db/client";
import { requireAuth } from "../middleware/auth";
import { isWorkspaceAdmin } from "../middleware/rbac";
import { createNotification } from "../lib/notify";
import { aiGateway, gatewayEnv } from "../lib/ai-gateway";
import { resolveProfile } from "@mondaily/shared/profile";
import { languageInstruction, normalizeLang } from "@mondaily/shared/i18n";

/**
 * MONDAILY CALENDAR + CALLS — native, workspace-scoped meetings with Mondaily-owned call links.
 *
 * Storage: the existing `nodes` table (object_type='calendar_event') — no new table/migration, so
 * events inherit workspace isolation. Access: the organizer or an attendee may VIEW; only the
 * organizer or a workspace admin/owner may EDIT/CANCEL. Call links are minted only when LiveKit is
 * configured (fail-closed, never a fake link, never Zoom/Teams). AI agenda drafting returns text
 * only — it never creates or sends an event.
 */
type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

export const EVENT_STATUSES = ["scheduled", "cancelled", "completed"] as const;
type EventStatus = (typeof EVENT_STATUSES)[number];

interface EventData {
  title: string; description: string; start_at: string; end_at: string; timezone: string;
  organizer_id: string; attendee_ids: string[]; location: string;
  call_room_id: string | null; call_url: string | null; status: EventStatus;
}

const callsEnabled = () => !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
const appUrl = () => (process.env.APP_URL ?? "https://app.mondaily.com").replace(/\/$/, "");

/**
 * A Mondaily-owned call link for a meeting — ONLY when the real-time engine is configured; else null
 * (no fake link). The PUBLIC url is a clean Mondaily path (app.mondaily.com/calls/<eventId>); the
 * workspace-namespaced `call_room_id` stays internal (used to isolate the underlying real-time room
 * per tenant). No external/third-party meeting provider is ever involved.
 */
const internalRoom = (ws: string, eventId: string) => `ws_${ws}__meeting__${eventId}`;   // never surfaced to users
function makeCallLink(ws: string, eventId: string): { call_room_id: string; call_url: string } | null {
  if (!callsEnabled()) return null;
  return { call_room_id: internalRoom(ws, eventId), call_url: `${appUrl()}/calls/${eventId}` };   // Mondaily-owned path link
}

/** Mint a short-lived join token for the underlying real-time engine (no branding leaks to the UI). */
async function mintCallToken(identity: string, name: string, room: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { iss: process.env.LIVEKIT_API_KEY, sub: identity, name, nbf: now, iat: now, exp: now + 60 * 60,
      video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true } },
    process.env.LIVEKIT_API_SECRET as string, "HS256",
  );
}

async function members(ws: string) {
  const { data } = await supabase.from("workspace_members").select("user_id, name, email").eq("workspace_id", ws);
  return new Map((data ?? []).map((m) => [String(m.user_id), m as { name?: string; email?: string }]));
}
async function getEvent(ws: string, id: string) {
  const { data } = await supabase.from("nodes").select("id, data, created_by, created_at, updated_at")
    .eq("workspace_id", ws).eq("object_type", "calendar_event").eq("id", id).maybeSingle();
  return data ? { ...data, data: (data.data ?? {}) as EventData } : null;
}
const canView = (d: EventData, me: string) => d.organizer_id === me || (d.attendee_ids ?? []).includes(me);
const canManage = (d: EventData, me: string, role: string) => d.organizer_id === me || isWorkspaceAdmin(role);

function shape(id: string, d: EventData, dir: Map<string, { name?: string; email?: string }>, createdAt?: string) {
  const person = (uid: string) => { const m = dir.get(uid); return { user_id: uid, name: m?.name || m?.email || "Member", email: m?.email ?? null }; };
  return {
    id, title: d.title, description: d.description ?? "", start_at: d.start_at, end_at: d.end_at,
    timezone: d.timezone ?? "UTC", location: d.location ?? "", status: d.status ?? "scheduled",
    call_url: d.call_url ?? null, call_room_id: d.call_room_id ?? null,
    organizer: person(d.organizer_id), attendees: (d.attendee_ids ?? []).map(person),
    created_at: createdAt,
  };
}

/** Notify attendees (not the actor) about a create/update/cancel. In-app only; deep-links to event. */
async function notifyAttendees(ws: string, eventId: string, d: EventData, actor: string, verb: "created" | "updated" | "cancelled") {
  const targets = [...new Set([d.organizer_id, ...(d.attendee_ids ?? [])])].filter((u) => u && u !== actor);
  await Promise.all(targets.map((uid) => createNotification({
    workspace_id: ws, user_id: uid, type: "calendar",
    title: `Meeting ${verb}: ${d.title}`,
    body: verb === "cancelled" ? "This meeting was cancelled." : `${new Date(d.start_at).toUTCString()}`,
    metadata: { route: `/calendar?event=${eventId}`, event_id: eventId },
  }).catch(() => false)));
}

const EventInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  start_at: z.string().min(1),
  end_at: z.string().min(1),
  timezone: z.string().max(60).optional(),
  attendee_ids: z.array(z.string()).max(50).optional(),
  location: z.string().max(300).optional(),
  generate_call_link: z.boolean().optional(),
});

// GET /calendar/events?from=&to= — the caller's events (organizer OR attendee), workspace-scoped.
router.get("/events", async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const from = c.req.query("from"); const to = c.req.query("to");
  let q = supabase.from("nodes").select("id, data, created_at").eq("workspace_id", ws).eq("object_type", "calendar_event");
  if (from) q = q.gte("data->>start_at", from);
  if (to) q = q.lte("data->>start_at", to);
  const { data } = await q.order("data->>start_at", { ascending: true }).limit(500);
  const dir = await members(ws);
  const events = (data ?? [])
    .map((n) => ({ id: n.id, d: (n.data ?? {}) as EventData, created_at: n.created_at }))
    .filter((e) => canView(e.d, me))                       // participant-only (never other people's meetings)
    .map((e) => shape(e.id, e.d, dir, e.created_at));
  return c.json({ events, calls_enabled: callsEnabled() });
});

// GET /calendar/events/:id — organizer or attendee only.
router.get("/events/:id", async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const ev = await getEvent(ws, c.req.param("id"));
  if (!ev) return c.json({ error: "Event not found." }, 404);
  if (!canView(ev.data, me)) return c.json({ error: "Not allowed." }, 403);
  const dir = await members(ws);
  return c.json({ ...shape(ev.id, ev.data, dir, ev.created_at), calls_enabled: callsEnabled() });
});

// POST /calendar/events — create a meeting (organizer = caller). Notifies attendees.
router.post("/events", zValidator("json", EventInput), async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const b = c.req.valid("json");
  const attendees = [...new Set((b.attendee_ids ?? []).filter((a) => a && a !== me))];
  const now = new Date().toISOString();
  const data: EventData = {
    title: b.title, description: b.description ?? "", start_at: b.start_at, end_at: b.end_at,
    timezone: b.timezone ?? "UTC", organizer_id: me, attendee_ids: attendees, location: b.location ?? "",
    call_room_id: null, call_url: null, status: "scheduled",
  };
  const { data: node, error } = await supabase.from("nodes")
    .insert({ workspace_id: ws, vertical: "shared", object_type: "calendar_event", created_by: me, data })
    .select("id, created_at").single();
  if (error || !node) return c.json({ error: "Could not create the meeting." }, 500);

  // Optional Mondaily call link — only when calling is configured (no fake link otherwise).
  if (b.generate_call_link) {
    const link = makeCallLink(ws, node.id);
    if (link) { data.call_room_id = link.call_room_id; data.call_url = link.call_url;
      await supabase.from("nodes").update({ data }).eq("workspace_id", ws).eq("id", node.id).eq("object_type", "calendar_event"); }
  }
  await notifyAttendees(ws, node.id, data, me, "created");
  const dir = await members(ws);
  return c.json({ ...shape(node.id, data, dir, node.created_at), calls_enabled: callsEnabled() }, 201);
});

// PATCH /calendar/events/:id — edit. Organizer or admin only. Notifies attendees.
router.patch("/events/:id", zValidator("json", EventInput.partial().extend({ status: z.enum(EVENT_STATUSES).optional() })), async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const ev = await getEvent(ws, c.req.param("id"));
  if (!ev) return c.json({ error: "Event not found." }, 404);
  if (!canManage(ev.data, me, c.get("role"))) return c.json({ error: "Only the organizer or an admin can edit this." }, 403);
  const b = c.req.valid("json");
  const next: EventData = {
    ...ev.data,
    ...(b.title !== undefined ? { title: b.title } : {}),
    ...(b.description !== undefined ? { description: b.description } : {}),
    ...(b.start_at !== undefined ? { start_at: b.start_at } : {}),
    ...(b.end_at !== undefined ? { end_at: b.end_at } : {}),
    ...(b.timezone !== undefined ? { timezone: b.timezone } : {}),
    ...(b.location !== undefined ? { location: b.location } : {}),
    ...(b.attendee_ids !== undefined ? { attendee_ids: [...new Set(b.attendee_ids.filter((a) => a && a !== ev.data.organizer_id))] } : {}),
    ...(b.status !== undefined ? { status: b.status } : {}),
  };
  const { error } = await supabase.from("nodes").update({ data: next }).eq("workspace_id", ws).eq("id", ev.id).eq("object_type", "calendar_event");
  if (error) return c.json({ error: "Could not update the meeting." }, 500);
  await notifyAttendees(ws, ev.id, next, me, next.status === "cancelled" ? "cancelled" : "updated");
  const dir = await members(ws);
  return c.json(shape(ev.id, next, dir, ev.created_at));
});

// DELETE /calendar/events/:id — CANCEL (soft): sets status=cancelled + notifies. Organizer/admin only.
router.delete("/events/:id", async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const ev = await getEvent(ws, c.req.param("id"));
  if (!ev) return c.json({ error: "Event not found." }, 404);
  if (!canManage(ev.data, me, c.get("role"))) return c.json({ error: "Only the organizer or an admin can cancel this." }, 403);
  const next: EventData = { ...ev.data, status: "cancelled" };
  const { error } = await supabase.from("nodes").update({ data: next }).eq("workspace_id", ws).eq("id", ev.id).eq("object_type", "calendar_event");
  if (error) return c.json({ error: "Could not cancel the meeting." }, 500);
  await notifyAttendees(ws, ev.id, next, me, "cancelled");
  return c.json({ ok: true, status: "cancelled" });
});

// POST /calendar/events/:id/call-link — mint a Mondaily call link. 503 if LiveKit isn't configured.
router.post("/events/:id/call-link", async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const ev = await getEvent(ws, c.req.param("id"));
  if (!ev) return c.json({ error: "Event not found." }, 404);
  if (!canManage(ev.data, me, c.get("role"))) return c.json({ error: "Only the organizer or an admin can add a call link." }, 403);
  const link = makeCallLink(ws, ev.id);
  if (!link) return c.json({ error: "Calls aren't configured on this workspace.", calls_enabled: false }, 503);
  const next: EventData = { ...ev.data, call_room_id: link.call_room_id, call_url: link.call_url };
  await supabase.from("nodes").update({ data: next }).eq("workspace_id", ws).eq("id", ev.id).eq("object_type", "calendar_event");
  return c.json({ call_url: link.call_url, call_room_id: link.call_room_id });
});

// POST /calendar/events/:id/call-token — mint a join token for THIS meeting's room. Access =
// organizer / attendee / admin only. Fails closed (503, no fake token) when the engine isn't
// configured. The room is the internal, workspace-namespaced id — the public URL stays /calls/:id.
router.post("/events/:id/call-token", async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId"); const role = c.get("role");
  const ev = await getEvent(ws, c.req.param("id"));
  if (!ev) return c.json({ error: "Event not found." }, 404);
  if (!canView(ev.data, me) && !isWorkspaceAdmin(role)) return c.json({ error: "Not allowed." }, 403);
  if (!callsEnabled()) return c.json({ error: "Calls aren't configured on this workspace.", calls_enabled: false }, 503);
  const room = ev.data.call_room_id || internalRoom(ws, ev.id);   // internal room id, never shown to users
  const dir = await members(ws); const meRow = dir.get(me);
  const token = await mintCallToken(me, meRow?.name || meRow?.email || "Member", room);
  return c.json({ token, url: process.env.LIVEKIT_URL, room });
});

// POST /calendar/draft-agenda — AI agenda draft. Returns TEXT only; never creates/sends an event.
router.post("/draft-agenda", zValidator("json", z.object({ title: z.string().max(200).optional(), prompt: z.string().min(1).max(1000) })), async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const env = gatewayEnv();
  if (!env.baseURL || !env.apiKey) return c.json({ error: "AI drafting isn't available right now." }, 503);
  const { data: wsRow } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const settings = (wsRow?.settings ?? {}) as Record<string, unknown>;
  const userLang = (settings.user_preferences as Record<string, { language?: string }> | undefined)?.[me]?.language;
  const lang = normalizeLang(userLang || resolveProfile(settings).language);
  const b = c.req.valid("json");
  const system = `You draft a concise meeting agenda as a short bullet list. Return ONLY the agenda (3–6 bullets), no preamble.${languageInstruction(lang)}`;
  const prompt = `Meeting title: ${b.title ?? "(untitled)"}\nContext/goal: ${b.prompt}`;
  try {
    const res = await aiGateway({ system, prompt, maxTokens: 300, workspaceId: ws, userId: me, feature: "agenda_draft" });
    const agenda = (res.text ?? "").trim();
    if (!agenda || res.provider === "none") return c.json({ error: "AI draft unavailable (check your AI credits)." }, 200);
    return c.json({ agenda });
  } catch { return c.json({ error: "Couldn't draft that — please try again." }, 200); }
});

export { router as calendarRouter };
