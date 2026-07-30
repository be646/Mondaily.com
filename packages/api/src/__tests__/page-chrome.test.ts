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
