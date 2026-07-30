import { describe, it, expect } from "vitest";
import { evaluateFormula, formulaFields } from "@mondaily/shared/formula";

/**
 * Records-as-AI-Sheets formula engine — REAL executed tests (the evaluator runs here, these are
 * not source-read guards). The engine's contract: deterministic, no eval(), and every failure is
 * an honest { ok:false, error } — a formula never fabricates a value.
 */
const row = { price: 100, qty: 3, discount: "10", name: "Acme", paid: true, due_date: "2026-08-04" };
const ev = (src: string, data: Record<string, unknown> = row) => evaluateFormula(src, data, { now: new Date("2026-07-30T12:00:00Z") });

describe("arithmetic + field references", () => {
  it("computes with {braced} and bare field refs, spaces ≙ underscores, case-insensitive", () => {
    expect(ev("{price} * {qty}")).toEqual({ ok: true, value: 300 });
    expect(ev("price * qty")).toEqual({ ok: true, value: 300 });
    expect(ev("{Due Date} = '2026-08-04'").ok && (ev("{Due Date} = '2026-08-04'") as { value: unknown }).value).toBe(true);
  });
  it("numeric strings coerce; precedence and parens hold", () => {
    expect(ev("price - price * discount / 100")).toEqual({ ok: true, value: 90 });
    expect(ev("(price + qty) * 2")).toEqual({ ok: true, value: 206 });
    expect(ev("-qty + 5")).toEqual({ ok: true, value: 2 });
  });
  it("string concat via & never invents numbers", () => {
    expect(ev("name & ' #' & qty")).toEqual({ ok: true, value: "Acme #3" });
  });
});

describe("functions", () => {
  it("IF / ROUND / ABS / MIN / MAX / SUM / LEN", () => {
    expect(ev("IF(paid, 'settled', 'open')")).toEqual({ ok: true, value: "settled" });
    expect(ev("ROUND(10/3, 2)")).toEqual({ ok: true, value: 3.33 });
    expect(ev("ABS(0 - qty)")).toEqual({ ok: true, value: 3 });
    expect(ev("MIN(price, qty, 7)")).toEqual({ ok: true, value: 3 });
    expect(ev("MAX(price, qty)")).toEqual({ ok: true, value: 100 });
    expect(ev("SUM(1, 2, qty)")).toEqual({ ok: true, value: 6 });
    expect(ev("LEN(name)")).toEqual({ ok: true, value: 4 });
  });
  it("DAYS + TODAY are date-aware and deterministic under an injected clock", () => {
    expect(ev("DAYS(due_date, TODAY())")).toEqual({ ok: true, value: 5 });
  });
  it("comparisons + AND/OR/NOT", () => {
    expect(ev("price > 50 AND qty < 5")).toEqual({ ok: true, value: true });
    expect(ev("price < 50 OR paid")).toEqual({ ok: true, value: true });
    expect(ev("NOT paid")).toEqual({ ok: true, value: false });
  });
});

describe("honest failure — never a fabricated value, never a throw", () => {
  it("division by zero, bad dates, unknown functions, syntax errors", () => {
    for (const bad of ["price / 0", "DAYS(name, TODAY())", "NOPE(1)", "price +", "{unclosed", "1 ! 2"]) {
      const r = ev(bad);
      expect(r.ok, bad).toBe(false);
      expect((r as { error: string }).error.length).toBeGreaterThan(0);
    }
  });
  it("missing fields resolve to null → arithmetic treats empty as 0, honest not crashy", () => {
    expect(ev("{ghost} + 5")).toEqual({ ok: true, value: 5 });
  });
  it("no eval/Function anywhere in the engine (sovereignty of execution)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    // strip comments first — the doc header legitimately SAYS "no eval()"
    const src = readFileSync(join(__dirname, "../../../shared/src/formula.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/\beval\s*\(/);
    expect(src).not.toMatch(/new Function/);
  });
});

describe("formulaFields — dependency extraction", () => {
  it("lists referenced fields, ignoring function names and keywords", () => {
    expect(formulaFields("IF({Price} > 0, price * qty, 0)").sort()).toEqual(["Price", "price", "qty"].sort());
    expect(formulaFields("TODAY()")).toEqual([]);
  });
});
