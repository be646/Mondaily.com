import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Ask audit. The standing lesson on this surface is that a tool can be right about what it fetched
 * and wrong about what it represents — so the checks here are about what the ANSWER means.
 */
const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const ask = () => read("packages/api/src/routes/ask.ts");

describe("finance answers reconcile with the finance pages", () => {
  it("reports the base-currency total from each invoice's FROZEN valuation", () => {
    // Ask said "9,814.16 EUR + 92,686.84 USD" while Reports said "US$115,692.57" — both true,
    // neither reconcilable against the other without doing FX in your head.
    const s = ask();
    expect(s).toMatch(/const baseCur = \(await workspaceBaseCurrency\(workspaceId\)\)\.toUpperCase\(\)/);
    expect(s).toMatch(/baseMinor \+= toMinor\(m\.base_amount, baseCur\)/);
  });

  it("still groups per currency — the honest detail is not replaced", () => {
    expect(ask()).toMatch(/const perCurrency = \[\.\.\.byCur\]\.map\(\(\[c, v\]\) => `\$\{v\.toFixed\(2\)\} \$\{c\}`\)\.join\(" \+ "\)/);
  });

  it("EXCLUDES an invoice with no stored rate and says how many", () => {
    // Converting it at today's rate would be inventing a number the record never carried.
    const s = ask();
    expect(s).toMatch(/else unvalued \+= 1;/);
    expect(s).toMatch(/excluding \$\{unvalued\} with no stored rate/);
  });

  it("adds nothing when the workspace is single-currency — no noise", () => {
    expect(ask()).toMatch(/if \(byCur\.size === 1 && byCur\.has\(baseCur\)\) return perCurrency;/);
  });

  it("sums in integers, like every other money total", () => {
    expect(ask()).toMatch(/fromMinor\(baseMinor, baseCur\)/);
  });

  it("keeps the truncation disclosure — a capped scan is a LOWER BOUND", () => {
    expect(ask()).toMatch(/LOWER BOUND, not the full picture/);
  });

  it("keeps the no-fabrication rule", () => {
    expect(ask()).toMatch(/NEVER FABRICATE DATA/);
  });
});
