import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aggregateRows, aggregateGrouped, aggNum, aggChecked, groupKeyOf, applyFilters, type AggRow } from "../lib/aggregate";

// ECB "units per 1 EUR": 1 EUR = 1.10 USD = 0.85 GBP.
const RATES = { USD: 1.10, GBP: 0.85 };
const row = (data: Record<string, unknown>, created_at?: string): AggRow => ({ data, created_at });

describe("aggregate.ts — deterministic record math", () => {
  const rows: AggRow[] = [
    row({ amount: 100, paid: true, stage: "Won" }),
    row({ amount: 50, paid: false, stage: "Open" }),
    row({ amount: "$25.50", paid: "yes", stage: "Won" }),
    row({ amount: null, paid: false, stage: "Open" }),
  ];

  it("count / filled / checked read real rows (no fabrication)", () => {
    expect(aggregateRows(rows, "count", "amount").value).toBe(4);
    expect(aggregateRows(rows, "filled", "amount").value).toBe(3);   // null is not filled
    expect(aggregateRows(rows, "checked", "paid").value).toBe(2);    // true + "yes"
  });
  it("sum / avg / min / max skip non-numeric and tolerate money strings", () => {
    expect(aggregateRows(rows, "sum", "amount").value).toBeCloseTo(175.5, 6);
    expect(aggregateRows(rows, "avg", "amount").value).toBeCloseTo(175.5 / 3, 6);
    expect(aggregateRows(rows, "min", "amount").value).toBe(25.5);
    expect(aggregateRows(rows, "max", "amount").value).toBe(100);
  });
  it("empty set aggregates to 0, never a guess", () => {
    expect(aggregateRows([], "sum", "amount")).toEqual({ value: 0, count: 0, unconverted: 0 });
  });
  it("aggNum/aggChecked helpers are honest", () => {
    expect(aggNum("$1,200.50")).toBeCloseTo(1200.5, 6);
    expect(aggNum("n/a")).toBeNull();
    expect(aggChecked("paid")).toBe(true);
    expect(aggChecked(0)).toBe(false);
  });
});

describe("aggregate.ts — currency sums are conversion-aware and FAIL CLOSED", () => {
  const money = [
    row({ price: 100, currency: "USD" }),
    row({ price: 100, currency: "GBP" }),
    row({ price: 100, currency: "JPY" }), // no rate for JPY → unconverted, face value
  ];
  it("converts each row to the target currency via the shared convert()", () => {
    const r = aggregateRows(money, "sum", "price", { target: "USD", base: "USD", rates: RATES });
    // 100 USD + (100 GBP→USD = 100/0.85*1.10 ≈ 129.41) + 100 JPY face (no rate) ≈ 329.41
    expect(r.value).toBeCloseTo(100 + (100 / 0.85) * 1.10 + 100, 4);
    expect(r.unconverted).toBe(1); // JPY flagged, never guessed
  });
  it("same-currency rows need no conversion and are not flagged", () => {
    const r = aggregateRows([row({ price: 10, currency: "USD" }), row({ price: 5, currency: "USD" })], "sum", "price", { target: "USD", base: "USD", rates: RATES });
    expect(r.value).toBe(15);
    expect(r.unconverted).toBe(0);
  });
});

describe("aggregate.ts — grouping by status/stage/owner/date", () => {
  it("groups rows and aggregates each bucket, sorted by label", () => {
    const rows: AggRow[] = [
      row({ amount: 100, stage: "Won" }), row({ amount: 50, stage: "Open" }), row({ amount: 25, stage: "Won" }),
    ];
    const g = aggregateGrouped(rows, "sum", "amount", "stage");
    expect(g).toEqual([
      { label: "Open", value: 50, count: 1, unconverted: 0 },
      { label: "Won", value: 125, count: 2, unconverted: 0 },
    ]);
  });
  it("date grouping buckets by month from created_at; owner resolves alias keys", () => {
    expect(groupKeyOf(row({}, "2026-03-15T00:00:00Z"), "date")).toBe("2026-03");
    expect(groupKeyOf(row({ deal_owner: "Alex" }), "owner")).toBe("Alex");
    expect(groupKeyOf(row({}), "status")).toBe("—"); // honest missing
  });
  it("group-by an ARBITRARY column key reads that value directly (Phase 3b.1)", () => {
    expect(groupKeyOf(row({ region: "EU" }), "region")).toBe("EU");
    expect(groupKeyOf(row({}), "region")).toBe("—"); // honest missing
    expect(groupKeyOf(row({ region: "EU" }), "none")).toBe("all");
  });
});

