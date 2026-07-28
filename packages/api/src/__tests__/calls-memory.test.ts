import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { callMemory, eventMemory, isPastEvent } from "../routes/calls";

const src = readFileSync(fileURLToPath(new URL("../routes/calls.ts", import.meta.url)), "utf8");
const list = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/calls.tsx", import.meta.url)), "utf8");
const room = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/call-room.tsx", import.meta.url)), "utf8");

// A minimal normalized-call shape (what callMemory reads).
const call = (over: Record<string, unknown> = {}) => ({
  id: "c1", contact_name: "Jane at Acme", company_name: "Acme", occurred_at: "2026-07-01T10:00:00Z",
  participants: [{ name: "Jane" }, { name: "Me" }], ai_summary: "", transcript: [] as unknown[], action_items: [] as unknown[],
  ...over,
}) as unknown as Parameters<typeof callMemory>[0];

describe("Meeting Memory — honest status derivation (no fabricated transcript/summary)", () => {
  it("a call record with no transcript/summary reads unavailable / none — never faked", () => {
    const m = callMemory(call());
    expect(m.source).toBe("call_record");
    expect(m.transcript_status).toBe("unavailable");
    expect(m.summary_status).toBe("none");
    expect(m.can_summarize).toBe(false);
    expect(m.href).toBe("/calls/c1");
  });
  it("a call record with a transcript can be summarized; a real summary reads 'generated'", () => {
    expect(callMemory(call({ transcript: [{ text: "hi" }] })).transcript_status).toBe("available");
    expect(callMemory(call({ transcript: [{ text: "hi" }] })).summary_status).toBe("pending");   // has content, not summarized
    expect(callMemory(call({ ai_summary: "done" })).summary_status).toBe("generated");
    expect(callMemory(call({ action_items: [1, 2, 3] })).action_item_count).toBe(3);
  });

  it("a calendar-event memory NEVER claims a transcript (no recording yet)", () => {
    const withAgenda = eventMemory("e1", { title: "Sync", start_at: "2026-07-01T09:00:00Z", description: "1. topic" }, new Date());
    expect(withAgenda.source).toBe("calendar");
    expect(withAgenda.transcript_status).toBe("unavailable");   // honest — no recording captured
    expect(withAgenda.summary_status).toBe("pending");          // can summarize from the agenda
    expect(withAgenda.can_summarize).toBe(true);
    expect(withAgenda.action_item_count).toBe(0);
    const noAgenda = eventMemory("e2", { title: "Quick chat", start_at: "2026-07-01T09:00:00Z" }, new Date());
    expect(noAgenda.summary_status).toBe("none");
    expect(noAgenda.can_summarize).toBe(false);                 // nothing to summarize → refuse
  });

  it("reflects PERSISTED transcript intelligence — saved intel → summary 'generated' + real action-item count", () => {
    // AI insights were generated from the saved live transcript and persisted under data.transcript_intel[id].
    const withIntel = eventMemory("e3", {
      title: "Roadmap sync", start_at: "2026-07-01T09:00:00Z",
      transcript_intel: { e3: { action_items: [{ text: "Book review" }, { text: "Send pricing" }] } },
    }, new Date());
    expect(withIntel.summary_status).toBe("generated");         // honest: real saved intel, not agenda-pending
    expect(withIntel.action_item_count).toBe(2);
    // intel keyed under a DIFFERENT event id must NOT leak into this row
    const otherKey = eventMemory("e4", { title: "Other", start_at: "2026-07-01T09:00:00Z", transcript_intel: { e3: { action_items: [{ text: "x" }] } } }, new Date());
    expect(otherKey.summary_status).toBe("none");
    expect(otherKey.action_item_count).toBe(0);
  });

  it("only PAST/completed events are memories — future & cancelled are excluded", () => {
    const now = new Date("2026-07-06T12:00:00Z");
    expect(isPastEvent({ start_at: "2026-07-01T09:00:00Z", end_at: "2026-07-01T10:00:00Z" }, now)).toBe(true);   // past
    expect(isPastEvent({ status: "completed", start_at: "2026-08-01T09:00:00Z", end_at: "2026-08-01T10:00:00Z" }, now)).toBe(true); // completed
    expect(isPastEvent({ start_at: "2026-08-01T09:00:00Z", end_at: "2026-08-01T10:00:00Z" }, now)).toBe(false);  // future
    expect(isPastEvent({ status: "cancelled", start_at: "2026-07-01T09:00:00Z", end_at: "2026-07-01T10:00:00Z" }, now)).toBe(false); // cancelled
  });
});

