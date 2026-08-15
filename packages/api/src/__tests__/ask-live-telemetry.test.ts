import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "../../../../apps/app/src");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const engine = strip(readFileSync(join(APP, "components/ai/use-ask-engine.ts"), "utf8"));
const askPage = strip(readFileSync(join(APP, "components/ai/ask-mondaily.tsx"), "utf8"));
const shared = strip(readFileSync(join(APP, "components/ai/ask-shared.tsx"), "utf8"));
const home = strip(readFileSync(join(APP, "routes/dashboard/home.tsx"), "utf8"));
const help = strip(readFileSync(join(APP, "components/help/help-panel.tsx"), "utf8"));

/**
 * What the Ask status line shows must be TRUE — the step, the seconds, the tokens.
 *
 * Audited 2026-08-15 against the request "work like Claude chat: exact step, real seconds, right
 * token counts, task-aware suggestions". Three things were false and are now banned:
 *
 *   - a canned four-step script rotating on an 850ms timer, under a comment CLAIMING it was
 *     "not a fake animation" (Home's audit had already removed the same fake once)
 *   - a live token counter that counted SSE FRAMES — the number changed with how the transport
 *     batched, not with the answer
 *   - two competing clocks, one of which reset to zero the instant the answer landed
 */
describe("the Ask status line only says true things", () => {
  it("the canned reasoning-steps script is gone from every surface", () => {
    for (const [name, src] of [["engine", engine], ["ask page", askPage], ["shared", shared], ["home", home]] as const) {
      expect(src, `${name} must not carry the fake step list`).not.toMatch(/GRAPH_REASONING_STEPS/);
    }
  });

  it("the step shown is the real one: tool status, else Writing once tokens flow, else Thinking", () => {
    expect(askPage).toMatch(/streamStatus \?\? \(tokenCount > 0 \? "Writing" : "Thinking"\)/);
    expect(home).toMatch(/streamStatus \?\? \(tokenCount > 0 \? "Writing" : "Thinking"\)/);
  });

  it("live tokens are ESTIMATED from characters, never counted from frames", () => {
    // One SSE frame can carry many tokens; frames++ understated long answers by whatever the
    // transport happened to batch.
    expect(engine).toMatch(/tokens = estimateTokens\(streamed\)/);
    expect(engine).not.toMatch(/tokens \+= 1/);
  });

  it("the live estimate is LABELLED as one", () => {
    expect(askPage).toMatch(/~\{tokenCount\} tokens/);
  });

  it("the exact count replaces the estimate when the provider reports usage", () => {
    expect(engine).toMatch(/tokens: finalUsage\?\.total_tokens \?\? estimateTokens\(reply\)/);
    expect(engine).toMatch(/tokensExact: finalUsage != null/);
  });

  it("one clock, from a real Date.now, frozen when the turn ends — not reset", () => {
    expect(engine).toMatch(/setElapsedSeconds\(Math\.floor\(\(Date\.now\(\) - startedAt\) \/ 1000\)\)/);
    expect(engine).toMatch(/freezeClock\(\); setLoading\(false\)/);
    // The page must consume the engine's clock rather than running a duplicate that resets.
    expect(askPage).not.toMatch(/setThinkingSeconds/);
    expect(askPage).toMatch(/fmtElapsed\(elapsedSeconds\)/);
  });

  it("the token ledger renders only real provider usage", () => {
    expect(shared).toMatch(/if \(!usage\) return null;/);
    expect(shared).toMatch(/if \(total === 0\) return null;/);
  });
});

describe("suggestions follow the task at every entry point", () => {
  it("the Home task widget no longer discards the follow-ups the API returns", () => {
    // The field was typed, read, and thrown away — suggestions existed everywhere except where shown.
    expect(home).toMatch(/setTaskWidgetFollowups\(\(data\.suggestions \?\? \[\]\)\.slice\(0, 3\)\)/);
    expect(home).toMatch(/taskWidgetFollowups\.map/);
    // Clicking one runs it through the same input path the user types into.
    expect(home).toMatch(/void submitTaskWidgetInput\(f\)/);
  });
});

describe("the support agent shows what is truthfully known", () => {
  it("a real elapsed clock, from Date.now", () => {
    expect(help).toMatch(/setBusySeconds\(Math\.floor\(\(Date\.now\(\) - started\) \/ 1000\)\)/);
  });

  it("says what it is doing instead of a bare spinner and an ellipsis", () => {
    expect(help).toMatch(/Investigating — reading your workspace and diagnostics/);
  });

  it("does not invent per-step progress for phases that emit no events", () => {
    // The agent answers in strict JSON parsed whole; fake steps are the pattern this codebase
    // keeps having to remove.
    expect(help).not.toMatch(/GRAPH_REASONING_STEPS|setInterval\([^)]*step/i);
  });
});
