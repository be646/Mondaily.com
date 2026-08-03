import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const hook = () => read("apps/app/src/lib/period-bounds.ts");
const routes = () => read("packages/api/src/routes/periods.ts");

const SURFACES = [
  "apps/app/src/routes/dashboard/insights.tsx",
  "apps/app/src/routes/dashboard/team-oversight.tsx",
  "apps/app/src/routes/dashboard/finance/reports.tsx",
  "apps/app/src/routes/dashboard/finance/expenses.tsx",
  "apps/app/src/routes/dashboard/finance/invoices.tsx",
  "apps/app/src/routes/dashboard/objects/[objectType]/index.tsx",
];

/**
 * Before this, a reporting window was a fact about the READER'S LAPTOP: two people looking at the
 * same workspace from different timezones saw months that began at different instants, and neither
 * necessarily matched the month the close worker files. With snapshots on disk that stops being a
 * cosmetic disagreement and becomes a report that contradicts the audit trail.
 */
describe("every reporting surface takes its window from the workspace", () => {
  it("all six resolve through the hook", () => {
    for (const f of SURFACES) {
      expect(read(f), `${f} must use useResolvedPeriod`).toMatch(/useResolvedPeriod\(/);
    }
  });

  it("none of them still derives a window from the browser's calendar", () => {
    // periodRange/previousRange compute from `new Date()` in the browser.
    for (const f of SURFACES) {
      expect(read(f), `${f} still calls periodRange/previousRange`).not.toMatch(/\b(periodRange|previousRange)\(/);
    }
  });

  it("the fixed month comparison on Reports resolves its own workspace window", () => {
    // It always compares this month with last month regardless of the selector. Left on the
    // browser's calendar, one figure on the page would sit in a different month from the rest.
    const src = read("apps/app/src/routes/dashboard/finance/reports.tsx");
    expect(src).toMatch(/const monthWindow = useResolvedPeriod\("month"\)/);
    expect(src).toMatch(/revenueIn\(monthWindow\.range\)/);
  });

  it("the oversight day-count counts from the RESOLVED start", () => {
    const src = read("apps/app/src/routes/dashboard/team-oversight.tsx");
    expect(src).toMatch(/function calendarDays\(start: Date\)/);
    expect(src).toMatch(/calendarDays\(oversightRange\.start\)/);
  });
});

describe("the comparison window comes from the same authority as the current one", () => {
  it("the endpoint returns BOTH", () => {
    // Resolving "this month" on the server and "last month" in the browser makes every delta wrong
    // by the timezone offset — small, plausible and permanent, which is the worst kind of error.
    expect(routes()).toMatch(/previous = \{ start: p\.start\.toISOString\(\), end: p\.end\.toISOString\(\) \};/);
    expect(hook()).toMatch(/previous: q\.data\.previous \?/);
  });

  it("TODAY compares against yesterday, not against nothing", () => {
    expect(routes()).toMatch(/timeframe === "TODAY"/);
  });
});

describe("it degrades rather than blanking", () => {
  it("falls back to the local window while loading or on failure, and says which it used", () => {
    // A reporting page that blanks because a bounds lookup was slow is worse than one showing a
    // window computed a few hours off — and unlike a blank page, the fallback is explainable.
    const src = hook();
    expect(src).toMatch(/if \(timeframe == null \|\| !q\.data\) \{[\s\S]{0,600}source: "browser"/);
    expect(src).toMatch(/source: "workspace"/);
  });

  it("keeps a custom range local — it is a typed span, not a calendar period", () => {
    expect(hook()).toMatch(/period === "custom" \? null : TIMEFRAME_OF\[period\]/);
  });

  it("does not re-ask on every mount; a calendar window is stable for minutes", () => {
    expect(hook()).toMatch(/staleTime: 60_000/);
  });
});

describe("a late-arriving workspace window is not ignored", () => {
  it("query keys include the resolved window, so the cache cannot pin the fallback result", () => {
    // Without this, the first render's browser-derived window would key the cache and the server
    // window would never take effect.
    const src = read("apps/app/src/routes/dashboard/team-oversight.tsx");
    expect(src).toMatch(/queryKey: \["outcomes", period, r\.start\.toISOString\(\), r\.end\.toISOString\(\)\]/);
    expect(src).toMatch(/queryKey: \["oversight-matrix", days, period, oversightRange\.start\.toISOString\(\)\]/);
  });
});
