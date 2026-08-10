#!/usr/bin/env node
/**
 * RESTORE — turn a backup directory back into a loadable database.
 *
 * The export existed for three days before this did, which meant the backups were a hypothesis:
 * nobody had ever put one back. This closes that loop. It emits SQL rather than talking to a
 * database directly, for two reasons that matter under pressure:
 *
 *   1. No driver, no credentials, no network path. It runs anywhere Node runs, and the SQL it
 *      produces can be inspected, diffed, edited, and replayed by hand into ANY Postgres — a local
 *      container, a new Supabase project, a rented box. A restore should not depend on the same
 *      tooling that just failed you.
 *   2. It is reviewable BEFORE it writes. During a real incident you want to read the thing that is
 *      about to touch your data.
 *
 * Tables load in the dependency order recorded in the schema snapshot, so foreign keys resolve as
 * the file replays. Rows are inserted with explicit column lists, so a backup taken before a column
 * was added still restores into a newer schema.
 *
 *   node scripts/backup/restore.mjs <backup-dir> --schema packages/db/schema/baseline.sql --out restore.sql
 *   psql "$TARGET" -v ON_ERROR_STOP=1 -f restore.sql
 *
 * It never writes to a database itself, and it will not run against production by accident, because
 * it cannot run against anything at all.
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith("--"));
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!dir) {
  console.error("usage: restore.mjs <backup-dir> [--schema baseline.sql] [--out restore.sql]");
  process.exit(1);
}
const schemaPath = opt("schema", "packages/db/schema/baseline.sql");
const outPath = opt("out", null);

/**
 * The load order comes from the schema snapshot, which already ordered its `create table`
 * statements so foreign keys resolve. Reusing that order means the two files cannot disagree —
 * there is one definition of "what depends on what", not two that drift apart.
 */
function loadOrder() {
  const sql = readFileSync(schemaPath, "utf8");
  return [...sql.matchAll(/^create table if not exists ([a-z_]+) \(/gm)].map(m => m[1]);
}

/**
 * Column types, read from the same schema file. The restore needs these because JSON and Postgres
 * disagree about one thing in particular: an ARRAY.
 *
 * The first version was type-blind and rendered every non-scalar as JSON, so a `text[]` column got
 * `'[]'` and Postgres answered `malformed array literal: "[]"` — `[` does not introduce an array,
 * `{` does. Three columns are affected (`node_ids uuid[]`, `shared_with text[]`, `labels text[]`)
 * and the restore aborted on the fourth table. Found by actually replaying into Postgres; no amount
 * of reading the file would have shown it.
 */
function loadTypes() {
  const sql = readFileSync(schemaPath, "utf8");
  const types = new Map();
  for (const m of sql.matchAll(/^create table if not exists ([a-z_]+) \(([\s\S]*?)\n\);/gm)) {
    const cols = new Map();
    for (const line of m[2].split("\n")) {
      const t = line.trim().replace(/,$/, "");
      if (!t || t.startsWith("constraint")) continue;
      const [col, ...rest] = t.split(/\s+/);
      cols.set(col, rest.join(" ").replace(/ not null$/, ""));
    }
    types.set(m[1], cols);
  }
  return types;
}

/**
 * A Postgres array literal: braces, elements double-quoted, with `"` and `\` backslash-escaped.
 * NULL inside an array is the bare word, which is why it cannot simply go through `literal()`.
 */
function arrayLiteral(values) {
  const items = values.map(v => {
    if (v === null || v === undefined) return "NULL";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  });
  return `'{${items.join(",")}}'`;
}

/**
 * Postgres literals. `jsonb` is the one that bites: a JS object must become a quoted JSON *string*
 * and be cast, and a JSON string containing a quote must survive that round trip. Everything goes
 * through the same quote-doubling so there is a single escaping path rather than one per type.
 */
function literal(v, type = "") {
  if (v === null || v === undefined) return "NULL";
  // An array column takes brace syntax; a jsonb column holding an array takes JSON. Same JS value,
  // different literal, and only the declared type distinguishes them.
  if (type.endsWith("[]")) return arrayLiteral(Array.isArray(v) ? v : [v]);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  const text = typeof v === "object" ? JSON.stringify(v) : String(v);
  return `'${text.replace(/'/g, "''")}'`;
}

const order = loadOrder();
const TYPES = loadTypes();
const present = new Set(
  readdirSync(dir).filter(f => f.endsWith(".ndjson")).map(f => f.replace(/\.ndjson$/, "")),
);
// Anything in the backup that the schema does not order goes last: better to attempt it and get a
// loud foreign-key error than to silently drop a table from the restore.
const tables = [...order.filter(t => present.has(t)), ...[...present].filter(t => !order.includes(t))];

const chunks = [
  `-- RESTORE — generated ${new Date().toISOString()} from ${dir}`,
  `-- Replay with: psql "$TARGET" -v ON_ERROR_STOP=1 -f <this file>`,
  `-- Wrapped in a transaction: it either restores completely or changes nothing.`,
  ``,
  `begin;`,
  `set constraints all deferred;`,
  ``,
];

let total = 0;
const summary = [];

for (const table of tables) {
  const raw = readFileSync(join(dir, `${table}.ndjson`), "utf8");
  const rows = raw.split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
  if (rows.length === 0) { summary.push({ table, rows: 0 }); continue; }

  // The union of keys across ALL rows, not just the first: PostgREST omits nothing, but a backup
  // taken across a schema change can legitimately have a column that only later rows carry.
  const cols = [...new Set(rows.flatMap(Object.keys))];

  const colTypes = TYPES.get(table) ?? new Map();
  chunks.push(`-- ${table}: ${rows.length} rows`);
  // Batched so a large table is a handful of statements rather than thousands, while staying well
  // under any statement-size limit.
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const values = batch.map(r => `(${cols.map(c => literal(r[c], colTypes.get(c) ?? "")).join(", ")})`).join(",\n  ");
    chunks.push(`insert into ${table} (${cols.join(", ")}) values\n  ${values};`);
  }
  chunks.push(``);
  total += rows.length;
  summary.push({ table, rows: rows.length });
}

// A restore that loaded the wrong number of rows must fail, not warn. This runs inside the same
// transaction as the inserts, so a mismatch rolls the whole thing back and leaves nothing behind.
chunks.push(`-- Verify: every table must hold exactly what the backup claimed, or nothing commits.`);
chunks.push(`do $$`, `declare n bigint;`, `begin`);
for (const { table, rows } of summary) {
  chunks.push(
    `  select count(*) into n from ${table};`,
    `  if n <> ${rows} then raise exception 'restore mismatch: ${table} has % rows, backup had ${rows}', n; end if;`,
  );
}
chunks.push(`  raise notice 'restore verified: ${summary.length} tables, ${total} rows';`, `end $$;`, ``, `commit;`);

const sql = chunks.join("\n") + "\n";
if (outPath) {
  writeFileSync(outPath, sql);
  console.error(`${total} rows across ${summary.filter(s => s.rows).length} tables → ${outPath}`);
} else {
  process.stdout.write(sql);
}
