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

describe("the reporting line follows the ledger, not the viewer", () => {
  it("money cells convert to the workspace BASE currency, not the display selector", () => {
    // A EUR invoice shows its USD value because USD is what the business reports in — whether or
    // not this particular person is viewing the page in PLN. Tying it to the selector showed two
    // colleagues different second lines for the same invoice.
    const cell = read("apps/app/src/components/finance/money-cell.tsx");
    expect(cell).toMatch(/const target = \(base \|\| display \|\| ""\)\.toUpperCase\(\)/);
    expect(cell).toMatch(/const \{ base, display, rates \} = useCurrency\(\)/);
  });
});
