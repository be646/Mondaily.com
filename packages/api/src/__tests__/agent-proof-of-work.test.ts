import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const runners = readFileSync(fileURLToPath(new URL("../jobs/runners.ts", import.meta.url)), "utf8");
const agents = readFileSync(fileURLToPath(new URL("../routes/agents.ts", import.meta.url)), "utf8");
const prospecting = readFileSync(fileURLToPath(new URL("../routes/prospecting.ts", import.meta.url)), "utf8");
const workflow = readFileSync(fileURLToPath(new URL("../jobs/workflow-engine.ts", import.meta.url)), "utf8");

describe("Operations Agent — real, not dormant (audit fixes)", () => {
  it("the /agents roster entry wires last_run_at + backed_by to real jobs (no hardcoded null)", () => {
    const opsBlock = agents.slice(agents.indexOf('id: "operations"'), agents.indexOf('id: "operations"') + 900);
    expect(agents).toMatch(/jobSummary\(latestJob\(jobs, "operations"\) \?\? latestJob\(jobs, "overdue_task_decisions"\)/);
    expect(opsBlock).toMatch(/backed_by: \["operations", "overdue_task_decisions"\]/);
    expect(opsBlock).toMatch(/last_run_at: opsJob\.lastRunAt/);
    expect(opsBlock).not.toMatch(/backed_by: \[\], last_run_at: null/);
  });
  it("runOverdueTaskDecisions logs structured proof-of-work steps (honest counts incl. zeros)", () => {
    const fn = runners.slice(runners.indexOf("export async function runOverdueTaskDecisions"));
    expect(fn).toMatch(/step\(`Scanned \$\{scanned\} overdue open task\(s\)`\)/);
    expect(fn).toMatch(/step\(`\$\{alreadyQueued\} already in the Decision Queue`/);
    expect(fn).toMatch(/step\(`Queued \$\{queued\} new decision\(s\)`/);
    expect(fn).toMatch(/completeJob\(jobId, \{ queued, scanned, already_queued: alreadyQueued/);
  });
  it("still dedupes decisions per task before inserting", () => {
    const fn = runners.slice(runners.indexOf("export async function runOverdueTaskDecisions"));
    expect(fn).toMatch(/\.eq\("agent_name", "operations"\)\.eq\("status", "pending"\)\.maybeSingle\(\)/);
  });
});

describe("Agent runners — proof-of-work steps (deal alerts + lead scoring)", () => {
  it("runDealAlerts logs scan + flag steps", () => {
    const fn = runners.slice(runners.indexOf("export async function runDealAlerts"), runners.indexOf("export async function runRelationshipHealth"));
    expect(fn).toMatch(/step\(`Scanned \$\{dealsScanned\} deal\(s\) for 14\+ days of inactivity`\)/);
    expect(fn).toMatch(/step\(`Flagged \$\{totalAlerts\} cold deal\(s\)`/);
  });
  it("runLeadScoring logs load/compute/write steps", () => {
    const fn = runners.slice(runners.indexOf("export async function runLeadScoring"));
    expect(fn).toMatch(/step\(`Loaded \$\{deals\.length\} deal\(s\) with 30-day activity \+ open-task signals`\)/);
    expect(fn).toMatch(/step\(`Wrote \$\{written\}\/\$\{updates\.length\} score\(s\)`/);
  });
});

describe("No silent runs — every completeJob logs structured steps (honest zeros included)", () => {
  const enrichRecord = readFileSync(fileURLToPath(new URL("../jobs/enrich-record.ts", import.meta.url)), "utf8");
  it("no agent job completes with an empty steps array anywhere", () => {
    for (const [name, src] of [["runners", runners], ["workflow", workflow], ["prospecting", prospecting], ["enrich-record", enrichRecord]] as const) {
      expect(src, `${name} still has completeJob(..., [])`).not.toMatch(/completeJob\([^)]*,\s*\[\]\)/);
    }
  });
  it("zero-work paths log honest zero steps, not fabricated activity", () => {
    expect(runners).toMatch(/step\("Scanned 0 relationship contact\(s\)"\)/);
    expect(runners).toMatch(/step\("Scanned invoices — 0 overdue"\)/);
    expect(runners).toMatch(/step\("Scanned 0 deal\(s\)"\)/);
    expect(enrichRecord).toMatch(/step\("Searched sources — no usable data found", \{ status: "info" \}\)/);
  });
  it("workflow + prospecting + enrichment log real count-driven steps", () => {
    expect(workflow).toMatch(/step\(`Evaluated \$\{summary\.workflows_evaluated\} active workflow\(s\)`\)/);
    expect(workflow).toMatch(/step\(`Queued \$\{summary\.actions_queued\} risky action\(s\) for approval`/);
    expect(prospecting).toMatch(/step\(`Searched the web — \$\{searchResults\.length\} source\(s\)`/);
    expect(prospecting).toMatch(/step\(`Extracted \$\{candidates\.length\} candidate\(s\)`\)/);
    expect(runners).toMatch(/step\(`Selected \$\{enrichable\.length\} enrichable record\(s\) \(limit \$\{limit\}\)`\)/);
    expect(enrichRecord).toMatch(/step\(`Wrote \$\{flatKeys\.length\} field\(s\) to the record`/);
  });
});

describe("Decision Queue dedup — no duplicate pending decisions on re-runs", () => {
  it("prospecting dedupes pending candidates by exact title before inserting", () => {
    expect(prospecting).toMatch(/\.eq\("agent_name", "prospecting"\)\.eq\("status", "pending"\)/);
    expect(prospecting).toMatch(/\.eq\("title", `New \$\{input\.object_type\}: \$\{candidate\.name\}`\)\.maybeSingle\(\)/);
  });
  it("workflow engine dedupes pending decisions per record before queueing a risky action", () => {
    expect(workflow).toMatch(/\.eq\("source_id", record\.id\)\.eq\("agent_name", "workflow"\)[\s\S]{0,60}\.eq\("status", "pending"\)\.maybeSingle\(\)/);
    expect(workflow).toMatch(/if \(pendingDupe\) return \{ action: action\.type, mode: "queued", detail: "already awaiting approval" \}/);
  });
});
