import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EVENT_STATUSES } from "../routes/calendar";

const src = readFileSync(fileURLToPath(new URL("../routes/calendar.ts", import.meta.url)), "utf8");
const page = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/calendar.tsx", import.meta.url)), "utf8");
const room = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/call-room.tsx", import.meta.url)), "utf8");

describe("Calendar — model + mounting", () => {
  it("has the required statuses", () => {
    expect([...EVENT_STATUSES]).toEqual(["scheduled", "cancelled", "completed"]);
  });
  it("stored as calendar_event nodes (no new table) and mounted at /api/v1/calendar", () => {
    expect(src).toMatch(/object_type: "calendar_event"/);
    const appSrc = readFileSync(fileURLToPath(new URL("../app.ts", import.meta.url)), "utf8");
    expect(appSrc).toMatch(/app\.route\("\/api\/v1\/calendar", calendarRouter\)/);
  });
});

describe("Calendar — workspace isolation", () => {
  it("every nodes access is workspace-scoped, and every calendar_event access is object-typed", () => {
    let idx = src.indexOf('.from("nodes")');
    let calCount = 0;
    while (idx !== -1) {
      const w = src.slice(idx, idx + 320);
      expect(w, w.slice(0, 90)).toMatch(/\.eq\("workspace_id", ws\)|workspace_id: ws/);   // ALWAYS ws-scoped
      // calendar_event rows must additionally be object-typed; the related-records lookup (person/company)
      // is legitimately a different object_type but is still workspace-scoped (asserted above).
      if (/calendar_event/.test(w)) calCount++;
      else expect(w, w.slice(0, 90)).toMatch(/object_type/);   // some explicit object_type filter present
      idx = src.indexOf('.from("nodes")', idx + 1);
    }
    expect(calCount).toBeGreaterThan(2);
  });
  it("the related-records lookup and today brief are workspace-scoped across every table", () => {
    const fn = src.slice(src.indexOf("async function relatedGraph"), src.indexOf("router.get(\"/brief/today\""));
    // people/companies, tasks, and decisions are all scoped to the caller's workspace
    expect((fn.match(/\.eq\("workspace_id", ws\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("Calendar — access rules", () => {
  it("view = organizer OR attendee; GET/:id 403s otherwise", () => {
    expect(src).toMatch(/const canView = \(d: EventData, me: string\) => d\.organizer_id === me \|\| \(d\.attendee_ids \?\? \[\]\)\.includes\(me\)/);
    expect(src).toMatch(/if \(!canView\(ev\.data, me\)\) return c\.json\(.*403\)/);
  });
  it("edit/cancel = organizer OR admin only (canManage guards PATCH + DELETE + call-link)", () => {
    expect(src).toMatch(/const canManage = \(d: EventData, me: string, role: string\) => d\.organizer_id === me \|\| isWorkspaceAdmin\(role\)/);
    const patch = src.slice(src.indexOf('router.patch("/events/:id"'));
    expect(patch).toMatch(/if \(!canManage\(ev\.data, me, c\.get\("role"\)\)\) return c\.json\(.*403\)/);
    const del = src.slice(src.indexOf('router.delete("/events/:id"'));
    expect(del).toMatch(/if \(!canManage\(ev\.data, me, c\.get\("role"\)\)\) return c\.json\(.*403\)/);
  });
  it("the GET /events list filters to the caller's own events (participant-only)", () => {
    expect(src).toMatch(/\.filter\(\(e\) => canView\(e\.d, me\)\)/);
  });
});

describe("Calendar — call links (Mondaily-owned, no fake, fail-closed)", () => {
  it("call link is minted ONLY when LiveKit is configured; else null", () => {
    expect(src).toMatch(/function makeCallLink[\s\S]*?if \(!callsEnabled\(\)\) return null/);
    expect(src).toMatch(/callsEnabled = \(\) => !!\(process\.env\.LIVEKIT_URL && process\.env\.LIVEKIT_API_KEY && process\.env\.LIVEKIT_API_SECRET\)/);
  });
  it("call links are Mondaily-owned path URLs (/calls/:id) — never external providers", () => {
    expect(src).toMatch(/call_url: `\$\{appUrl\(\)\}\/calls\/\$\{eventId\}`/);   // app.mondaily.com/calls/<id>
    expect(src).not.toMatch(/zoom\.us|teams\.microsoft|meet\.google|outlook/i);
  });
  it("never involves an external meeting provider and never exposes engine branding to users", () => {
    const appSrc = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/calendar.tsx", import.meta.url)), "utf8");
    expect(appSrc).not.toMatch(/livekit|zoom|teams|google|outlook/i);   // UI shows only "Mondaily call"
  });
  it("POST /events/:id/call-link returns 503 cleanly when calling isn't configured", () => {
    const fn = src.slice(src.indexOf('router.post("/events/:id/call-link"'));
    expect(fn).toMatch(/if \(!link\) return c\.json\(\{ error: "Calls aren't configured on this workspace\.", calls_enabled: false \}, 503\)/);
  });
  it("create only attaches a link when makeCallLink succeeds (no fake link on create)", () => {
    const fn = src.slice(src.indexOf('router.post("/events"'), src.indexOf('router.patch("/events/:id"'));
    expect(fn).toMatch(/if \(b\.generate_call_link\) \{[\s\S]*?const link = makeCallLink\(ws, node\.id\);[\s\S]*?if \(link\)/);
  });
});

describe("Calendar — notifications to attendees (deep-linked)", () => {
  it("notifies attendees (excluding the actor) with a deep-link route to the event", () => {
    const fn = src.slice(src.indexOf("async function notifyAttendees"), src.indexOf("async function notifyAttendees") + 700);
    expect(fn).toMatch(/\.filter\(\(u\) => u && u !== actor\)/);
    expect(fn).toMatch(/createNotification\(\{[\s\S]*?type: "calendar"/);
    expect(fn).toMatch(/metadata: \{ route: `\/calendar\?event=\$\{eventId\}`/);
  });
  it("create + patch + delete all notify attendees", () => {
    expect(src).toMatch(/notifyAttendees\(ws, node\.id, data, me, "created"\)/);
    expect(src).toMatch(/notifyAttendees\(ws, ev\.id, next, me, next\.status === "cancelled" \? "cancelled" : "updated"\)/);
    expect(src).toMatch(/notifyAttendees\(ws, ev\.id, next, me, "cancelled"\)/);
  });
});

describe("Calendar — AI agenda draft (text only, never creates an event)", () => {
  it("POST /draft-agenda returns agenda text and never inserts a calendar_event", () => {
    const fn = src.slice(src.indexOf('router.post("/draft-agenda"'));
    expect(fn).toMatch(/return c\.json\(\{ agenda \}\)/);
    expect(fn).not.toMatch(/object_type: "calendar_event"/);   // never creates an event
    expect(fn).toMatch(/languageInstruction\(lang\)/);          // language-aware
    expect(fn).toMatch(/if \(!env\.baseURL \|\| !env\.apiKey\) return c\.json\(.*503\)/); // fails closed
  });
  it("the create modal AI draft only fills the agenda field — it does not create the event", () => {
    const fn = page.slice(page.indexOf("async function draftAgenda"), page.indexOf("async function draftAgenda") + 400);
    expect(fn).toMatch(/apiClient\.post<\{ agenda\?: string \}>\("\/calendar\/draft-agenda"/);
    expect(fn).toMatch(/setDesc\(r\.agenda\)/);
    expect(fn).not.toMatch(/create\.mutate|\/calendar\/events"/);   // no auto-create
  });
});

describe("Calls — call room token (server-side, fail-closed, workspace-scoped)", () => {
  const fn = src.slice(src.indexOf('router.post("/events/:id/call-token"'), src.indexOf('router.post("/draft-agenda"'));
  it("mints the join token server-side (never on the client) and returns the engine url + room", () => {
    expect(src).toMatch(/async function mintCallToken/);
    expect(src).toMatch(/import \{ sign \} from "hono\/jwt"/);
    expect(fn).toMatch(/const token = await mintCallToken\(/);
    expect(fn).toMatch(/return c\.json\(\{ token, url: process\.env\.LIVEKIT_URL, room \}\)/);
  });
  it("only organizer, attendee, or workspace admin may get a token; others 403", () => {
    expect(fn).toMatch(/if \(!canView\(ev\.data, me\) && !isWorkspaceAdmin\(role\)\) return c\.json\(.*403\)/);
  });
  it("404s an unknown event and never leaks a token across workspaces (getEvent is ws-scoped)", () => {
    expect(fn).toMatch(/if \(!ev\) return c\.json\(.*404\)/);
    expect(fn).toMatch(/getEvent\(ws, /);
  });
  it("issues NO token when the engine env is missing — clean 503, fail-closed", () => {
    expect(fn).toMatch(/if \(!callsEnabled\(\)\) return c\.json\(\{ error: "Calls aren't configured on this workspace\.", calls_enabled: false \}, 503\)/);
    // the 503 guard must precede the token mint (no fake token can be reached)
    expect(fn.indexOf("callsEnabled()")).toBeLessThan(fn.indexOf("mintCallToken("));
  });
  it("the public room uses the EVENT id while the internal room id stays server-side only", () => {
    expect(src).toMatch(/const internalRoom = \(ws: string, eventId: string\) => `ws_\$\{ws\}__meeting__\$\{eventId\}`/);
    // join room derives from the stored internal id (or is recomputed) — never the public /calls/:id path
    expect(fn).toMatch(/const room = ev\.data\.call_room_id \|\| internalRoom\(ws, ev\.id\)/);
    // the internal room namespace is never surfaced in the client call room
    expect(room).not.toMatch(/__meeting__|ws_\$\{/);
  });
});

describe("Calls — call room page (native, no engine branding, correct access states)", () => {
  it("loads the event by id and dispatches: meeting room, not-allowed, or the call record", () => {
    expect(room).toMatch(/apiClient\.get\(`\/calendar\/events\/\$\{id\}`\)/);
    expect(room).toMatch(/if \(\/not allowed\/i\.test\(msg\)\) return <NotAllowed \/>/);
    expect(room).toMatch(/return <CallDetailPage \/>/);   // non-breaking fallback for call records
  });
  it("requests the join token from the server (client never signs) and connects via the engine", () => {
    expect(room).toMatch(/apiClient\.post<[^>]*>\(`\/calendar\/events\/\$\{event\.id\}\/call-token`/);
    expect(room).toMatch(/await room\.connect\(url, token\)/);
  });
  it("shows a clean not-configured state when calls are off (no join possible)", () => {
    expect(room).toMatch(/!event\.calls_enabled \?/);
    expect(room).toMatch(/t\("cal\.calls_off"\)/);
  });
  it("never exposes the underlying engine or any external provider brand to users", () => {
    // The engine npm package is imported in code (unavoidable); what must never appear is the
    // engine/provider name in anything the user sees. Strip the package-specifier lines, then assert.
    const visible = room.split("\n").filter((l) => !/["']livekit-client["']/.test(l)).join("\n");
    expect(visible).not.toMatch(/livekit|zoom|teams|google meet|outlook|meet\.google/i);
  });
  it("the /calls/:id route renders the dispatcher (event id in the public URL)", () => {
    const app = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/App.tsx", import.meta.url)), "utf8");
    expect(app).toMatch(/<Route path="calls\/:id" element=\{<CallRoomDispatch \/>\} \/>/);
  });
});

describe("Calls — in-call UI polish (named tiles, controls, screen share, no branding)", () => {
  it("renders named participant tiles with initials placeholders when there's no video", () => {
    expect(room).toMatch(/function ParticipantTile/);
    expect(room).toMatch(/function initialsOf/);
    expect(room).toMatch(/\{initialsOf\(name\)\}/);            // initials shown when hasVideo is false
    expect(room).toMatch(/\{name\}</);                        // the participant's name is rendered
  });
  it("clearly marks the local user's own tile", () => {
    expect(room).toMatch(/isLocal &&[\s\S]*?youLabel/);
    expect(room).toMatch(/t\("cal\.you"\)/);
  });
  it("highlights the active speaker when the client SDK reports it", () => {
    expect(room).toMatch(/ActiveSpeakersChanged/);
    expect(room).toMatch(/speaking \? "2px solid var\(--section-accent\)"/);
  });
  it("has mute, camera, and leave controls in the toolbar", () => {
    expect(room).toMatch(/onClick=\{toggleMic\}/);
    expect(room).toMatch(/onClick=\{toggleCam\}/);
    expect(room).toMatch(/onClick=\{leave\}/);
    expect(room).toMatch(/setMicrophoneEnabled/);
    expect(room).toMatch(/setCameraEnabled/);
  });
  it("supports screen share and device selection via the client SDK (non-breaking extras)", () => {
    expect(room).toMatch(/setScreenShareEnabled/);
    expect(room).toMatch(/switchActiveDevice\(kind, deviceId\)/);
    expect(room).toMatch(/switchDevice\(kind === "audio" \? "audioinput" : "videoinput", e\.target\.value\)/);
  });
  it("still shows no engine/provider branding anywhere the user can see", () => {
    const visible = room.split("\n").filter((l) => !/["']livekit-client["']/.test(l)).join("\n");
    expect(visible).not.toMatch(/livekit|zoom|teams|google meet|outlook|meet\.google/i);
  });
});

describe("Calendar — event detail opens the native call room", () => {
  it("'Join call' navigates internally to /calls/:eventId (not an external link)", () => {
    expect(page).toMatch(/navigate\(`\/calls\/\$\{e\.id\}`\)/);
    expect(page).not.toMatch(/href=\{e\.call_url\}/);   // no external/new-tab anchor anymore
  });
});

describe("Smart Calendar — Today brief (deterministic, real data, no fabrication)", () => {
  const fn = src.slice(src.indexOf('router.get("/brief/today"'), src.indexOf("// POST /calendar/events/:id/prepare"));
  it("reads only the caller's real events for today (workspace + participant scoped)", () => {
    expect(fn).toMatch(/\.eq\("workspace_id", ws\)\.eq\("object_type", "calendar_event"\)/);
    expect(fn).toMatch(/\.filter\(\(e\) => canView\(e\.d, me\) && e\.d\.status !== "cancelled"\)/);
  });
  it("detects overlaps from actual start/end intervals — never a fake/random conflict", () => {
    expect(fn).toMatch(/new Date\(a\.start_at\) < new Date\(b\.end_at \|\| b\.start_at\) && new Date\(b\.start_at\) < new Date\(a\.end_at \|\| a\.start_at\)/);
    expect(fn).not.toMatch(/Math\.random/);
  });
  it("derives no-agenda and no-call-link gaps from real fields (call gap only when calls are on)", () => {
    expect(fn).toMatch(/const noAgenda = evs\.filter\(\(e\) => !\(e\.d\.description \?\? ""\)\.trim\(\)\)/);
    expect(fn).toMatch(/const noCall = callsEnabled\(\) \? evs\.filter\(\(e\) => !e\.d\.call_url\)/);
  });
  it("suggestions are built strictly from those facts (no invented advice)", () => {
    expect(fn).toMatch(/if \(conflicts\.length\) suggestions\.push/);
    expect(fn).toMatch(/if \(noAgenda\.length\) suggestions\.push/);
    expect(fn).toMatch(/if \(noCall\.length\) suggestions\.push/);
  });
});

describe("Smart Calendar — AI meeting prep (source-backed, never fabricates)", () => {
  const fn = src.slice(src.indexOf('router.post("/events/:id/prepare"'), src.indexOf("export { router as calendarRouter }"));
  it("access = organizer / attendee / admin; others 403", () => {
    expect(fn).toMatch(/if \(!canView\(ev\.data, me\) && !isWorkspaceAdmin\(role\)\) return c\.json\(.*403\)/);
  });
  it("sources come ONLY from real workspace rows (relatedGraph), never from the model output", () => {
    expect(fn).toMatch(/const sources = await relatedGraph\(ws, ev\.data, dir\)/);
    // the parsed model output is used ONLY for summary/talking points/follow-ups — NOT for sources
    const parsedUse = fn.slice(fn.indexOf("JSON.parse"));
    expect(parsedUse).not.toMatch(/sources[\s]*[:=][\s]*parsed/);
    expect(parsedUse).toMatch(/event: shaped, sources,/);   // sources echoed straight from the DB set
  });
  it("the prompt forbids inventing facts/sources", () => {
    expect(fn).toMatch(/never invent/i);
    expect(fn).toMatch(/Use ONLY the context provided/);
  });
  it("degrades cleanly when AI is unavailable — real sources kept, ai_available:false, no fake output", () => {
    expect(fn).toMatch(/if \(!env\.baseURL \|\| !env\.apiKey\)[\s\S]*?agenda_summary: null, talking_points: \[\], follow_ups: \[\], ai_available: false/);
  });
  it("relatedGraph builds rows only from query results (people/tasks/decisions), not from AI", () => {
    const rg = src.slice(src.indexOf("async function relatedGraph"), src.indexOf('router.get("/brief/today"'));
    expect(rg).toMatch(/for \(const r of people\.data \?\? \[\]\) out\.push/);
    expect(rg).toMatch(/for \(const t of tasks\.data \?\? \[\]\) out\.push/);
    expect(rg).toMatch(/for \(const d of decisions\.data \?\? \[\]\) out\.push/);
    expect(rg).not.toMatch(/aiGateway|gatewayEnv/);   // grounding set never touches the model
  });
});

describe("Smart Calendar UI — command-center layout", () => {
  it("has Today / Week / Upcoming view modes", () => {
    expect(page).toMatch(/type ViewMode = "today" \| "week" \| "upcoming"/);
    expect(page).toMatch(/t\("cal\.view_today"\)/);
    expect(page).toMatch(/t\("cal\.view_week"\)/);
    expect(page).toMatch(/t\("cal\.view_upcoming"\)/);
  });
  it("renders a Today intelligence strip fed by the real brief endpoint", () => {
    expect(page).toMatch(/function TodayStrip/);
    expect(page).toMatch(/apiClient\.get\("\/calendar\/brief\/today"\)/);
  });
  it("event detail is a Meeting Brief with source-backed AI preparation", () => {
    expect(page).toMatch(/t\("cal\.meeting_brief"\)/);
    expect(page).toMatch(/apiClient\.post\(`\/calendar\/events\/\$\{id\}\/prepare`/);
    expect(page).toMatch(/t\("cal\.sources_note"\)/);   // grounding disclosure shown to the user
  });
  it("after-meeting actions are clearly marked not-ready (no fake completion)", () => {
    expect(page).toMatch(/t\("cal\.coming_soon"\)/);
    expect(page).toMatch(/cursor-not-allowed/);
  });
  it("uses a persistent right-side Meeting Brief (desktop) + drawer (mobile), sharing one body", () => {
    expect(page).toMatch(/function MeetingBriefBody/);
    expect(page).toMatch(/function EventDrawer/);
    // desktop panel is always mounted (hidden on small screens); the drawer is mobile-only
    expect(page).toMatch(/<aside className="hidden lg:block">/);
    expect(page).toMatch(/<div className="lg:hidden"><EventDrawer/);
    // the brief tracks the selected meeting, else the next upcoming one
    expect(page).toMatch(/const briefId = openId \?\? nextEvent\?\.id \?\? null/);
  });
  it("when AI prep finds no records, it says it is based only on the meeting details (no fabrication)", () => {
    expect(page).toMatch(/r\.sources\.length === 0 \?[\s\S]*?t\("cal\.based_on_details"\)/);
  });
});

describe("Calendar UI — page behavior", () => {
  it("has a create modal, attendee picker (excludes self), and a call-link toggle gated on calls_enabled", () => {
    expect(page).toMatch(/function CreateModal/);
    expect(page).toMatch(/m\.id !== me\.userId/);
    expect(page).toMatch(/disabled=\{!callsEnabled\}/);   // toggle disabled + note when calls off
    expect(page).toMatch(/t\("cal\.calls_off"\)/);
  });
  it("meeting title/description are rendered verbatim (never translated)", () => {
    expect(page).toMatch(/\{e\.title\}/);
    expect(page).toMatch(/whitespace-pre-wrap[^>]*>\{e\.description\}/);
  });
});
