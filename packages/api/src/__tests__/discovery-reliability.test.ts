import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const route = readFileSync(join(__dirname, "../routes/discovery.ts"), "utf8");
const page = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/discovery.tsx"), "utf8");

/**
 * Phase 6 — "sometimes it works, sometimes it stops". Diagnosis found three real causes: hung
 * streams spun forever with no error, interactive sweeps left no trace to diagnose, and the
 * dedupe scans silently truncated at the row cap and re-created what they couldn't see.
 */
describe("every interactive sweep is a recorded run", () => {
  it("starts an agent_jobs run, completes with the stage diagnostics, fails honestly", () => {
    expect(route).toMatch(/agent_name: "discovery",\s*\n\s*trigger_type: "manual"/);
    expect(route).toMatch(/duration_ms: Date\.now\(\) - t0/);
    expect(route).toMatch(/await failJob\(jobId, inner instanceof Error/);
  });

  it("GET /discovery/runs serves the history from agent_jobs with per-stage numbers", () => {
    expect(route).toMatch(/router\.get\("\/runs"/);
    expect(route).toMatch(/stages: \{ queries: Number\(out\.queries \?\? 0\), hits: Number\(out\.hits \?\? 0\), extracted: Number\(out\.extracted \?\? 0\), matched: Number\(out\.matched \?\? 0\) \}/);
  });
});

describe("dedupe scans read everything, not the first page", () => {
  it("no .limit(5000) node reads remain — they truncated at the server row cap", () => {
    expect(route).not.toMatch(/from\("nodes"\)[\s\S]{0,160}\.limit\(5000\)/);
    expect(route).toMatch(/async function pagedIdData/);
    expect(route).toMatch(/\.range\(from, from \+ PAGE - 1\)/);
  });
});

describe("a hung stream becomes an honest error, not an eternal spinner", () => {
  it("the reader has a 60s stall watchdog that aborts with a retryable message", () => {
    expect(page).toMatch(/no progress for 60s/);
    expect(page).toMatch(/const feed = \(\) => \{ clearTimeout\(watchdog\)/);
    // fed on every chunk, cleared when the loop exits
    expect(page).toMatch(/if \(done\) break;\s*\n\s*feed\(\);/);
    expect(page).toMatch(/\} finally \{ clearTimeout\(watchdog\); \}/);
  });

  it("the abort reason reaches the user instead of an opaque AbortError", () => {
    expect(page).toMatch(/reason instanceof Error \? reason\.message/);
  });
});

describe("a rate-limited engine is INFRA, not 'no results'", () => {
  const job = readFileSync(join(__dirname, "../jobs/social-discovery.ts"), "utf8");
  it("429 marks the sweep unreachable after one polite retry", () => {
    // The run-history's FIRST live row caught this: 8 query angles, 0 hits, 5 seconds — while
    // /discovery/status (a single request) said HEALTHY. The burst tripped SearXNG's limiter and
    // every 429 was reported as a clean zero, indistinguishable from a genuinely dry query.
    expect(job).toMatch(/res\.status >= 500 \|\| res\.status === 429, rateLimited: res\.status === 429/);
    expect(job).toMatch(/if \(res\.status === 429\) \{/);        // the single retry
  });
  it("the user is told to wait, not that nothing exists", () => {
    expect(job).toMatch(/rate-limited this sweep — wait a minute and try again/);
  });
});
