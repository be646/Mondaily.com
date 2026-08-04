import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

/**
 * The public surface is the one anyone on the internet can bill us through.
 *
 * /api/v1/public/ask is unauthenticated by design — a visitor asking about pricing has no account —
 * and it calls the AI gateway. It had NO rate limit, NO cap on message length and NO cap on how many
 * messages could be sent. maxTokens capped the answer; nothing capped the question.
 */
describe("public AI endpoint is bounded", () => {
  const src = read("routes/public-ask.ts");

  it("is rate limited per IP", () => {
    expect(src).toMatch(/rateLimit\(\{ max: \d+, windowMs: [\d_]+ \}\)/);
    expect(src).toMatch(/from "\.\.\/middleware\/rate-limit"/);
  });

  it("caps message length and conversation depth", () => {
    // The prompt is what costs money; z.string() with no max let a caller paste a novel.
    expect(src).toMatch(/content: z\.string\(\)\.max\(/);
    expect(src).toMatch(/\.min\(1\)\.max\(\d+\)/);
  });
});

describe("there is exactly one rateLimit implementation", () => {
  it("the no-op passthrough is gone", () => {
    // middleware/ratelimit.ts exported a 6-line createMiddleware that just called next() — an
    // identically-named no-op sitting beside the real 48-line limiter. Nothing imported it, but a
    // one-character filename difference would have silently disabled protection while reading as
    // if it were enabled.
    expect(existsSync(join(SRC, "middleware/ratelimit.ts"))).toBe(false);
    expect(existsSync(join(SRC, "middleware/rate-limit.ts"))).toBe(true);
  });

  it("the surviving one actually counts hits", () => {
    const real = read("middleware/rate-limit.ts");
    expect(real).toMatch(/hits\.length >= max/);
    expect(real).toMatch(/Retry-After/);
  });
});
