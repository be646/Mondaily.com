import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "../routes/ask.ts"), "utf8");

/**
 * Every tool must be REACHABLE.
 *
 * selectTools hands the model CORE_TOOLS plus any keyword-matched group. A tool added to TOOLS but
 * to no group is dead: defined, dispatchable, documented — and never passed. That is exactly what
 * happened to pipeline_metrics, which was written, deployed, and then denied by the assistant
 * ("I'm not seeing a pipeline_metrics tool") because nothing selected it.
 *
 * Nothing warned. This test is the warning. Parsed statically — importing ask.ts drags in the DB
 * client and the AI gateway, which is not what a registry check should need.
 */
const declared = [...src.matchAll(/^\s{4}name: "([a-z_]+)",$/gm)].map(m => m[1]!);
const core = (src.match(/const CORE_TOOLS = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "")
  .match(/"([a-z_]+)"/g)?.map(s => s.replace(/"/g, "")) ?? [];
const grouped = (src.match(/const TOOL_GROUPS[\s\S]*?\n\];/)?.[0] ?? "")
  .match(/tools: \[([^\]]*)\]/g)?.flatMap(b => (b.match(/"([a-z_]+)"/g) ?? []).map(s => s.replace(/"/g, ""))) ?? [];

describe("no Ask tool is unreachable", () => {
  it("parses the registry", () => {
    expect(declared.length).toBeGreaterThan(10);
    expect(core.length).toBeGreaterThan(3);
    expect(grouped.length).toBeGreaterThan(10);
  });

  it("every declared tool is in CORE or a keyword group", () => {
    const reachable = new Set([...core, ...grouped]);
    const dead = declared.filter(n => !reachable.has(n));
    expect(dead, `unreachable — add to CORE_TOOLS or a TOOL_GROUP: ${dead.join(", ")}`).toEqual([]);
  });

  it("pipeline_metrics is reachable, and its keywords cover ordinary deal questions", () => {
    expect([...core, ...grouped]).toContain("pipeline_metrics");
    const kw = src.match(/tools: \["pipeline_metrics"\], keywords: (\/.*?\/i)/)?.[1] ?? "";
    expect(kw).toBeTruthy();
    const re = new RegExp(kw.slice(1, kw.lastIndexOf("/")), "i");
    for (const q of ["how many deals are open", "what is my pipeline worth", "how many did we win"]) {
      expect(re.test(q), q).toBe(true);
    }
  });
});
