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
    // Re-pointed 2026-07-31: gained a formulaSrc arg (formula-column footer totals).
    expect(table).toMatch(/calcResultTyped\(calculations\[col\], col, sorted, effectiveType\(col\), \{ display: wsDisplay, rates: fxRates, base: wsBase \}, fSrc\)/);
  });
});

describe("Phase 2 — fuller server field-type adoption (select / multi_select / datetime / url / email / phone)", () => {
  it("maps a persisted select type to a real picker built from options ∪ existing values", () => {
    expect(table).toMatch(/kind === "select"/);
    expect(table).toMatch(/serverAttrOptions\.get\(col\)/);
    expect(table).toMatch(/<StagePill value=\{shown\} options=\{opts\} onSelect/);
    // No options yet → degrade to a plain editable cell, never crash.
    expect(table).toMatch(/if \(!opts\.length\) return <div[^>]*><EditableCell raw=\{val\}/);
  });
  it("maps multi_select to read chips from an array OR comma string (unknown shapes degrade to text)", () => {
    expect(table).toMatch(/kind === "multi_select"[\s\S]*?<MultiSelectChips/);
    expect(table).toMatch(/Array\.isArray\(value\)\s*\?\s*value\.map\(v => String\(v\)\)/);
  });
  it("datetime/date format honestly and degrade to the raw stored string on bad input (no crash)", () => {
    expect(table).toMatch(/kind === "datetime" \|\| kind === "date"[\s\S]*?<DateCell/);
    expect(table).toMatch(/function fmtAbsDate/);
    expect(table).toMatch(/if \(isNaN\(d\.getTime\(\)\)\) return \{ text: s, ok: false \}/);
  });
  it("url/email/phone render as typed links only when the value plausibly matches, else plain text", () => {
    expect(table).toMatch(/kind === "url" \|\| kind === "email" \|\| kind === "phone"[\s\S]*?<ContactCell/);
    expect(table).toMatch(/kind === "email" && \/\^\[\^\\s@\]\+@/);
    expect(table).toMatch(/href=\{`mailto:\$\{s\}`\}/);
    expect(table).toMatch(/href=\{`tel:/);
  });
  it("resolution order is unchanged: explicit local preset → server type → name inference", () => {
    // effectiveType still checks the local preset first, then the server type.
    expect(table).toMatch(/const local = customCols\.find\(cc => cc\.key === col\)\?\.type;\s*if \(local\) return local;\s*return serverAttrType\.get\(col\);/);
    // Name inference (isNumeric) still exists as the final fallback for untyped columns.
    expect(table).toMatch(/function isNumeric\(col: string\)/);
  });
  it("text-like server types never total to sums/averages — only count / % filled", () => {
    expect(table).toMatch(/const textKind = kind === "select" \|\| kind === "multi_select" \|\| kind === "url" \|\| kind === "email" \|\| kind === "phone" \|\| kind === "datetime" \|\| kind === "date" \|\| kind === "text"/);
    expect(table).toMatch(/textKind\s*\?\s*\[\{ op:"count",label:"Count" \},\{ op:"filled",label:"% Filled" \}\]/);
  });
  it("still no schema/finance/AI/formula changes in this component (Phase 2 stays display-only)", () => {
    // No eval-based formula engine introduced; the only evalFormula is the pre-existing per-cell one.
    expect((table.match(/function evalFormula/g) ?? []).length).toBe(1);
    // No finance write paths / payment logic added here.
    expect(table).not.toMatch(/\/invoices\/[^r]/); // only the pre-existing /invoices/rollup read remains
  });
});

describe("Phase 3 — footer uses the authoritative server total, client calc stays the fallback", () => {
  it("posts to the generic aggregate endpoint with the resolved kind (currency flag), op, and filters", () => {
    expect(table).toMatch(/apiClient\.post<AggResp>\("\/records\/aggregate", \{ object_type: objectType, column: col, op: aggOp, group_by: "none", currency: kind === "currency", \.\.\.\(filters\?\.length \? \{ filters \} : \{\}\) \}\)/);
    expect(table).toMatch(/function serverAggOp/);
    // checkbox "count" maps to the server "checked" op.
    expect(table).toMatch(/if \(kind === "checkbox"\) return op === "filled" \? "filled" : "checked"/);
  });
  it("keeps the client subtotal instantly and on error (never blank, never a fake number)", () => {
    // 2026-08-01: totals render through <CompactTotal> — a sum that outgrows its column shows
    // compact ("€1.24M") with the exact figure in the tooltip, instead of truncating.
    expect(table).toMatch(/if \(!q\.data\) return <CompactTotal text=\{fallback\}\/>/);
    expect(table).toMatch(/<ServerTotalValue objectType=\{objectType\} col=\{col\} op=\{calculations\[col\]\} kind=\{effectiveType\(col\)\} display=\{wsDisplay\} fallback=\{clientStr\}/);
  });
  it("labels truncation and unconverted amounts honestly (no silent full-coverage claim)", () => {
    // Now rendered as structured scope notes (aggParts) rather than a single string.
    expect(table).toMatch(/first \$\{resp\.total_rows\.toLocaleString\(\)\}`, warn: true/);
    expect(table).toMatch(/over \$\{resp\.total_rows\.toLocaleString\(\)\}`/);
    expect(table).toMatch(/\$\{resp\.unconverted\} unconverted`, warn: true/);
  });
});

describe("Phase 3b.1 — filtered server totals + group subtotals (still no schema/finance/formula)", () => {
  it("only server-representable filters (equality, non-owner) are sent; owner/date-range/text stay client", () => {
    // 2026-08-01 filter redesign (user-requested): search-first + condition chips. filterText and
    // quickFilters are gone — toolbarSearch is THE text filter, `conditions` the structured set,
    // and both run in SQL over ALL records (see /nodes q + filters params).
    expect(table).toMatch(/function serverFilters/);
    expect(table).toMatch(/c\.op === "is" && !\/owner\|assign\/i\.test\(c\.col\) && c\.col !== LAST_ACTIVITY/);
  });
  it("footer uses the server total (with filters) only when the WHOLE active filter set is representable", () => {
    // Got STRICTER when the toolbar search was added: a text search is client-side, so it too must
    // block the server total from claiming to represent the view.
    // 2026-07-31 audit: the `filterQuery` prop was removed — the only call site never passed it,
    // so it was permanently "". filterText + toolbarSearch are the two live text filters.
    // 2026-08-01 filter redesign (user-requested): search-first + condition chips. filterText and
    // quickFilters are gone — toolbarSearch is THE text filter, `conditions` the structured set,
    // and both run in SQL over ALL records (see /nodes q + filters params).
    // 2026-08-01: totals render through <CompactTotal> — a sum that outgrows its column shows
    // compact ("€1.24M") with the exact figure in the tooltip, instead of truncating.
    expect(table).toMatch(/const allRepresentable = !toolbarSearch\.trim\(\) && reprFilters\.length === conditions\.length;\s*if \(!allRepresentable\) return <><CompactTotal text=\{clientStr\}\/><TotalNote text="this view" \/><\/>;/);
    expect(table).toMatch(/<ServerTotalValue[^]*?filters=\{reprFilters\}/);
    // the aggregate call forwards the validated equality filters
    expect(table).toMatch(/\.\.\.\(filters\?\.length \? \{ filters \} : \{\}\)/);
  });
  it("group subtotals come from the server grouped response, with an honest client per-group fallback", () => {
    expect(table).toMatch(/const groupAggQ = useQuery/);
    expect(table).toMatch(/group_by: groupByCol/);
    // server value when present, else a client per-group calcResultTyped — never a blank/fake
    expect(table).toMatch(/srv\s*\?\s*fmtGroupVal\(groupCalcKind, groupCalcOp, srv\.value, groupAggCurrency, srv\.unconverted\)\s*:\s*calcResultTyped\(groupCalcOp, groupCalcCol, groupRows/);
    // group query only runs when the filter set is server-representable (else client fallback)
    expect(table).toMatch(/groupFiltersRepresentable/);
    expect(table).toMatch(/enabled: !!\(groupByCol && groupCalcCol && groupCalcOp && serverAggOp\(groupCalcKind, groupCalcOp\) && groupFiltersRepresentable\)/);
  });
  it("group subtotal currency stays honest (unconverted marker) and reuses formatMoney only", () => {
    expect(table).toMatch(/function fmtGroupVal/);
    expect(table).toMatch(/formatMoney\(value, currency\) \+ \(unconverted > 0 \? ` ·\$\{unconverted\}✗`/);
  });
});

// ── Phase 3 UX polish — honest footer labels, group chip, a11y, profile section order ──
const detail = readFileSync(
  fileURLToPath(new URL("../../../../apps/app/src/components/records/record-detail.tsx", import.meta.url)),
  "utf8",
);
describe("Phase 3 UX polish — footer totals scope is explicit and honest", () => {
  it("footer distinguishes full-table / filtered / truncated / unconverted / this-view", () => {
    expect(table).toMatch(/function aggParts/);
    expect(table).toMatch(/function TotalNote/);
    // full table vs filtered vs truncated scope note
    expect(table).toMatch(/filtered · \$\{resp\.total_rows/);
    expect(table).toMatch(/first \$\{resp\.total_rows.*?warn: true/);
    expect(table).toMatch(/over \$\{resp\.total_rows/);
    expect(table).toMatch(/\$\{resp\.unconverted\} unconverted`, warn: true/);
    // a client subtotal (unrepresentable filter) is labelled "this view", never as full truth
    // 2026-08-01: totals render through <CompactTotal> — a sum that outgrows its column shows
    // compact ("€1.24M") with the exact figure in the tooltip, instead of truncating.
    expect(table).toMatch(/return <><CompactTotal text=\{clientStr\}\/><TotalNote text="this view" \/><\/>/);
  });
  it("truncated + unconverted use a warn tone (not silently shown as full truth)", () => {
    expect(table).toMatch(/color: warn \? "#c6892e" : "var\(--text-faint\)"/);
  });
  it("group subtotal is a compact non-wrapping chip that names server vs this-view scope", () => {
    expect(table).toMatch(/whitespace-nowrap rounded-sm border/);
    expect(table).toMatch(/srv \? "Group subtotal \(full table\)" : "Group subtotal \(this view\)"/);
  });
});

describe("Phase 3 UX polish — accessibility (focus-visible + labels), no actions removed", () => {
  it("shared toolbar button class carries a focus ring; add-column + calc buttons labelled", () => {
    expect(table).toMatch(/const TB = "[^"]*focus-visible:ring-2 focus-visible:ring-\[var\(--section-accent\)\]/);
    expect(table).toMatch(/aria-label="Add a column"/);
    expect(table).toMatch(/aria-label=\{`Add a total for \$\{colLabel\(col\)\}`\}/);
    expect(table).toMatch(/aria-label=\{`Change \$\{calculations\[col\]\} total for \$\{colLabel\(col\)\}`\}/);
  });
  it("typed-cell edit triggers are keyboard-focusable (currency/percent/date)", () => {
    expect((table.match(/text-left w-full[^"]*focus-visible:ring-2/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("all existing table actions/tools preserved (nothing removed)", () => {
    for (const h of ["AddColumnDropdown", "CalcDropdown", "ServerTotalValue", "board", "startResize", "colOrder", "exportCSV", "setOpenPanel"]) {
      expect(table).toContain(h);
    }
  });
});

describe("Phase 3 UX polish — record profile puts real fields above AI interpretation", () => {
  it("Overview shows the record's Key fields BEFORE the AI Inspector block", () => {
    const keyIdx = detail.indexOf('Key fields</p>');
    const aiIdx = detail.indexOf("AI Inspector (interpretation)");
    expect(keyIdx).toBeGreaterThan(0);
    expect(aiIdx).toBeGreaterThan(0);
    expect(keyIdx).toBeLessThan(aiIdx); // key fields render above the AI block
  });
  it("editing behavior preserved — fields still save through the same PATCH path", () => {
    expect(detail).toMatch(/onSave=\{v => save\("description", v\)\}/);
    expect(detail).toMatch(/<CompanyHighlights\s+data=\{data\} onSave=\{save\}/);
  });
  it("Finance stays read-only aggregation (no recomputation added in this pass)", () => {
    // The finance tab still reads the domain endpoints; this pass added no finance write/compute.
    expect(detail).toMatch(/linked_record_id=\$\{recordId\}/);
    expect(detail).toMatch(/byLinkAndName<InvoiceRecord>\("\/invoices"\)/);
    expect(detail).not.toMatch(/records\/aggregate/);
  });
});
