import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PIPE_STAGES, isOpenStage } from "@mondaily/shared/deal-stage";

const src = readFileSync(join(__dirname, "../routes/ask.ts"), "utf8");

/**
 * Ask must answer with the WORKSPACE's definitions, not its own.
 *
 * Measured live 2026-08-04: asked for open pipeline, Ask replied "28" while every dashboard said
 * 21. Nothing was broken in a resolver — the model had simply inferred "open = not closed" and
 * folded in "On Hold" (3, outside the pipeline ladder) and unstaged deals (4). An assistant that
 * contradicts the product's own numbers is worse than one that declines to answer.
 */
describe("Ask is told the workspace's definitions", () => {
  it("the pipeline ladder comes from the shared module, not a prose copy", () => {
    // Interpolated, so a stage added to PIPE_STAGES reaches the prompt automatically.
    expect(src).toMatch(/\$\{PIPE_STAGES\.join\(/);
    expect(src).toMatch(/from "@mondaily\/shared\/deal-stage"/);
  });

  it("states that unstaged and off-ladder stages are NOT open", () => {
    expect(src).toMatch(/An unstaged deal is NOT open/);
    expect(src).toMatch(/On Hold/);
  });

  it("states the FLOW vs STOCK rule", () => {
    // A windowed stock reports zero on the 1st — the defect this codebase already fixed twice.
    expect(src).toMatch(/STOCK metrics .* must NEVER be windowed/s);
  });

  it("states that `status` is not a stage", () => {
    expect(src).toMatch(/"status" is a DIFFERENT field/);
  });

  it("the definition it teaches matches the code it describes", () => {
    // The prompt claims open = sits at a pipeline stage. Assert that is what isOpenStage does, so
    // the two cannot drift into disagreeing again.
    expect(isOpenStage("On Hold")).toBe(false);
    expect(isOpenStage("")).toBe(false);
    expect(isOpenStage("Closed Won")).toBe(false);
    for (const s of PIPE_STAGES) expect(isOpenStage(s)).toBe(true);
  });
});
