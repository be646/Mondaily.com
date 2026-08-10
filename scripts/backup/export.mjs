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
 * not schema; the schema lives in packages/db/migrations, which is already in git. Together those
 * two are a complete restore.
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
 * Tables carrying tenant or account data. A table absent from the deployment is skipped with a
 * note rather than failing the run — deployments legitimately differ, and a backup that aborts
 * because one optional feature was never migrated protects nothing.
 */
const TABLES = [
  "workspaces", "workspace_members", "auth_credentials", "auth_refresh_tokens",
  "nodes", "lists", "tasks", "activities", "chat_threads", "internal_messages",
  "notifications", "decision_queue", "ai_credits_ledger", "period_snapshots",
  "fx_rates", "email_connections", "client_errors",
  // Optional/feature-gated — absent on some deployments, captured when present.
  "invoices", "quotes", "credit_notes", "expenses", "workflows", "calendar_events",
  "chat_groups", "chat_group_members", "call_transcript_lines", "caption_translations",
  "ai_training_logs", "discovered_leads", "workspace_goals", "rate_limits",
];

const PAGE = 1000;
const outRoot = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 ? process.argv[i + 1] : "backups";
})();
// Colons are illegal in filenames on Windows and awkward everywhere else.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = join(outRoot, stamp);
mkdirSync(dir, { recursive: true });

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

/**
 * A column to page by. Paging WITHOUT a stable sort is the subtle way this goes wrong: Postgres is
 * free to return rows in any order between requests, so page 2 can repeat rows from page 1 and skip
 * others entirely — producing a backup with the right row COUNT and the wrong rows.
 *
 * Prefer a real key; otherwise take whichever column the table actually has first.
 */
async function orderColumn(table) {
  const res = await fetch(`${URL_}/rest/v1/${table}?select=*&limit=1`, { headers });
  if (!res.ok) return null;
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return "__EMPTY__";
  const keys = Object.keys(rows[0]);
  for (const preferred of ["id", "user_id", "workspace_id", "created_at"]) {
    if (keys.includes(preferred)) return preferred;
  }
  return keys[0] ?? null;
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
    const res = await fetch(`${URL_}/rest/v1/${table}?select=*&order=${encodeURIComponent(orderBy)}`, {
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
