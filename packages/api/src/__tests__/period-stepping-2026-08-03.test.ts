import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pastPeriodBounds, pastPeriodLabel, shiftPeriods, periodBounds } from "@mondaily/shared/period";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const UTC = { timeZone: "UTC", weekStart: 0 as const };
const WARSAW = { timeZone: "Europe/Warsaw", weekStart: 0 as const };
const AUG3 = new Date("2026-08-03T12:00:00Z");

describe("stepping back lands on whole calendar periods", () => {
  it("-1 month is last month IN FULL, not month-to-date", () => {
    // A closed period's window is the whole period. Comparing all of July against three days of
    // August is what makes every 1st-of-the-month look like a collapse.
    const b = pastPeriodBounds("MONTH", AUG3, UTC, -1)!;
    expect(b.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(b.end.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("walks boundaries rather than subtracting days, so month lengths do not drift", () => {
    // -6 from August is February; a naive 30-day step would land in March.
    expect(pastPeriodLabel("MONTH", AUG3, UTC, -6)).toBe("February 2026");
    expect(pastPeriodLabel("MONTH", AUG3, UTC, -8)).toBe("December 2025");
  });

  it("crosses the year boundary correctly for every type", () => {
    expect(pastPeriodLabel("QUARTER", AUG3, UTC, -3)).toBe("Q4 2025");
    expect(pastPeriodLabel("YEAR", AUG3, UTC, -2)).toBe("2024");
  });

  it("respects the workspace timezone, so a past month is that workspace's month", () => {
    const b = pastPeriodBounds("MONTH", AUG3, WARSAW, -1)!;
    expect(b.start.toISOString()).toBe("2026-06-30T22:00:00.000Z");   // 1 July, Warsaw midnight
  });

  it("offset 0 is the live period, still period-to-date", () => {
    const b = pastPeriodBounds("MONTH", AUG3, UTC, 0)!;
    expect(b.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(b.end.getTime()).toBe(AUG3.getTime());
  });

  it("returns null where 'N periods back' means nothing", () => {
    expect(pastPeriodBounds("ALL_TIME", AUG3, UTC, -1)).toBeNull();
    expect(pastPeriodBounds("TODAY", AUG3, UTC, -1)).toBeNull();
  });

  it("stepping back N then forward N returns to where it started", () => {
    for (const n of [1, 5, 13]) {
      const back = shiftPeriods(AUG3, "MONTHLY", UTC, -n);
      expect(shiftPeriods(back, "MONTHLY", UTC, n).getTime()).toBe(periodBounds(AUG3, "MONTHLY", UTC).start.getTime());
    }
  });
});

describe("the endpoint names the window and says whether it is closed", () => {
  it("bounds the offset so a caller cannot walk a million boundaries", () => {
    expect(read("packages/api/src/routes/periods.ts")).toMatch(/offset: z\.coerce\.number\(\)\.int\(\)\.min\(-120\)\.max\(0\)\.default\(0\)/);
  });

  it("compares a past period against ITS predecessor, not against last month", () => {
    expect(read("packages/api/src/routes/periods.ts")).toMatch(/pastPeriodBounds\(timeframe, now, cfg, offset - 1\)/);
  });

  it("returns the label and the completeness flag", () => {
    const src = read("packages/api/src/routes/periods.ts");
    expect(src).toMatch(/label: pastPeriodLabel\(timeframe, now, cfg, offset\)/);
    expect(src).toMatch(/complete: offset < 0/);
  });
});

describe("the client never invents a historical window", () => {
  it("waits for the server rather than showing a browser-derived guess as history", () => {
    expect(read("apps/app/src/lib/period-bounds.ts"))
      .toMatch(/A past period CANNOT be computed locally without the workspace calendar/);
  });

  it("ignores an offset where it is meaningless", () => {
    expect(read("apps/app/src/lib/period-bounds.ts")).toMatch(/const steppable = timeframe != null && timeframe !== "TODAY" && timeframe !== "ALL_TIME"/);
  });

  // The stepper's own edge cases (offset reset, no future, hidden where meaningless, server label,
  // "closed period") moved into components/ui/period-nav when it was extracted for the six-surface
  // sweep, and are asserted there — see period-nav-sweep-2026-08-03. Duplicating them here would
  // be the same copy-paste problem this session keeps fixing, in test form. What belongs HERE is
  // that the surface actually delegates.
  it("the surface uses the shared control rather than its own", () => {
    const src = read("apps/app/src/routes/dashboard/team-oversight.tsx");
    expect(src).toMatch(/<PeriodNav /);
    expect(src).toMatch(/usePeriodOffset\(period\)/);
    expect(src).not.toMatch(/ChevronLeft size=\{13\}/);
  });
});

describe("completed tasks are a FLOW; open and overdue stay STOCK", () => {
  it("counts only completions inside the window", () => {
    // Was unwindowed entirely: an all-time count of 36 sat beside 317 records touched this period,
    // with nothing saying they measured different spans.
    const src = read("packages/api/src/routes/activities.ts");
    expect(src).toMatch(/if \(Number\.isFinite\(done\) && done >= Date\.parse\(sinceIso\)\) cur\.completed \+= 1;/);
  });

  it("keeps the all-time figure available rather than replacing one with the other", () => {
    expect(read("packages/api/src/routes/activities.ts")).toMatch(/completed_tasks_all_time: taskAgg\.get\(uid\)\?\.completed_all_time \?\? 0/);
  });

  it("leaves open/overdue unwindowed — they are work in hand right now", () => {
    const src = read("packages/api/src/routes/activities.ts");
    expect(src).toMatch(/Unwindowed ON PURPOSE for the STOCK half/);
  });
});