describe("aggregate.ts — equality filters (the record table's quickFilters), case-insensitive AND", () => {
  const rows: AggRow[] = [
    row({ amount: 100, stage: "Won", region: "EU" }),
    row({ amount: 50, stage: "won", region: "US" }),
    row({ amount: 25, stage: "Open", region: "EU" }),
  ];
  it("no filters is a pass-through", () => {
    expect(applyFilters(rows).length).toBe(3);
    expect(applyFilters(rows, []).length).toBe(3);
  });
  it("filters are case-insensitive and AND-combined; a filtered total matches only the kept rows", () => {
    const kept = applyFilters(rows, [{ column: "stage", value: "WON" }]);
    expect(kept.length).toBe(2);
    expect(aggregateRows(kept, "sum", "amount").value).toBe(150);
    const both = applyFilters(rows, [{ column: "stage", value: "won" }, { column: "region", value: "eu" }]);
    expect(both.length).toBe(1);
    expect(aggregateRows(both, "sum", "amount").value).toBe(100);
  });
  it("a filter on a non-existent column matches nothing — honest empty, never an error", () => {
    expect(applyFilters(rows, [{ column: "nope", value: "x" }]).length).toBe(0);
  });
});

// ── Route-level guards (source): isolation, validation, cap/truncation, shared helpers, no finance dup ──
const route = readFileSync(fileURLToPath(new URL("../routes/records.ts", import.meta.url)), "utf8");
describe("POST /records/aggregate — safe, workspace-scoped, honest", () => {
  it("requires auth and scopes EVERY query to the caller's workspace", () => {
    expect(route).toMatch(/router\.use\("\*", requireAuth\)/);
    expect((route.match(/\.eq\("workspace_id", ws\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(route).not.toMatch(/\.eq\("workspace_id", [^w]/); // never a workspace id from user input
  });
  it("validates object_type/column/op/group_by/filters (no raw SQL from user input)", () => {
    expect(route).toMatch(/object_type: z\.string\(\)\.min\(1\)\.max\(64\)\.regex/);
    expect(route).toMatch(/op: z\.enum\(\["count", "sum", "avg", "min", "max", "filled", "checked"\]\)/);
    // group_by is now a validated key (none | date | keyword | column), not a fixed enum.
    expect(route).toMatch(/group_by: z\.string\(\)\.max\(120\)\.regex\(KEY, "invalid group_by"\)/);
    // filters are validated equality pairs, capped in count, each column key-shaped.
    expect(route).toMatch(/filters: z\.array\(z\.object\(\{ column: z\.string\(\)\.min\(1\)\.max\(120\)\.regex\(KEY\), value: z\.string\(\)\.max\(200\) \}\)\)\.max\(8\)/);
    expect(route).toMatch(/const KEY = \/\^\[a-z0-9_\.-\]\+\$\/i/);
  });
  it("filters run in-memory over fetched rows — never a dynamic .eq() from a user key", () => {
    expect(route).toMatch(/applyFilters\(truncated \? all\.slice\(0, CAP\) : all, filters\)/);
    // the only .eq() calls are the fixed workspace_id + object_type scopes
    expect(route).not.toMatch(/\.eq\(`data/);
    expect(route).not.toMatch(/\.eq\(\$\{/);
  });
  it("count with no grouping AND no filters uses a cheap head count; else caps rows + flags truncation", () => {
    expect(route).toMatch(/op === "count" && group_by === "none" && !hasFilters/);
    expect(route).toMatch(/count: "exact", head: true/);
    expect(route).toMatch(/const CAP = 10_000/);
    expect(route).toMatch(/const truncated = all\.length > CAP/);
    expect(route).toMatch(/\.limit\(CAP \+ 1\)/);
  });
  it("currency conversion reuses the shared helpers only, toward the user's display currency", () => {
    expect(route).toMatch(/userDisplayCurrency\(ws, c\.get\("userId"\)\)/);
    expect(route).toMatch(/workspaceBaseCurrency\(ws\)/);
    expect(route).toMatch(/loadRates\(\)/);
    // only converts when the CALLER flags the column as currency — never re-inferred from data
    expect(route).toMatch(/if \(currency && numericOp\)/);
  });
  it("stays generic — never queries finance verticals or the finance rollup converter", () => {
    // No hardcoded finance object_type / vertical, and no reuse of the finance rollup's makeBaseConverter.
    expect(route).not.toMatch(/vertical",\s*"finance"|object_type",\s*"invoice"|object_type",\s*"expense"|makeBaseConverter/);
  });
});
