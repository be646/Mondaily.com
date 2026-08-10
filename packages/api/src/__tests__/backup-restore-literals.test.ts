import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Guards the restore generator against the bug that broke the first real restore drill.
 *
 * On 2026-08-10 the nightly backup was replayed into a live Postgres for the first time. It failed
 * on the fourth table with `malformed array literal: "[]"`: the generator rendered every non-scalar
 * as JSON, so a `text[]` column received `'[]'` — but `[` does not introduce a Postgres array, `{`
 * does. Three columns carry array types (`node_ids uuid[]`, `shared_with text[]`, `labels text[]`).
 *
 * The failure was invisible to every check that read the file rather than replaying it: the row
 * counts matched, the JSON was valid, the load order was right. Only Postgres could say no.
 *
 * These run the real script over a real backup directory, so they test the artifact that ships
 * rather than a re-implementation of it.
 */
const SCRIPT = resolve(__dirname, "../../../../scripts/backup/restore.mjs");

function generate(schema: string, rows: Record<string, unknown>[], table: string): string {
  const dir = mkdtempSync(join(tmpdir(), "restore-test-"));
  try {
    writeFileSync(join(dir, "schema.sql"), schema);
    writeFileSync(join(dir, `${table}.ndjson`), rows.map(r => JSON.stringify(r)).join("\n") + "\n");
    execFileSync("node", [SCRIPT, dir, "--schema", join(dir, "schema.sql"), "--out", join(dir, "out.sql")]);
    return readFileSync(join(dir, "out.sql"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SCHEMA = `create table if not exists lists (
  id uuid not null,
  labels text[],
  shared_with text[],
  data jsonb,
  constraint lists_pkey primary key (id)
);`;

describe("restore.mjs literal rendering", () => {
  it("renders an array column with braces, not JSON brackets", () => {
    const sql = generate(SCHEMA, [{ id: "a", labels: ["x", "y"], shared_with: [], data: null }], "lists");
    // THE regression: '[]' here is what Postgres rejected outright.
    expect(sql).not.toContain("'[]'");
    expect(sql).toContain("'{}'");
    expect(sql).toContain(`'{"x","y"}'`);
  });

  it("still renders a jsonb column as JSON, since the same JS array means something different there", () => {
    const sql = generate(SCHEMA, [{ id: "a", labels: null, shared_with: null, data: { tags: ["x"] } }], "lists");
    expect(sql).toContain(`'{"tags":["x"]}'`);
  });

  it("escapes quotes and backslashes inside array elements", () => {
    const sql = generate(SCHEMA, [{ id: "a", labels: [`say "hi"`, "back\\slash"], shared_with: null, data: null }], "lists");
    expect(sql).toContain(`\\"hi\\"`);
    expect(sql).toContain("back\\\\slash");
  });

  it("keeps a NULL element inside an array bare rather than quoting it into the string 'NULL'", () => {
    const sql = generate(SCHEMA, [{ id: "a", labels: ["x", null], shared_with: null, data: null }], "lists");
    expect(sql).toContain(`'{"x",NULL}'`);
  });

  it("asserts the restored row count inside the transaction, so a short restore rolls back", () => {
    const sql = generate(SCHEMA, [{ id: "a" }, { id: "b" }], "lists");
    expect(sql).toContain("begin;");
    expect(sql).toContain("raise exception 'restore mismatch: lists has % rows, backup had 2'");
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });
});
