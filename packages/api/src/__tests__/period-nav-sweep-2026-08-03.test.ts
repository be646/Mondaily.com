import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const nav = () => read("apps/app/src/components/ui/period-nav.tsx");

const SURFACES = [
  "apps/app/src/routes/dashboard/team-oversight.tsx",
  "apps/app/src/routes/dashboard/insights.tsx",
  "apps/app/src/routes/dashboard/finance/reports.tsx",
  "apps/app/src/routes/dashboard/finance/invoices.tsx",
  "apps/app/src/routes/dashboard/finance/expenses.tsx",
  "apps/app/src/routes/dashboard/objects/[objectType]/index.tsx",
];

/**
 * A control that has to get the same four edge cases right on six pages is exactly the thing that
 * should exist once. This session fixed the same class of bug three times — a rule written at one
 * call site and reconstructed by hand at another — so the stepper was extracted before it was
 * copied, not after.
 */
describe("every period surface can look at a closed period", () => {
  it("all six render the shared control", () => {
    for (const f of SURFACES) expect(read(f), f).toMatch(/<PeriodNav /);
  });

  it("all six thread the offset into the resolved window", () => {
    for (const f of SURFACES) {
      expect(read(f), f).toMatch(/useResolvedPeriod\(period,[^)]*periodOffset\)/);
    }
  });

  it("all six take the window's NAME from the server, never rebuilding it from an offset", () => {
    for (const f of SURFACES) expect(read(f), f).toMatch(/label: periodName/);
  });

  it("there is exactly ONE implementation — nobody re-inlined it", () => {
    const inline = SURFACES.filter(f => /ChevronLeft size=\{13\}/.test(read(f)));
    expect(inline).toEqual([]);
  });
});

describe("the control's edge cases live in one place", () => {
  it("resets the offset when the period TYPE changes", () => {
    // "3 months back" and "3 quarters back" are different places; carrying the number is a jump
    // nobody asked for.
    expect(nav()).toMatch(/useEffect\(\(\) => \{ setOffset\(0\); \}, \[period\]\)/);
  });

  it("cannot step into the future", () => {
    const src = nav();
    expect(src).toMatch(/Math\.min\(0, offset \+ 1\)/);
    expect(src).toMatch(/disabled=\{offset >= 0\}/);
  });

  it("hides itself where stepping is meaningless", () => {
    const src = nav();
    expect(src).toMatch(/period !== "today" && period !== "all" && period !== "custom"/);
    expect(src).toMatch(/if \(!isSteppable\(period\)\) return null;/);
  });

  it("prefers the server's label whenever it has arrived", () => {
    expect(nav()).toMatch(/\{serverLabel \?\? periodLabel\(period\)\}/);
  });

  it("says out loud that a closed period is shown IN FULL", () => {
    // Otherwise a reader cannot tell a smaller number from less elapsed time.
    expect(nav()).toMatch(/closed period/);
  });

  it("bounds how far back it can walk", () => {
    expect(nav()).toMatch(/Math\.max\(-120, offset - 1\)/);
  });
});
