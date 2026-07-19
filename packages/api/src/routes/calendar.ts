import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
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
import { isOverdue } from "@mondaily/shared/dates";
import { endRoom } from "../lib/livekit";

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

/** A simple, explicit recurrence rule (a deliberately small subset of iCal RRULE — no third-party
 *  lib). Weekly recurs on the master's weekday; monthly on the master's day-of-month (months without
 *  that day, e.g. Feb 30, are skipped, never silently shifted). Ends by `count` OR `until`, else open. */
export interface RecurrenceRule {
  freq: "daily" | "weekly" | "monthly";
  interval: number;          // every N days/weeks/months (>=1)
  count?: number;            // stop after N occurrences (inclusive of the first)
  until?: string;            // stop on/after this date (YYYY-MM-DD)
}

interface EventData {
  title: string; description: string; start_at: string; end_at: string; timezone: string;
  organizer_id: string; attendee_ids: string[]; location: string;
  call_room_id: string | null; call_url: string | null; status: EventStatus;
  recurrence?: RecurrenceRule | null;   // set only on the SERIES MASTER
  exdates?: string[];                   // occurrence dates (YYYY-MM-DD) cancelled individually
  responses?: Record<string, RsvpResponse>;   // per-attendee RSVP; absent = not yet responded
  guest_link_epoch?: number;            // bumped to revoke all outstanding external guest links at once
}

export const RSVP_RESPONSES = ["accepted", "declined", "tentative"] as const;
export type RsvpResponse = (typeof RSVP_RESPONSES)[number];

// ── Recurrence (pure, unit-tested) ────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
/** A Date → naive "YYYY-MM-DDTHH:mm" (matches how the app stores start_at from <input datetime-local>). */
const fmtLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The synthetic id for one occurrence of a recurring series, and its inverse (base node id). */
export const occurrenceId = (masterId: string, occDate: string) => `${masterId}::${occDate}`;
export const baseId = (id: string) => id.split("::")[0]!;

/** A short human summary of a rule ("Every 2 weeks", "Monthly"), for the UI. */
export function recurrenceSummary(r: RecurrenceRule): string {
  const unit = r.freq === "daily" ? "day" : r.freq === "weekly" ? "week" : "month";
  const base = r.interval === 1 ? { daily: "Daily", weekly: "Weekly", monthly: "Monthly" }[r.freq] : `Every ${r.interval} ${unit}s`;
  if (r.count) return `${base}, ${r.count}×`;
  if (r.until) return `${base}, until ${r.until}`;
  return base;
}

export interface Occurrence { occurrence_start: string; occurrence_end: string; occurrence_date: string }

/** Normalize a validated recurrence input into a concrete stored rule. Written so it doesn't depend
 *  on how zod happens to infer optionality across dependency versions (`freq` is always present at
 *  runtime — the schema requires it — and interval defaults to 1). */
function normalizeRule(r: { freq?: RecurrenceRule["freq"]; interval?: number; count?: number; until?: string }): RecurrenceRule {
  return {
    freq: r.freq!, interval: r.interval ?? 1,
    ...(r.count != null ? { count: r.count } : {}),
    ...(r.until ? { until: r.until } : {}),
  };
}

/**
 * Expand a recurring master into concrete occurrences that fall within [fromISO, toISO]. Pure and
 * deterministic: preserves each occurrence's wall-clock time + duration, honors count/until,
 * skips explicitly-cancelled exdates, skips invalid monthly days, and is hard-capped so a malformed
 * open-ended rule can never loop unbounded.
 */
export function expandRecurrence(
  master: Pick<EventData, "start_at" | "end_at" | "recurrence" | "exdates">,
  fromISO: string | undefined, toISO: string | undefined, cap = 366,
): Occurrence[] {
  const r = master.recurrence;
  if (!r || r.interval < 1) return [];
  const first = new Date(master.start_at);
  if (Number.isNaN(first.getTime())) return [];
  const durationMs = Math.max(0, new Date(master.end_at).getTime() - first.getTime());
  // A date-only bound ("2026-07-04") covers the WHOLE day — start-of-day for `from`, end-of-day for
  // `to` — so a same-day occurrence with a time-of-day isn't clipped off the edge of the window.
  const windowStart = fromISO ? new Date(fromISO.includes("T") ? fromISO : `${fromISO}T00:00:00`) : null;
  // Default a 90-day forward window when the caller gives no upper bound (keeps the list finite).
  const windowEnd = toISO
    ? new Date(toISO.includes("T") ? toISO : `${toISO}T23:59:59`)
    : new Date(first.getTime() + 90 * 86_400_000 + (windowStart ? Math.max(0, windowStart.getTime() - first.getTime()) : 0));
  const untilEnd = r.until ? new Date(`${r.until}T23:59`) : null;
  const exdates = new Set(master.exdates ?? []);

  const out: Occurrence[] = [];
  const day = first.getDate();
  for (let i = 0, emitted = 0; i < cap; i++) {
    if (r.count && emitted >= r.count) break;
    const d = new Date(first);
    if (r.freq === "daily") d.setDate(first.getDate() + i * r.interval);
    else if (r.freq === "weekly") d.setDate(first.getDate() + i * r.interval * 7);
    else { d.setDate(1); d.setMonth(first.getMonth() + i * r.interval); if (daysInMonth(d) < day) continue; d.setDate(day); }
    emitted++;                                   // counts toward `count` even if outside the window
    if (untilEnd && d > untilEnd) break;
    if (d > windowEnd) break;
    if (windowStart && d.getTime() + durationMs < windowStart.getTime()) continue;  // ended before window
    const key = dateKey(d);
    if (exdates.has(key)) continue;
    out.push({ occurrence_start: fmtLocal(d), occurrence_end: fmtLocal(new Date(d.getTime() + durationMs)), occurrence_date: key });
  }
  return out;
}
function daysInMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }

