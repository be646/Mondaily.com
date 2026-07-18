import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Phase 1 spreadsheet layer for the record table — typed currency/checkbox/percentage DISPLAY +
 * currency-aware, fail-closed column TOTALS. Frontend-only: no schema change, no finance route
 * change, no formula engine. These guards lock the honesty + reuse invariants.
 */
const table = readFileSync(
  fileURLToPath(new URL("../../../../apps/app/src/components/records/record-table.tsx", import.meta.url)),
  "utf8",
);

describe("record table — typed spreadsheet cells (currency / checkbox / percentage)", () => {
  it("exposes currency, percentage, and checkbox column preset types", () => {
    expect(table).toMatch(/type: "currency",/);
    expect(table).toMatch(/type: "percentage",/);
    expect(table).toMatch(/type: "checkbox",/);
  });
  it("renders each typed cell from the resolved column type", () => {
    expect(table).toMatch(/kind === "checkbox"[\s\S]*?<CheckboxCell/);
    expect(table).toMatch(/kind === "currency"[\s\S]*?<CurrencyCell/);
    expect(table).toMatch(/kind === "percentage"[\s\S]*?<PercentCell/);
  });
  it("checkbox writes a real boolean and reads it back honestly (no faked truthiness)", () => {
    expect(table).toMatch(/function CheckboxCell/);
    expect(table).toMatch(/onChange=\{e => onSave\(e\.target\.checked\)\}/);
    expect(table).toMatch(/function truthy\(v: unknown\): boolean/);
  });
});

describe("record table — column types prefer the persisted server schema, local preset overrides", () => {
  it("reads object_definitions attributes and maps attribute name → data key like the create form", () => {
    expect(table).toMatch(/queryKey: \["object-defs"\]/);
    expect(table).toMatch(/a\.name\.toLowerCase\(\)\.replace\(\/\\s\+\/g, "_"\)/);
  });
  it("effectiveType lets an explicit local preset win, then the server type, then inference", () => {
    expect(table).toMatch(/const local = customCols\.find\(cc => cc\.key === col\)\?\.type;\s*if \(local\) return local;\s*return serverAttrType\.get\(col\);/);
  });
});

describe("record table — currency-aware, fail-closed column totals (no fabricated money)", () => {
  it("currency totals convert each row to the DISPLAY currency via the shared convertAmount helper", () => {
    expect(table).toMatch(/function calcResultTyped/);
    expect(table).toMatch(/convertAmount\(x\.n, x\.cur, ctx\.display, ctx\.rates\)/);
    // Reuses the shared money formatter — never a hardcoded symbol.
    expect(table).toMatch(/formatMoney\(agg, ctx\.display\)/);
    expect(table).not.toMatch(/return `\$\$\{/);
  });
  it("a missing FX rate is flagged, never guessed (fail-closed face value + 'unconverted' note)", () => {
    expect(table).toMatch(/if \(v == null\) \{ missing \+= 1; return x\.n; \}/);
    expect(table).toMatch(/missing > 0 \? ` · \$\{missing\} unconverted`/);
  });
  it("checkbox totals COUNT the checked rows; percentage totals AVERAGE — not a raw sum", () => {
    expect(table).toMatch(/kind === "checkbox"[\s\S]*?records\.filter\(r => truthy\(r\.data\[col\]\)\)\.length/);
    expect(table).toMatch(/\$\{checked\} checked/);
    expect(table).toMatch(/kind === "percentage"[\s\S]*?op === "avg"/);
  });
  it("reuses the shared currency system (convertAmount + useCurrency), no bespoke money math", () => {
    expect(table).toMatch(/import \{ formatMoney, convertAmount, useCurrency \} from "\.\.\/\.\.\/hooks\/useCurrency"/);
    expect(table).toMatch(/const \{ base: wsBase, display: wsDisplay, rates: fxRates \} = useCurrency\(\)/);
  });
  it("the footer total call is type-aware (passes the resolved kind + currency context)", () => {
    expect(table).toMatch(/calcResultTyped\(calculations\[col\], col, sorted, effectiveType\(col\), \{ display: wsDisplay, rates: fxRates, base: wsBase \}\)/);
  });
});
