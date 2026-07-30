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

  it("the global top bar is bar 1: 48px, flat page surface, hairline, no boxy controls", () => {
    // Measured spec: exactly 48px (h-12), NOT a lifted card (page surface, not surface-card),
    // one hairline below, compact rounded-md controls. rounded-sm/rounded-lg chrome and the
    // rounded-full agent pill were the "each page a different app" residue in the top bar.
    const status = app("components/ai/agent-status.tsx");
    const topbar = status.slice(status.indexOf("md-topbar"), status.lastIndexOf("Ask side panel"));
    expect(topbar).toMatch(/h-12 items-center/);
    expect(topbar).toMatch(/border-b border-\[var\(--border-soft\)\]/);
    expect(topbar).toMatch(/bg-\[var\(--surface-page\)\]/);
    expect(topbar).not.toMatch(/rounded-sm/);
    expect(topbar).not.toMatch(/rounded-lg/);
    // leftSlot chrome (search trigger, status link, agent chip) follows the same contract
    const slot = layout.slice(layout.indexOf("<AgentStatusBar"), layout.indexOf("VerifyEmailBanner"));
    expect(slot).not.toMatch(/rounded-lg/);
    expect(slot).not.toMatch(/rounded-full border/);
  });

  it("EVERY route header runs the bar variant (ratchet — briefing is the one exemption)", () => {
    // Full adoption 2026-07-30: settings batch + singles. Briefing keeps its warmer block header
    // deliberately (a daily read, not a work surface). A new page using CommandPageHeader without
    // variant="bar" reintroduces the tall block header this pass retired.
    const { execSync } = require("node:child_process");
    const out = execSync(`grep -rln "<CommandPageHeader" "${join(APP, "routes")}"`, { encoding: "utf8" });
    for (const file of out.trim().split("\n")) {
      if (file.endsWith("briefing.tsx")) continue;
      const s = readFileSync(file, "utf8");
      expect(s, `${file} uses the block header — adopt variant="bar"`).toMatch(/variant="bar"/);
    }
  });

  it("the finance shell strip is bar 2: header folds in, action portals to the strip", () => {
    // Inside the shell the page title duplicates the active tab, so FinanceHeader renders no
    // header block — it stamps document.title and portals the page action into
    // #finance-shell-actions. The slot shares Tabs' border-b so the hairline runs unbroken.
    const shell = app("routes/dashboard/finance/shell.tsx");
    expect(shell).toMatch(/id="finance-shell-actions"/);
    expect(shell).toMatch(/border-b border-\[var\(--border-soft\)\]/);
    const ft = app("components/finance/finance-toolbar.tsx");
    expect(ft).toMatch(/createPortal\(action \?\? null, slot\)/);
    expect(ft).toMatch(/document\.title = `\$\{title\} · Mondaily`/);
    expect(ft).toMatch(/__mdTitledPath/);
    // the strip actions are canonical solid primaries, not hand-rolled accent tints
    for (const f of ["invoices", "quotes", "credit-notes", "expenses"]) {
      const s = app(`routes/dashboard/finance/${f}.tsx`);
      expect(s, `${f} primary not canonical`).toMatch(/btn-primary h-7 shrink-0/);
    }
  });

  it("the first adopter group runs the bar with content pulled up", () => {
    // Group 1 (Decisions/Goals/Inbox) verified live 2026-07-30; group 2 (Discovery/Calls/Activity)
    // follows the same contract. Discovery's wrapper differs (flex column shell), so its padding
    // assertion is its own.
    // Decisions AND Calendar left this list 2026-07-30: their headers FOLDED into the control
    // band entirely (finance-shell treatment) — asserted separately.
    for (const f of ["routes/dashboard/goals.tsx", "routes/dashboard/messages.tsx", "routes/dashboard/calls.tsx", "routes/dashboard/activity.tsx", "routes/dashboard/team-oversight.tsx"]) {
      const s = readFileSync(join(APP, f), "utf8");
      expect(s, `${f} missing variant="bar"`).toMatch(/variant="bar"/);
      expect(s, `${f} still has tall top padding`).toMatch(/pt-2 pb-[68]/);
    }
    const disc = readFileSync(join(APP, "routes/dashboard/discovery.tsx"), "utf8");
    expect(disc).toMatch(/variant="bar"/);
    expect(disc).toMatch(/pt-1 pb-1/);
  });
});

describe("Decisions header folds into the lane band (Increment 2)", () => {
  it("no standalone page header remains; queue status renders in the band with real numbers", () => {
    const d = app("routes/dashboard/decisions.tsx");
    expect(d).not.toMatch(/<CommandPageHeader/);
    // the honest signals survived the fold — same computed values, new position
    expect(d).toMatch(/queueStatus\.map/);
    expect(d).toMatch(/\$\{pendingItems\.length\} awaiting/);
    expect(d).toMatch(/\$\{highRisk\} high risk/);
    // keyboard hints kept (tooltip, not a chrome row)
    expect(d).toMatch(/j\/k navigate · a approve · r reject · s snooze/);
  });
});

describe("content primitives (Increment 1 — Panel / Modal / KPI)", () => {
  it("the three primitives exist with their core contracts", () => {
    const panel = app("components/ui/panel.tsx");
    expect(panel).toMatch(/border-b px-3\.5 py-2\.5/);           // fixed header density
    const modal = app("components/ui/modal.tsx");
    expect(modal).toMatch(/role="dialog" aria-modal="true"/);
    expect(modal).toMatch(/e\.key === "Escape"/);
    expect(modal).toMatch(/createPortal/);
    const kpi = app("components/ui/kpi.tsx");
    expect(kpi).toMatch(/telemetry-strip/);                       // formalizes, not forks, the strip
    expect(kpi).toMatch(/font-mono text-stat font-semibold tabular-nums/);
  });

  it("Discovery adopted them: ICP editor is a Modal, watched searches a Panel", () => {
    const d = app("routes/dashboard/discovery.tsx");
    expect(d).toMatch(/<Modal\s*\n?\s*title="Your ideal customer"/);
    expect(d).toMatch(/<Panel icon=\{Bell\} title="Watched searches"/);
  });

  it("Invoices runs ONE KPI strip via KPIGrid, not per-stat telemetry cards", () => {
    const inv = app("routes/dashboard/finance/invoices.tsx");
    expect(inv).toMatch(/<KPIGrid/);
    expect(inv).not.toMatch(/className="telemetry-strip"/);
  });
});
