import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const page = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/reports/sales-report.tsx"), "utf8");

/**
 * FOUND LIVE 2026-08-18 while auditing the redesigned Reports page: /reports/sales?object=deals
 * said "Won Value $1.4M · This Month" while the telemetry strip directly above it said USD 800.
 * The live-report page dated wins by updated_at — the exact re-dating bug lib/money removed
 * (measured in prod 2026-08-02: unrelated edits moved 1,422,500 of wins into the current month).
 * Two money surfaces on ONE SCREEN disagreeing by 1750x is the untrustworthiness the money model
 * exists to prevent.
 */
describe("the live report dates deal wins the money model's way", () => {
  it("deal mode exists and follows won_at, with undated wins excluded and counted", () => {
    expect(page).toMatch(/const dealMode\s*=\s*\/deal\/i\.test\(activeSlug/);
    expect(page).toContain("wonUndatedCount");
    expect(page).toMatch(/won_at/);
    // The exclusion must return through the stats so the UI can disclose it.
    expect(page).toMatch(/wonUndatedCount, wonUndatedValue, openExcludedCount, openExcludedValue \};/);
  });

  it("deal-mode won KPIs come from the CLIENT stats — the server stage aggregate windows on updated_at", () => {
    expect(page).toContain("const kWonValue   = dealMode ? stats.wonValue : (sStage?.wonValue ?? stats.wonValue);");
    expect(page).toContain("const kCompletion = dealMode ? stats.completionRate : (sStage?.completionRate ?? stats.completionRate);");
  });

  it("the exclusion is DISCLOSED next to the figure, in the same words every other surface uses", () => {
    expect(page).toContain("no close date and");
    expect(page).toContain("excluded from period figures");
    expect(page).toContain("undated excluded");
  });

  it("the trend skips undated wins rather than inventing a position for them", () => {
    expect(page).toMatch(/if \(dealMode && stageCol && isWon\(stagePre\)\) \{/);
    expect(page).toMatch(/if \(!wa \|\| !Number\.isFinite\(Date\.parse\(String\(wa\)\)\)\) continue;/);
  });

  it("generic objects keep their semantics — deal mode never leaks to visits/tasks", () => {
    // The undated-exclusion branch is gated on dealMode && stageCol; the generic branch survives.
    expect(page).toContain("wonRecs = stageCol ? inPeriod.filter(r => isWon(getStage(r))) : inPeriod;");
  });
});

describe("the disclosure has a path to act — the supervised backfill, surfaced", () => {
  it("Review calls the DRY RUN; Apply is a separate explicit step", () => {
    expect(page).toContain('apiClient.post<{ proposals: WinProposal[] }>("/periods/backfill-wins", { dry_run: true })');
    expect(page).toContain('apiClient.post("/periods/backfill-wins", { dry_run: false })');
  });

  it("each proposal shows its EVIDENCE, and evidence-less deals stay undated — never invented", () => {
    expect(page).toContain("({p.source}: {p.evidence_detail})");
    expect(page).toContain("no evidence — stays undated");
    expect(page).toContain("They stay disclosed, not invented.");
  });
});

describe("there is ONE definition of open pipeline — measured 2026-08-19: one screen, three answers", () => {
  const outcomes = readFileSync(join(__dirname, "../lib/outcomes.ts"), "utf8");
  const strip = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/reports/index.tsx"), "utf8");

  it("the outcomes engine classifies open via the SHARED isOpenStage, never 'not closed'", () => {
    expect(outcomes).toContain('import { isOpenStage } from "@mondaily/shared/deal-stage"');
    expect(outcomes).toMatch(/\} else if \(isOpenStage\(stage\)\) \{/);
    expect(outcomes).not.toMatch(/else if \(!\/closed\/i\.test\(stage\)\)/);
  });

  it("what it excludes is COUNTED and disclosed — silently dropping $97,898 is as wrong as silently including it", () => {
    expect(outcomes).toContain("pipeline_excluded: { deals: excludedDeals, value:");
    expect(strip).toContain("on hold/unstaged excluded");
  });

  it("the live report's deal-mode open uses the shared rule as a balance, remainder disclosed, no flow delta", () => {
    expect(page).toContain('import { isOpenStage } from "@mondaily/shared/deal-stage"');
    expect(page).toMatch(/if \(isOpenStage\(st\)\) openRecs\.push\(r\);/);
    expect(page).toContain("openExcludedCount, openExcludedValue };");
    expect(page).toMatch(/dealMode \? null : pctDelta\(hasValue \? stats\.openValue/);
    expect(page).toMatch(/const kOpenValue  = dealMode \? stats\.openValue : \(sStage\?\.openValue \?\? stats\.openValue\);/);
  });
});