/** Reschedule to a new start while PRESERVING the meeting's duration (drag-to-move). Pure + tested. */
export function rescheduledDates(oldStart: string, oldEnd: string, newStart: string): { start_at: string; end_at: string } {
  const s = new Date(newStart);
  if (Number.isNaN(s.getTime())) return { start_at: oldStart, end_at: oldEnd };   // reject a bad target, keep as-is
  const dur = Math.max(0, new Date(oldEnd).getTime() - new Date(oldStart).getTime());
  return { start_at: fmtLocal(s), end_at: fmtLocal(new Date(s.getTime() + dur)) };
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
  // Accept an occurrence id (master::date) — series routes operate on the master node.
  const { data } = await supabase.from("nodes").select("id, data, created_by, created_at, updated_at")
    .eq("workspace_id", ws).eq("object_type", "calendar_event").eq("id", baseId(id)).maybeSingle();
  return data ? { ...data, data: (data.data ?? {}) as EventData } : null;
}
const canView = (d: EventData, me: string) => d.organizer_id === me || (d.attendee_ids ?? []).includes(me);
const canManage = (d: EventData, me: string, role: string) => d.organizer_id === me || isWorkspaceAdmin(role);

/** Tally attendee RSVP responses (organizer excluded — they own the meeting, they don't RSVP). */
export function responseCounts(d: Pick<EventData, "attendee_ids" | "responses">): { accepted: number; declined: number; tentative: number; no_response: number } {
  const r = d.responses ?? {};
  const counts = { accepted: 0, declined: 0, tentative: 0, no_response: 0 };
  for (const uid of d.attendee_ids ?? []) {
    const v = r[uid];
    if (v === "accepted" || v === "declined" || v === "tentative") counts[v]++;
    else counts.no_response++;
  }
  return counts;
}

function shape(id: string, d: EventData, dir: Map<string, { name?: string; email?: string }>, createdAt?: string) {
  const responses = d.responses ?? {};
  const person = (uid: string) => { const m = dir.get(uid); return { user_id: uid, name: m?.name || m?.email || "Member", email: m?.email ?? null, response: responses[uid] ?? null }; };
  return {
    id, title: d.title, description: d.description ?? "", start_at: d.start_at, end_at: d.end_at,
    timezone: d.timezone ?? "UTC", location: d.location ?? "", status: d.status ?? "scheduled",
    call_url: d.call_url ?? null, call_room_id: d.call_room_id ?? null,
    guest_waiting_room: (d as { guest_waiting_room?: boolean }).guest_waiting_room ?? false,
    organizer: person(d.organizer_id), attendees: (d.attendee_ids ?? []).map(person),
    recurrence: d.recurrence ?? null,
    recurrence_summary: d.recurrence ? recurrenceSummary(d.recurrence) : null,
    responses, response_counts: responseCounts(d),
    created_at: createdAt,
  };
}

/** Notify attendees (not the actor) about a create/update/cancel. In-app only; deep-links to event.
 *  Attributed to the Meeting Agent (canonical source_agent="meeting") — this is real calendar work,
 *  not a fabricated agent run: the notification only exists because a user actually created/changed
 *  a meeting. No agent_job_id is set (there is no scheduled job), so nothing implies a "running" agent. */
