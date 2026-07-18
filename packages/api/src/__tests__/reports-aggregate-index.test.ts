import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Phase 3d — the Reports INDEX consumes the record aggregation layer for real all-time KPIs on generic
 * object cards. Frontend-only, reusing POST /records/aggregate + /objects. No backend/schema/formula
 * change, and finance report cards are never re-sourced to generic records.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const hook = read("../../../../apps/app/src/hooks/useRecordAggregate.ts");
const index = read("../../../../apps/app/src/routes/dashboard/reports/index.tsx");

describe("useRecordAggregate adapter — reuses the existing endpoint, carries honesty through", () => {
  it("posts to /records/aggregate and never invents a total on error/loading (retry:false)", () => {
    expect(hook).toMatch(/apiClient\.post<AggResp>\("\/records\/aggregate", \{\s*object_type: objectType, column, op, group_by: groupBy, currency,/);
    expect(hook).toMatch(/retry: false/);
    expect(hook).toMatch(/staleTime: 5 \* 60_000/);
  });
  it("scope notes mirror the record-table honesty vocab (over N / first N warn / K unconverted warn)", () => {
    expect(hook).toMatch(/first \$\{resp\.total_rows\.toLocaleString\(\)\}`, warn: true/);
    expect(hook).toMatch(/over \$\{resp\.total_rows\.toLocaleString\(\)\}`/);
    expect(hook).toMatch(/\$\{resp\.unconverted\} unconverted`, warn: true/);
    // count is exact → no scope note
    expect(hook).toMatch(/if \(op !== "count"\)/);
  });
  it("topGroup skips the missing-value bucket so a 'top' group is always a real category", () => {
    expect(hook).toMatch(/filter\(g => g\.label && g\.label !== "—"\)/);
  });
});

describe("Reports index — real record-backed KPI cards, honest + finance-safe", () => {
  it("cards fetch real aggregates via the adapter (count + primary value + top group)", () => {
    expect(index).toMatch(/useRecordAggregate\(\{ objectType: obj\.slug, column: "name", op: "count"/);
    expect(index).toMatch(/op: "sum", currency: fields\.money\?\.type === "currency"/);
    expect(index).toMatch(/op: "checked"/);
    expect(index).toMatch(/groupBy: fields\.group\?\.key \?\? "none"/);
  });
  it("field types come from the persisted /objects attributes (same normalization as the table)", () => {
    expect(index).toMatch(/attributes\?: ObjAttr\[\]/);
    expect(index).toMatch(/const normKey = \(s: string\) => s\.toLowerCase\(\)\.replace\(\/\\s\+\/g, "_"\)/);
    expect(index).toMatch(/t\.type === "currency"/);
    expect(index).toMatch(/t\.type === "checkbox"/);
  });
  it("KPIs are labelled 'Computed from records · all-time' and carry scope notes", () => {
    expect(index).toMatch(/Computed from records · all-time/);
    expect(index).toMatch(/<ScopeNotes resp=\{resp\} op=\{op\} \/>/);
  });
  it("loading/error degrades to the original honest shell — never a fake KPI", () => {
    expect(index).toMatch(/const hasKpis = !!\(countQ\.data \|\| moneyStr \|\| checkedQ\.data \|\| top\)/);
    expect(index).toMatch(/Computed from your \{obj\.name_plural\.toLowerCase\(\)\} on open/);
  });
  it("lazy-loads aggregates only when a card is near the viewport (no fan-out on first paint)", () => {
    expect(index).toMatch(/function useInView/);
    expect(index).toMatch(/new IntersectionObserver/);
    expect(index).toMatch(/enabled: inView/);
  });
  it("existing report navigation is unchanged (cards still open /reports/sales?object=slug)", () => {
    expect(index).toMatch(/to=\{`\/reports\/sales\?object=\$\{obj\.slug\}`\}/);
  });
  it("no finance recomputation, no formula engine, no schema — generic records only", () => {
    // The index never queries finance domain endpoints or invents paid/outstanding.
    expect(index).not.toMatch(/\/invoices|\/expenses|\/quotes|\/credit-notes|outstanding|makeBaseConverter/);
    // No client formula evaluation introduced.
    expect(index).not.toMatch(/evalFormula|new Function/);
    // Reuses the shared currency formatter only (no bespoke money math).
    expect(index).toMatch(/import \{ useCurrency, formatMoney \}/);
  });
});

const sales = read("../../../../apps/app/src/routes/dashboard/reports/sales-report.tsx");
describe("Phase 3e — Sales Report switches only the semantics-identical KPIs to server aggregation", () => {
  it("Total Records uses a server count scoped to the SAME period (date_filter) + equality filters", () => {
    expect(sales).toMatch(/useRecordAggregate\(\{ objectType: activeSlug, column: "name", op: "count", dateFilter, filters: aggFilters/);
    expect(sales).toMatch(/field: "updated_at", from: start\.toISOString\(\), to: end\.toISOString\(\)/);
    expect(sales).toMatch(/Object\.entries\(activeFilters\)\.filter\(\(\[, v\]\) => !!v\)\.map\(\(\[column, value\]\) => \(\{ column, value \}\)\)/);
  });
  it("Total Value (stage-less) uses a plain server sum; Won Value (staged) uses the grouped-derived value", () => {
    // The plain sum only runs for stage-less objects — won/lost is never inferred by the endpoint.
    expect(sales).toMatch(/op: "sum", currency: true, dateFilter, filters: aggFilters, enabled: !!activeSlug && !!valueCol && !stageCol/);
    // Phase 3f: the Won Value card now uses the FRONTEND-classified grouped value (kWonValue).
    expect(sales).toMatch(/hasStage \? \(kWonValue \|\| \(sStage\?\.totalValue \?\? stats\.totalValue\)\) : kTotalValue/);
  });
  it("server value is preferred but falls back to the client stat (never blank, never fake)", () => {
    expect(sales).toMatch(/const kTotalCount = serverCount\.data\?\.value \?\? stats\.totalCount/);
    expect(sales).toMatch(/const kTotalValue = serverValue\.data\?\.value \?\? stats\.totalValue/);
  });
  it("provenance is honest — server total, over N / first N (truncated), K unconverted", () => {
    expect(sales).toMatch(/server total/);
    // note now uses a shared scope (count or stage-grouped) + a combined unconverted total
    expect(sales).toMatch(/scope\.truncated \?/);
    expect(sales).toMatch(/first \{scope\.total_rows\.toLocaleString\(\)\}/);
    expect(sales).toMatch(/over \{scope\.total_rows\.toLocaleString\(\)\}/);
    expect(sales).toMatch(/serverUnconverted > 0 && <span[^>]*> · \{serverUnconverted\} unconverted<\/span>/);
  });
  it("no finance recomputation / formula / schema in the sales report switch", () => {
    expect(sales).not.toMatch(/\/invoices\/rollup|makeBaseConverter|outstanding/);
    expect(sales).not.toMatch(/new Function/);
  });
});

describe("Phase 3f — stage-derived KPIs from ONE grouped aggregate, classified on the frontend", () => {
  it("issues a grouped aggregate on the stage column (currency-aware, date + equality scoped)", () => {
    expect(sales).toMatch(/const serverStage = useRecordAggregate\(\{\s*objectType: activeSlug, column: valueCol \?\? "name", op: valueCol \? "sum" : "count",\s*groupBy: stageCol \?\? "none", currency: !!valueCol, dateFilter, filters: aggFilters,/);
  });
  it("won/lost/open classification happens on the FRONTEND via the existing isWon/isLost/isOpen", () => {
    expect(sales).toMatch(/function deriveStageStats\(groups: StageGroup\[\], hasValue: boolean\)/);
    expect(sales).toMatch(/if \(isWon\(g\.label\)\)\s+\{ wonValue \+= val; wonCount \+= g\.count; \}/);
    expect(sales).toMatch(/if \(isLost\(g\.label\)\) \{ lostCount \+= g\.count; \}/);
    expect(sales).toMatch(/if \(isOpen\(g\.label\)\)\s+\{ openValue \+= val; openCount \+= g\.count; \}/);
    // completion + avg reconstructed with the SAME formulas the client computeStats uses
    expect(sales).toMatch(/completionRate = \(wonCount \+ lostCount\) > 0 \? Math\.round\(wonCount \/ \(wonCount \+ lostCount\) \* 100\) : 0/);
    expect(sales).toMatch(/avgVal = wonCount \? Math\.round\(wonValue \/ wonCount\) : \(totalCount \? Math\.round\(totalValue \/ totalCount\) : 0\)/);
  });
  it("the 5 stage KPIs prefer the server value, falling back to the client stat", () => {
    for (const k of [
      /const kWonValue   = sStage\?\.wonValue \?\? stats\.wonValue/,
      /const kCompletion = sStage\?\.completionRate \?\? stats\.completionRate/,
      /const kOpenValue  = sStage\?\.openValue \?\? stats\.openValue/,
      /const kOpenCount  = sStage\?\.openCount \?\? stats\.openCount/,
      /const kAvg        = sStage\?\.avgVal \?\? stats\.avgVal/,
    ]) expect(sales).toMatch(k);
    // the cards render the k* values (server-preferred), not the raw client stats
    expect(sales).toMatch(/value=\{hasStage \? `\$\{kCompletion\}%`/);
    expect(sales).toMatch(/fmtMoney\(kOpenValue, curSym\)/);
    expect(sales).toMatch(/fmtNum\(hasStage \? kOpenCount : records\.length\)/);
  });
  it("stays backend-generic: NO value_in, NO backend stage semantics (isWon lives only in the frontend)", () => {
    const route = read("../routes/records.ts");
    const agg = read("../lib/aggregate.ts");
    expect(route).not.toMatch(/value_in|isWon|isLost|isOpen|won|lost/i);
    expect(agg).not.toMatch(/value_in|isWon|isLost|isOpen/);
  });
});
