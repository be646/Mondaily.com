import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Step 2 of the sheet rework: the view is a query, and it resolves in ONE place.
 * Only the first sort rule used to reach SQL, and numeric/owner filters never did — so past the
 * page cap, SQL chose which rows you got by one ranking while the browser ranked them by another.
 */
const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const ubc = () => read("packages/db/src/ubc.ts");
const nodesRoute = () => read("packages/api/src/routes/nodes.ts");
const table = () => read("apps/app/src/components/records/record-table.tsx");
const migration = () => read("packages/db/migrations/20260802_list_records.sql");

describe("every sort rule reaches SQL, in order", () => {
  it("listNodes applies the whole rule list, not just the first", () => {
    expect(ubc()).toMatch(/for \(const s of applied\)/);
    expect(ubc()).toMatch(/const applied = sorts\.filter\(s => s\.col && SAFE_COL\.test\(s\.col\)\)/);
  });

  it("SQL NULLs sink in both directions", () => {
    expect(ubc()).toMatch(/nullsFirst: false/);
  });

  it("the empty-STRING limit is documented, not claimed as solved", () => {
    // Verified live on deals.amount: "" sorted first ascending. nullsFirst only covers real NULLs.
    expect(ubc()).toMatch(/does NOT sink empty STRINGS/);
  });

  it("a sort over a column holding blanks is disclosed as page-scoped", () => {
    expect(table()).toMatch(/typeof v === "string" && v\.trim\(\) === ""/);
  });

  it("a stable id key always terminates the ordering so pages cannot skip or repeat rows", () => {
    expect(ubc()).toMatch(/query = query\.order\("id", \{ ascending: true \}\)/);
  });

  it("the single-rule params still work for older callers", () => {
    expect(ubc()).toMatch(/options\.sort_col\s*\n?\s*\?\s*\[\{ col: options\.sort_col/);
  });

  it("the route accepts and shape-validates the rule list", () => {
    expect(nodesRoute()).toMatch(/sorts: z\.string\(\)\.max\(1000\)\.optional\(\)/);
    expect(nodesRoute()).toMatch(/parsed\.slice\(0, 4\)/);
  });

  it("the client sends every rule", () => {
    expect(table()).toMatch(/params\.set\("sorts", JSON\.stringify\(sqlSorts\)\)/);
  });
});

describe("owner emptiness is answered by SQL, and both engines judge the same value", () => {
  it("Unassigned / Assigned are no longer excluded from the server conditions", () => {
    expect(table()).toMatch(/\(\/owner\|assign\/i\.test\(c\.col\) && c\.op !== "empty" && c\.op !== "not_empty"\)/);
  });

  it("the client tests the STORED owner for emptiness, not the resolved display name", () => {
    expect(table()).toMatch(/const useStored = isOwnerCol && \(c\.op === "empty" \|\| c\.op === "not_empty"\)/);
  });
});

describe("what cannot resolve in SQL is disclosed, never presented as the answer", () => {
  it("the partial set is named with the real denominator", () => {
    expect(table()).toMatch(/const partialReasons = useMemo/);
    expect(table()).toMatch(/computed on \{records\.length\} of \{totalOfType\}/);
  });

  it("nothing is disclosed when the page IS every record — no false alarms on small sheets", () => {
    expect(table()).toMatch(/const loadedIsEverything = totalOfType == null \|\| records\.length >= totalOfType/);
    expect(table()).toMatch(/if \(loadedIsEverything\) return \[\] as string\[\]/);
  });

  it("derived columns are identified by type, not by name guessing", () => {
    expect(table()).toMatch(/t === "formula" \|\| t === "finance_billed" \|\| t === "finance_outstanding"/);
  });

  it("derived columns are never sent as SQL sort keys — there is no stored value to order by", () => {
    expect(table()).toMatch(/sortRules\.filter\(r => !isDerivedCol\(r\.col\)\)/);
  });
});

describe("the list_records migration is shipped but not yet relied upon", () => {
  it("parses numbers the same way the app does, instead of a regexp strip", () => {
    const sql = migration();
    expect(sql).toMatch(/create or replace function mondaily_num/);
    expect(sql).toMatch(/1\.200,50|last_comma > last_dot/);   // European decimal handling
  });

  it("compares gt/lt numerically and skips the condition when the operand is not a number", () => {
    expect(migration()).toMatch(/num_val := mondaily_num\(val\);/);
    expect(migration()).toMatch(/if num_val is not null then/);
  });

  it("ranks ordered categoricals by position, with unknown values after known ones", () => {
    expect(migration()).toMatch(/array_position\(/);
    expect(migration()).toMatch(/nulls last/);
  });

  it("returns the row as jsonb so a stale column list cannot silently drop fields", () => {
    expect(migration()).toMatch(/returns table \(record jsonb, total_count bigint\)/);
    expect(migration()).toMatch(/to_jsonb\(n\.\*\)/);
  });

  it("validates column names inside the function too — it is reachable through PostgREST", () => {
    const sql = migration();
    const guards = sql.match(/\^\[a-zA-Z0-9_-\]\{1,64\}\$/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(3);   // search cols, filter cols, sort cols
  });

  it("no caller depends on the function yet — it must be applied and verified first", () => {
    // The NAME may appear in comments pointing at the migration; what must not exist is an
    // invocation. Unverified plpgsql (no Postgres on the build machine) stays unwired.
    expect(ubc()).not.toMatch(/rpc\(\s*["'`]list_records/);
    expect(read("packages/api/src/routes/nodes.ts")).not.toMatch(/rpc\(\s*["'`]list_records/);
  });
});