async function notifyAttendees(ws: string, eventId: string, d: EventData, actor: string, verb: "created" | "updated" | "cancelled") {
  const targets = [...new Set([d.organizer_id, ...(d.attendee_ids ?? [])])].filter((u) => u && u !== actor);
  await Promise.all(targets.map((uid) => createNotification({
    workspace_id: ws, user_id: uid, type: "calendar",
    title: `Meeting ${verb}: ${d.title}`,
    body: verb === "cancelled" ? "This meeting was cancelled." : `${new Date(d.start_at).toUTCString()}`,
    source: { source_agent: "meeting", node_id: eventId, object_type: "calendar_event", route: `/calendar?event=${eventId}` },
    metadata: { event_id: eventId },
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
  recurrence: z.object({
    freq: z.enum(["daily", "weekly", "monthly"]),
    interval: z.number().int().min(1).max(30).default(1),
    count: z.number().int().min(1).max(365).optional(),
    until: z.string().max(10).optional(),
  }).nullable().optional(),
});

// Reject inverted times (end before/at start) only when both parse to real dates — leaves
// all-day/date-only inputs untouched. Prevents malformed events that render off-grid. Applied on
// CREATE only; PATCH keeps EventInput.partial() (a plain object supports .partial()/.shape).
const endAfterStart = (d: { start_at?: string; end_at?: string }) => {
  if (!d.start_at || !d.end_at) return true;
  const s = Date.parse(d.start_at), e = Date.parse(d.end_at);
  return !(Number.isFinite(s) && Number.isFinite(e)) || e > s;
};
const EventCreate = EventInput.refine(endAfterStart, { message: "end_at must be after start_at", path: ["end_at"] });

// GET /calendar/events?from=&to= — the caller's events (organizer OR attendee), workspace-scoped.
router.get("/events", async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const from = c.req.query("from"); const to = c.req.query("to");
  // Windowed non-recurring events, PLUS every recurring master (its start may predate the window,
  // yet its occurrences fall inside it — so masters are fetched unfiltered and expanded in code).
  let q = supabase.from("nodes").select("id, data, created_at").eq("workspace_id", ws).eq("object_type", "calendar_event").is("data->recurrence", null);
  if (from) q = q.gte("data->>start_at", from);
  if (to) q = q.lte("data->>start_at", to);
  const [winRes, recRes] = await Promise.all([
    q.order("data->>start_at", { ascending: true }).limit(500),
    supabase.from("nodes").select("id, data, created_at").eq("workspace_id", ws).eq("object_type", "calendar_event").not("data->recurrence", "is", null).limit(200),
  ]);
  const dir = await members(ws);

  const single = (winRes.data ?? [])
    .map((n) => ({ id: n.id, d: (n.data ?? {}) as EventData, created_at: n.created_at }))
    .filter((e) => canView(e.d, me))
    .map((e) => shape(e.id, e.d, dir, e.created_at));

  // Expand each recurring series into concrete, in-window occurrences (skipping cancelled series
  // and individually-cancelled dates). Each occurrence carries its master id so the UI can act on it.
  const recurring = (recRes.data ?? [])
    .map((n) => ({ id: n.id, d: (n.data ?? {}) as EventData, created_at: n.created_at }))
    .filter((e) => canView(e.d, me) && e.d.status !== "cancelled" && e.d.recurrence)
    .flatMap((e) => expandRecurrence(e.d, from, to).map((occ) => ({
      ...shape(occurrenceId(e.id, occ.occurrence_date), { ...e.d, start_at: occ.occurrence_start, end_at: occ.occurrence_end }, dir, e.created_at),
      recurring: true, master_id: e.id, occurrence_date: occ.occurrence_date,
    })));

  const events = [...single, ...recurring].sort((a, b) => a.start_at.localeCompare(b.start_at));
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
router.post("/events", zValidator("json", EventCreate), async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const b = c.req.valid("json");
  // SECURITY: attendees MUST be members of this workspace — never trust arbitrary user_ids, or a
  // foreign user named as an attendee would gain event-read + call-join access (canView) in this tenant.
  const memberSet = new Set((await members(ws)).keys());
  const attendees = [...new Set((b.attendee_ids ?? []).filter((a) => a && a !== me && memberSet.has(a)))];
  const now = new Date().toISOString();
  const data: EventData = {
    title: b.title, description: b.description ?? "", start_at: b.start_at, end_at: b.end_at,
    timezone: b.timezone ?? "UTC", organizer_id: me, attendee_ids: attendees, location: b.location ?? "",
    call_room_id: null, call_url: null, status: "scheduled",
    ...(b.recurrence ? { recurrence: normalizeRule(b.recurrence), exdates: [] } : {}),
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
  // SECURITY: same membership check as create — attendees must belong to this workspace.
  let nextAttendees: string[] | undefined;
  if (b.attendee_ids !== undefined) {
    const memberSet = new Set((await members(ws)).keys());
    nextAttendees = [...new Set(b.attendee_ids.filter((a) => a && a !== ev.data.organizer_id && memberSet.has(a)))];
  }
  const next: EventData = {
    ...ev.data,
    ...(b.title !== undefined ? { title: b.title } : {}),
    ...(b.description !== undefined ? { description: b.description } : {}),
    ...(b.start_at !== undefined ? { start_at: b.start_at } : {}),
    ...(b.end_at !== undefined ? { end_at: b.end_at } : {}),
    ...(b.timezone !== undefined ? { timezone: b.timezone } : {}),
    ...(b.location !== undefined ? { location: b.location } : {}),
    ...(nextAttendees !== undefined ? { attendee_ids: nextAttendees } : {}),
    ...(b.status !== undefined ? { status: b.status } : {}),
    // Editing the series' recurrence (null clears it). Edits always apply to the whole series.
    ...(b.recurrence !== undefined ? { recurrence: b.recurrence ? normalizeRule(b.recurrence) : null } : {}),
  };
  const { error } = await supabase.from("nodes").update({ data: next }).eq("workspace_id", ws).eq("id", ev.id).eq("object_type", "calendar_event");
  if (error) return c.json({ error: "Could not update the meeting." }, 500);
  await notifyAttendees(ws, ev.id, next, me, next.status === "cancelled" ? "cancelled" : "updated");
  const dir = await members(ws);
  return c.json(shape(ev.id, next, dir, ev.created_at));
});

// DELETE /calendar/events/:id — CANCEL (soft). Organizer/admin only. For a recurring series,
// `?occurrence=YYYY-MM-DD` cancels JUST that one date (adds an exdate); without it the whole series
// (or a single meeting) is cancelled.
router.delete("/events/:id", async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const ev = await getEvent(ws, c.req.param("id"));
  if (!ev) return c.json({ error: "Event not found." }, 404);
  if (!canManage(ev.data, me, c.get("role"))) return c.json({ error: "Only the organizer or an admin can cancel this." }, 403);

  const occurrence = c.req.query("occurrence");
  if (occurrence && ev.data.recurrence) {
    const exdates = [...new Set([...(ev.data.exdates ?? []), occurrence])];
    const next: EventData = { ...ev.data, exdates };
    const { error } = await supabase.from("nodes").update({ data: next }).eq("workspace_id", ws).eq("id", ev.id).eq("object_type", "calendar_event");
    if (error) return c.json({ error: "Could not cancel this occurrence." }, 500);
    await notifyAttendees(ws, ev.id, ev.data, me, "cancelled");
    return c.json({ ok: true, occurrence_cancelled: occurrence });
  }

  const next: EventData = { ...ev.data, status: "cancelled" };
  const { error } = await supabase.from("nodes").update({ data: next }).eq("workspace_id", ws).eq("id", ev.id).eq("object_type", "calendar_event");
  if (error) return c.json({ error: "Could not cancel the meeting." }, 500);
  await notifyAttendees(ws, ev.id, next, me, "cancelled");
  return c.json({ ok: true, status: "cancelled" });
});

// POST /calendar/events/:id/reschedule — drag-to-move. Organizer/admin only; preserves duration and
// notifies attendees. Not for a single occurrence of a series (the id must be a real event node).
router.post("/events/:id/reschedule", zValidator("json", z.object({ start_at: z.string().min(1) })), async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  if (c.req.param("id").includes("::")) return c.json({ error: "Reschedule a recurring meeting from its series, not a single occurrence." }, 400);
  const ev = await getEvent(ws, c.req.param("id"));
  if (!ev) return c.json({ error: "Event not found." }, 404);
  if (!canManage(ev.data, me, c.get("role"))) return c.json({ error: "Only the organizer or an admin can reschedule this." }, 403);
  if (ev.data.status === "cancelled") return c.json({ error: "This meeting was cancelled." }, 409);
  const next: EventData = { ...ev.data, ...rescheduledDates(ev.data.start_at, ev.data.end_at, c.req.valid("json").start_at) };
  const { error } = await supabase.from("nodes").update({ data: next }).eq("workspace_id", ws).eq("id", ev.id).eq("object_type", "calendar_event");
  if (error) return c.json({ error: "Could not reschedule the meeting." }, 500);
  await notifyAttendees(ws, ev.id, next, me, "updated");
  const dir = await members(ws);
  return c.json(shape(ev.id, next, dir, ev.created_at));
});

// POST /calendar/events/:id/respond — an attendee (or the organizer) RSVPs. Participant-only. The
// organizer is notified of a real response. For a recurring series the response applies to the
// series (per-occurrence RSVP is a future refinement).
router.post("/events/:id/respond", zValidator("json", z.object({ response: z.enum(RSVP_RESPONSES) })), async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const ev = await getEvent(ws, c.req.param("id"));
  if (!ev) return c.json({ error: "Event not found." }, 404);
  if (!canView(ev.data, me)) return c.json({ error: "Not allowed." }, 403);
  if (ev.data.status === "cancelled") return c.json({ error: "This meeting was cancelled." }, 409);
  const response = c.req.valid("json").response;
  const next: EventData = { ...ev.data, responses: { ...(ev.data.responses ?? {}), [me]: response } };
  const { error } = await supabase.from("nodes").update({ data: next }).eq("workspace_id", ws).eq("id", ev.id).eq("object_type", "calendar_event");
  if (error) return c.json({ error: "Could not save your response." }, 500);

  // Notify the organizer (not when the organizer RSVPs to their own meeting).
  if (me !== ev.data.organizer_id) {
    const dir = await members(ws); const meRow = dir.get(me);
    await createNotification({
      workspace_id: ws, user_id: ev.data.organizer_id, type: "calendar",
      title: `${meRow?.name || meRow?.email || "A teammate"} ${response} “${ev.data.title}”`,
      source: { source_agent: "meeting", node_id: ev.id, object_type: "calendar_event", route: `/calendar?event=${ev.id}` },
      metadata: { event_id: ev.id, response },
    }).catch(() => false);
  }
  const dir = await members(ws);
  return c.json(shape(ev.id, next, dir, ev.created_at));
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

// POST /calendar/events/:id/end-call — ORGANIZER/ADMIN ends the meeting for EVERYONE (deletes the
// LiveKit room, disconnecting all participants). Plain "leave" only disconnects yourself; this is the
// host control. Fails closed when calls aren't configured. Idempotent (deleting a gone room is fine).
router.post("/events/:id/end-call", async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const ev = await getEvent(ws, c.req.param("id"));
  if (!ev) return c.json({ error: "Event not found." }, 404);
  if (!canManage(ev.data, me, c.get("role"))) return c.json({ error: "Only the organizer or an admin can end the call for everyone." }, 403);
  if (!callsEnabled()) return c.json({ error: "Calls aren't configured on this workspace.", calls_enabled: false }, 503);
  const room = ev.data.call_room_id || internalRoom(ws, ev.id);
  const ended = await endRoom(room);
  return c.json({ ended });
});

// POST /calendar/events/:id/guest-link — ORGANIZER/ADMIN mints a shareable EXTERNAL guest link. The
// token is SIGNED, event+room-scoped, and expires in 24h — it grants ONLY the ability to join THIS
// one room as a named guest (no account, no workspace or API access). Anyone with the link can join
// until it expires; the host can also "End for all" to force everyone out.
router.post("/events/:id/guest-link", async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const ev = await getEvent(ws, c.req.param("id"));
  if (!ev) return c.json({ error: "Event not found." }, 404);
  if (!canManage(ev.data, me, c.get("role"))) return c.json({ error: "Only the organizer or an admin can create a guest link." }, 403);
  if (!callsEnabled()) return c.json({ error: "Calls aren't configured on this workspace.", calls_enabled: false }, 503);
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) return c.json({ error: "Guest links aren't available right now." }, 503);
  const room = ev.data.call_room_id || internalRoom(ws, ev.id);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 24 * 60 * 60;
  // `epoch` binds the link to the event's current guest-link generation. Revoking (below) bumps the
  // event's epoch, which instantly invalidates every previously-issued link without waiting for exp.
  // `jti` is a unique id for audit/logging (and future per-link revocation).
  const epoch = Number(ev.data.guest_link_epoch ?? 0);
  const jti = randomUUID();
  const token = await sign({ kind: "call_guest", ev: ev.id, ws, room, exp, epoch, jti }, secret, "HS256");
  // Token in the URL fragment (#g=) so it isn't sent to the server in logs/referrers — the SPA reads it.
  return c.json({ url: `${appUrl()}/join/${ev.id}#g=${token}`, expires_at: new Date(exp * 1000).toISOString() });
});

