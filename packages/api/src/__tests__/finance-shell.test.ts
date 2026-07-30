import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "../../../../apps/app/src");
const app = (p: string) => readFileSync(join(APP, p), "utf8");
const shell = app("routes/dashboard/finance/shell.tsx");
const routes = app("App.tsx");
const sidebar = app("components/layout/sidebar.tsx");

/**
 * The Finance merge: six surfaces, one tab shell. The safety property is that this is ROUTING plus
 * one strip of chrome — the pages render through the Outlet unchanged, so no money feature can be
 * lost by the merge itself.
 */
describe("the finance tab shell", () => {
  it("mounts all six surfaces as children of one shell", () => {
    expect(routes).toMatch(/<Route path="finance" element=\{<FinanceShell \/>\}>/);
    for (const p of ['path="invoices"', 'path="quotes"', 'path="credit-notes"', 'path="expenses"', 'path="reports"', 'path="approvals"']) {
      expect(routes).toContain(p);
    }
    expect(shell).toMatch(/<Outlet \/>/);
  });

  it("old URLs keep working — /approvals redirects, /finance indexes to invoices", () => {
    expect(routes).toMatch(/<Route path="approvals" element=\{<Navigate to="\/finance\/approvals" replace \/>\} \/>/);
    expect(routes).toMatch(/<Route index element=\{<Navigate to="\/finance\/invoices" replace \/>\} \/>/);
  });

  it("uses THE tab component with real counts, honest about unknowns", () => {
    expect(shell).toMatch(/import \{ Tabs \} from "@\/components\/ui\/tabs"/);
    expect(shell).toMatch(/apiClient\.get\("\/clean\/types"\)/);   // the exact SQL aggregate
    expect(shell).toMatch(/if \(!type \|\| !counts\.data\) return undefined;/);  // unknown → no badge
  });

  it("detail routes stay inside the shell so the strip is one click back", () => {
    expect(routes).toMatch(/path="invoices\/:invoiceId"/);
    expect(routes).toMatch(/path="credit-notes\/:creditNoteId"/);
  });

  it("six sidebar links became one — nothing removed, everything behind the strip", () => {
    expect(sidebar).toMatch(/\{ to: "\/finance\/invoices", label: "Finance", icon: Receipt/);
    expect(sidebar).not.toMatch(/label: "Credit Notes"/);
    expect(sidebar).not.toMatch(/\{ to: "\/approvals",/);
  });
});

describe("the sheet has an always-visible search", () => {
  const table = app("components/records/record-table.tsx");
  it("left-anchored in the toolbar, wired into the same filter path as everything else", () => {
    // The sheet had NO search box — filterQuery is a prop nobody feeds — so finding a record meant
    // opening the Filter panel. The complaint was literally "search bar like attio".
    expect(table).toMatch(/placeholder="Search records…"/);
    expect(table).toMatch(/if \(toolbarSearch\.trim\(\)\) \{/);
    // it participates in the memo deps, the N-of-M counter, and the no-results message
    expect(table).toMatch(/\[records, filterText, filterQuery, toolbarSearch, quickFilters\]/);
    expect(table).toMatch(/toolbarSearch \|\| filterText \|\| filterQuery/);
  });
  it("blocks server-side group representability like the other text filters", () => {
    // A text search is client-side; pretending the grouped server view represents it would lie.
    expect(table).toMatch(/!filterText\.trim\(\) && !filterQuery && !toolbarSearch\.trim\(\)/);
  });
});

describe("design pass A — one indicator vocabulary, one segmented control", () => {
  const indicators = app("components/ui/indicators.tsx");
  const segmented = app("components/ui/segmented.tsx");
  const brief = app("routes/dashboard/briefing.tsx");
  const consolePage = app("routes/dashboard/owner-console.tsx");
  const financeToolbar = app("components/finance/finance-toolbar.tsx");
  const quotes = app("routes/dashboard/finance/quotes.tsx");

  it("DeltaPill and the tone maps exist ONCE, token-backed", () => {
    expect(indicators).toMatch(/export function DeltaPill/);
    expect(indicators).toMatch(/ok: "var\(--status-ok\)"/);
    // the copies are gone — no page defines its own delta pill or risk hexes anymore
    for (const page of [brief, consolePage]) {
      expect(page).not.toMatch(/function Delta/);
      expect(page).not.toMatch(/high: "#d1524a"/);
    }
    expect(brief).toMatch(/from "\.\.\/\.\.\/components\/ui\/indicators"/);
    expect(consolePage).toMatch(/from "\.\.\/\.\.\/components\/ui\/indicators"/);
  });

  it("the segmented control exists once and the finance toolbar uses it", () => {
    expect(segmented).toMatch(/export function SegmentedControl/);
    expect(financeToolbar).toMatch(/<SegmentedControl/);
    // the hand-rolled pill row inside the toolbar is gone
    expect(financeToolbar).not.toMatch(/tabs\.map\(t => \{\s*\n\s*const active = activeTab === t\.key;/);
  });

  it("segment counts render at zero and describe the WHOLE set, not the filtered view", () => {
    expect(segmented).toMatch(/typeof s\.count === "number" &&/);
    // quotes counts come from an UNFILTERED fetch — counting the server-filtered list would show
    // "Draft 0" the moment you filter to Sent
    expect(quotes).toMatch(/queryKey: \["quotes", "", ""\]/);
    expect(quotes).toMatch(/allQuotes\.reduce/);
  });
});

describe("team oversight speaks the app's one label idiom", () => {
  const page = app("routes/dashboard/team-oversight.tsx");
  it("the roster header row is sentence-case, not shouted — records-table precedent", () => {
    expect(page).not.toMatch(/uppercase tracking-wide sm:grid/);
    expect(page).toMatch(/text-\[10\.5px\] font-medium sm:grid/);
  });
  it("form field labels are quiet labels, not micro-kickers", () => {
    expect(page).not.toMatch(/text-\[9\.5px\] font-semibold uppercase[^>]*>Scope/);
    expect(page).toMatch(/text-\[10\.5px\] font-medium" style=\{\{ color: "var\(--text-muted\)" \}\}>Scope/);
  });
  it("section kickers match the console idiom exactly — widest tracking, secondary color", () => {
    // The audit originally called ALL 18 uppercase labels debt; the app's own living idiom
    // (Owner Console SectionLabel) disagrees for section kickers. Normalized TO that idiom
    // instead of away from it: no half-tracked, faint-colored variants left on section labels.
    expect(page).not.toMatch(/font-semibold uppercase tracking-wider" style=\{\{ color: "var\(--text-faint\)"/);
    // data labels inside tiles/chips (period sublabel, signal level) legitimately remain
  });
});
