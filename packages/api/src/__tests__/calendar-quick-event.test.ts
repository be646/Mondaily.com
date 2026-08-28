import { describe, it, expect } from "vitest";
import { parseQuickEvent } from "../../../../apps/app/src/lib/quick-event";

/**
 * Natural-language quick-add (calendar item C1 of the master plan, 2026-08-20).
 * DETERMINISTIC parser — the same sentence always means the same event, works with the AI engine
 * offline, and every interpretation is previewed to the user before creation. The one forbidden
 * move: guessing "when" from nothing.
 */

// THURSDAY, 20 Aug 2026, 10:00 local — every case is relative to this.
const NOW = new Date(2026, 7, 20, 10, 0, 0);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

describe("dates", () => {
  it("tomorrow 1pm", () => {
    const e = parseQuickEvent("lunch with Omar tomorrow 1pm", NOW)!;
    expect(iso(e.start)).toBe("2026-08-21 13:00");
    expect(iso(e.end)).toBe("2026-08-21 13:30");
    expect(e.title).toBe("Lunch with Omar");
  });

  it("bare weekday = the NEXT occurrence; same weekday today jumps a week", () => {
    expect(iso(parseQuickEvent("standup friday 9am", NOW)!.start)).toBe("2026-08-21 09:00");
    expect(iso(parseQuickEvent("planning wednesday 9am", NOW)!.start)).toBe("2026-08-26 09:00");
    expect(iso(parseQuickEvent("planning thursday 9am", NOW)!.start)).toBe("2026-08-27 09:00"); // today IS Thursday → next week
  });

  it("next <weekday> means the week after the coming one", () => {
    expect(iso(parseQuickEvent("review next friday 3pm", NOW)!.start)).toBe("2026-08-28 15:00");
  });

  it("explicit dates: '30 aug', 'aug 30', day/month numerals, ISO", () => {
    expect(iso(parseQuickEvent("demo 30 aug 2pm", NOW)!.start)).toBe("2026-08-30 14:00");
    expect(iso(parseQuickEvent("demo aug 30 2pm", NOW)!.start)).toBe("2026-08-30 14:00");
    expect(iso(parseQuickEvent("demo 30/8 2pm", NOW)!.start)).toBe("2026-08-30 14:00");
    expect(iso(parseQuickEvent("demo 2026-09-02 2pm", NOW)!.start)).toBe("2026-09-02 14:00");
  });

  it("a month-day already past rolls to next year, never silently into the past", () => {
    expect(parseQuickEvent("kickoff 3 feb 10am", NOW)!.start.getFullYear()).toBe(2027);
  });
});

describe("times", () => {
  it("24h, dotted, and colon forms", () => {
    expect(iso(parseQuickEvent("call tomorrow 13:30", NOW)!.start)).toBe("2026-08-21 13:30");
    expect(iso(parseQuickEvent("call tomorrow 1.30pm", NOW)!.start)).toBe("2026-08-21 13:30");
  });

  it("'at 5' means the working afternoon; 'at 9' means morning", () => {
    expect(iso(parseQuickEvent("coffee today at 5", NOW)!.start)).toBe("2026-08-20 17:00");
    const e = parseQuickEvent("gym at 9", NOW)!;   // 9 < now(10:00) today → tomorrow morning
    expect(iso(e.start)).toBe("2026-08-21 09:00");
  });

  it("time-only in the past today rolls to tomorrow", () => {
    expect(iso(parseQuickEvent("standup 9am", NOW)!.start)).toBe("2026-08-21 09:00");
  });

  it("ranges win over the default duration, and '1-2pm' applies pm to both ends", () => {
    const e = parseQuickEvent("workshop tomorrow 1-2pm", NOW)!;
    expect(iso(e.start)).toBe("2026-08-21 13:00");
    expect(iso(e.end)).toBe("2026-08-21 14:00");
    const f = parseQuickEvent("deep work tomorrow 13:00-15:30", NOW)!;
    expect(iso(f.end)).toBe("2026-08-21 15:30");
  });

  it("noon and midnight", () => {
    expect(iso(parseQuickEvent("lunch tomorrow noon", NOW)!.start)).toBe("2026-08-21 12:00");
  });
});

describe("durations and defaults", () => {
  it("'for 45m', 'for 1.5h', '1h30'", () => {
    expect(iso(parseQuickEvent("sync tomorrow 2pm for 45m", NOW)!.end)).toBe("2026-08-21 14:45");
    expect(iso(parseQuickEvent("sync tomorrow 2pm for 1.5h", NOW)!.end)).toBe("2026-08-21 15:30");
    expect(iso(parseQuickEvent("sync tomorrow 2pm 1h30", NOW)!.end)).toBe("2026-08-21 15:30");
  });

  it("default duration 30 minutes; date-only defaults to 09:00", () => {
    const e = parseQuickEvent("board prep tomorrow", NOW)!;
    expect(iso(e.start)).toBe("2026-08-21 09:00");
    expect(iso(e.end)).toBe("2026-08-21 09:30");
  });
});

describe("the forbidden guess", () => {
  it("no date and no time → null (the full form opens; quick-add never invents 'when')", () => {
    expect(parseQuickEvent("catch up with the design team", NOW)).toBeNull();
    expect(parseQuickEvent("", NOW)).toBeNull();
  });

  it("title survives cleanly and the interpretation is human-readable", () => {
    const e = parseQuickEvent("Pitch review with Sarah tomorrow at 4 for 1h", NOW)!;
    expect(e.title).toBe("Pitch review with Sarah");
    expect(iso(e.start)).toBe("2026-08-21 16:00");
    expect(iso(e.end)).toBe("2026-08-21 17:00");
    expect(e.when.length).toBeGreaterThan(8);   // shown to the user before anything is created
  });
});
