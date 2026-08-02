import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("no native browser dialogs where a user types or decides", () => {
  it("nothing asks for input through window.prompt", () => {
    // The browser's prompt is its own chrome: another typeface, OS-ordered buttons, an input box no
    // theme reaches. Asking for a money amount in a grey OS box reads as a bug because it looks it.
    for (const f of [
      "apps/app/src/components/records/record-table.tsx",
      "apps/app/src/routes/dashboard/finance/expenses.tsx",
    ]) {
      expect(read(f), f).not.toMatch(/window\.prompt/);
      expect(read(f), f).not.toMatch(/window\.alert/);
    }
  });

  it("the dialog service is mounted once, around the whole dashboard", () => {
    const layout = read("apps/app/src/routes/dashboard/layout.tsx");
    expect(layout).toMatch(/<DialogProvider>/);
    expect(layout).toMatch(/<\/DialogProvider>/);
  });

  it("dismissing always resolves — an awaited dialog that never settles freezes the caller", () => {
    const svc = read("apps/app/src/components/ui/dialog-service.tsx");
    expect(svc).toMatch(/if \(pending\.kind === "prompt"\) pending\.resolve\(null\)/);
    expect(svc).toMatch(/else if \(pending\.kind === "confirm"\) pending\.resolve\(false\)/);
  });

  it("invalid input keeps the dialog open instead of discarding what was typed", () => {
    const svc = read("apps/app/src/components/ui/dialog-service.tsx");
    expect(svc).toMatch(/if \(err\) \{ setError\(err\); return; \}/);
  });

  it("degrades to the native dialog if the provider is missing, rather than losing the action", () => {
    expect(read("apps/app/src/components/ui/dialog-service.tsx"))
      .toMatch(/handle \? handle\.prompt\(o\) : Promise\.resolve\(window\.prompt/);
  });

  it("the formula editor validates in the dialog, not via a second native alert", () => {
    const t = read("apps/app/src/components/records/record-table.tsx");
    expect(t).toMatch(/validate: \(v\) => \{[\s\S]{0,300}evaluateFormula/);
  });

  it("Escape closes, so a dialog is never a trap", () => {
    expect(read("apps/app/src/components/ui/dialog-service.tsx")).toMatch(/if \(e\.key === "Escape"\)/);
  });
});

describe("a column and its own total must be addable", () => {
  it("money cells report in the SAME currency as the page's totals", () => {
    // Cells briefly reported in the workspace base while totals followed the selector. Rows in USD
    // under a KPI in PLN cannot be reconciled, which is the one thing a finance page is for.
    const cell = read("apps/app/src/components/finance/money-cell.tsx");
    expect(cell).toMatch(/const target = \(display \|\| base \|\| ""\)\.toUpperCase\(\)/);
  });

  it("the page says when it is NOT showing the reporting currency, and offers to switch back", () => {
    // Without this a USD business can read PLN totals for weeks and quote them, never learning the
    // figures were neither the charged amounts nor the reported ones.
    const notice = read("apps/app/src/components/finance/currency-basis-notice.tsx");
    expect(notice).toMatch(/This workspace reports in/);
    expect(notice).toMatch(/setDisplay\.mutate\(b\)/);
    expect(notice).toMatch(/if \(!b \|\| !d \|\| b === d\) return null;/);   // silent when they agree
  });

  it("it is mounted once for the whole finance surface", () => {
    expect(read("apps/app/src/routes/dashboard/finance/shell.tsx")).toMatch(/<CurrencyBasisNotice \/>/);
  });
});

describe("one page, one method of valuing money", () => {
  const rep = () => read("apps/app/src/routes/dashboard/finance/reports.tsx");

  it("EVERY figure on reports goes through the frozen sum", () => {
    // The KPI tiles were converted first, leaving the chart, top clients, status breakdown, credit
    // reasons and overdue total still re-converting live — the same page reporting two ways.
    expect(rep()).not.toMatch(/sumInDisplay/);
  });

  it("the per-type money adapters are gone — readMoney knows every shape", () => {
    const s = rep();
    expect(s).not.toMatch(/const inv\$ = /);
    expect(s).not.toMatch(/const cn\$ = /);
    expect(s).not.toMatch(/const exp\$ = /);
  });
});
