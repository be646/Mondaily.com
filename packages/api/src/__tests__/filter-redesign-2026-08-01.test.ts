import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards for the 2026-08-01 filter redesign (user-requested): search-first + structured condition
 * chips, applied in SQL over ALL records — replacing the dropdown-per-column row that filtered
 * only the loaded page.
 */
const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const table = () => read("apps/app/src/components/records/record-table.tsx");
const ubc = () => read("packages/db/src/ubc.ts");

describe("filter redesign — server-side filtering", () => {
  it("/nodes accepts q (identity search) and filters (JSON conditions)", () => {
    const nodes = read("packages/api/src/routes/nodes.ts");
    expect(nodes).toMatch(/q: z\.string\(\)\.max\(100\)\.optional\(\)/);
    expect(nodes).toMatch(/filters: z\.string\(\)\.max\(4000\)\.optional\(\)/);
    expect(nodes).toMatch(/FILTER_OPS\.includes/);
  });

  it("free-text search covers the identity fields PLUS the sheet's own columns, escaped and quoted", () => {
    // 2026-08-01 audit: 7 hardcoded fields made server search answer "no rows" for terms the user
    // could SEE on screen; wildcards were unescaped and commas were stripped (making "Smith, John"
    // unfindable). Now: caller columns via q_cols, %/_ escaped, values double-quoted.
    expect(ubc()).toMatch(/"name", "title", "full_name", "email", "phone", "company", "notes",/);
    expect(ubc()).toMatch(/options\.q_cols \?\? \[\]/);
    expect(ubc()).toMatch(/data->>\$\{f\}\.ilike\."%\$\{term\}%"/);
    expect(ubc()).toContain('replace(/[\\\\%_]/g');
  });

  it("column names from the client never reach SQL unless shaped like one", () => {
    expect(ubc()).toMatch(/const SAFE_COL = /);
    expect(ubc()).toMatch(/if \(!SAFE_COL\.test\(f\.col\)\) continue/);
  });

  it("the server refuses numeric gt/lt (jsonb text-compare would lie about numbers)", () => {
    // NodeFilter deliberately has no gt/lt; the client keeps numeric ranges local
    expect(ubc()).toMatch(/op: "is" \| "is_not" \| "contains" \| "empty" \| "not_empty" \| "before" \| "after"/);
    expect(table()).toMatch(/c\.op !== "gt" && c\.op !== "lt"/);
  });

  it("the table sends debounced search + representable conditions to the server", () => {
    expect(table()).toMatch(/const debouncedSearch = useDebounced\(toolbarSearch\.trim\(\), 300\)/);
    // 2026-08-01 sort rebuild: the primary sort rule joined the key — SQL orders the whole type.
    // 2026-08-01 audit: + primarySortNumeric (bug: numeric kind resolved after the fetch and the
    // cached text-ordered page never refetched).
    expect(table()).toMatch(/queryKey: \["records", objectType, debouncedSearch, JSON\.stringify\(serverConds\), primarySort\?\.col \?\? "", primarySort\?\.dir \?\? "", primarySortNumeric\]/);
    expect(table()).toMatch(/params\.set\("filters", JSON\.stringify/);
  });
});

describe("filter redesign — the UI is search-first chips, not a dropdown row", () => {
  it("one text filter, one condition list — the parallel filters are gone", () => {
    expect(table()).not.toMatch(/const \[filterText, setFilterText\]/);
    expect(table()).not.toMatch(/quickFilters/);
    // 2026-08-01 board parity: the state was LIFTED to the page so Table and Board share it —
    // switching views used to silently discard the active filter set.
    expect(table()).toMatch(/conditions, setConditions \} = view/);
    expect(read('apps/app/src/routes/dashboard/objects/\[objectType\]/index.tsx')).toMatch(/const \[viewConditions, setViewConditions\] = useState<Cond\[\]>/);
  });

  it("conditions are added field → operator → value, typed by the column's kind", () => {
    expect(table()).toMatch(/function inferColKind/);
    expect(table()).toMatch(/date:\s+\["after", "before", "empty", "not_empty"\]/);
    expect(table()).toMatch(/number: \["gt", "lt", "is", "empty", "not_empty"\]/);
  });

  it("last activity is a real filterable dimension with no-activity presets", () => {
    expect(table()).toMatch(/const LAST_ACTIVITY = "last_activity"/);
    expect(table()).toMatch(/No activity in 30 days/);
    expect(table()).toMatch(/c\.col === "last_activity" \? r\.updated_at/);
  });

  it("saved views from before the redesign still apply (shape migration on read)", () => {
    expect(table()).toMatch(/const migrateView = /);
    expect(table()).toMatch(/"op" in f \? f/);
    // guarded: legacy localStorage views may lack either key entirely — applying one threw.
    expect(table()).toMatch(/setConditions\(Array\.isArray\(view\.filters\) \? view\.filters\.map\(migrateView\) : \[\]\)/);
  });

  it("duplicate names get a display-only marker — no data is touched", () => {
    expect(table()).toMatch(/const dupCounts = useMemo/);
    expect(table()).toMatch(/possible duplicates/);
    // nothing in the marker path calls a mutation
    expect(table()).not.toMatch(/mergeRecords|dedupe\(/);
  });
});