// POST /calendar/events/:id/revoke-guest-links — ORGANIZER/ADMIN invalidates EVERY outstanding guest
// link for this meeting at once (e.g. a link was shared too widely). Bumps the event's guest-link
// epoch; any link minted before this call fails redemption immediately. New links keep working.
router.post("/events/:id/revoke-guest-links", async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const ev = await getEvent(ws, c.req.param("id"));
  if (!ev) return c.json({ error: "Event not found." }, 404);
  if (!canManage(ev.data, me, c.get("role"))) return c.json({ error: "Only the organizer or an admin can revoke guest links." }, 403);
  const nextEpoch = Number(ev.data.guest_link_epoch ?? 0) + 1;
  const { error } = await supabase.from("nodes")
    .update({ data: { ...ev.data, guest_link_epoch: nextEpoch } })
    .eq("workspace_id", ws).eq("object_type", "calendar_event").eq("id", baseId(ev.id));
  if (error) return c.json({ error: "Could not revoke guest links." }, 500);
  return c.json({ ok: true, revoked: true, epoch: nextEpoch });
});

// ── Guest waiting room (Phase 2A) — ORGANIZER/ADMIN only. Waiting requests live as generic nodes
// (object_type "call_waiting_request"), so there is NO schema/migration. ──
const WAITING_OBJECT = "call_waiting_request";
const WAITING_TTL_MS = 30 * 60_000;

