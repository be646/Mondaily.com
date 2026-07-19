import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MEETING_TYPES, DEFAULT_MEETING_TYPE, normalizeMeetingType, isMeetingType,
  MEETING_TYPE_META, guestSafeMeetingLabel,
  MEETING_TYPE_SECTIONS, summarySectionsGuidance,
} from "@mondaily/shared/meeting-types";

/**
 * Meeting Types Phase 1 — a stored classification label + human copy. NO AI behaviour is wired to it
 * yet. Stored in event node data (no migration); default general; old events without a type render as
 * general; guests only ever see a safe label.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const calendar = read("../routes/calendar.ts");
const calls = read("../routes/calls.ts");
const guest = read("../routes/guest-calls.ts");
const memory = read("../jobs/meeting-memory.ts");
const calendarUi = read("../../../../apps/app/src/routes/dashboard/calendar.tsx");
const callRoomUi = read("../../../../apps/app/src/routes/dashboard/call-room.tsx");
const callDetailUi = read("../../../../apps/app/src/routes/dashboard/call-detail.tsx");
const guestUi = read("../../../../apps/app/src/routes/guest-call.tsx");

describe("meeting-types registry — the 10 supported types, default general, honest labels", () => {
  it("exposes exactly the 10 required types with general as default", () => {
    expect([...MEETING_TYPES]).toEqual([
      "general", "sales", "support", "hiring_interview", "internal_sync",
      "client_review", "onboarding", "training", "legal_or_compliance", "finance_review",
    ]);
    expect(DEFAULT_MEETING_TYPE).toBe("general");
  });
  it("normalizeMeetingType maps absent/unknown/legacy → general (old events preserved)", () => {
    expect(normalizeMeetingType(undefined)).toBe("general");
    expect(normalizeMeetingType(null)).toBe("general");
    expect(normalizeMeetingType("not_a_type")).toBe("general");
    expect(normalizeMeetingType("sales")).toBe("sales");
    expect(isMeetingType("hiring_interview")).toBe(true);
    expect(isMeetingType("nope")).toBe(false);
  });
  it("every type has a plain description — and none claims AI is already running on it", () => {
    for (const t of MEETING_TYPES) {
      expect(MEETING_TYPE_META[t].label.length).toBeGreaterThan(0);
      expect(MEETING_TYPE_META[t].description.length).toBeGreaterThan(0);
      // honest: descriptions say "later" / plain focus, never "AI is analysing" now.
      expect(MEETING_TYPE_META[t].description).not.toMatch(/AI is (analy|running|doing)|now generating/i);
    }
  });
  it("guest-safe label hides sensitive/internal types behind a neutral 'Meeting'", () => {
    expect(guestSafeMeetingLabel("finance_review")).toBe("Meeting");
    expect(guestSafeMeetingLabel("legal_or_compliance")).toBe("Meeting");
    expect(guestSafeMeetingLabel("internal_sync")).toBe("Meeting");
    expect(guestSafeMeetingLabel("sales")).toBe("Meeting");
    expect(guestSafeMeetingLabel("hiring_interview")).toBe("Interview");
    expect(guestSafeMeetingLabel("support")).toBe("Support session");
  });
});

describe("backend — meeting_type stored in event data (no schema), default general, guest-safe", () => {
  it("create/edit validate + persist meeting_type into the event node data", () => {
    expect(calendar).toMatch(/meeting_type: z\.enum\(MEETING_TYPES\)\.optional\(\)/);
    expect(calendar).toMatch(/meeting_type: normalizeMeetingType\(b\.meeting_type\)/);   // create default general
    expect(calendar).toMatch(/b\.meeting_type !== undefined \? \{ meeting_type: normalizeMeetingType\(b\.meeting_type\) \}/); // patch
    // stored in nodes.data (the EventData object) — no new table, no SQL DDL in this route.
    expect(calendar).not.toMatch(/\bcreate table\b|\balter table\b/i);
    expect(calendar).toMatch(/meeting_type: normalizeMeetingType\(b\.meeting_type\),\s+\/\/ default general/);
  });
  it("the event view + call detail surface a normalized meeting_type (absent → general)", () => {
    expect(calendar).toMatch(/meeting_type: normalizeMeetingType\(d\.meeting_type\)/);
    expect(calls).toMatch(/meeting_type: normalizeMeetingType\(data\.meeting_type\)/);
  });
  it("guest meta returns ONLY the guest-safe label — never the raw type id", () => {
    expect(guest).toMatch(/meeting_type_label: guestSafeMeetingLabel\(normalizeMeetingType\(r\.data\.meeting_type\)\)/);
    // the raw meeting_type value is never placed in a guest JSON response.
    expect(guest).not.toMatch(/meeting_type: r\.data\.meeting_type|meeting_type: normalizeMeetingType\(r\.data\.meeting_type\)/);
  });
});

describe("Phase 1.1 — Meeting Memory propagates the event's meeting_type onto the call record", () => {
  it("copies the originating event's meeting_type into the call record node data (normalized)", () => {
    expect(memory).toMatch(/import \{ normalizeMeetingType, summarySectionsGuidance, MEETING_TYPE_SECTIONS, type MeetingType \} from "@mondaily\/shared\/meeting-types"/);
    expect(memory).toMatch(/const meeting_type = await resolveEventMeetingType\(ws, isUpload \? null : session\.room\)/);
    expect(memory).toMatch(/meeting_type,/);   // added to baseData (the persisted node data)
  });
  it("resolver: native `…__meeting__<eventId>` → the event's type; no room/match/upload → general", () => {
    expect(memory).toMatch(/async function resolveEventMeetingType\(ws: string, room: string \| null\)/);
    expect(memory).toMatch(/if \(!room\) return "general"/);
    expect(memory).toMatch(/const m = room\.match\(\/__meeting__\(\.\+\)\$\/\)/);
    expect(memory).toMatch(/if \(!m\) return "general"/);   // direct/non-meeting rooms → general
    expect(memory).toMatch(/\.eq\("object_type", "calendar_event"\)\.eq\("id", m\[1\]\)/);   // real linked event only
    expect(memory).toMatch(/return normalizeMeetingType\(\(data\?\.data as \{ meeting_type\?: string \} \| null\)\?\.meeting_type\)/);
  });
  it("upload path passes null (standalone recordings stay general) — no fabricated event link", () => {
    expect(memory).toMatch(/isUpload \? null : session\.room/);
  });
  it("meeting_type is used only to SELECT type guidance — never fed as raw content to the model", () => {
    // Phase 2: extractMeetingIntel receives the normalized type (to pick the section guidance)…
    expect(memory).toMatch(/extractMeetingIntel\(ws, session\.initiator_id, lines, normalizeMeetingType\(meeting_type\)\)/);
    // …but the raw type string is never interpolated into the transcript prompt or a gateway argument.
    expect(memory).not.toMatch(/prompt: `[^`]*meeting_type/);
    expect(memory).not.toMatch(/aiGatewayToolUse\(\{[^}]*meeting_type/);
  });
});

describe("Phase 2 — type-aware post-call summary sections (transcript-grounded, additive)", () => {
  it("general adds NO sections (behaviour preserved); every other type has sections + guidance", () => {
    expect(MEETING_TYPE_SECTIONS.general).toEqual([]);
    expect(summarySectionsGuidance("general")).toBe("");
    for (const t of MEETING_TYPES.filter(x => x !== "general")) {
      expect(MEETING_TYPE_SECTIONS[t].length).toBeGreaterThan(0);
      expect(summarySectionsGuidance(t).length).toBeGreaterThan(0);
    }
  });
  it("each type's guidance names its own sections (right lens per type)", () => {
    expect(summarySectionsGuidance("sales")).toMatch(/Buying signals[\s\S]*Objections|Objections[\s\S]*Buying signals/);
    expect(summarySectionsGuidance("support")).toMatch(/Resolution \/ status/);
    expect(summarySectionsGuidance("client_review")).toMatch(/Renewal \/ expansion signals/);
    expect(summarySectionsGuidance("finance_review")).toMatch(/Figures discussed/);
  });
  it("hiring_interview guidance FORBIDS scoring/ranking and protected-class judgments", () => {
    const g = summarySectionsGuidance("hiring_interview");
    expect(g).toMatch(/Do NOT score, rate, rank, or recommend the candidate/);
    expect(g).toMatch(/protected characteristic \(age, race, ethnicity, gender, religion, disability/);
    // no field asks for a numeric score / rating.
    expect(MEETING_TYPE_SECTIONS.hiring_interview.map(s => s.key)).not.toContain("score");
    expect(MEETING_TYPE_SECTIONS.hiring_interview.map(s => s.key)).not.toContain("rating");
  });
  it("unknown/legacy type → general guidance (empty), so it can't fabricate sections", () => {
    expect(summarySectionsGuidance(normalizeMeetingType("bogus"))).toBe("");
  });
  it("extraction: core prompt unchanged, type guidance APPENDED, sections parsed safely", () => {
    // The base transcript-grounded prompt is intact; type guidance is concatenated, not replacing it.
    expect(memory).toMatch(/You are a meeting analyst\.[\s\S]*owner is a name ONLY if the transcript names who owns it\." \+ guidance/);
    expect(memory).toMatch(/const guidance = summarySectionsGuidance\(meetingType\)/);
    // sections: only KNOWN keys kept, empty ones dropped (omit, never invent); label from the registry.
    expect(memory).toMatch(/\.filter\(\(s\) => allowedKeys\.has\(s\.key\) && s\.points\.length > 0\)/);
    expect(memory).toMatch(/label: labelOf\.get\(s\.key\) \?\? s\.key/);
  });
  it("stored under data.summary_sections ONLY when non-empty (old/general records unchanged); no schema", () => {
    expect(memory).toMatch(/\.\.\.\(intel\.summary_sections\.length \? \{ summary_sections: intel\.summary_sections \} : \{\}\)/);
    expect(calls).toMatch(/summary_sections: Array\.isArray\(data\.summary_sections\) \? data\.summary_sections : \[\]/);
    expect(memory).not.toMatch(/\bcreate table\b|\balter table\b/i);
  });
  it("preserved fields + no auto-task/guest-email/live-caption code added by this change", () => {
    // core intel fields still present.
    for (const f of ["overview", "key_topics", "action_items", "decisions", "next_steps"]) expect(memory).toMatch(new RegExp(`${f}:`));
    // no new guest email / live caption / candidate scoring introduced here.
    expect(memory).not.toMatch(/sendTransactionalEmail|guest.*email|live_caption|caption|candidate_score|interview_score/i);
    expect(memory).not.toMatch(/tavily|api\.openai\.com|api\.anthropic\.com/i);   // sovereign: gateway only
  });
});

describe("UI — type selector on create/edit; shown on calendar, call room, call detail; safe on guest", () => {
  it("create form + event detail let you set the type (organizer edit)", () => {
    expect(calendarUi).toMatch(/import \{ MEETING_TYPES, MEETING_TYPE_META, type MeetingType \}/);
    expect(calendarUi).toMatch(/meeting_type: meetingType/);                         // sent on create
    expect(calendarUi).toMatch(/setType\.mutate\(v as MeetingType\)/);               // organizer edit → patch
    expect(calendarUi).toMatch(/\/calendar\/events\/\$\{id\}`, \{ meeting_type \}/);
  });
  it("call room header + call detail show the type label", () => {
    expect(callRoomUi).toMatch(/MEETING_TYPE_META\[event\.meeting_type\]\.label/);
    expect(callDetailUi).toMatch(/MEETING_TYPE_META\[call\.meeting_type\]\.label/);
  });
  it("guest prejoin shows only the safe label from meta — no raw type", () => {
    expect(guestUi).toMatch(/meta\?\.meeting_type_label/);
    expect(guestUi).not.toMatch(/meeting_type:/);   // guest UI never handles the raw type id
  });
});
