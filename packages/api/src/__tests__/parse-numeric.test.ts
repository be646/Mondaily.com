import { describe, it, expect } from "vitest";
import { parseNumeric } from "@mondaily/shared/numbers";

/**
 * THE shared numeric parser (2026-08-01) — replaces `parseFloat(s.replace(/[^0-9.-]/g,""))` at
 * every call site, INCLUDING cell write paths where the old strip permanently stored corrupted
 * numbers ("€1.200,50" saved as 1.2).
 */
describe("parseNumeric — the cases the old regex-strip corrupted", () => {
  it("European decimals", () => {
    expect(parseNumeric("1.200,50")).toBe(1200.5);   // old: 1.2
    expect(parseNumeric("1,5")).toBe(1.5);           // old: 15
    expect(parseNumeric("1.200.300")).toBe(1200300);
  });
  it("US thousands + decimals", () => {
    expect(parseNumeric("1,200")).toBe(1200);
    expect(parseNumeric("1,200,300.25")).toBe(1200300.25);
    expect(parseNumeric("1200.50")).toBe(1200.5);
  });
  it("currency symbols and codes strip cleanly", () => {
    expect(parseNumeric("€5,000")).toBe(5000);
    expect(parseNumeric("$ 1,234.56")).toBe(1234.56);
    expect(parseNumeric("PLN 2 500")).toBe(2500);
  });
  it("magnitude suffixes", () => {
    expect(parseNumeric("€1.2M")).toBe(1_200_000);   // old: 1.2
    expect(parseNumeric("500k")).toBe(500_000);
    expect(parseNumeric("1.5bn")).toBe(1_500_000_000);
  });
  it("accounting negatives", () => {
    expect(parseNumeric("(500)")).toBe(-500);        // old: +500
    expect(parseNumeric("-1,200.50")).toBe(-1200.5);
  });
  it("plain numbers and passthroughs", () => {
    expect(parseNumeric(42)).toBe(42);
    expect(parseNumeric("42")).toBe(42);
    expect(parseNumeric("0")).toBe(0);
  });
  it("honest nulls — never a guessed number", () => {
    expect(parseNumeric("")).toBeNull();
    expect(parseNumeric("—")).toBeNull();
    expect(parseNumeric(null)).toBeNull();
    expect(parseNumeric(undefined)).toBeNull();
    expect(parseNumeric("hello")).toBeNull();
    expect(parseNumeric(NaN)).toBeNull();
  });
});

describe("the parser is actually adopted at the corrupting sites", () => {
  const read = (p: string) => require("node:fs").readFileSync(require("node:path").join(__dirname, "../../../..", p), "utf8");
  it("server aggregate delegates to it", () => {
    expect(read("packages/api/src/lib/aggregate.ts")).toMatch(/return parseNumeric\(v\)/);
  });
  it("cell write paths use it (the paths that stored corrupted values)", () => {
    const t = read("apps/app/src/components/records/record-table.tsx");
    expect(t).toMatch(/const n = parseNumeric\(s\);/);
    expect(t).not.toMatch(/parseFloat\(s\.replace\(\/\[\^0-9\.\\-\]\/g, ""\)\)/);
  });
});
