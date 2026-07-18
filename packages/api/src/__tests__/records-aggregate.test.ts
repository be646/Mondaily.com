import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aggregateRows, aggregateGrouped, aggregateTop, dateBucketKey, aggNum, aggChecked, groupKeyOf, applyFilters, type AggRow } from "../lib/aggregate";

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

describe("aggregate.ts — Phase 3h op:'top' ranks rows by a numeric/currency column", () => {
  const rows: AggRow[] = [
    { id: "a", data: { name: "Alpha", amount: 100 } },
    { id: "b", data: { name: "Bravo", amount: 300 } },
    { id: "c", data: { name: "Cara",  amount: 200 } },
    { id: "d", data: { name: "Dud",   amount: "n/a" } }, // non-numeric → skipped
  ];
  it("returns the highest-value rows first, capped at limit, with id + display name", () => {
    const t = aggregateTop(rows, "amount", 2);
    expect(t.rows.map(r => r.id)).toEqual(["b", "c"]);
    expect(t.rows[0]).toMatchObject({ id: "b", label: "Bravo", value: 300 });
    expect(t.unconverted).toBe(0);
  });
  it("skips rows with no numeric value in the column (never fabricated)", () => {
    const t = aggregateTop(rows, "amount", 10);
    expect(t.rows.map(r => r.id)).toEqual(["b", "c", "a"]); // "d" excluded
  });
  it("is currency-aware and FAILS CLOSED — a missing rate uses face value and is flagged", () => {
    const money = [
      { id: "u", data: { name: "US",  price: 100, currency: "USD" } },
      { id: "g", data: { name: "GB",  price: 100, currency: "GBP" } }, // 100 GBP→USD ≈ 129.41
      { id: "j", data: { name: "JP",  price: 500, currency: "JPY" } }, // no rate → face 500, flagged
    ];
    const t = aggregateTop(money, "price", 10, { target: "USD", base: "USD", rates: RATES });
    expect(t.rows[0].id).toBe("j");              // face 500 ranks first (fail-closed, honest)
    expect(t.rows.every(r => r.currency === "USD")).toBe(true);
    expect(t.rows.find(r => r.id === "j")!.unconverted).toBe(true);
    expect(t.unconverted).toBe(1);
  });
});

describe("aggregate.ts — Phase 3h generic date buckets (pure UTC, sortable keys)", () => {
  const d = "2026-03-09T14:25:00Z"; // Mon 9 Mar 2026, ISO week 11
  it("truncates to each granularity deterministically", () => {
    const dt = new Date(d);
    expect(dateBucketKey(dt, "year")).toBe("2026");
    expect(dateBucketKey(dt, "quarter")).toBe("2026-Q1");
    expect(dateBucketKey(dt, "month")).toBe("2026-03");
    expect(dateBucketKey(dt, "day")).toBe("2026-03-09");
    expect(dateBucketKey(dt, "hour")).toBe("2026-03-09T14");
    expect(dateBucketKey(dt, "week")).toBe("2026-W11");
  });
  it("group_by:'date' honours the bucket arg (default stays month, back-compat)", () => {
    expect(groupKeyOf({ data: {}, created_at: d }, "date")).toBe("2026-03");         // default month
    expect(groupKeyOf({ data: {}, created_at: d }, "date", "day")).toBe("2026-03-09");
    expect(groupKeyOf({ data: {}, created_at: d }, "date", "quarter")).toBe("2026-Q1");
    expect(groupKeyOf({ data: {} }, "date", "day")).toBe("—");                        // no date → honest
  });
  it("aggregateGrouped buckets by day when asked, sorted chronologically by key", () => {
    const rows: AggRow[] = [
      { data: { amount: 10 }, created_at: "2026-03-09T01:00:00Z" },
      { data: { amount: 5 },  created_at: "2026-03-10T01:00:00Z" },
      { data: { amount: 7 },  created_at: "2026-03-09T20:00:00Z" },
    ];
    const g = aggregateGrouped(rows, "sum", "amount", "date", undefined, "day");
    expect(g).toEqual([
      { label: "2026-03-09", value: 17, count: 2, unconverted: 0 },
      { label: "2026-03-10", value: 5,  count: 1, unconverted: 0 },
    ]);
  });
});

