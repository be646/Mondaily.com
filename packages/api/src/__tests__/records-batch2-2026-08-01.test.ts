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

describe("sort bar — same chrome as the filter bar, duplicates unrepresentable", () => {
  it("is its own bar built from hairline chips + a dashed picker, not a form select", () => {
    expect(table()).toMatch(/function SortBar/);
    // the 36px FieldSelect form control is gone from the sheet toolbar entirely
    expect(table()).not.toMatch(/FieldSelect value=\{rule\.col\}/);
    expect(table()).not.toMatch(/import \{ FieldSelect \}/);
    expect(table()).toMatch(/border border-dashed border-\[var\(--border-soft\)\][^"]*text-\[11px\]/);
  });

  it("adding a sort opens a field picker — it never auto-picks 'the next unused column'", () => {
    expect(table()).not.toMatch(/const unused = \[\.\.\.allColumnsWithCustom/);
    expect(table()).toMatch(/const fieldPicker = \(self\?: string\)/);
  });

  it("the picker only offers fields that are not already sorted", () => {
    expect(table()).toMatch(/fields\.filter\(c => \(c === self \|\| !used\.has\(c\)\)/);
  });

  it("direction words follow the column kind instead of always claiming A→Z", () => {
    expect(table()).toMatch(/numericOf\(rule\.col\) \? \(rule\.dir === "asc" \? "1→9" : "9→1"\)/);
  });
});

describe("sort comparator — real numbers, empties last", () => {
  it("uses the shared parser, never the parseFloat strip that corrupted European money", () => {
    expect(table()).toMatch(/const an = typeof ar === "number" \? ar : parseNumeric\(av\)/);
    expect(table()).not.toMatch(/parseFloat\(av\.replace/);
  });

  it("empty cells sink to the bottom in both directions", () => {
    expect(table()).toMatch(/if \(aEmpty !== bEmpty\) return aEmpty \? 1 : -1/);
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

describe("column keys are unique — duplicate React keys orphan fibers (dead cells)", () => {
  it("custom column keys colliding with data-derived keys are dropped, case-insensitively", () => {
    // 2026-08-01: a custom Country column on a sheet already carrying `country` rendered the same
    // key twice; React orphaned one td's fiber — the cell was visible but completely dead.
    expect(table()).toMatch(/regularCustomCols\.map\(c => c\.key\)\.filter\(k => !allColumns\.some\(a => a\.toLowerCase\(\) === k\.toLowerCase\(\)\)\)/);
  });

  it("country is never treated as numeric by the name heuristic", () => {
    expect(table()).toMatch(/if \(lower\.includes\("country"\)\) return false/);
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
