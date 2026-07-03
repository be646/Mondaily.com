import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describeExecution } from "../lib/decision-actions";

/**
 * Decision Queue cockpit: execution-preview logic (what approving really does), plus source-read
 * guards proving the existing handlers, workspace isolation, training capture, and no-fabrication
 * rules are all preserved.
 */

describe("describeExecution — exact action + side-effect gating", () => {
  it("prospecting → create record (side effect)", () => {
    const e = describeExecution({ agent_name: "prospecting", source_type: "prospecting_candidate", evidence: [{ candidate: { object_type: "company", name: "Acme" }, destination_list_id: "l1" }] });
    expect(e.side_effect).toBe(true);
    expect(e.text).toMatch(/Create a company/);
    expect(e.text).toMatch(/destination list/);
  });
  it("discovery → create person (side effect)", () => {
    const e = describeExecution({ agent_name: "discovery", source_type: "discovered_lead", evidence: [{ lead: { name: "Jane" } }] });
    expect(e.side_effect).toBe(true);
    expect(e.text).toMatch(/person record for “Jane”/);
  });
  it("invoice_chaser → send chase email (side effect)", () => {
    const e = describeExecution({ agent_name: "invoice_chaser", source_type: "invoice", evidence: [] });
    expect(e.side_effect).toBe(true);
    expect(e.text).toMatch(/chase email/);
  });
  it("workflow → send email (side effect)", () => {
    expect(describeExecution({ agent_name: "workflow", source_type: "node", evidence: [] }).side_effect).toBe(true);
  });
  it("rule-based agents (operations/relationship/opportunity…) → advisory, NO side effect", () => {
    for (const agent of ["operations", "relationship", "opportunity", "people", "portfolio", "asset", "signal"]) {
      const e = describeExecution({ agent_name: agent, source_type: "node", evidence: [] });
      expect(e.side_effect).toBe(false);
      expect(e.text).toMatch(/Advisory only/);
    }
  });
  it("handles missing/odd evidence without throwing", () => {
    expect(() => describeExecution({ agent_name: "prospecting", source_type: "prospecting_candidate", evidence: null })).not.toThrow();
    expect(describeExecution({}).side_effect).toBe(false);
  });
});

describe("preserved logic + isolation (source-read guards)", () => {
  const src = readFileSync(fileURLToPath(new URL("../routes/decisions.ts", import.meta.url)), "utf8");

  it("approve still executes the action AND captures training", () => {
    expect(src).toMatch(/router\.post\("\/:id\/approve"/);
    expect(src).toMatch(/executeApprovedAction\(c\.get\("workspaceId"\), decision\)/);
    expect(src).toMatch(/resolve\(c, "approved", \{\}, "APPROVED"\)/);
  });
  it("reject still captures training", () => {
    expect(src).toMatch(/resolve\(c, "rejected", \{\}, "REJECTED"\)/);
  });
  it("resolve writes an activity row and logs the training verdict", () => {
    expect(src).toMatch(/logDecisionTrainingExample\(c\.get\("workspaceId"\), data, trainingAction\)/);
    expect(src).toMatch(/action: `decision_\$\{status\}`/);
  });
  it("cockpit view queries are BOTH workspace-scoped", () => {
    const block = src.slice(src.indexOf('view === "cockpit"'), src.indexOf("return c.json(rows)"));
    const reads = (block.match(/\.from\("decision_queue"\)/g) ?? []).length;
    const guards = (block.match(/\.eq\("workspace_id", workspaceId\)/g) ?? []).length;
    expect(reads).toBe(2);
    expect(guards).toBe(2);
  });
  it("every returned decision carries an execution_preview", () => {
    expect(src).toMatch(/execution_preview: describeExecution/);
  });
  it("Ask endpoint is workspace-scoped and refuses when there's nothing to ground on", () => {
    expect(src).toMatch(/router\.post\("\/:id\/ask"/);
    expect(src).toMatch(/\.eq\("workspace_id", workspaceId\)\.eq\("id", c\.req\.param\("id"\)\)/);
    expect(src).toMatch(/if \(!hasSubstance\)[\s\S]*sufficient: false/);
  });
  it("Ask never fabricates a confidence when none was computed", () => {
    expect(src).toMatch(/Confidence: not computed/);
    expect(src).toMatch(/do NOT make one up/);
  });
});
