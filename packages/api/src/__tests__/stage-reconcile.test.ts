import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withStageStamps } from "../lib/stage-stamps";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * The two stage fields stop diverging, and history is only touched where evidence exists.
 */
describe("a stage write keeps both fields in step", () => {
  it("setting a stage updates deal_stage AND stage when the record carries both", () => {
    // 28 of 44 deals disagreed because writes landed on one key. From now they cannot diverge.
    const out = withStageStamps("deals", { deal_stage: "Lead", stage: "Lead" }, { deal_stage: "Proposal" });
    expect(out.deal_stage).toBe("Proposal");
    expect(out.stage).toBe("Proposal");
  });

  it("does not invent a field the record never had", () => {
    const out = withStageStamps("deals", { stage: "Lead" }, { stage: "Won" });
    expect(out.stage).toBe("Won");
    expect(out.deal_stage).toBeUndefined();
  });

  it("still stamps won_at exactly once, on the transition", () => {
    const out = withStageStamps("deals", { stage: "Lead" }, { stage: "Closed Won" }, () => "2026-08-03T00:00:00Z");
    expect(out.won_at).toBe("2026-08-03T00:00:00Z");
    const again = withStageStamps("deals", { stage: "Closed Won", won_at: "2026-01-01T00:00:00Z" }, { stage: "Closed Won" });
    expect(again.won_at).toBe("2026-01-01T00:00:00Z");
  });
});

describe("reconciliation proposes only where evidence exists", () => {
  const src = read("packages/api/src/lib/reconcile-stage.ts");

  it("a same-instant change is refused, not broken as a tie", () => {
    // 20 of the 28 had both fields written by ONE import. Treating "last edited" as a signal there
    // would silently pick whichever comparison operator happened to win.
    expect(src).toMatch(/gap === 0/);
    expect(src).toMatch(/proposed: null/);
  });

  it("the write path is read-merge-write", () => {
    // PATCH replaces `data` wholesale; anything not re-sent is erased.
    expect(src).toMatch(/\.\.\.\(\(row\.data \?\? \{\}\)/);
  });

  it("the endpoint is owner-gated and dry-run by default", () => {
    const routes = read("packages/api/src/routes/periods.ts");
    expect(routes).toMatch(/reconcile-stage/);
    expect(routes).toMatch(/dry_run: z\.boolean\(\)\.default\(true\)/);
    expect(routes).toMatch(/Owner\/admin only/);
  });
});
