#!/usr/bin/env node
/**
 * SOVEREIGN BACKUP — a full logical export of every tenant table, to disk you control.
 *
 * Written because there was no backup tooling at all, and on 2026-08-07 a real customer signed up.
 * Until that day the only data at risk was our own; the cost of being wrong changed that morning.
 *
 * Deliberately NOT pg_dump: this runs against PostgREST with the service key, so it needs no
 * database password, no network path to port 5432, and no client binaries — it works from a laptop,
 * a CI runner, or a cron box with nothing installed but Node. The trade is that it captures ROWS,
 * not schema.
 *
 * This file used to claim the schema was safe in packages/db/migrations. It was not: ten core
 * tables, `nodes` among them, were made by hand in the Supabase editor and appear in no migration.
 * Rows without a schema are not a restore. Run scripts/backup/schema-snapshot.mjs alongside this —
 * run.sh does — and the pair is restorable by scripts/backup/restore.mjs.
 *
 * Every table is paged, because a `select *` that silently returns only the first 1,000 rows is the
 * worst possible backup: it succeeds, it looks right, and it is missing most of your data. Each
 * file records the row count the server reported so a short read is caught here rather than during
 * a restore.
 *
 *   node scripts/backup/export.mjs                  → ./backups/<timestamp>/
 *   node scripts/backup/export.mjs --out /vol/bak   → somewhere durable
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment. It never prints them.
 */

import { mkdirSync, writeFileSync, createWriteStream } from "node:fs";
import { join } from "node:path";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.");
  process.exit(1);
}

/**
 * Which tables to capture — DISCOVERED from the database, never hand-listed.
 *
 * The first version carried a literal array of 31 table names. On 2026-08-10 that list was measured
 * against the live database: it was missing 15,018 rows across 30 tables — about 45% of everything.
 * Among them `object_definitions` (the definitions of every custom object, without which the Graph
 * has no shape), `edges` (the relationships between records), `list_entries`, every `task_*` table,
 * `document_counters` (invoice numbering), `api_keys` and `teams`.
 *
 * Nobody removed those. They were added after the list was written, and a hand-maintained list
 * silently omits everything that comes later — it fails in the direction of quietly protecting less
 * while still reporting success. So the default is now "back up everything", and anything skipped
 * must be named here with a reason. A new table is captured the day it is created.
 */
const EXCLUDE = new Map([
  ["rate_limits", "ephemeral counters, rebuilt within the minute"],
  ["discovery_cache", "cache of external search results, re-fetchable"],
  ["node_embeddings", "derived from nodes.data — regenerate by reindexing, and vectors are bulky"],
]);

async function discoverTables() {
  const res = await fetch(`${URL_}/rest/v1/`, {
    headers: { ...headers, Accept: "application/openapi+json" },
  });
  if (!res.ok) throw new Error(`Could not list tables: HTTP ${res.status}`);
  const spec = await res.json();
  const defs = spec.definitions ?? spec.components?.schemas ?? {};
  return Object.keys(defs).filter(t => defs[t].properties && !EXCLUDE.has(t)).sort();
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const PAGE = 1000;
const outRoot = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 ? process.argv[i + 1] : "backups";
})();
// Colons are illegal in filenames on Windows and awkward everywhere else.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = join(outRoot, stamp);
mkdirSync(dir, { recursive: true });

/**
 * A DETERMINISTIC sort for paging. Getting this wrong is the quiet way a backup lies.
 *
 * `LIMIT/OFFSET` over a non-unique `ORDER BY` is not stable in Postgres: rows that tie may come
 * back in any order per request, so page 2 can repeat rows from page 1 and skip others — leaving a
 * backup with the right row COUNT and the wrong rows.
 *
 * The first version preferred id / user_id / workspace_id / created_at and took the first column
 * otherwise. That looked careful and was not: `period_snapshots` has no `id` (its key is
 * `snapshot_id`) so it sorted by `workspace_id` — 13 distinct values across 1,968 rows — and
 * `fx_rates` sorted by `currency`, 30 across 2,031. Both are paged. Both were unstable.
 *
 * So: use a single column ONLY when it is genuinely a unique key. Otherwise sort by the whole row
 * of scalar columns, which is deterministic by construction — two rows can only tie if they are
 * identical in every scalar field, and then their order does not matter.
 */
