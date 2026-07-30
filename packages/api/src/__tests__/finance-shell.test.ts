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
