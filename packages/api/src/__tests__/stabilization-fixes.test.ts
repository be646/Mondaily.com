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

describe("grounding is a shared discipline, not a memo-only feature", () => {
  it("one validator lives in lib/grounding; the memo delegates to it", async () => {
    const owner = readFileSync(join(__dirname, "../routes/owner.ts"), "utf8");
    expect(owner).toMatch(/from "\.\.\/lib\/grounding"/);
    expect(owner).toMatch(/return groundingViolations\(memo, payload, \{ base \}\)/);
  });

  it("string payloads (digests) contribute their embedded numbers", async () => {
    const { groundingViolations } = await import("../lib/grounding");
    const digest = "AI credits (tokens) used in last 30 days: 745180.\nAssigned tasks — open: 4, overdue: 2.";
    // narrating the digest's own number passes; inventing one fails
    expect(groundingViolations("They used 745,180 tokens this month.", digest)).toEqual([]);
    expect(groundingViolations("They used 900,000 tokens this month.", digest)).not.toEqual([]);
  });

  it("oversight insight is checked against its digest and rejected prose is dropped, not shipped", () => {
    const acts = readFileSync(join(__dirname, "../routes/activities.ts"), "utf8");
    expect(acts).toMatch(/groundingViolations\(insight, digest\)/);
    expect(acts).toMatch(/rejected — not grounded/);
    // the rejection path yields the honest thin-data sentence, never the invented prose
    expect(acts).toMatch(/insight = "";/);
  });

  it("streaming chat marks a gateway outage as degraded end-to-end", () => {
    const ask = readFileSync(join(__dirname, "../routes/ask.ts"), "utf8");
    expect(ask).toMatch(/degraded: streamProvider === "none"/);
    const engine = readFileSync(join(__dirname, "../../../../apps/app/src/components/ai/use-ask-engine.ts"), "utf8");
    expect(engine).toMatch(/finalDegraded = ev\.degraded === true/);
    const chat = readFileSync(join(__dirname, "../../../../apps/app/src/components/ai/ask-mondaily.tsx"), "utf8");
    expect(chat).toMatch(/a fallback notice, not an answer/);
  });

  it("readiness measures recordings storage and never presents an undercount as a total", () => {
    const mail = readFileSync(join(__dirname, "../lib/mail.ts"), "utf8");
    expect(mail).toMatch(/export async function recordingsStorageUsage/);
    expect(mail).toMatch(/partial = true/);
    const readiness = readFileSync(join(__dirname, "../routes/admin-readiness.ts"), "utf8");
    expect(readiness).toMatch(/recordings_storage_bytes: storage\.bytes/);
    expect(readiness).toMatch(/recordings_storage_partial: storage\.partial/);
  });
});
