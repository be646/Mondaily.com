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

describe("a tile's label follows its window, not the calendar today", () => {
  it("Finance Reports names the viewed period instead of saying 'this year'", () => {
    // Once a closed period can be stepped into, "PLN 0.00 collected · this year" over 2025's
    // window is a label contradicting its own number. Seen live before the fix.
    const src = read("apps/app/src/routes/dashboard/finance/reports.tsx");
    expect(src).toMatch(/: periodName \? periodName/);
    expect(src).toMatch(/a label\s*\n?\s*\/\/ contradicting its own number/);
  });
});

describe("the toolbar is a toolbar, not a block", () => {
  it("the period pills never wrap", () => {
    // Regression: PeriodSelector was flex-wrap, so adding the stepper beside it broke the pills
    // into three ragged stacked rows — Today Week / Month Quarter / Year All / Custom.
    const src = read("apps/app/src/components/ui/period-selector.tsx");
    expect(src).not.toMatch(/flex flex-wrap items-center gap-2/);
    expect(src).toMatch(/inline-flex shrink-0 items-center gap-0\.5 whitespace-nowrap/);
  });

  it("the stepper and its badge never wrap either", () => {
    const src = read("apps/app/src/components/ui/period-nav.tsx");
    expect(src).toMatch(/flex shrink-0 items-center gap-1\.5 whitespace-nowrap/);
    // "closed period" wrapped inside its own pill; it is a dot + one word now.
    expect(src).not.toMatch(/>closed period</);
    expect(src).toMatch(/title="Closed period — shown in full, not period-to-date"/);
  });

  it("the lens has its OWN row — it does not borrow space the tab strip lacks", () => {
    // Measured: 7 pills + stepper + currency need ~620px; the strip has 560, so the leading pills
    // spilled left UNDER the tabs and "Today" became unreachable at x=796 vs a strip starting 856.
    const shell = read("apps/app/src/routes/dashboard/finance/shell.tsx");
    expect(shell).toMatch(/id="finance-shell-period"/);
    expect(read("apps/app/src/components/finance/finance-toolbar.tsx")).toMatch(/periodLens\?: ReactNode/);
  });

  it("every stepping surface names its window instead of saying 'this month'", () => {
    for (const f of [
      "apps/app/src/routes/dashboard/finance/reports.tsx",
      "apps/app/src/routes/dashboard/finance/invoices.tsx",
      "apps/app/src/routes/dashboard/finance/expenses.tsx",
      "apps/app/src/routes/dashboard/insights.tsx",
    ]) {
      expect(read(f), f).toMatch(/: periodName \? periodName/);
    }
  });
});
