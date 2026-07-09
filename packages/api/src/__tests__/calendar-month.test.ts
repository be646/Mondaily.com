import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { t, SUPPORTED_LANGUAGES } from "@mondaily/shared/i18n";

const cal = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/calendar.tsx", import.meta.url)), "utf8");

describe("Calendar — Month view i18n", () => {
  it("cal.view_month + cal.more_count are translated in all 12 languages", () => {
    for (const key of ["cal.view_month", "cal.more_count"]) {
      for (const l of SUPPORTED_LANGUAGES) {
        const v = t(l.code, key);
        expect(v, `${key}/${l.code}`).not.toBe(key);
        expect(v.length).toBeGreaterThan(0);
      }
    }
  });
  it("the overflow template keeps the {n} placeholder for runtime fill", () => {
    expect(t("en", "cal.more_count")).toContain("{n}");
    expect(t("fr", "cal.more_count")).toContain("{n}");
  });
});

describe("Calendar — Month view wiring", () => {
  it("adds 'month' as a real view mode and tab (between week and upcoming)", () => {
    expect(cal).toMatch(/type ViewMode = "today" \| "week" \| "month" \| "upcoming"/);
    expect(cal).toMatch(/k: "month", label: t\("cal\.view_month"\)/);
  });
  it("builds a rectangular 6×7 (42-cell) Monday-first grid around the anchored month", () => {
    expect(cal).toMatch(/length: 42/);                       // 6 weeks × 7 days
    expect(cal).toMatch(/\(first\.getDay\(\) \+ 6\) % 7/);   // Monday-first offset
  });
  it("navigation shifts by whole months in month view (not by days)", () => {
    expect(cal).toMatch(/if \(view === "month"\) d\.setMonth\(d\.getMonth\(\) \+ dir\)/);
    expect(cal).toMatch(/view === "month"\s*\?\s*anchor\.toLocaleDateString\(lang, \{ month: "long", year: "numeric" \}\)/);
  });
  it("renders MonthGrid and routes its interactions to real handlers (open / pick day / create)", () => {
    expect(cal).toMatch(/<MonthGrid /);
    expect(cal).toMatch(/onPickDay=\{\(d\) => \{ setAnchor\(d\); setView\("today"\); \}\}/);
    expect(cal).toMatch(/onCreateDay=/);
    expect(cal).toMatch(/onOpen=\{openEvent\}/);
  });
  it("cells cap at 3 chips with a '+N more' overflow (no unbounded growth)", () => {
    expect(cal).toMatch(/dayEvents\.slice\(0, 3\)/);
    expect(cal).toMatch(/moreLabel\(overflow\)/);
  });
  it("chips reuse the shared semantic meetingTone (honest, field-derived — not random)", () => {
    expect(cal).toMatch(/const tone = meetingTone\(e\)/);
  });
});
