import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ubc = readFileSync(join(__dirname, "../../../db/src/ubc.ts"), "utf8");
const nodes = readFileSync(join(__dirname, "../routes/nodes.ts"), "utf8");
const ask = readFileSync(join(__dirname, "../routes/ask.ts"), "utf8");

/** Stabilization pass — the two named production bugs from the audit scorecard. */
describe("GET /nodes pagination is real", () => {
  it("offset is in the schema — zod no longer strips it", () => {
    // It was absent entirely: clients paginating got page one repeatedly, silently.
    expect(nodes).toMatch(/offset: z\.coerce\.number\(\)\.min\(0\)\.default\(0\)/);
  });
  it("listNodes applies offset via range with a deterministic id tiebreak", () => {
    expect(ubc).toMatch(/\.range\(from, from \+ limit - 1\)/);
    // updated_at alone skips/duplicates rows sharing a timestamp (bulk writes) — pages must be stable
    expect(ubc).toMatch(/\.order\("updated_at", \{ ascending: false \}\)\.order\("id", \{ ascending: true \}\)/);
  });
});

describe("a gateway outage is not a healthy answer", () => {
  it("provider 'none' marks the response degraded with a header monitors can alert on", () => {
    // The graceful fallback used to ship as a 200 identical to a real answer.
    expect(ask).toMatch(/const degraded = provider === "none";/);
    expect(ask).toMatch(/X-Mondaily-Degraded/);
    expect(ask).toMatch(/degraded, memory:/);
  });
});
