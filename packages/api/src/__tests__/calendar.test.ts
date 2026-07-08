import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EVENT_STATUSES, groupFollowUps, type FollowTask } from "../routes/calendar";
import { buildNotificationPayload, extractSource, categorizeNotification } from "../lib/notify";
import { analyzeMeetings, relatedFollowUps, type MeetingLite } from "../jobs/meeting-agent";

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
    const fn = src.slice(src.indexOf("async function notifyAttendees"), src.indexOf("async function notifyAttendees") + 900);
    expect(fn).toMatch(/\.filter\(\(u\) => u && u !== actor\)/);
    expect(fn).toMatch(/createNotification\(\{[\s\S]*?type: "calendar"/);
    expect(fn).toMatch(/route: `\/calendar\?event=\$\{eventId\}`/);
  });
  it("create + patch + delete all notify attendees", () => {
    expect(src).toMatch(/notifyAttendees\(ws, node\.id, data, me, "created"\)/);
    expect(src).toMatch(/notifyAttendees\(ws, ev\.id, next, me, next\.status === "cancelled" \? "cancelled" : "updated"\)/);
    expect(src).toMatch(/notifyAttendees\(ws, ev\.id, next, me, "cancelled"\)/);
  });
});

describe("Meeting Agent attribution — real calendar notifications (no fabricated runs)", () => {
  const fn = src.slice(src.indexOf("async function notifyAttendees"), src.indexOf("async function notifyAttendees") + 1100);

  it("calendar notifications carry canonical Meeting Agent source metadata", () => {
    // source_agent="meeting" + node_id (event) + object_type="calendar_event" + event route
    expect(fn).toMatch(/source: \{ source_agent: "meeting", node_id: eventId, object_type: "calendar_event", route: `\/calendar\?event=\$\{eventId\}` \}/);
  });

  it("NEVER implies a running/scheduled Meeting Agent job (no agent_job_id, no agent_jobs write)", () => {
    expect(fn).not.toMatch(/agent_job_id/);
    // the whole calendar route registers no scheduled/active Meeting Agent job
    expect(src).not.toMatch(/agent_jobs/);
    expect(src).not.toMatch(/source_agent: "meeting"[\s\S]*?agent_job_id/);
  });

  it("the resolver folds Meeting Agent provenance into a real, deep-linkable notification", () => {
    const payload = buildNotificationPayload({
      workspace_id: "w1", user_id: "u2", type: "calendar", title: "Meeting created: Sync",
      source: { source_agent: "meeting", node_id: "evt_1", object_type: "calendar_event", route: "/calendar?event=evt_1" },
      metadata: { event_id: "evt_1" },
    });
    const md = payload.metadata as Record<string, unknown>;
    expect(md.source_agent).toBe("meeting");
    expect(md.node_id).toBe("evt_1");
    expect(md.object_type).toBe("calendar_event");
    expect(md.route).toBe("/calendar?event=evt_1");
    expect(md.event_id).toBe("evt_1");
    expect(md.agent_job_id).toBeUndefined();            // no fabricated run linkage
  });

  it("categorizes as an agent notification and round-trips the Meeting Agent source", () => {
    const md = { source_agent: "meeting", node_id: "evt_1", object_type: "calendar_event", route: "/calendar?event=evt_1" };
    expect(categorizeNotification({ type: "calendar", metadata: md })).toBe("agent");
    const s = extractSource({ metadata: md });
    expect(s.source_agent).toBe("meeting");             // the bell reads this → "by Meeting Agent"
    expect(s.route).toBe("/calendar?event=evt_1");
    expect(s.object_type).toBe("calendar_event");
    expect(s.agent_job_id).toBeUndefined();
  });

  it("the frontend resolver maps the 'meeting' slug to the Meeting Agent name (bell attribution)", () => {
    const agents = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/lib/agents.ts", import.meta.url)), "utf8");
    const groups = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/lib/notification-groups.ts", import.meta.url)), "utf8");
    expect(agents).toMatch(/meeting:\s*\{ id: "meeting",\s*name: "Meeting Agent"/);
    expect(groups).toMatch(/agentByRaw\(slug\)\.name/);   // actorLabel resolves source_agent via the registry
  });

  it("create / update / call-link / prep behavior is untouched (still wired)", () => {
    expect(src).toMatch(/router\.post\("\/events", zValidator/);            // create
    expect(src).toMatch(/router\.patch\("\/events\/:id"/);                  // update
    expect(src).toMatch(/router\.post\("\/events\/:id\/call-link"/);        // add call link
    expect(src).toMatch(/router\.post\("\/events\/:id\/prepare"/);          // prepare me
    expect(src).toMatch(/router\.post\("\/events\/:id\/call-token"/);       // join flow
  });
});

describe("Meeting Agent — real backend agent (registry + runner + honest status)", () => {
  const agentsSrc = readFileSync(fileURLToPath(new URL("../routes/agents.ts", import.meta.url)), "utf8");
  const runnerSrc = readFileSync(fileURLToPath(new URL("../jobs/meeting-agent.ts", import.meta.url)), "utf8");

  it("is listed in the /agents registry (Agents page + Home constellation + Activity roster)", () => {
    // the GET / handler pushes a real Meeting Agent entry
    expect(agentsSrc).toMatch(/id: "meeting", name: "Meeting Agent", category: "operations"/);
  });
  it("has a real on-demand runner wired to POST /agents/meeting/run", () => {
    expect(agentsSrc).toMatch(/meeting: async \(ws\) => runMeetingAgent\(ws\)/);
    expect(agentsSrc).toMatch(/import \{ runMeetingAgent \} from "\.\.\/jobs\/meeting-agent"/);
  });
  it("never claims a fake 'running'/'active' state without a real running job", () => {
    // state is derived from the real job row; default rest state is "monitoring", not active/running
    expect(agentsSrc).toMatch(/meetingJobRow\?\.status === "running" \? "active" : "monitoring"/);
    // idle label is honest until it actually runs
    expect(agentsSrc).toMatch(/jobSummary\(meetingJobRow, "No runs yet"\)/);
  });
  it("the runner logs real proof-of-work: startJob → structured steps → completeJob", () => {
    expect(runnerSrc).toMatch(/startJob\(\{ workspace_id: workspaceId, agent_name: "meeting"/);
    expect(runnerSrc).toMatch(/step\(`Loaded \$\{a\.active\.length\} meeting\(s\)`/);
    expect(runnerSrc).toMatch(/step\(`Found \$\{a\.conflicts\.length\} conflict\(s\)`/);
    expect(runnerSrc).toMatch(/step\(`Found \$\{a\.missingAgenda\.length\} missing agenda\(s\)`/);
    expect(runnerSrc).toMatch(/step\(`Found \$\{a\.missingCall\.length\} missing call link\(s\)`/);
    expect(runnerSrc).toMatch(/step\(`Found \$\{followUps\.length\} related follow-up\(s\)`/);
    expect(runnerSrc).toMatch(/step\(`Queued \$\{queued\} attention item\(s\)`/);
    expect(runnerSrc).toMatch(/completeJob\(jobId, output, steps\)/);
  });
  it("detects meeting-related open follow-up tasks by shared title keywords (real, not invented)", () => {
    const events: MeetingLite[] = [{ id: "m", title: "Acme onboarding", start_at: "2026-07-06T10:00:00Z" }];
    const tasks = [
      { id: "t1", title: "Send Acme onboarding docs" },   // matches "acme"/"onboarding"
      { id: "t2", title: "Buy milk" },                     // unrelated
    ];
    const r = relatedFollowUps(events, tasks);
    expect(r.map(t => t.id)).toEqual(["t1"]);
    // honest empties: no meetings, or no tasks → no matches (never fabricated)
    expect(relatedFollowUps([], tasks)).toEqual([]);
    expect(relatedFollowUps(events, [])).toEqual([]);
  });
  it("only queues Decision Queue items for REAL conflicts, deduped (no fabricated attention)", () => {
    expect(runnerSrc).toMatch(/for \(const \[x, y\] of a\.conflicts\)/);
    expect(runnerSrc).toMatch(/source_type: "calendar_conflict"/);
    expect(runnerSrc).toMatch(/\.eq\("status", "pending"\)\.maybeSingle\(\)/);   // dedupe existing
  });
  it("an empty / no-meeting workspace yields honest zero-result findings (no invented activity)", () => {
    const r = analyzeMeetings([]);
    expect(r.active).toEqual([]);
    expect(r.conflicts).toEqual([]);
    expect(r.missingAgenda).toEqual([]);
    expect(r.missingCall).toEqual([]);
    expect(relatedFollowUps([], [])).toEqual([]);
    // the step labels are count-driven, so with zero events they read "0 …" (honest, not skipped)
    expect(runnerSrc).toMatch(/step\(`Loaded \$\{a\.active\.length\} meeting\(s\)`/);
    expect(runnerSrc).toMatch(/step\(`Found \$\{a\.conflicts\.length\} conflict\(s\)`/);
    expect(runnerSrc).not.toMatch(/Math\.random/);   // nothing fabricated
  });

  it("detection is real: overlaps by actual time, gaps by real fields, cancelled excluded", () => {
    const evs: MeetingLite[] = [
      { id: "a", title: "A", start_at: "2026-07-06T10:00:00Z", end_at: "2026-07-06T11:00:00Z", description: "agenda", call_url: "x" },
      { id: "b", title: "B", start_at: "2026-07-06T10:30:00Z", end_at: "2026-07-06T11:30:00Z", description: "", call_url: null }, // overlaps A, no agenda, no call
      { id: "c", title: "C", start_at: "2026-07-06T12:00:00Z", end_at: "2026-07-06T12:30:00Z", description: "x", call_url: "y" },  // no overlap
      { id: "d", title: "D", start_at: "2026-07-06T10:15:00Z", end_at: "2026-07-06T10:45:00Z", status: "cancelled" },              // excluded
    ];
    const r = analyzeMeetings(evs);
    expect(r.active.map(e => e.id).sort()).toEqual(["a", "b", "c"]);   // cancelled dropped
    expect(r.conflicts.length).toBe(1);                                // only A×B
    expect(r.conflicts[0]!.map(e => e.id).sort()).toEqual(["a", "b"]);
    expect(r.missingAgenda.map(e => e.id)).toEqual(["b"]);
    expect(r.missingCall.map(e => e.id)).toEqual(["b"]);
  });
  it("no overlap when meetings merely touch (end == next start)", () => {
    const evs: MeetingLite[] = [
      { id: "a", start_at: "2026-07-06T10:00:00Z", end_at: "2026-07-06T11:00:00Z", description: "x", call_url: "x" },
      { id: "b", start_at: "2026-07-06T11:00:00Z", end_at: "2026-07-06T12:00:00Z", description: "x", call_url: "x" },
    ];
    expect(analyzeMeetings(evs).conflicts.length).toBe(0);
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
  it("Today's Brief lists today's meetings as clickable rows that select the meeting", () => {
    // a real per-meeting row (time/title/attendees + agenda/call icons) that opens the review panel
    expect(page).toMatch(/todays\.map\(\(e, i\) =>/);
    expect(page).toMatch(/<button key=\{e\.id\} onClick=\{\(\) => onOpen\(e\.id\)\}/);
    // the strip is fed the real today events + selection, no fabricated meetings
    expect(page).toMatch(/<TodayStrip onOpen=\{openEvent\} selectedId=\{selected\} events=\{events\.filter\(e => isSameDay\(new Date\(e\.start_at\), now\)\)\}/);
    expect(page).toMatch(/const hasAgenda = !!\(e\.description \?\? ""\)\.trim\(\)/);   // agenda status from real field
  });
  it("Today briefing panel is an AI briefing with clickable Next / Needs-attention rows", () => {
    expect(page).toMatch(/t\("cal\.needs_attention"\)/);
    expect(page).toMatch(/attention\.map\(a => \(/);                          // needs-attention rows
    expect(page).toMatch(/onClick=\{\(\) => onOpen\(a\.id\)\}/);              // each opens that meeting to fix it
    expect(page).toMatch(/for \(const x of b\.no_agenda\)/);                  // built from REAL brief gaps
  });
  it("event detail is an AI Meeting Brief with source-backed AI preparation", () => {
    expect(page).toMatch(/t\("cal\.ai_meeting_brief"\)/);   // framed as the AI Meeting Brief
    expect(page).toMatch(/apiClient\.post\(`\/calendar\/events\/\$\{id\}\/prepare`/);
    expect(page).toMatch(/t\("cal\.sources_note"\)/);   // grounding disclosure shown to the user
  });
  it("after-meeting: create follow-up task is REAL; notes/recap stay honest 'Coming soon'", () => {
    expect(page).toMatch(/createTask\.mutate\(`Follow up on \$\{e\.title\}`\)/);   // real task create
    expect(page).toMatch(/apiClient\.post\("\/tasks", \{ title \}\)/);
    expect(page).toMatch(/t\("cal\.coming_soon"\)/);
    expect(page).toMatch(/cursor-not-allowed/);
  });
  it("uses a persistent right-side Meeting Brief (desktop) + drawer (mobile), sharing one body", () => {
    expect(page).toMatch(/function MeetingBriefBody/);
    expect(page).toMatch(/function EventDrawer/);
    // desktop panel is always mounted (hidden on small screens); the drawer is mobile-only
    expect(page).toMatch(/<aside className="hidden lg:block">/);
    expect(page).toMatch(/<div className="lg:hidden"><EventDrawer/);
    // selected meeting → its brief; nothing selected → the Today briefing (panel never sits empty)
    expect(page).toMatch(/openId \? <MeetingBriefBody id=\{openId\} \/> : <TodayBriefingPanel/);
  });
  it("when AI prep finds no records, it says it is based only on the meeting details (no fabrication)", () => {
    expect(page).toMatch(/r\.sources\.length === 0 \?[\s\S]*?t\("cal\.based_on_details"\)/);
  });
});

describe("Smart Calendar — real time grid (rail, hour lines, positioned events)", () => {
  it("has a TimeGrid with a left time rail and horizontal hour lines", () => {
    expect(page).toMatch(/function TimeGrid/);
    expect(page).toMatch(/Time rail/);                                  // labelled rail
    expect(page).toMatch(/String\(h\)\.padStart\(2, "0"\) \+ ":00"|padStart\(2, "0"\)\}:00/);   // hour labels
    expect(page).toMatch(/Horizontal hour lines/);
    expect(page).toMatch(/HOUR_PX/);                                    // pixel-per-hour scale
  });
  it("positions events by time and lays overlaps side-by-side", () => {
    expect(page).toMatch(/function layoutDay/);
    expect(page).toMatch(/top: pl\.top, height: pl\.height/);           // time-positioned blocks
    expect(page).toMatch(/widthPct/);                                   // side-by-side overlap columns
  });
  it("draws a current-time line when today is visible", () => {
    expect(page).toMatch(/Current-time line/);
    expect(page).toMatch(/isToday && nowVisible/);
  });
  it("Today view renders a single-column day timeline; Week renders seven columns", () => {
    expect(page).toMatch(/<TimeGrid days=\{\[anchor\]\}[^>]*single/);
    expect(page).toMatch(/<TimeGrid days=\{anchorWeek\}/);
    expect(page).toMatch(/monday\.setDate\(monday\.getDate\(\) - \(\(monday\.getDay\(\) \+ 6\) % 7\)\)/);   // real Mon–Sun week
  });
  it("always renders a real grid even when empty (subtle in-grid suggestions, not a blank card)", () => {
    expect(page).toMatch(/function GridEmpty/);
    expect(page).toMatch(/dayCount === 0 && <GridEmpty/);
    expect(page).toMatch(/weekCount === 0 && <GridEmpty/);
    expect(page).toMatch(/t\("cal\.suggest_followups"\)/);
    expect(page).toMatch(/t\("cal\.clear_day"\)/);
  });
  it("has Today / prev / next calendar controls", () => {
    expect(page).toMatch(/onClick=\{goToday\}/);
    expect(page).toMatch(/onClick=\{\(\) => shift\(-1\)\}/);
    expect(page).toMatch(/onClick=\{\(\) => shift\(1\)\}/);
    expect(page).toMatch(/\{rangeLabel\}/);
  });
  it("the brief panel never sits empty — shows a Today briefing when nothing is selected", () => {
    expect(page).toMatch(/function TodayBriefingPanel/);
    expect(page).toMatch(/t\("cal\.today_briefing"\)/);
    expect(page).toMatch(/apiClient\.get\("\/calendar\/brief\/today"\)/);   // real brief data, no fabrication
  });
});

describe("Smart Calendar — visible Meeting Agent identity (honest, on-demand)", () => {
  it("shows the Meeting Agent in the calendar header, brief, and prep result", () => {
    expect(page).toMatch(/t\("cal\.meeting_agent"\)/);
    expect(page).toMatch(/t\("cal\.agent_monitoring"\)/);               // header subtitle
    expect(page).toMatch(/t\("cal\.prepared_by"\)/);                    // Meeting Brief attribution
    expect(page).toMatch(/t\("cal\.agent_source"\)/);                   // AI prep result attribution
  });
  it("agent status is honest — available/on-demand, never a fabricated 'running' job", () => {
    expect(page).toMatch(/t\("cal\.agent_available"\)/);
    expect(page).not.toMatch(/Meeting Agent[^"]*running|running[^"]*Meeting Agent/i);
  });
  it("Meeting Agent is registered canonically (name + icon), owning the /calendar section", () => {
    const agents = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/lib/agents.ts", import.meta.url)), "utf8");
    expect(agents).toMatch(/meeting:\s*\{ id: "meeting",\s*name: "Meeting Agent"/);
    expect(agents).toMatch(/\["\/calendar", "meeting"\]/);
  });
});

describe("Calendar UX — click-to-create + review panel + semantic colours", () => {
  it("clicking an empty grid slot opens New Meeting prefilled with the slot time (30-min default)", () => {
    expect(page).toMatch(/const openSlot = \(start: Date\) =>/);
    expect(page).toMatch(/new Date\(start\.getTime\(\) \+ 30 \* 60_000\)/);   // 30-minute default end
    expect(page).toMatch(/<TimeGrid days=\{\[anchor\]\}[^>]*onSlot=\{openSlot\}/);
    expect(page).toMatch(/<TimeGrid days=\{anchorWeek\}[^>]*onSlot=\{openSlot\}/);
    expect(page).toMatch(/initialStart=\{createInit\?\.start\}/);
    // CreateModal seeds its start/end from the prefilled values
    expect(page).toMatch(/useState\(initialStart \?\? ""\)/);
    expect(page).toMatch(/useState\(initialEnd \?\? ""\)/);
  });
  it("clicking an existing meeting opens the review panel (event, not slot)", () => {
    expect(page).toMatch(/onClick=\{\(ev\) => \{ ev\.stopPropagation\(\); onOpen\(pl\.e\.id\); \}\}/);
    expect(page).toMatch(/openId \? <MeetingBriefBody id=\{openId\} \/> : <TodayBriefingPanel/);
  });
  it("review panel carries the required actions (join / prepare / add-edit agenda / create task)", () => {
    expect(page).toMatch(/navigate\(`\/calls\/\$\{e\.id\}`\)/);                 // join call
    expect(page).toMatch(/prepare\.mutate\(\)/);                                // prepare with AI
    expect(page).toMatch(/apiClient\.patch\(`\/calendar\/events\/\$\{id\}`, \{ description: agendaDraft \}\)/);  // add/edit agenda
    expect(page).toMatch(/t\("cal\.edit_agenda"\)/);
    expect(page).toMatch(/t\("cal\.create_task"\)/);
  });
  it("AI Meeting Brief readiness rows are derived from REAL fields only (incl. related + follow-ups)", () => {
    expect(page).toMatch(/t\("cal\.ai_meeting_brief"\)/);
    expect(page).toMatch(/const relN = prepare\.data\?\.sources\.length \?\? 0/);        // related from real prep sources
    expect(page).toMatch(/followTotal > 0/);                                            // follow-ups from real tasks
    expect(page).toMatch(/t\("cal\.st_none_found"\)/);                                  // says what was NOT found
  });
  it("follow-ups are grouped and only suggested is a marked draft", () => {
    expect(page).toMatch(/function FollowUpGroups/);
    expect(page).toMatch(/t\("cal\.overdue"\)/);
    expect(page).toMatch(/t\("cal\.due_today"\)/);
    expect(page).toMatch(/t\("cal\.related_meeting"\)/);
    expect(page).toMatch(/t\("cal\.draft_tag"\)/);
    expect(page).toMatch(/apiClient\.get\(`\/calendar\/events\/\$\{id\}\/followups`\)/);
  });
  it("the meeting colour classifier is deterministic — real fields only, no randomness", () => {
    expect(page).toMatch(/function meetingTone\(e: CalEvent\)/);
    expect(page).not.toMatch(/meetingTone[\s\S]{0,400}Math\.random/);
    // maps by real fields: missing agenda → rose, finance → amber, external → green, else slate
    expect(page).toMatch(/if \(!\(e\.description \?\? ""\)\.trim\(\)\) return TONE\.rose/);
    expect(page).toMatch(/if \(FINANCE_RE\.test\(e\.title\)\) return TONE\.amber/);
    expect(page).toMatch(/if \(EXTERNAL_RE\.test\(e\.title\)\) return TONE\.green/);
    expect(page).toMatch(/return TONE\.slate/);
  });
});

describe("Calendar — grouped follow-ups (real tasks, deterministic)", () => {
  const now = new Date("2026-07-06T12:00:00Z");
  const iso = (s: string) => new Date(s).toISOString();
  const tasks: FollowTask[] = [
    { id: "o", title: "Old thing", due_date: iso("2026-07-01T09:00:00Z") },      // overdue
    { id: "d", title: "Due thing", due_date: iso("2026-07-06T15:00:00Z") },      // due today
    { id: "r", title: "Acme renewal follow-up", due_date: null },                 // related to "Acme onboarding"
    { id: "n", title: "Buy milk", due_date: null },                               // unrelated, no date
  ];
  it("splits tasks into overdue / due-today / related without duplication", () => {
    const g = groupFollowUps(tasks, "Acme onboarding", now);
    expect(g.overdue.map(t => t.id)).toEqual(["o"]);
    expect(g.due_today.map(t => t.id)).toEqual(["d"]);
    expect(g.related.map(t => t.id)).toEqual(["r"]);   // "n" unrelated; dated ones not double-counted
  });
  it("an overdue task that also matches keywords stays in overdue only (single group)", () => {
    const g = groupFollowUps([{ id: "x", title: "Acme overdue", due_date: iso("2026-07-01T09:00:00Z") }], "Acme onboarding", now);
    expect(g.overdue.map(t => t.id)).toEqual(["x"]);
    expect(g.related).toEqual([]);
  });
});

describe("Smart Calendar — Meeting Agent co-pilot readiness (real signals, no fabrication)", () => {
  it("renders a co-pilot readiness panel with agenda / call-link / prep / conflict signals", () => {
    expect(page).toMatch(/function CoPilot/);
    expect(page).toMatch(/t\("cal\.agent_checks"\)/);   // "Meeting Agent checks" strip
    expect(page).toMatch(/<CoPilot signals=\{signals\}/);
    expect(page).toMatch(/t\("cal\.sig_call"\)/);
    expect(page).toMatch(/t\("cal\.sig_prep"\)/);
  });
  it("derives every signal from the meeting's own real fields (never fabricated)", () => {
    expect(page).toMatch(/const hasAgenda = !!\(e\.description \?\? ""\)\.trim\(\)/);   // agenda from real field
    expect(page).toMatch(/e\.call_url \? S\("call"/);                                     // call link from real field
    expect(page).toMatch(/!!prepare\.data/);                                              // prep status from real state
    expect(page).toMatch(/briefQ\.data\?\.conflicts\?\.some\(c => c\.a === id \|\| c\.b === id\)/); // conflict from real brief
  });
  it("suggested next action reuses real, existing actions only (add call / prepare / join)", () => {
    expect(page).toMatch(/label: t\("cal\.add_call"\), run: \(\) => addCall\.mutate\(\)/);
    expect(page).toMatch(/label: t\("cal\.prepare"\), run: \(\) => prepare\.mutate\(\)/);
    expect(page).toMatch(/label: t\("cal\.join_call"\), run: \(\) => navigate\(`\/calls\/\$\{e\.id\}`\)/);
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
