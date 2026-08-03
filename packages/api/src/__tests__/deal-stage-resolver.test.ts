import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dealStageOf, dealStageKey, stageIndex } from "@mondaily/shared/deal-stage";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * One fact, one resolver.
 *
 * Deals store their stage under `deal_stage`, `stage` or `status`, and the app had NINE different
 * fallback chains for it — with different precedence. `stage ?? deal_stage` and
 * `deal_stage ?? stage` are not the same question, and in this workspace 28 of 44 deals carry both
 * fields with DIFFERENT values, so the chains genuinely disagreed about which deals were won.
 */
describe("deal stage is resolved in one place", () => {
  it("prefers deal_stage, then stage, then status", () => {
    expect(dealStageOf({ deal_stage: "Negotiation", stage: "Lead" })).toBe("Negotiation");
    expect(dealStageOf({ stage: "Proposal" })).toBe("Proposal");
    expect(dealStageOf({ status: "Qualified" })).toBe("Qualified");
  });

  it("returns empty for an unstaged deal rather than inventing one", () => {
    // `?? "Lead"` counted deals that never said as OPEN leads, inflating pipeline value.
    expect(dealStageOf({})).toBe("");
    expect(dealStageOf(null)).toBe("");
    expect(stageIndex("")).toBe(-1);
  });

  it("writes back to the key the record actually uses", () => {
    // Writing deal_stage onto a record staged via `stage` leaves two fields disagreeing, and since
    // the resolver prefers deal_stage the deal would silently change stage on save.
    expect(dealStageKey({ stage: "Lead" })).toBe("stage");
    expect(dealStageKey({ deal_stage: "Lead", stage: "Won" })).toBe("deal_stage");
    expect(dealStageKey({})).toBe("deal_stage");
  });

  it("no surface defaults an unstaged deal to a real stage", () => {
    for (const f of [
      "apps/app/src/routes/dashboard/insights.tsx",
      "apps/app/src/routes/dashboard/pipeline.tsx",
      "apps/app/src/components/records/record-detail.tsx",
    ]) {
      expect(read(f), f).not.toMatch(/deal_stage\s*\?\?\s*"Lead"/);
    }
  });

  it("the API keeps one implementation, not a second copy", () => {
    expect(read("packages/api/src/lib/stage-stamps.ts")).toMatch(/from "@mondaily\/shared\/deal-stage"/);
  });
});
