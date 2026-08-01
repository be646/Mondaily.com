import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards for the 2026-08-01 records batch 2: sort rebuild, auto-fit cells, Owner/Assignee
 * unification, and the new-record drawer.
 */
const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const table = () => read("apps/app/src/components/records/record-table.tsx");
const index = () => read("apps/app/src/routes/dashboard/objects/[objectType]/index.tsx");

describe("sort rebuild — one model, ordered in SQL", () => {
  it("the parallel quick-sort system is gone; header clicks edit rule 0", () => {
    expect(table()).not.toMatch(/quickSortCol/);
    expect(table()).toMatch(/setSortRules\(prev => prev\[0\]\?\.col === col/);
  });

  it("the primary rule is sent to the server so the page is the true top-N", () => {
    expect(table()).toMatch(/params\.set\("sort_col", primarySort\.col\)/);
    const nodes = read("packages/api/src/routes/nodes.ts");
    expect(nodes).toMatch(/sort_col: z\.string\(\)\.max\(64\)\.optional\(\)/);
  });

  it("numeric columns order via the jsonb value, never text-compare", () => {
    const ubc = read("packages/db/src/ubc.ts");
    expect(ubc).toMatch(/options\.sort_numeric \? `data->\$\{options\.sort_col\}` : `data->>\$\{options\.sort_col\}`/);
    expect(table()).toMatch(/params\.set\("sort_numeric", "true"\)/);
  });

  it("sort column names are shape-validated like filter columns", () => {
    expect(read("packages/db/src/ubc.ts")).toMatch(/options\.sort_col && SAFE_COL\.test\(options\.sort_col\)/);
  });
});

describe("cells — single line, auto-fit with caps, compact totals", () => {
  it("cells never wrap; width comes from content with a per-kind cap", () => {
    // 2026-08-01: ellipsis moved INSIDE text cells (EditableCell 'block truncate') — the td-level
    // text-ellipsis painted a stray '…' right after pill components.
    expect(table()).toMatch(/overflow-hidden whitespace-nowrap/);
    expect(table()).not.toMatch(/whitespace-nowrap text-ellipsis $\{isNumericCol/);
    expect(table()).toMatch(/const autoWidths = useMemo/);
    expect(table()).toMatch(/number: \[96, 150\], date: \[110, 160\], select: \[110, 180\], text: \[120, 360\]/);
  });

  it("a column always fits its own footer total; oversized totals render compact with the exact figure in the tooltip", () => {
    expect(table()).toMatch(/maxLen = Math\.max\(maxLen, total\.length\)/);
    expect(table()).toMatch(/function CompactTotal/);
    expect(table()).toMatch(/notation: "compact"/);
    expect(table()).toMatch(/<span title=\{text\}>/);
  });
});

describe("Owner vs Assignee — one meaning per word", () => {
  it("record sheets display assigned-to columns as Owner", () => {
    expect(table()).toMatch(/if \(\/\^\(assigned_to\|assignee\|assigned\)\$\/i\.test\(col\)\) return "Owner"/);
    // every label site routes through colLabel
    expect(table()).toMatch(/first-letter:uppercase">\{colLabel\(col\)\}/);
    expect(index()).toMatch(/\/\^\(assigned_to\|assignee\|assigned\)\$\/i\.test\(k\) \? "Owner"/);
  });
});

describe("new-record drawer — typed, sheet-language, duplicate-aware", () => {
  it("is a right-side drawer, not a centered ticket", () => {
    expect(index()).toMatch(/fixed right-0 top-0 z-50 flex h-full flex-col border-l/);
    expect(index()).not.toMatch(/fixed left-1\/2 top-1\/2 z-50 -translate-x-1\/2 -translate-y-1\/2[^`]*New \{objectType/);
  });

  it("inputs are typed per field kind — owner picker, option pills, date and number inputs", () => {
    expect(index()).toMatch(/const fieldKind = \(k: string\): "date" \| "number" \| "select" \| "owner" \| "text"/);
    expect(index()).toMatch(/kind === "owner" \? \(/);
    expect(index()).toMatch(/optionsFor\(k\)\.map\(opt =>/);
    expect(index()).toMatch(/type=\{kind === "date" \? "date" : kind === "number" \? "number" : "text"\}/);
  });

  it("owners come from workspace members, never free text", () => {
    expect(index()).toMatch(/queryKey: \["members"\]/);
  });

  it("the duplicate check stays wired", () => {
    expect(index()).toMatch(/\/nodes\/similar\?q=/);
  });
});
