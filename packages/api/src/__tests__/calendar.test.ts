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
  it("every nodes access is scoped by workspace_id + object_type calendar_event", () => {
    let idx = src.indexOf('.from("nodes")');
    let count = 0;
    while (idx !== -1) {
      const w = src.slice(idx, idx + 320);
      expect(w, w.slice(0, 90)).toMatch(/\.eq\("workspace_id", ws\)|workspace_id: ws/);
      expect(w, w.slice(0, 90)).toMatch(/calendar_event/);
      count++;
      idx = src.indexOf('.from("nodes")', idx + 1);
    }
    expect(count).toBeGreaterThan(2);
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

describe("Calendar — event detail opens the native call room", () => {
  it("'Join call' navigates internally to /calls/:eventId (not an external link)", () => {
    expect(page).toMatch(/navigate\(`\/calls\/\$\{e\.id\}`\)/);
    expect(page).not.toMatch(/href=\{e\.call_url\}/);   // no external/new-tab anchor anymore
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
