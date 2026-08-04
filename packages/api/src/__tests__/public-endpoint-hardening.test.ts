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

describe("rate limiting survives serverless", () => {
  const mw = read("middleware/rate-limit.ts");
  const auth = read("routes/auth.ts");

  it("counts in Postgres first, memory only as fallback", () => {
    // In-memory counters are per warm instance. Measured in prod 2026-08-04: fifteen rapid requests
    // to a 12/min endpoint all returned 200, because each landed on a different instance. The
    // limiter and the login lockout both believed they were protecting something they were not.
    expect(mw).toMatch(/const durable = await store\.hit\(/);
    expect(mw).toMatch(/from "\.\.\/lib\/rate-limit-store"/);
    expect(auth).toMatch(/await store\.hit\(`login-lock\|/);
  });

  it("FAILS SOFT when the table is missing", () => {
    // A limiter that takes the product down because its own migration has not run is a worse
    // outage than the abuse it prevents.
    const st = read("lib/rate-limit-store.ts");
    expect(st).toMatch(/tableMissing = true/);
    expect(st).toMatch(/return null/);
    expect(mw).toMatch(/if \(durable\) \{/);
  });

  it("a correct password forgives past failures", () => {
    // Otherwise a legitimate user who mistyped six times stays locked out after logging in.
    expect(auth).toMatch(/clearLoginFails/);
  });

  it("counts atomically, so two concurrent requests cannot both read '1'", () => {
    const sql = readFileSync(
      join(SRC, "../../db/migrations/20260804_rate_limits.sql"), "utf8");
    expect(sql).toMatch(/on conflict \(key\) do update/);
    expect(sql).toMatch(/rate_limit_hit/);
  });
});

describe("a broken limiter is distinguishable from an absent one", () => {
  const st = read("lib/rate-limit-store.ts");

  it("an RPC error that is NOT 'missing' is reported, not latched", () => {
    // rate_limit_hit installed cleanly and failed at CALL time (an ambiguous OUT parameter named
    // like a column). Every error returned null → in-memory fallback → still 200 fifteen times.
    // A security control that fails silently is worse than one that is obviously off.
    expect(st).toMatch(/rate-limit store failing/);
    expect(st).toMatch(/console\.error\("\[rate-limit\]/);
  });

  it("exposes health for readiness", () => {
    expect(st).toMatch(/export const rateLimitStoreHealth/);
  });

  it("the SQL fix names outputs so they cannot collide with columns", () => {
    const sql = readFileSync(
      join(SRC, "../../db/migrations/20260804b_rate_limits_fix_ambiguity.sql"), "utf8");
    expect(sql).toMatch(/returns table \(out_hits integer, out_locked_until timestamptz\)/);
    expect(sql).toMatch(/into v_hits, v_locked/);
    // And PROVES it runs — a successful CREATE proved nothing last time.
    expect(sql).toMatch(/select \* from rate_limit_hit\('migration-selftest'/);
  });
});

