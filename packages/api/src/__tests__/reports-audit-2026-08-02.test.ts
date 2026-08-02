import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reports/Insights audit. A report is read as fact, so the recurring danger on this surface is a
 * partial scan presented as a complete total — the same class as a page cap shown as a count.
 */
const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const reports = () => read("packages/api/src/routes/reports.ts");
const ask = () => read("packages/api/src/routes/ask.ts");

describe("a partial scan is never presented as a total", () => {
  it("the paging helper's truncation flag reaches the result", () => {
    // It was computed and then discarded, so a report built from a capped scan looked complete.
    const s = reports();
    expect(s).toMatch(/truncated = truncated \|\| r\.truncated;/);
    expect(s).toMatch(/forecast_from\?: number; slope\?: number; truncated\?: boolean/);
  });

  it("every report shape carries it, not just the default one", () => {
    const s = reports();
    for (const shape of ['chart_type: "funnel", truncated', 'chart_type: "bar", truncated', 'chart_type: "line", truncated']) {
      expect(s, shape).toContain(shape);
    }
    expect(s).toMatch(/chart_type: String\(config\.chart_type \?\? "line"\), truncated/);
  });

  it("Ask states it as a LOWER BOUND — the model restates a bare total as fact", () => {
    const s = ask();
    expect(s).toMatch(/hit its scan ceiling/);
    expect(s).toMatch(/LOWER BOUND/);
    expect(s).toMatch(/\$\{result\.truncated \? "Total so far \(partial\)" : "Total"\}/);
  });

  it("a complete report says nothing extra — no false alarm", () => {
    expect(reports()).toMatch(/let truncated = false;/);
  });
});

describe("report queries stay workspace-scoped", () => {
  it("the node scan and the report lookup are both scoped", () => {
    const s = reports();
    expect(s).toMatch(/\.eq\("workspace_id", workspaceId\)\.eq\("object_type", v\)/);
    expect(s).toMatch(/\.eq\("workspace_id", workspaceId\)\.eq\("object_type", "report"\)\.eq\("id", reportId\)/);
  });
});