// POST /events/:id/waiting-room { enabled } — toggle whether external guests must be admitted by the host.
router.post("/events/:id/waiting-room", zValidator("json", z.object({ enabled: z.boolean() })), async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const ev = await getEvent(ws, c.req.param("id"));
  if (!ev) return c.json({ error: "Event not found." }, 404);
  if (!canManage(ev.data, me, c.get("role"))) return c.json({ error: "Only the organizer or an admin can change the waiting room." }, 403);
  const { enabled } = c.req.valid("json");
  const { error } = await supabase.from("nodes")
    .update({ data: { ...ev.data, guest_waiting_room: enabled } })
    .eq("workspace_id", ws).eq("object_type", "calendar_event").eq("id", baseId(ev.id));
  if (error) return c.json({ error: "Could not update the waiting room." }, 500);
  return c.json({ ok: true, enabled });
});

// GET /events/:id/waiting — the host's live list of guests waiting to be admitted (name + request id only).
router.get("/events/:id/waiting", async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const ev = await getEvent(ws, c.req.param("id"));
  if (!ev) return c.json({ error: "Event not found." }, 404);
  if (!canManage(ev.data, me, c.get("role"))) return c.json({ error: "Only the organizer or an admin can see waiting guests." }, 403);
  const eventId = c.req.param("id");
  const { data } = await supabase.from("nodes")
    .select("id,data").eq("workspace_id", ws).eq("object_type", WAITING_OBJECT).eq("data->>event_id", eventId).eq("data->>status", "waiting");
  const now = Date.now();
  const waiting = (data ?? [])
    .map((n) => n.data as { request_id: string; guest_name: string; created_at: string })
    .filter((d) => now - new Date(d.created_at).getTime() <= WAITING_TTL_MS)   // hide stale requests
    .map((d) => ({ request_id: d.request_id, guest_name: d.guest_name, created_at: d.created_at }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return c.json({ waiting });
});

// POST /events/:id/waiting/:rid/admit|deny — the host's decision (workspace + event scoped).
async function decideWaiting(c: Context<{ Variables: Variables }>, decision: "admitted" | "denied") {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const eventId = c.req.param("id") ?? ""; const rid = c.req.param("rid") ?? "";
  const ev = await getEvent(ws, eventId);
  if (!ev) return c.json({ error: "Event not found." }, 404);
  if (!canManage(ev.data, me, c.get("role"))) return c.json({ error: "Only the organizer or an admin can admit or deny guests." }, 403);
  const { data: node } = await supabase.from("nodes")
    .select("id,data").eq("workspace_id", ws).eq("object_type", WAITING_OBJECT)
    .eq("data->>request_id", rid).eq("data->>event_id", eventId).maybeSingle();
  if (!node) return c.json({ error: "That waiting request is no longer available." }, 404);
  const { error } = await supabase.from("nodes").update({ data: { ...(node.data as object), status: decision } }).eq("id", node.id).eq("workspace_id", ws).eq("object_type", WAITING_OBJECT);
  if (error) return c.json({ error: "Could not update the request." }, 500);
  return c.json({ ok: true, status: decision });
}
router.post("/events/:id/waiting/:rid/admit", (c) => decideWaiting(c, "admitted"));
router.post("/events/:id/waiting/:rid/deny", (c) => decideWaiting(c, "denied"));

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

// ── Smart Calendar intelligence ──────────────────────────────────────────────────────────────────
// Everything below is SOURCE-BACKED: related records are real workspace rows (never invented), and the
// Today brief is computed deterministically from the caller's real events (no fake conflicts/scores).

/** Keyword tokens from a meeting title — used to look up genuinely-related workspace records. */
function tokenize(text: string): string[] {
  const stop = new Set(["the", "and", "for", "with", "meeting", "call", "sync", "weekly", "review", "team", "about", "from", "into", "this", "that", "our"]);
  return [...new Set((text || "").toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [])].filter((w) => w.length >= 4 && !stop.has(w)).slice(0, 6);
}
const orIlike = (col: string, toks: string[]) => toks.map((t) => `${col}.ilike.%${t.replace(/[%,()]/g, "")}%`).join(",");

interface RelatedRow { type: "record" | "task" | "decision"; object_type: string; node_id: string; title: string; match_reason: string }

/**
 * Real workspace rows related to a meeting, found by matching the title keywords (and attendee names)
 * against people/companies, tasks, and open decisions. Every row returned actually exists — this is the
 * SOURCE set the AI is grounded on; the model never adds to it.
 */
async function relatedGraph(ws: string, ev: EventData, dir: Map<string, { name?: string; email?: string }>): Promise<RelatedRow[]> {
  const nameToks = [ev.organizer_id, ...(ev.attendee_ids ?? [])].map((u) => dir.get(u)?.name).filter(Boolean).flatMap((n) => tokenize(String(n)));
  const toks = [...new Set([...tokenize(ev.title), ...nameToks])].slice(0, 8);
  if (toks.length === 0) return [];
  const out: RelatedRow[] = [];
  const [people, tasks, decisions] = await Promise.all([
    supabase.from("nodes").select("id, object_type, data").eq("workspace_id", ws).in("object_type", ["person", "company"]).or(orIlike("data->>name", toks)).limit(5),
    supabase.from("tasks").select("id, title, status").eq("workspace_id", ws).or(orIlike("title", toks)).limit(5),
    supabase.from("decision_queue").select("id, title, status, risk_level").eq("workspace_id", ws).eq("status", "pending").or(orIlike("title", toks)).limit(5),
  ]);
  for (const r of people.data ?? []) out.push({ type: "record", object_type: r.object_type, node_id: r.id, title: (r.data as { name?: string })?.name || "Untitled", match_reason: "name matches meeting" });
  for (const t of tasks.data ?? []) out.push({ type: "task", object_type: "task", node_id: t.id, title: t.title, match_reason: `task · ${t.status || "todo"}` });
  for (const d of decisions.data ?? []) out.push({ type: "decision", object_type: "decision", node_id: d.id, title: d.title, match_reason: `${d.risk_level ?? "open"} decision` });
  return out;
}

// GET /calendar/brief/today — deterministic "today's meeting brief" from the caller's real events.
// No AI, no fabrication: counts, next meeting, real time-overlap conflicts, gaps (no agenda / no call).
router.get("/brief/today", async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const { data } = await supabase.from("nodes").select("id, data").eq("workspace_id", ws).eq("object_type", "calendar_event")
    .gte("data->>start_at", start.toISOString()).lt("data->>start_at", end.toISOString()).order("data->>start_at", { ascending: true }).limit(200);
  const dir = await members(ws);
  const evs = (data ?? []).map((n) => ({ id: n.id, d: (n.data ?? {}) as EventData }))
    .filter((e) => canView(e.d, me) && e.d.status !== "cancelled");

  const nextEv = evs.find((e) => new Date(e.d.end_at || e.d.start_at) >= now);
  // Real overlaps only: two meetings whose [start,end) intervals intersect.
  const conflicts: { a: string; b: string; a_title: string; b_title: string }[] = [];
  for (let i = 0; i < evs.length; i++) for (let j = i + 1; j < evs.length; j++) {
    const ei = evs[i]!, ej = evs[j]!; const a = ei.d, b = ej.d;
    if (new Date(a.start_at) < new Date(b.end_at || b.start_at) && new Date(b.start_at) < new Date(a.end_at || a.start_at))
      conflicts.push({ a: ei.id, b: ej.id, a_title: a.title, b_title: b.title });
  }
  const noAgenda = evs.filter((e) => !(e.d.description ?? "").trim()).map((e) => ({ id: e.id, title: e.d.title }));
  const noCall = callsEnabled() ? evs.filter((e) => !e.d.call_url).map((e) => ({ id: e.id, title: e.d.title })) : [];

  // Suggestions are derived strictly from the facts above (never fabricated).
  const suggestions: string[] = [];
  if (conflicts.length) suggestions.push(`Resolve ${conflicts.length} overlapping meeting${conflicts.length > 1 ? "s" : ""}.`);
  if (noAgenda.length) suggestions.push(`Add an agenda to ${noAgenda.length} meeting${noAgenda.length > 1 ? "s" : ""}.`);
  if (noCall.length) suggestions.push(`Add a call link to ${noCall.length} meeting${noCall.length > 1 ? "s" : ""}.`);

  return c.json({
    count: evs.length,
    next: nextEv ? { id: nextEv.id, title: nextEv.d.title, start_at: nextEv.d.start_at, call_url: nextEv.d.call_url ?? null } : null,
    conflicts, no_agenda: noAgenda, no_call_link: noCall, suggestions, calls_enabled: callsEnabled(),
  });
});

