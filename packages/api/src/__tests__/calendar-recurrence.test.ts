import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expandRecurrence, recurrenceSummary, occurrenceId, baseId, type RecurrenceRule } from "../routes/calendar";

const master = (recurrence: RecurrenceRule, start = "2026-07-01T09:00", end = "2026-07-01T09:30", exdates: string[] = []) =>
  ({ start_at: start, end_at: end, recurrence, exdates });
const dates = (occ: { occurrence_date: string }[]) => occ.map((o) => o.occurrence_date);

describe("expandRecurrence — daily", () => {
  it("emits one occurrence per interval, preserving wall-clock time + duration", () => {
    const occ = expandRecurrence(master({ freq: "daily", interval: 1 }), "2026-07-01", "2026-07-04");
    expect(dates(occ)).toEqual(["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"]);
    expect(occ[0]).toMatchObject({ occurrence_start: "2026-07-01T09:00", occurrence_end: "2026-07-01T09:30" });
  });
  it("honors interval (every 2 days)", () => {
    const occ = expandRecurrence(master({ freq: "daily", interval: 2 }), "2026-07-01", "2026-07-07");
    expect(dates(occ)).toEqual(["2026-07-01", "2026-07-03", "2026-07-05", "2026-07-07"]);
  });
});

describe("expandRecurrence — weekly & monthly", () => {
  it("weekly recurs on the same weekday", () => {
    const occ = expandRecurrence(master({ freq: "weekly", interval: 1 }), "2026-07-01", "2026-07-29");
    expect(dates(occ)).toEqual(["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29"]);
  });
  it("monthly recurs on the same day-of-month", () => {
    const occ = expandRecurrence(master({ freq: "monthly", interval: 1 }, "2026-01-15T09:00", "2026-01-15T10:00"), "2026-01-01", "2026-04-30");
    expect(dates(occ)).toEqual(["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"]);
  });
  it("monthly SKIPS months without the day (Jan 31 → no Feb 31), never shifts it silently", () => {
    const occ = expandRecurrence(master({ freq: "monthly", interval: 1 }, "2026-01-31T09:00", "2026-01-31T10:00"), "2026-01-01", "2026-05-31");
    expect(dates(occ)).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]); // Feb + Apr skipped
  });
});

describe("expandRecurrence — bounds", () => {
  it("stops after `count` occurrences (counting from the first)", () => {
    const occ = expandRecurrence(master({ freq: "daily", interval: 1, count: 3 }), "2026-07-01", "2026-12-31");
    expect(dates(occ)).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
  });
  it("stops on/after `until`", () => {
    const occ = expandRecurrence(master({ freq: "weekly", interval: 1, until: "2026-07-20" }), "2026-07-01", "2026-12-31");
    expect(dates(occ)).toEqual(["2026-07-01", "2026-07-08", "2026-07-15"]);
  });
  it("only returns occurrences inside the [from,to] window", () => {
    const occ = expandRecurrence(master({ freq: "daily", interval: 1 }), "2026-07-10", "2026-07-12");
    expect(dates(occ)).toEqual(["2026-07-10", "2026-07-11", "2026-07-12"]);
  });
  it("a window past `until` yields nothing", () => {
    const occ = expandRecurrence(master({ freq: "daily", interval: 1, until: "2026-07-05" }), "2026-08-01", "2026-08-10");
    expect(occ).toEqual([]);
  });
  it("open-ended rule is hard-capped (never loops unbounded) and defaults a finite window", () => {
    const occ = expandRecurrence(master({ freq: "daily", interval: 1 }), undefined, undefined, 366);
    expect(occ.length).toBeGreaterThan(0);
    expect(occ.length).toBeLessThanOrEqual(366);
  });
});

describe("expandRecurrence — cancelled occurrences (exdates)", () => {
  it("skips individually-cancelled dates but keeps the rest", () => {
    const occ = expandRecurrence(master({ freq: "daily", interval: 1 }, "2026-07-01T09:00", "2026-07-01T09:30", ["2026-07-02"]), "2026-07-01", "2026-07-03");
    expect(dates(occ)).toEqual(["2026-07-01", "2026-07-03"]);
  });
  it("an exdate still counts toward `count` (it was a real occurrence, just cancelled)", () => {
    const occ = expandRecurrence(master({ freq: "daily", interval: 1, count: 3 }, "2026-07-01T09:00", "2026-07-01T09:30", ["2026-07-02"]), "2026-07-01", "2026-12-31");
    expect(dates(occ)).toEqual(["2026-07-01", "2026-07-03"]); // 3 emitted, middle one cancelled
  });
});

describe("guards + helpers", () => {
  it("no rule / bad interval / bad date → no occurrences (never throws)", () => {
    expect(expandRecurrence({ start_at: "2026-07-01T09:00", end_at: "x", recurrence: null }, "2026-07-01", "2026-07-05")).toEqual([]);
    expect(expandRecurrence(master({ freq: "daily", interval: 0 }), "2026-07-01", "2026-07-05")).toEqual([]);
    expect(expandRecurrence(master({ freq: "daily", interval: 1 }, "not-a-date"), "2026-07-01", "2026-07-05")).toEqual([]);
  });
  it("occurrenceId / baseId round-trip (occurrence ids resolve to the master node)", () => {
    const id = occurrenceId("node_abc", "2026-07-02");
    expect(id).toBe("node_abc::2026-07-02");
    expect(baseId(id)).toBe("node_abc");
    expect(baseId("node_plain")).toBe("node_plain");
  });
  it("recurrenceSummary is human-readable", () => {
    expect(recurrenceSummary({ freq: "weekly", interval: 1 })).toBe("Weekly");
    expect(recurrenceSummary({ freq: "daily", interval: 2 })).toBe("Every 2 days");
    expect(recurrenceSummary({ freq: "monthly", interval: 1, count: 6 })).toBe("Monthly, 6×");
    expect(recurrenceSummary({ freq: "daily", interval: 1, until: "2026-08-01" })).toBe("Daily, until 2026-08-01");
  });
});

describe("route wiring", () => {
  const cal = readFileSync(fileURLToPath(new URL("../routes/calendar.ts", import.meta.url)), "utf8");
  it("GET /events fetches recurring masters unfiltered by date and expands them", () => {
    expect(cal).toMatch(/\.not\("data->recurrence", "is", null\)/);
    expect(cal).toMatch(/\.is\("data->recurrence", null\)/);              // non-recurring path stays windowed
    expect(cal).toMatch(/expandRecurrence\(e\.d, from, to\)/);
  });
  it("occurrence ids resolve to the master via baseId in getEvent", () => {
    expect(cal).toMatch(/\.eq\("id", baseId\(id\)\)/);
  });
  it("DELETE supports per-occurrence cancel via exdates, else cancels the series", () => {
    expect(cal).toMatch(/const occurrence = c\.req\.query\("occurrence"\)/);
    expect(cal).toMatch(/exdates = \[\.\.\.new Set\(\[\.\.\.\(ev\.data\.exdates \?\? \[\]\), occurrence\]\)\]/);
  });
});
