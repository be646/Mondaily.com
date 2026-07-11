import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Action-item promotion — turn a REAL extracted call action item into a Task or a Decision. Guards:
 * workspace-scoped, idempotent (no duplicate on a second click), honest (only promotes an item that
 * exists), and the detail UI shows per-item status.
 */
const calls = readFileSync(fileURLToPath(new URL("../routes/calls.ts", import.meta.url)), "utf8");
const detail = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/call-detail.tsx", import.meta.url)), "utf8");

describe("promotion endpoint — scoped, validated, honest", () => {
  it("exists and accepts only task | decision", () => {
    expect(calls).toMatch(/router\.post\("\/:id\/action-items\/:index\/promote"/);
    expect(calls).toMatch(/target: z\.enum\(\["task", "decision"\]\)/);
  });
  it("is workspace-scoped (node load + inserts + node update all carry the workspace)", () => {
    expect(calls).toMatch(/const node = await getCall\(ws, c\.req\.param\("id"\)\)/);
    expect(calls).toMatch(/workspace_id: ws, title: item\.slice\(0, 300\)/);         // task insert
    expect(calls).toMatch(/workspace_id: ws, source_type: "call_record"/);           // decision insert
    expect(calls).toMatch(/\.update\(\{ data: \{[^]*?action_item_promotions: map \} \}\)\.eq\("workspace_id", ws\)/);
  });
  it("only promotes an item that actually exists (index bounds → 400)", () => {
    expect(calls).toMatch(/if \(!Number\.isInteger\(idx\) \|\| idx < 0 \|\| idx >= items\.length\) return c\.json\(\{ error: "invalid_index" \}, 400\)/);
    expect(calls).toMatch(/if \(!item\) return c\.json\(\{ error: "empty_item" \}, 400\)/);
  });
});

describe("idempotency + duplicate prevention", () => {
  it("already-promoted item returns the same id (no new row)", () => {
    expect(calls).toMatch(/if \(existing\?\.id\) return c\.json\(\{ index: idx, type: existing\.type, id: existing\.id, status: statusFor\(existing\.type\), idempotent: true \}\)/);
  });
  it("re-reads before persisting so a fast double-click can't double-write", () => {
    expect(calls).toMatch(/const \{ data: fresh \} = await supabase\.from\("nodes"\)\.select\("data"\)/);
    expect(calls).toMatch(/if \(raced\?\.id\) return c\.json\([^]*?idempotent: true \}\)/);
  });
  it("uses existing task / decision_queue shapes; failure returns a reason + failed status", () => {
    expect(calls).toMatch(/supabase\.from\("tasks"\)\.insert\(/);
    expect(calls).toMatch(/supabase\.from\("decision_queue"\)\.insert\(/);
    expect((calls.match(/error: "create_failed", reason: error\?\.message[^]*?status: "failed" \}, 500\)/g) ?? []).length).toBe(2);
  });
});

describe("detail UI — buttons + per-item status", () => {
  it("Create task + Send to Decision Queue call the promote endpoint", () => {
    expect(detail).toMatch(/apiClient\.post\(`\/calls\/\$\{id\}\/action-items\/\$\{index\}\/promote`, \{ target \}\)/);
    expect(detail).toMatch(/Create task/);
    expect(detail).toMatch(/Send to Decision Queue/);
  });
  it("prevents re-promoting (guards on pending + existing promotion)", () => {
    expect(detail).toMatch(/if \(promoting \|\| call\?\.action_item_promotions\?\.\[String\(index\)\]\) return/);
  });
  it("shows the four states: not promoted / task created / decision queued / failed", () => {
    expect(detail).toMatch(/promo\.type === "task" \? "Task created" : "Decision queued"/);
    expect(detail).toMatch(/Failed — \{err\}/);
  });
  it("status persists (reads action_item_promotions surfaced by normalizeCall)", () => {
    expect(calls).toMatch(/action_item_promotions: \(data\.action_item_promotions && typeof data\.action_item_promotions === "object"\)/);
  });
});

describe("must-not-change", () => {
  it("no Memory Phase 2B and no third-party (sovereign)", () => {
    expect(calls).not.toMatch(/memory-recall|recallContext|buildAskMemory/);
    expect(calls).not.toMatch(/openai\.com|deepgram|assemblyai/);
  });
});
