import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const GATEWAY = readFileSync(join(__dirname, "../lib/ai-gateway.ts"), "utf8");

/**
 * What happens when the AI provider says 429.
 *
 * REPORTED 2026-08-13 with a screenshot: Ask ran its tools, listed eight real records, and then
 * answered "⏳ Mondaily AI is at its current throughput limit". The lookups had already succeeded —
 * the work was done and then thrown away.
 *
 * The cause was the recovery path, which fired immediately against the same account and the same
 * model. For a spent per-minute quota that cannot work: the retry is inside the same window, so it
 * 429s in milliseconds and the user gets an apology. A recovery that cannot succeed against the
 * failure it most often meets is not a recovery.
 *
 * MEASURED at the same time, and the reason the limit is reached at all: chat prompts run a median
 * of 8,514 tokens and a maximum of 30,783, with the largest taking 60–122 SECONDS. A tokens-per-
 * minute ceiling is reached by a couple of large questions, not by request volume — peak traffic
 * was only 7 requests/minute.
 */
describe("a rate-limited answer gets recovered, not apologised for", () => {
  it("waits before retrying a rate-limited call", () => {
    // Retrying instantly lands in the same spent window. The wait is the whole fix.
    expect(GATEWAY).toMatch(/if \(rateLimited\) \{[\s\S]{0,200}retryAfterMs\(err\)/);
    expect(GATEWAY).toMatch(/setTimeout\(res, waitMs\)/);
  });

  it("honours the provider's Retry-After but never hangs on it", () => {
    // Obeying a 60s Retry-After literally is what made chat "load forever" once already.
    expect(GATEWAY).toMatch(/retry-after/i);
    expect(GATEWAY).toMatch(/MAX_WAIT_MS\s*=\s*(\d+)/);
    const cap = Number(/MAX_WAIT_MS\s*=\s*(\d+)/.exec(GATEWAY)?.[1] ?? 0);
    expect(cap, "the wait must stay short enough that a chat request does not stall").toBeGreaterThan(0);
    expect(cap).toBeLessThanOrEqual(5000);
  });

  it("still pauses when the provider sends no Retry-After header", () => {
    // A missing header is the common case; falling through to zero wait reinstates the bug.
    expect(GATEWAY).toMatch(/return 1200;/);
  });

  it("retries a rate limit on a DIFFERENT model than the one that was throttled", () => {
    // Same model, same bucket. The fast model is usually accounted separately.
    expect(GATEWAY).toMatch(/resolveModel\(rateLimited \? FAST_MODEL_SPEC : DEFAULT_MODEL_SPEC\)/);
  });

  it("a non-rate-limit failure still recovers immediately", () => {
    // A broken or 400-ing model must not be punished with a wait — that is pure added latency.
    // Every wait in the file must sit inside a rate-limit branch, so assert on the guard rather
    // than trying to reason about indentation.
    const waits = [...GATEWAY.matchAll(/await new Promise\(res => setTimeout/g)];
    expect(waits.length, "expected the rate-limit waits to exist").toBeGreaterThan(0);
    for (const w of waits) {
      const preceding = GATEWAY.slice(Math.max(0, w.index! - 300), w.index!);
      expect(preceding, `a wait at index ${w.index} is not guarded by a rate-limit check`)
        .toMatch(/rateLimited/);
    }
  });

  /**
   * Home calls POST /ask (non-streaming); /ask/new streams. Two entry points to the same feature,
   * and the non-streaming one had NO retry — a single 429 produced "trouble connecting to the AI
   * service", which is not what happened: the quota was spent and the service was fine. The screen
   * users land on gave the least accurate answer.
   */
  it("the non-streaming path Home uses recovers the same way", () => {
    // Slice from this function to the NEXT top-level declaration after it — runOpenAICompatAgent is
    // defined earlier in the file, so slicing to it ran backwards and silently produced "".
    const start = GATEWAY.indexOf("export async function aiGatewayAgent(");
    expect(start, "aiGatewayAgent must exist").toBeGreaterThan(-1);
    const after = GATEWAY.indexOf("\nexport async function", start + 1);
    const block = GATEWAY.slice(start, after > start ? after : undefined);
    expect(block.length, "the function block must not be empty — the slice is inverted").toBeGreaterThan(200);
    expect(block, "Home's path must detect a rate limit too").toMatch(/const rateLimited = primaryErr\?\.status === 429/);
    expect(block, "…wait before retrying").toMatch(/retryAfterMs\(primaryErr\)/);
    expect(block, "…and retry on the fast model").toMatch(/resolveModel\(FAST_MODEL_SPEC\)/);
  });

  it("both entry points tell the user the SAME true thing about a quota", () => {
    // Reporting "trouble connecting" for a rate limit sends the user to check their network for a
    // problem that is ours and self-clearing.
    const occurrences = GATEWAY.match(/throughput limit/g) ?? [];
    expect(occurrences.length, "both the streaming and non-streaming paths must use the rate-limit wording")
      .toBeGreaterThanOrEqual(2);
  });

  it("never names the AI supplier to the user", () => {
    // The system is ours; infrastructure suppliers are not surfaced. A leaked vendor name in a
    // user-facing string is both a support problem and a sovereignty one.
    const messages = GATEWAY.match(/"[^"]*(throughput limit|trouble reaching)[^"]*"/g) ?? [];
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) expect(m.toLowerCase()).not.toMatch(/cerebras|openai|anthropic|groq|together/);
  });
});