// POST /calendar/events/:id/prepare — "Prepare me for this meeting". Grounds on REAL related workspace
// rows (people/tasks/decisions); the AI only summarizes + suggests talking points/follow-ups from that
// context and never invents sources. Access = organizer/attendee/admin. Degrades cleanly with no AI.
router.post("/events/:id/prepare", async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId"); const role = c.get("role");
  const ev = await getEvent(ws, c.req.param("id"));
  if (!ev) return c.json({ error: "Event not found." }, 404);
  if (!canView(ev.data, me) && !isWorkspaceAdmin(role)) return c.json({ error: "Not allowed." }, 403);
  const dir = await members(ws);
  const shaped = shape(ev.id, ev.data, dir, ev.created_at);
  const sources = await relatedGraph(ws, ev.data, dir);   // real rows only — the grounding set

  const env = gatewayEnv();
  const hasAgenda = !!(ev.data.description ?? "").trim();
  if (!env.baseURL || !env.apiKey) {
    // No AI configured — still return the fully source-backed brief; mark AI parts unavailable (no fake).
    return c.json({ event: shaped, sources, agenda_summary: null, talking_points: [], follow_ups: [], ai_available: false });
  }
  const { data: wsRow } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const settings = (wsRow?.settings ?? {}) as Record<string, unknown>;
  const userLang = (settings.user_preferences as Record<string, { language?: string }> | undefined)?.[me]?.language;
  const lang = normalizeLang(userLang || resolveProfile(settings).language);

  const ctx = [
    `Meeting: ${ev.data.title}`,
    `When: ${ev.data.start_at}`,
    `Attendees: ${[shaped.organizer.name, ...shaped.attendees.map((a) => a.name)].join(", ")}`,
    hasAgenda ? `Agenda:\n${ev.data.description}` : `Agenda: (none set)`,
    sources.length ? `Related workspace records (the ONLY facts you may cite):\n${sources.map((s) => `- [${s.type}] ${s.title} (${s.match_reason})`).join("\n")}` : `Related workspace records: none found.`,
  ].join("\n\n");
  const system = `You prepare a Mondaily user for a meeting. Use ONLY the context provided — never invent people, records, numbers, or facts not present. Respond as strict JSON: {"agenda_summary": string, "talking_points": string[3-5], "follow_ups": string[2-4]}. If the agenda is empty, infer a reasonable focus from the title and related records but keep talking points grounded. No preamble.${languageInstruction(lang)}`;
  try {
    const res = await aiGateway({ system, prompt: ctx, maxTokens: 500, workspaceId: ws, userId: me, feature: "meeting_prep" });
    const txt = (res.text ?? "").trim();
    if (!txt || res.provider === "none") return c.json({ event: shaped, sources, agenda_summary: null, talking_points: [], follow_ups: [], ai_available: false });
    let parsed: { agenda_summary?: string; talking_points?: string[]; follow_ups?: string[] } = {};
    try { parsed = JSON.parse(txt.replace(/^```json?\s*|\s*```$/g, "")); } catch { /* keep empty */ }
    return c.json({
      event: shaped, sources,
      agenda_summary: typeof parsed.agenda_summary === "string" ? parsed.agenda_summary : null,
      talking_points: Array.isArray(parsed.talking_points) ? parsed.talking_points.slice(0, 5).map(String) : [],
      follow_ups: Array.isArray(parsed.follow_ups) ? parsed.follow_ups.slice(0, 4).map(String) : [],
      ai_available: true,
    });
  } catch { return c.json({ event: shaped, sources, agenda_summary: null, talking_points: [], follow_ups: [], ai_available: false }); }
});