describe("aggregate.ts — date bucket reads the SAME timestamp the caller filtered on (dateField)", () => {
  // A row whose created_at and updated_at fall in DIFFERENT day buckets — the whole point of the fix.
  const divergent: AggRow = { data: { amount: 100 }, created_at: "2026-03-01T00:00:00Z", updated_at: "2026-03-20T00:00:00Z" };
  it("defaults to created_at (back-compat) when no dateField is given", () => {
    expect(groupKeyOf(divergent, "date", "day")).toBe("2026-03-01");
    expect(groupKeyOf(divergent, "date", "day", "created_at")).toBe("2026-03-01");
  });
  it("buckets by updated_at when dateField is updated_at", () => {
    expect(groupKeyOf(divergent, "date", "day", "updated_at")).toBe("2026-03-20");
  });
  it("a divergent row lands in a DIFFERENT bucket depending on the field", () => {
    const byCreated = aggregateGrouped([divergent], "sum", "amount", "date", undefined, "day", "created_at");
    const byUpdated = aggregateGrouped([divergent], "sum", "amount", "date", undefined, "day", "updated_at");
    expect(byCreated[0]!.label).toBe("2026-03-01");
    expect(byUpdated[0]!.label).toBe("2026-03-20");
    expect(byCreated[0]!.label).not.toBe(byUpdated[0]!.label);
  });
  it("missing updated_at → honest '—' bucket (never a fabricated date)", () => {
    expect(groupKeyOf({ data: {}, created_at: "2026-03-01T00:00:00Z" }, "date", "day", "updated_at")).toBe("—");
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
    expect(route).toMatch(/op: z\.enum\(\["count", "sum", "avg", "min", "max", "filled", "checked", "top"\]\)/);
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
    expect(route).toMatch(/if \(currency && \(numericOp \|\| op === "top"\)\)/);
  });
  it("stays generic — never queries finance verticals or the finance rollup converter", () => {
    // No hardcoded finance object_type / vertical, and no reuse of the finance rollup's makeBaseConverter.
    expect(route).not.toMatch(/vertical",\s*"finance"|object_type",\s*"invoice"|object_type",\s*"expense"|makeBaseConverter/);
  });
});

describe("POST /records/aggregate — Phase 3e date_filter (safe, SQL-applied, fail-closed)", () => {
  it("validates date_filter: field enum, ISO from/to, at least one bound (invalid → 400)", () => {
    expect(route).toMatch(/date_filter: z\.object\(\{\s*field: z\.enum\(\["created_at", "updated_at"\]\)/);
    expect(route).toMatch(/from: z\.string\(\)\.refine\(\(s\) => !Number\.isNaN\(Date\.parse\(s\)\), "invalid from date"\)\.optional\(\)/);
    expect(route).toMatch(/to: z\.string\(\)\.refine\(\(s\) => !Number\.isNaN\(Date\.parse\(s\)\), "invalid to date"\)\.optional\(\)/);
    expect(route).toMatch(/\.refine\(\(d\) => d\.from != null \|\| d\.to != null, "date_filter needs from or to"\)/);
  });
  it("applies the range in SQL on a FIXED root column via .gte/.lte — no dynamic column from user input", () => {
    expect(route).toMatch(/out = out\.gte\(date_filter\.field, date_filter\.from\)/);
    expect(route).toMatch(/out = out\.lte\(date_filter\.field, date_filter\.to\)/);
    // field is an enum, so date_filter.field is only ever "created_at" | "updated_at".
    expect(route).not.toMatch(/\.gte\(`|\.lte\(`|\.gte\(\$\{|\.lte\(\$\{/);
  });
  it("date filter is applied BEFORE the cap (correct window) on BOTH the count + fetch paths", () => {
    expect(route).toMatch(/const \{ count, error \} = await withDate\(supabase/);
    expect(route).toMatch(/const \{ data, error \} = await withDate\(supabase/);
    // withDate's closing `))` is followed by .order().limit() → the range narrows the query pre-cap.
    expect(route).toMatch(/\)\)\s*\.order\("created_at", \{ ascending: true \}\)\s*\.limit\(CAP \+ 1\)/);
  });
});

describe("POST /records/aggregate — Phase 3h op:'top' + generic date bucket (bounded, safe, honest)", () => {
  it("adds 'top' to the op enum and validates limit (1..50) + bucket enum", () => {
    expect(route).toMatch(/op: z\.enum\(\["count", "sum", "avg", "min", "max", "filled", "checked", "top"\]\)/);
    expect(route).toMatch(/limit: z\.number\(\)\.int\(\)\.min\(1\)\.max\(50\)\.default\(10\)/);
    expect(route).toMatch(/bucket: z\.enum\(\["hour", "day", "week", "month", "quarter", "year"\]\)\.default\("month"\)/);
  });
  it("ranks in-memory via the shared helper — never an ORDER BY on a JSON data key", () => {
    expect(route).toMatch(/aggregateTop\(rows, column, limit, money\)/);
    // the sort is done in aggregateTop over already-fetched rows; no dynamic order on a data-> key
    expect(route).not.toMatch(/\.order\(`data|\.order\(\$\{|order\("data->/);
  });
  it("top is currency-aware (money context extends to it) and returns honest rows/truncated/unconverted", () => {
    expect(route).toMatch(/if \(currency && \(numericOp \|\| op === "top"\)\)/);
    expect(route).toMatch(/rows: t\.rows, total_rows: rows\.length, truncated, unconverted: t\.unconverted, currency: currencyCode/);
  });
  it("top rows come from the SAME workspace/date/filter-scoped, capped fetch (no separate query)", () => {
    // aggregateTop consumes `rows` — the applyFilters(...) output of the capped, workspace-scoped fetch.
    expect(route).toMatch(/const rows = applyFilters\(truncated \? all\.slice\(0, CAP\) : all, filters\)/);
  });
  it("the date bucket + dateField are passed to the grouped path (buckets on the filtered timestamp)", () => {
    expect(route).toMatch(/const dateField = date_filter\?\.field \?\? "created_at"/);
    expect(route).toMatch(/aggregateGrouped\(rows, op, column, group_by, money, bucket, dateField\)/);
  });
  it("fetches BOTH root timestamps so a date bucket can read created_at or updated_at", () => {
    expect(route).toMatch(/\.select\("id,data,created_at,updated_at"\)/);
  });
  it("dateField is bounded to the date_filter enum — only created_at | updated_at ever reach the bucket", () => {
    // The bucket source is date_filter.field, and that field is a zod enum (validated 400 otherwise).
    expect(route).toMatch(/field: z\.enum\(\["created_at", "updated_at"\]\)/);
  });
  it("column stays regex-bounded — top can't rank on an unsafe/injected column key", () => {
    expect(route).toMatch(/column: z\.string\(\)\.min\(1\)\.max\(120\)/);
    expect(route).toMatch(/const KEY = \/\^\[a-z0-9_\.-\]\+\$\/i/);
  });
  it("stays generic — no won/lost/open, no value_in, no finance recomputation in the top/bucket path", () => {
    expect(route).not.toMatch(/value_in|isWon|isLost|isOpen|won|lost/i);
    expect(route).not.toMatch(/makeBaseConverter/);
  });
});