function orderExpression(sample) {
  const keys = Object.keys(sample);
  // A column named `id`, or `<thing>_id` that is the table's own key, is unique by convention here.
  for (const k of ["id", "snapshot_id", "user_id", "key"]) {
    if (keys.includes(k)) return k;
  }
  // Full-tuple sort. json/jsonb columns are excluded — Postgres cannot order `json`, and the
  // scalars are already enough to make the tuple unique.
  const scalars = keys.filter(k => {
    const v = sample[k];
    return v === null || ["string", "number", "boolean"].includes(typeof v);
  });
  return scalars.length ? scalars.join(",") : keys[0];
}

async function orderColumn(table) {
  const res = await fetch(`${URL_}/rest/v1/${table}?select=*&limit=1`, { headers });
  if (!res.ok) return null;
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return "__EMPTY__";
  return orderExpression(rows[0]);
}

async function countOf(table) {
  const res = await fetch(`${URL_}/rest/v1/${table}?select=*&limit=1`, {
    headers: { ...headers, Prefer: "count=exact", Range: "0-0" },
  });
  if (!res.ok) return null;                       // absent or not readable
  const cr = res.headers.get("content-range") ?? "";
  const n = Number(cr.split("/").pop());
  return Number.isFinite(n) ? n : null;
}

async function dump(table, expected, orderBy) {
  const file = join(dir, `${table}.ndjson`);
  const out = createWriteStream(file);
  let written = 0;
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${URL_}/rest/v1/${table}?select=*&order=${orderBy}`, {
      headers: { ...headers, Range: `${from}-${from + PAGE - 1}` },
    });
    if (!res.ok) throw new Error(`${table} page ${from}: HTTP ${res.status}`);
    const rows = await res.json();
    // NDJSON, one row per line: a 3,000-row table stays streamable and diffable, and a truncated
    // file loses only its last line instead of failing to parse entirely like a single JSON array.
    for (const r of rows) out.write(JSON.stringify(r) + "\n");
    written += rows.length;
    if (rows.length < PAGE) break;
  }
  await new Promise(r => out.end(r));
  return { table, written, expected, complete: expected === null || written === expected };
}

const manifest = { started_at: new Date().toISOString(), source: new URL(URL_).host, tables: [] };
let short = 0;

const TABLES = await discoverTables();
console.log(`${TABLES.length} tables discovered (${EXCLUDE.size} excluded by policy)\n`);

for (const table of TABLES) {
  const expected = await countOf(table);
  if (expected === null) {
    manifest.tables.push({ table, skipped: "absent on this deployment" });
    console.log(`  ${table.padEnd(24)} — absent, skipped`);
    continue;
  }
  const orderBy = await orderColumn(table);
  if (orderBy === "__EMPTY__" || expected === 0) {
    writeFileSync(join(dir, `${table}.ndjson`), "");
    manifest.tables.push({ table, written: 0, expected: 0, complete: true });
    console.log(`  ${table.padEnd(24)}      0 rows`);
    continue;
  }
  if (!orderBy) {
    manifest.tables.push({ table, skipped: "no orderable column" });
    console.log(`  ${table.padEnd(24)} — no orderable column, skipped`);
    continue;
  }
  const r = await dump(table, expected, orderBy);
  manifest.tables.push(r);
  if (!r.complete) short++;
  console.log(`  ${table.padEnd(24)} ${String(r.written).padStart(6)} rows${r.complete ? "" : `  ⚠ EXPECTED ${r.expected}`}`);
}

manifest.finished_at = new Date().toISOString();
manifest.total_rows = manifest.tables.reduce((a, t) => a + (t.written ?? 0), 0);
manifest.short_reads = short;
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

console.log(`\n${manifest.total_rows} rows → ${dir}`);
if (short) {
  // A short read means the backup is INCOMPLETE. Exit non-zero so a cron job fails loudly rather
  // than leaving a plausible-looking directory that cannot actually restore the system.
  console.error(`\n${short} table(s) came up short. This backup is NOT complete.`);
  process.exit(1);
}
console.log("Every table matched its server-reported count.");
