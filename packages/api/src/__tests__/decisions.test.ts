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

describe("comments + assignment (Increment 2) — source-read guards", () => {
  const src = readFileSync(fileURLToPath(new URL("../routes/decisions.ts", import.meta.url)), "utf8");

  it("GET/POST comments verify the decision is in this workspace first", () => {
    expect(src).toMatch(/router\.get\("\/:id\/comments"/);
    expect(src).toMatch(/router\.post\("\/:id\/comments"/);
    expect(src).toMatch(/decisionInWorkspace\(workspaceId, id\)/);
  });
  it("comment reads/writes are workspace-scoped", () => {
    expect(src).toMatch(/from\("decision_comments"\)[\s\S]*?\.eq\("workspace_id", workspaceId\)\.eq\("decision_id", id\)/);
    expect(src).toMatch(/decision_comments"\)\.insert\(\{\s*workspace_id: workspaceId, decision_id: id/);
  });
  it("decisionInWorkspace itself is workspace-scoped", () => {
    expect(src).toMatch(/from\("decision_queue"\)\.select\("id, assignee_id, title"\)\.eq\("workspace_id", workspaceId\)\.eq\("id", id\)/);
  });
  it("assign endpoint updates workspace-scoped and clears email on unassign", () => {
    expect(src).toMatch(/router\.post\("\/:id\/assign"/);
    expect(src).toMatch(/from\("decision_queue"\)\s*\.update\(\{ assignee_id, assignee_email: assignee_id \? \(assignee_email \?\? null\) : null \}\)\s*\.eq\("workspace_id", workspaceId\)\.eq\("id", id\)/);
  });
  it("assign + comment notify the assignee, never the actor, and deep-link the decision", () => {
    expect(src).toMatch(/createNotification\(\{[\s\S]*?user_id: decision\.assignee_id[\s\S]*?source: \{ decision_id: id/);
    expect(src).toMatch(/assignee_id !== userId/);
  });
  it("training capture path is untouched (still fires on approve/reject/edit)", () => {
    // No change to the resolve()/PATCH training calls.
    expect(src).toMatch(/logDecisionTrainingExample\(c\.get\("workspaceId"\), data, "EDITED", body\)/);
    expect(src).toMatch(/resolve\(c, "approved", \{\}, "APPROVED"\)/);
    expect(src).toMatch(/resolve\(c, "rejected", \{\}, "REJECTED"\)/);
  });
});

describe("Decisions 2.0 — AI verdict + triage honesty", () => {
  const src = readFileSync(fileURLToPath(new URL("../routes/decisions.ts", import.meta.url)), "utf8");
  const page = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/decisions.tsx", import.meta.url)), "utf8");

  it("verdict refuses (sufficient:false) when nothing is recorded to ground on", () => {
    const fn = src.slice(src.indexOf('router.post("/:id/verdict"'), src.indexOf('router.post("/triage"'));
    expect(fn).toMatch(/if \(!hasSubstance\) return c\.json\(\{ sufficient: false/);
    expect(fn).toMatch(/\.eq\("workspace_id", workspaceId\)/);   // workspace-scoped read
  });
  it("verdict is structured tool-use, defaults to 'investigate' on invalid output, and reports its grounding", () => {
    const fn = src.slice(src.indexOf('router.post("/:id/verdict"'), src.indexOf('router.post("/triage"'));
    expect(fn).toMatch(/enum: \["approve", "reject", "investigate"\]/);
    expect(fn).toMatch(/: "investigate";/);          // fallback when the model returns junk
    expect(fn).toMatch(/grounded_on: \{/);            // proof of what it judged from
    expect(fn).toMatch(/NEVER a confident approve/);  // thin-evidence instruction
  });
  it("triage validates returned ids against the real queue and never drops a decision silently", () => {
    const fn = src.slice(src.indexOf('router.post("/triage"'));
    expect(fn).toMatch(/validIds\.has\(String\(r\.id\)\)/);
    expect(fn).toMatch(/Not ranked by AI — review manually/);   // dropped ids come back honestly
    expect(fn).toMatch(/\.eq\("status", "pending"\)/);
  });
  it("the UI keeps AI advisory: verdict/triage never call approve/reject endpoints", () => {
    const verdictUi = page.slice(page.indexOf("function DecisionVerdict"));
    expect(verdictUi).toMatch(/Advisory only — nothing runs until you act below/);
    expect(verdictUi).not.toMatch(/\/approve|\/reject|\/bulk/);
    expect(page).toMatch(/never acts/i);
  });
  it("provenance shows the REAL captured prompt and output, labeled as capture not reconstruction", () => {
    expect(page).toMatch(/What the agent saw \(real captured prompt\)/);
    expect(page).toMatch(/What the agent produced \(real captured output\)/);
    expect(page).toMatch(/provenance, not a reconstruction/);
  });
});

describe("Decisions 2.0 round 2 — cockpit functions stay honest", () => {
  const page = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/decisions.tsx", import.meta.url)), "utf8");

  it("snooze presets send REAL until timestamps to the existing endpoint", () => {
    expect(page).toMatch(/onResolve\(d, "snooze", \{ until: new Date\(Date\.now\(\) \+ pr\.hours \* 3_600_000\)\.toISOString\(\) \}\)/);
  });
  it("a rejection note lands in the decision's real comments audit before resolving", () => {
    expect(page).toMatch(/apiClient\.post\(`\/decisions\/\$\{d\.id\}\/comments`, \{ body: `Rejected: \$\{opts\.note\}` \}\)/);
  });
  it("batch adjudication is capped, sequential, and advisory (chips only, no execution)", () => {
    const fn = page.slice(page.indexOf("async function adjudicateVisible"), page.indexOf("// Keyboard triage"));
    expect(fn).toMatch(/\.slice\(0, 8\)/);
    expect(fn).not.toMatch(/\/approve|\/reject|\/bulk/);
  });
  it("queue stats are computed from the real loaded rows (no invented metrics)", () => {
    expect(page).toMatch(/const pending = items\.filter\(d => d\.status === "pending"\)/);
    expect(page).toMatch(/resolved7\.length \? `\$\{Math\.round\(\(approved7 \/ resolved7\.length\) \* 100\)\}%` : "—"/);
  });
  it("audit trail names the real resolver from the member directory", () => {
    expect(page).toMatch(/memberLabel\(members, d\.resolved_by\)/);
  });
});
