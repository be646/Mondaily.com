import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "../../../../apps/app/src");
const app = (p: string) => readFileSync(join(APP, p), "utf8");
const controls = app("components/ui/controls.tsx");
const layout = app("routes/dashboard/layout.tsx");

/**
 * Page-chrome contract, phase 1. The complaint was threefold: the browser tab always said
 * "Mondaily" (document.title was never set anywhere in the app), the kicker repeated the page name
 * the sidebar already showed, and the repeated kicker pushed content down over a dense page.
 */
describe("the browser tab says where you are", () => {
  it("CommandPageHeader sets document.title from the page title", () => {
    const header = controls.slice(controls.indexOf("export function CommandPageHeader"));
    expect(header).toMatch(/document\.title = `\$\{title\} · Mondaily`/);
  });

  it("the layout provides a route fallback for pages without a header", () => {
    expect(layout).toMatch(/document\.title = nice === "Mondaily" \? "Mondaily" : `\$\{nice\} · Mondaily`/);
    // keyed on navigation, so it re-fires per page
    expect(layout).toMatch(/\}, \[location\.pathname\]\);/);
  });

  it("the fallback stands down when a page header titled itself", () => {
    // Child effects run before parent effects, so the header fires FIRST and the layout would
    // overwrite it — "Meeting with Anna" became "Calls". Verified live before this claim flag
    // existed. Both halves must exist: the header claims, the layout checks.
    expect(controls).toMatch(/__mdTitledPath = window\.location\.pathname/);
    expect(layout).toMatch(/if \(claimed === location\.pathname\) return;/);
  });

  it("the route map covers the pages the complaint named", () => {
    // goals, insights, finance pages, calendar, inbox(messages), canvas — the exact list reported
    // as showing "Mondaily".
    for (const path of ['"/goals"', '"/insights"', '"/calendar"', '"/messages"', '"/canvas"', '"/finance/invoices"', '"/finance/quotes"', '"/finance/expenses"', '"/briefing"', '"/pipeline"']) {
      expect(layout, `route map missing ${path}`).toContain(path);
    }
  });
});

describe("a kicker never repeats the page name", () => {
  it("redundant call-signs are dropped and the title collapses up a row", () => {
    const header = controls.slice(controls.indexOf("function redundantCallsign"));
    expect(header).toMatch(/const kicker = callsign && !redundantCallsign\(callsign, title\)/);
    // both layouts exist: kicker row + title below, OR one compact row with the icon beside the h1
    expect(header).toMatch(/\{kicker \? \(/);
  });

  it("catches singular/plural and phrase-containment repeats", () => {
    // INBOX/"Inbox", TASKS/"Tasks", GOALS/"Goal-directed agents", INSIGHTS/"Workspace Insights"
    expect(controls).toMatch(/\.replace\(\/s\$\/, ""\)/);
    expect(controls).toMatch(/t\.includes\(c\) \|\| c\.includes\(t\)/);
  });
});

describe("the slim two-bar idiom (Pass BAR-1)", () => {
  it("the segmented control is hairline, not a boxed track", () => {
    // Measured against a reference dashboard, not guessed: no group border, no lifted card —
    // bare text segments with a faint ink wash (~5%) on the active one. The boxy pill track was
    // the "filters look like boxes" complaint.
    const seg = readFileSync(join(APP, "components/ui/segmented.tsx"), "utf8");
    expect(seg).not.toMatch(/rounded-lg border p-0\.5/);
    expect(seg).not.toMatch(/boxShadow/);
    expect(seg).toMatch(/color-mix\(in srgb, var\(--text-primary\) 5%, transparent\)/);
  });

  it("CommandPageHeader has the bar variant: one hairline row, ~44px, content starts below", () => {
    expect(controls).toMatch(/variant\?: "block" \| "bar"/);
    const bar = controls.slice(controls.indexOf('if (variant === "bar")'));
    expect(bar).toMatch(/h-11 items-center/);
    expect(bar).toMatch(/border-b/);
  });

  it("the first adopter group runs the bar with content pulled up", () => {
    for (const f of ["routes/dashboard/goals.tsx", "routes/dashboard/messages.tsx", "routes/dashboard/decisions.tsx"]) {
      const s = readFileSync(join(APP, f), "utf8");
      expect(s, `${f} missing variant="bar"`).toMatch(/variant="bar"/);
      expect(s, `${f} still has tall top padding`).toMatch(/pt-2 pb-[68]/);
    }
  });
});
