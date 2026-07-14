import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { partitionSaveBatch, bulkOutcome } from "../lib/discovery-pipeline";

/**
 * Discovery bulk-failure honesty. The pure classifiers behind /save-batch and /bulk-{task,decision}
 * must account for EVERY selected lead in a disjoint bucket, so the UI can never show fake success.
 */
const lead = (name: string, website?: string) => ({ name, website });

describe("partitionSaveBatch — every lead in exactly one bucket", () => {
  it("all-new batch → all toInsert, none existed/skipped", () => {
    const r = partitionSaveBatch([lead("Acme", "acme.com"), lead("Beta", "beta.io")], new Map());
    expect(r.toInsert.map((l) => l.name)).toEqual(["Acme", "Beta"]);
    expect(r.already_existed).toEqual([]);
    expect(r.skipped_details).toEqual([]);
  });

  it("duplicate / in-graph handling → reported as already_existed with node id, not re-inserted", () => {
    const existing = new Map([["acme.com", "node_1"]]);
    const r = partitionSaveBatch([lead("Acme", "acme.com"), lead("Beta", "beta.io")], existing);
    expect(r.already_existed).toEqual([{ name: "Acme", node_id: "node_1" }]);
    expect(r.toInsert.map((l) => l.name)).toEqual(["Beta"]);
  });

  it("intra-batch duplicate → skipped with a reason (not double-created)", () => {
    const r = partitionSaveBatch([lead("Acme", "acme.com"), lead("Acme dup", "acme.com")], new Map());
    expect(r.toInsert.map((l) => l.name)).toEqual(["Acme"]);
    expect(r.skipped_details).toEqual([{ name: "Acme dup", reason: "duplicate of another selected lead" }]);
  });

  it("no name/website key → skipped with a reason (never silently dropped)", () => {
    const r = partitionSaveBatch([{ name: "", website: "" }], new Map());
    expect(r.toInsert).toEqual([]);
    expect(r.skipped_details[0]!.reason).toMatch(/missing/);
  });

  it("counts reconcile with the selection (created + existed + skipped === total)", () => {
    const existing = new Map([["acme.com", "n1"]]);
    const leads = [lead("Acme", "acme.com"), lead("Beta", "beta.io"), lead("Beta2", "beta.io"), { name: "", website: "" }];
    const r = partitionSaveBatch(leads, existing);
    expect(r.toInsert.length + r.already_existed.length + r.skipped_details.length).toBe(leads.length);
  });
});

describe("bulkOutcome — honest created/failed tally", () => {
  it("all success", () => {
    expect(bulkOutcome([{ ok: true }, { ok: true }])).toEqual({ created: 2, failed: 0 });
  });
  it("partial success", () => {
    expect(bulkOutcome([{ ok: true }, { ok: false }, { ok: true }])).toEqual({ created: 2, failed: 1 });
  });
  it("all failed", () => {
    expect(bulkOutcome([{ ok: false }, { ok: false }])).toEqual({ created: 0, failed: 2 });
  });
  it("empty", () => {
    expect(bulkOutcome([])).toEqual({ created: 0, failed: 0 });
  });
});

describe("route + frontend wiring (source guards)", () => {
  const route = readFileSync(fileURLToPath(new URL("../routes/discovery.ts", import.meta.url)), "utf8");
  const ui = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/discovery.tsx", import.meta.url)), "utf8");

  it("save-batch returns per-lead failed + skipped_details, never a blanket 400 error", () => {
    expect(route).toMatch(/partitionSaveBatch\(leads, existingByKey\)/);
    expect(route).toMatch(/const failed = toInsert\.map\(\(b\) => \(\{ name: b\.name, reason: error\.message \|\| "no reason returned" \}\)\)/);
    expect(route).toMatch(/skipped_details, ids: \[\], created: \[\], already_existed, failed \}, 200\)/);
  });

  it("bulk-task/decision keep per-lead results + honest tally", () => {
    expect((route.match(/return c\.json\(\{ \.\.\.bulkOutcome\(results\), results \}\)/g) ?? []).length).toBe(2);
  });

  it("frontend success chips are driven from per-item status (created→saved, failed→failed)", () => {
    // save: only res.created get a saved chip; res.failed get a failed chip (never a success one)
    expect(ui).toMatch(/for \(const cr of res\.created\)[^\n]*updates\[k\] = \{ saved: true/);
    expect(ui).toMatch(/for \(const f of failures\)[^\n]*updates\[k\] = \{ failed: true, failReason: f\.reason \}/);
    // bulk: ok → tasked/queued, !ok → failed with reason
    expect(ui).toMatch(/r\.ok \? \(kind === "task" \? \{ tasked: true \} : \{ queued: true \}\) : \{ failed: true, failReason: r\.error \|\| "no reason returned" \}/);
  });

  it("frontend ledger shows created / existed / skipped / failed + failed names & reasons", () => {
    expect(ui).toMatch(/interface BulkLedger \{ verb: string; total: number; created: number; existed: number; skipped: number; failed: number; failures/);
    expect(ui).toMatch(/ledger\.failures\.slice\(0, 8\)\.map/);
    expect(ui).toMatch(/f\.reason \|\| "no reason returned"/);
    // a thrown request marks the whole batch failed honestly (no fake success)
    expect(ui).toMatch(/const allFailed = \(verb: string, reason: string\): BulkLedger/);
  });

  it("PipelineChips can render a Failed chip with its reason (never a success chip for failures)", () => {
    expect(ui).toMatch(/st\.failed \? \{ l: "Failed", tone: "#d1524a", title: st\.failReason \|\| "no reason returned" \}/);
  });
});