// GET /calendar/events/:id/followups — REAL open tasks grouped for this meeting's review panel:
// overdue / due-today / related (title-keyword match) + a clearly-marked SUGGESTED draft (never created
// here). Read-only, workspace-scoped, access = organizer/attendee/admin. No fabricated tasks.
export interface FollowTask { id: string; title: string; due_date: string | null; priority?: string | null }
export function groupFollowUps(tasks: FollowTask[], meetingTitle: string, now: Date): { overdue: FollowTask[]; due_today: FollowTask[]; related: FollowTask[] } {
  const todayStr = now.toDateString();
  const isToday = (d?: string | null) => !!d && new Date(d).toDateString() === todayStr;
  const toks = new Set(tokenize(meetingTitle));
  const relatedIds = new Set(tasks.filter((t) => tokenize(t.title || "").some((w) => toks.has(w))).map((t) => t.id));
  const overdue = tasks.filter((t) => isOverdue(t.due_date, now));
  const due_today = tasks.filter((t) => isToday(t.due_date));
  const seen = new Set([...overdue, ...due_today].map((t) => t.id));   // a task shows in ONE group only
  const related = tasks.filter((t) => relatedIds.has(t.id) && !seen.has(t.id));
  return { overdue, due_today, related };
}

router.get("/events/:id/followups", async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId"); const role = c.get("role");
  const ev = await getEvent(ws, c.req.param("id"));
  if (!ev) return c.json({ error: "Event not found." }, 404);
  if (!canView(ev.data, me) && !isWorkspaceAdmin(role)) return c.json({ error: "Not allowed." }, 403);
  const { data: taskRows } = await supabase.from("tasks").select("id, title, due_date, priority").eq("workspace_id", ws).eq("completed", false).limit(500);
  const tasks: FollowTask[] = (taskRows ?? []).map((t) => ({ id: String(t.id), title: String(t.title ?? ""), due_date: (t.due_date as string | null) ?? null, priority: (t.priority as string | null) ?? null }));
  const g = groupFollowUps(tasks, ev.data.title, new Date());
  return c.json({
    ...g,
    suggested: { title: `Follow up on ${ev.data.title}`, draft: true },   // a template the user may create — NOT inserted
    total_open: tasks.length,
  });
});

export { router as calendarRouter };
