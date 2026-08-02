import { describe, it, expect } from "vitest";
import {
  periodStart, periodEnd, periodBounds, previousPeriod, periodKey, getPeriodBounds,
  windowFor, inBounds, periodConfigFrom, elapsedPeriods, wallClock, instantOf,
  DEFAULT_PERIOD_CONFIG, type PeriodConfig,
} from "@mondaily/shared/period";

const WARSAW: PeriodConfig = { timeZone: "Europe/Warsaw", weekStart: 0 };
const NY: PeriodConfig = { timeZone: "America/New_York", weekStart: 0 };
const UTC = DEFAULT_PERIOD_CONFIG;
const MON: PeriodConfig = { timeZone: "UTC", weekStart: 1 };

/**
 * A period boundary is a wall-clock fact in the workspace's timezone. Every bug this module exists
 * to prevent looks the same from the outside — "the numbers are wrong on the 1st" — so the tests
 * are about instants, not about formatting.
 */
describe("boundaries are local wall-clock, not UTC", () => {
  it("a Warsaw month starts at Warsaw midnight, which is 22:00 UTC the day before", () => {
    // Vercel Cron fires in UTC. Closing on the UTC 1st would file two hours of Warsaw transactions
    // into the wrong month — the single most common cause of a wrong monthly total.
    const start = periodStart(new Date("2026-08-15T12:00:00Z"), "MONTHLY", WARSAW);
    expect(start.toISOString()).toBe("2026-07-31T22:00:00.000Z");
  });

  it("the same instant belongs to different months in different zones, and that is correct", () => {
    const instant = new Date("2026-08-01T02:00:00Z");   // Aug 1 in Warsaw, Jul 31 in New York
    expect(periodKey(instant, "MONTHLY", WARSAW)).toBe("2026-M08");
    expect(periodKey(instant, "MONTHLY", NY)).toBe("2026-M07");
  });

  it("a UTC workspace is unaffected", () => {
    expect(periodStart(new Date("2026-08-15T12:00:00Z"), "MONTHLY", UTC).toISOString())
      .toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("DST does not move a boundary off midnight", () => {
  it("a week spanning the spring-forward transition still starts at local midnight", () => {
    // Warsaw springs forward 2026-03-29. Subtracting 7×24h across it lands at 23:00 the day before.
    const w = periodStart(new Date("2026-04-01T12:00:00Z"), "WEEKLY", WARSAW);
    const local = wallClock(w, WARSAW.timeZone);
    expect([local.hour, local.minute, local.second]).toEqual([0, 0, 0]);
  });

  it("a month containing a DST change still starts and ends at local midnight", () => {
    for (const at of ["2026-03-15T12:00:00Z", "2026-10-15T12:00:00Z"]) {
      const b = periodBounds(new Date(at), "MONTHLY", WARSAW);
      expect(wallClock(b.start, WARSAW.timeZone).hour).toBe(0);
      expect(wallClock(b.end, WARSAW.timeZone).hour).toBe(0);
    }
  });

  it("instantOf resolves a wall-clock time back to the instant it names", () => {
    const i = instantOf({ year: 2026, month: 8, day: 1 }, "Europe/Warsaw");
    const back = wallClock(i, "Europe/Warsaw");
    expect([back.year, back.month, back.day, back.hour]).toEqual([2026, 8, 1, 0]);
  });
});

describe("periods tile — no gap, no overlap, nothing counted twice", () => {
  it("the end is EXCLUSIVE, so a row at exactly midnight belongs to one period only", () => {
    const july = periodBounds(new Date("2026-07-15T12:00:00Z"), "MONTHLY", UTC);
    const aug = periodBounds(new Date("2026-08-15T12:00:00Z"), "MONTHLY", UTC);
    expect(july.end.getTime()).toBe(aug.start.getTime());
    const boundary = "2026-08-01T00:00:00.000Z";
    expect(inBounds(boundary, july)).toBe(false);
    expect(inBounds(boundary, aug)).toBe(true);
  });

  it("consecutive periods of every type meet exactly", () => {
    for (const type of ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const) {
      const b = periodBounds(new Date("2026-08-15T12:00:00Z"), type, WARSAW);
      const next = periodBounds(b.end, type, WARSAW);
      expect(next.start.getTime()).toBe(b.end.getTime());
    }
  });

  it("previousPeriod is the calendar's previous, across year and quarter edges", () => {
    const jan = new Date("2026-01-15T12:00:00Z");
    expect(periodKey(previousPeriod(jan, "MONTHLY", UTC).start, "MONTHLY", UTC)).toBe("2025-M12");
    expect(periodKey(previousPeriod(jan, "QUARTERLY", UTC).start, "QUARTERLY", UTC)).toBe("2025-Q4");
    expect(periodKey(previousPeriod(jan, "YEARLY", UTC).start, "YEARLY", UTC)).toBe("2025-Y2025");
  });

  it("a 31-day month is not treated as 30, and February is not treated as 31", () => {
    const feb = periodBounds(new Date("2026-02-10T00:00:00Z"), "MONTHLY", UTC);
    expect((feb.end.getTime() - feb.start.getTime()) / 86_400_000).toBe(28);
    const jul = periodBounds(new Date("2026-07-10T00:00:00Z"), "MONTHLY", UTC);
    expect((jul.end.getTime() - jul.start.getTime()) / 86_400_000).toBe(31);
  });
});

describe("week start is a workspace setting, not a constant", () => {
  it("defaults to Sunday, which is what this product has always done", () => {
    expect(DEFAULT_PERIOD_CONFIG.weekStart).toBe(0);
    // 2026-08-02 is a Sunday.
    expect(periodStart(new Date("2026-08-05T12:00:00Z"), "WEEKLY", UTC).toISOString())
      .toBe("2026-08-02T00:00:00.000Z");
  });

  it("honours Monday when a workspace asks for it", () => {
    expect(periodStart(new Date("2026-08-05T12:00:00Z"), "WEEKLY", MON).toISOString())
      .toBe("2026-08-03T00:00:00.000Z");
  });

  it("the weekly KEY describes the same span as the BOUNDS, under either week start", () => {
    // This is the invariant that matters. ISO week numbering always starts Monday, so using it
    // for a Sunday-start workspace would label a span the closer never actually closed.
    for (const cfg of [UTC, MON]) {
      for (const iso of ["2026-01-01T12:00:00Z", "2026-08-02T12:00:00Z", "2026-08-05T12:00:00Z", "2026-12-31T12:00:00Z"]) {
        const at = new Date(iso);
        const start = periodStart(at, "WEEKLY", cfg);
        // Asking for the key at the instant the week starts must give the same key as asking
        // anywhere inside it — key and bounds cannot disagree.
        expect(periodKey(start, "WEEKLY", cfg)).toBe(periodKey(at, "WEEKLY", cfg));
      }
    }
  });

  it("a Sunday falls in DIFFERENT weeks under the two settings", () => {
    const sunday = new Date("2026-08-02T12:00:00Z");
    expect(periodStart(sunday, "WEEKLY", UTC).toISOString()).toBe("2026-08-02T00:00:00.000Z");
    expect(periodStart(sunday, "WEEKLY", MON).toISOString()).toBe("2026-07-27T00:00:00.000Z");
    expect(periodKey(sunday, "WEEKLY", UTC)).not.toBe(periodKey(sunday, "WEEKLY", MON));
  });
});

describe("STOCK metrics ignore the window", () => {
  it("a balance is as-of, so no window applies", () => {
    // The classic bug: unpaid invoices "drop to zero" on the 1st. They were not paid; the filter
    // stopped counting them.
    expect(windowFor("STOCK", "MONTH", new Date(), UTC)).toBeNull();
    expect(windowFor("STOCK", "YEAR", new Date(), UTC)).toBeNull();
  });

  it("a flow is windowed", () => {
    expect(windowFor("FLOW", "MONTH", new Date("2026-08-15T12:00:00Z"), UTC)?.start.toISOString())
      .toBe("2026-08-01T00:00:00.000Z");
  });

  it("ALL_TIME returns null, not an epoch-to-now range", () => {
    // "No predicate" and "a predicate that matches everything" are different instructions.
    expect(getPeriodBounds("ALL_TIME", new Date(), UTC)).toBeNull();
    expect(inBounds("1999-01-01T00:00:00Z", null)).toBe(true);
  });

  it("an undated row is never claimed by a window", () => {
    const b = getPeriodBounds("MONTH", new Date("2026-08-15T12:00:00Z"), UTC);
    expect(inBounds(null, b)).toBe(false);
    expect(inBounds("not a date", b)).toBe(false);
  });
});

describe("elapsedPeriods makes the close calendar-driven", () => {
  it("lists every period that ENDED in the span, oldest first", () => {
    const got = elapsedPeriods(new Date("2026-05-15T00:00:00Z"), new Date("2026-08-02T00:00:00Z"), "MONTHLY", UTC);
    expect(got.map(g => g.key)).toEqual(["2026-M05", "2026-M06", "2026-M07"]);
  });

  it("backfills periods a skipped cron missed — the point of asking the calendar", () => {
    const got = elapsedPeriods(new Date("2025-11-01T00:00:00Z"), new Date("2026-08-02T00:00:00Z"), "QUARTERLY", UTC);
    expect(got.map(g => g.key)).toEqual(["2025-Q4", "2026-Q1", "2026-Q2"]);
  });

  it("never returns the period still in progress", () => {
    const got = elapsedPeriods(new Date("2026-08-01T00:00:00Z"), new Date("2026-08-15T00:00:00Z"), "MONTHLY", UTC);
    expect(got).toEqual([]);
  });

  it("is idempotent — the same span asked twice gives the same answer", () => {
    const a = elapsedPeriods(new Date("2026-01-01T00:00:00Z"), new Date("2026-08-02T00:00:00Z"), "MONTHLY", UTC);
    const b = elapsedPeriods(new Date("2026-01-01T00:00:00Z"), new Date("2026-08-02T00:00:00Z"), "MONTHLY", UTC);
    expect(a.map(x => x.key)).toEqual(b.map(x => x.key));
  });

  it("is bounded, so a corrupt start date cannot spin", () => {
    const got = elapsedPeriods(new Date(0), new Date("2026-08-02T00:00:00Z"), "WEEKLY", UTC);
    expect(got.length).toBeLessThanOrEqual(1000);
  });
});

describe("config is read defensively", () => {
  it("falls back to UTC, never to the server's local zone", () => {
    // The server's zone is a property of where the code runs; using it makes results irreproducible.
    expect(periodConfigFrom(null).timeZone).toBe("UTC");
    expect(periodConfigFrom({}).timeZone).toBe("UTC");
  });

  it("rejects an unknown timezone instead of throwing at the first boundary", () => {
    expect(periodConfigFrom({ timezone: "Mars/Olympus" }).timeZone).toBe("UTC");
  });

  it("accepts a real zone and both spellings of Monday", () => {
    expect(periodConfigFrom({ timezone: "Europe/Warsaw" }).timeZone).toBe("Europe/Warsaw");
    expect(periodConfigFrom({ week_start: 1 }).weekStart).toBe(1);
    expect(periodConfigFrom({ week_start: "monday" }).weekStart).toBe(1);
    expect(periodConfigFrom({ week_start: "sunday" }).weekStart).toBe(0);
  });
});

describe("period keys are stable identities", () => {
  it("formats each type as specified", () => {
    const at = new Date("2026-08-15T12:00:00Z");
    expect(periodKey(at, "MONTHLY", UTC)).toBe("2026-M08");
    expect(periodKey(at, "QUARTERLY", UTC)).toBe("2026-Q3");
    expect(periodKey(at, "YEARLY", UTC)).toBe("2026-Y2026");
    expect(periodKey(at, "WEEKLY", UTC)).toMatch(/^2026-W\d{2}$/);
  });

  it("every instant inside a period yields the same key", () => {
    const b = periodBounds(new Date("2026-08-15T12:00:00Z"), "MONTHLY", WARSAW);
    const mid = new Date((b.start.getTime() + b.end.getTime()) / 2);
    for (const t of [b.start, mid, new Date(b.end.getTime() - 1)]) {
      expect(periodKey(t, "MONTHLY", WARSAW)).toBe("2026-M08");
    }
  });
});