describe("Meeting Memory — endpoint combines both sources, workspace-scoped", () => {
  const fn = src.slice(src.indexOf('router.get("/memory"'), src.indexOf('router.get("/:id"'));
  it("queries BOTH call records and calendar events, each scoped to the workspace", () => {
    expect(fn).toMatch(/\.eq\("workspace_id", ws\)\.eq\("vertical", "sales"\)\.eq\("object_type", "call"\)/);
    expect(fn).toMatch(/\.eq\("workspace_id", ws\)\.eq\("object_type", "calendar_event"\)/);
  });
  it("combines the two into one memories list, participant-scoped + past-only for events", () => {
    expect(fn).toMatch(/canView\(e\.d\) && isPastEvent\(e\.d, now\)/);
    expect(fn).toMatch(/\[\.\.\.eventItems, \.\.\.callItems\]/);
  });
  it("search covers title/people/summary/transcript (server-side corpus)", () => {
    expect(fn).toMatch(/it\.corpus\.includes\(search\)/);
    expect(fn).toMatch(/n\.transcript\.map/);   // transcript text is part of the corpus
  });
  it("is registered BEFORE /:id so 'memory' isn't captured as an id", () => {
    expect(src.indexOf('router.get("/memory"')).toBeLessThan(src.indexOf('router.get("/:id"'));
  });
  it("does not remove the legacy call list or record-detail endpoints", () => {
    expect(src).toMatch(/router\.get\("\/",/);        // legacy list
    expect(src).toMatch(/router\.get\("\/:id",/);     // legacy record detail
    expect(src).toMatch(/router\.post\("\/:id\/analyze"/);
  });
});

describe("Meeting Memory — page + dispatcher (design, honesty, non-breaking)", () => {
  it("the /calls page is Meeting Memory with tabs + search over the combined endpoint", () => {
    expect(list).toMatch(/Meeting Memory/);
    expect(list).toMatch(/apiClient\.get<\{ memories: MemoryRow\[\] \}>\(`\/calls\/memory\?search=/);
    for (const label of ["All", "Meetings", "Calls", "Needs summary", "Action items"]) expect(list).toContain(label);
    // honest GUIDED empty state — same facts, now with real next actions; no Chrome-extension pitch
    expect(list).toMatch(/Completed calendar meetings and recorded calls land here/);
    expect(list).not.toMatch(/Chrome extension/i);
  });
  it("live /calls/:eventId still opens the live room for upcoming meetings; past → memory detail", () => {
    expect(room).toMatch(/return past \? <MeetingMemoryDetail event=\{e\} \/> : <CallRoom event=\{e\} \/>/);
    expect(room).toMatch(/function MeetingMemoryDetail/);
    // old call record detail is still the fallback
    expect(room).toMatch(/return <CallDetailPage \/>/);
  });
  it("memory detail refuses AI summary without agenda/notes (no fake transcript)", () => {
    expect(room).toMatch(/Not enough recorded content yet/);
    expect(room).toMatch(/Transcript unavailable/);
    expect(room).toMatch(/apiClient\.post\(`\/calendar\/events\/\$\{e\.id\}\/prepare`/);   // summary grounded on agenda
  });
});
