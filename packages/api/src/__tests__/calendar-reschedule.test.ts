import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rescheduledDates } from "../routes/calendar";
import { t, SUPPORTED_LANGUAGES } from "@mondaily/shared/i18n";

const cal = readFileSync(fileURLToPath(new URL("../routes/calendar.ts", import.meta.url)), "utf8");
const page = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/calendar.tsx", import.meta.url)), "utf8");

describe("rescheduledDates — duration-preserving move", () => {
  it("moves start and shifts end by the SAME duration", () => {
    expect(rescheduledDates("2026-07-01T09:00", "2026-07-01T10:30", "2026-07-08T14:00"))
      .toEqual({ start_at: "2026-07-08T14:00", end_at: "2026-07-08T15:30" });
  });
  it("preserves a multi-hour duration across a day change", () => {
    expect(rescheduledDates("2026-07-01T09:00", "2026-07-01T11:00", "2026-07-02T09:00"))
      .toEqual({ start_at: "2026-07-02T09:00", end_at: "2026-07-02T11:00" });
  });
  it("a zero/negative stored duration yields a zero-length meeting (never a negative one)", () => {
    expect(rescheduledDates("2026-07-01T09:00", "2026-07-01T09:00", "2026-07-03T12:00"))
      .toEqual({ start_at: "2026-07-03T12:00", end_at: "2026-07-03T12:00" });
  });
  it("a bad target start is rejected — the meeting stays where it was (never NaN)", () => {
    expect(rescheduledDates("2026-07-01T09:00", "2026-07-01T10:00", "not-a-date"))
      .toEqual({ start_at: "2026-07-01T09:00", end_at: "2026-07-01T10:00" });
  });
});

describe("reschedule route — organizer-only, duration preserved, series-safe", () => {
  const fn = cal.slice(cal.indexOf('router.post("/events/:id/reschedule"'), cal.indexOf('router.post("/events/:id/respond"'));
  it("rejects a single-occurrence id (must reschedule the series, not one date)", () => {
    expect(fn).toMatch(/if \(c\.req\.param\("id"\)\.includes\("::"\)\) return c\.json\(.*400\)/);
  });
  it("is organizer/admin gated (403) and refuses a cancelled meeting (409)", () => {
    expect(fn).toMatch(/if \(!canManage\(ev\.data, me, c\.get\("role"\)\)\) return c\.json\(.*403\)/);
    expect(fn).toMatch(/status === "cancelled".*409/s);
  });
  it("uses the pure helper to compute the new dates and notifies attendees", () => {
    expect(fn).toMatch(/rescheduledDates\(ev\.data\.start_at, ev\.data\.end_at, c\.req\.valid\("json"\)\.start_at\)/);
    expect(fn).toMatch(/notifyAttendees\(ws, ev\.id, next, me, "updated"\)/);
  });
});

describe("month-grid drag frontend + i18n", () => {
  it("only non-recurring chips are draggable (a series occurrence is never dragged)", () => {
    expect(page).toMatch(/const draggable = !!onMove && !e\.recurring/);
    expect(page).toMatch(/draggable=\{draggable\}/);
  });
  it("day cells are drop targets that call onMove with the target day", () => {
    expect(page).toMatch(/onDrop=\{onMove \?/);
    expect(page).toMatch(/onMove\(p\.id, p\.start, d\)/);
    expect(page).toMatch(/reschedule = useMutation/);
    expect(page).toMatch(/\/calendar\/events\/\$\{id\}\/reschedule/);
  });
  it("dropping on the SAME day is a no-op (no needless PATCH)", () => {
    expect(page).toMatch(/p\.start\.slice\(0, 10\) !== toLocalInput\(d\)\.slice\(0, 10\)/);
  });
  it("cal.drag_hint is translated in all 12 languages", () => {
    for (const l of SUPPORTED_LANGUAGES) {
      const v = t(l.code, "cal.drag_hint");
      expect(v, `drag_hint/${l.code}`).not.toBe("cal.drag_hint");
      expect(v.length).toBeGreaterThan(0);
    }
  });
});
