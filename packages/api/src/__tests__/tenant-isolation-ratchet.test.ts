import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROUTES = join(__dirname, "../routes");

const TENANT_TABLES = [
  "nodes", "activities", "workspace_members", "chat_threads", "tasks", "lists",
  "invoices", "quotes", "credit_notes", "expenses", "notifications", "workflows",
  "internal_messages", "calendar_events", "ai_credits_ledger", "period_snapshots",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Statements touching a tenant table with no workspace_id anywhere in the chained call. */
function unscopedStatements(): { file: string; table: string }[] {
  const re = new RegExp(`\\.from\\("(${TENANT_TABLES.join("|")})"\\)((?:[^;]|\\n){0,400}?);`, "g");
  const found: { file: string; table: string }[] = [];
  for (const f of walk(ROUTES)) {
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(re)) {
      if (m[2]!.includes("workspace_id")) continue;
      found.push({ file: f.slice(ROUTES.length + 1), table: m[1]! });
    }
  }
  return found;
}

/**
 * Cross-tenant isolation, held by a ratchet.
 *
 * Audited every one of these on 2026-08-04 and all were safe — ids sourced from workspace-scoped
 * selects, a prior assertTaskOwnership, inserts carrying workspace_id, or public tracking endpoints
 * keyed by an unguessable id. That audit is a snapshot; this is the thing that keeps it true.
 *
 * An unscoped statement is not automatically a bug, which is why this counts rather than forbids.
 * But every NEW one is a place where a caller-supplied id could reach another tenant's row, so it
 * has to be looked at deliberately rather than merged unnoticed.
 */
describe("tenant isolation does not regress", () => {
  it("the detector still sees the codebase it is meant to police", () => {
    // WITHOUT this, the ratchet below is vacuous in the one way that matters. It asserts a CEILING
    // on violations, so a detector that finds nothing passes — and it would find nothing if the
    // routes moved, or if data access moved behind a helper and `.from("nodes")` stopped appearing.
    // The guard would stay green forever while policing an empty set.
    //
    // The floor is on the POPULATION SCANNED, not on violations found, so genuinely fixing every
    // unscoped statement can never trip it. Measured 2026-08-11: 63 route files, 454 tenant-table
    // statements; the floors sit far below that so ordinary refactors do not cause noise.
    const files = walk(ROUTES);
    expect(files.length, "no route files scanned — the walk is broken, not the code").toBeGreaterThan(30);
    const statements = files
      .map(f => (readFileSync(f, "utf8").match(new RegExp(`\\.from\\("(${TENANT_TABLES.join("|")})"\\)`, "g")) ?? []).length)
      .reduce((a, b) => a + b, 0);
    expect(statements, "no tenant-table access found at all — the pattern no longer matches how this codebase reads data, so the ratchet is policing nothing").toBeGreaterThan(200);
  });

  it("no NEW unscoped tenant-table statements", () => {
    const found = unscopedStatements();
    const detail = found.map(f => `${f.file} → ${f.table}`).join("\n");
    expect(found.length,
      `Unscoped tenant-table access grew. Each new one must either filter on workspace_id, ` +
      `assert ownership first, or source its ids from a workspace-scoped query:\n${detail}`,
    ).toBeLessThanOrEqual(22);
  });

  it("the ownership-assertion helper still exists and is used", () => {
    // The pattern that makes update-by-id safe in task-reviews.
    const reviews = readFileSync(join(ROUTES, "task-reviews.ts"), "utf8");
    expect(reviews).toMatch(/assertTaskOwnership\(/);
    expect(reviews).toMatch(/catch \{ return c\.json\(\{ error: "Not found" \}, 404\); \}/);
  });
});
