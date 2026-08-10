#!/usr/bin/env node
/**
 * SCHEMA SNAPSHOT — reconstruct table definitions from the live database.
 *
 * Written on 2026-08-10 after discovering that ten core tables — including `nodes`, which IS the
 * Graph, plus `workspaces`, `workspace_members`, `activities`, `tasks`, `lists`, `chat_threads`,
 * `notifications`, `decision_queue` and `email_connections` — had NO `create table` anywhere in
 * packages/db/migrations. They were created by hand in the Supabase editor and never written down.
 *
 * That made the row backup a false comfort: it captured 18,543 rows whose shape existed nowhere but
 * inside the account we were backing up AGAINST. Losing the project would have left data with no
 * table to restore it into.
 *
 * PostgREST publishes an OpenAPI document describing every exposed table: columns, Postgres types,
 * nullability, primary keys and foreign keys. That is enough to rebuild a table you can restore
 * into, and it needs no database password — the same constraint that shaped export.mjs.
 *
 * WHAT THIS CAPTURES: tables, columns, types, NOT NULL, primary keys, foreign keys.
 * WHAT IT DOES NOT: indexes, CHECK constraints, defaults expressed as functions, triggers, RLS
 * policies, sequences, extensions, views. Those live in the migrations that DO exist, and for the
 * hand-made tables they are simply not recorded anywhere. This closes the fatal gap (no schema at
 * all); it is not a substitute for a real `pg_dump --schema-only` once you have the DB password.
 *
 *   node scripts/backup/schema-snapshot.mjs            → print to stdout
 *   node scripts/backup/schema-snapshot.mjs --out FILE → write it
 */

import { writeFileSync } from "node:fs";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.");
  process.exit(1);
}

const res = await fetch(`${URL_}/rest/v1/`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: "application/openapi+json" },
});
if (!res.ok) {
  console.error(`Could not read the API description: HTTP ${res.status}`);
  process.exit(1);
}
const spec = await res.json();
const defs = spec.definitions ?? spec.components?.schemas ?? {};

/**
 * PostgREST reports the real Postgres type in `format`, which is what we want — reusing it verbatim
 * keeps `jsonb` as `jsonb` and `timestamp with time zone` as itself, rather than flattening
 * everything to text through a lossy mapping of our own invention.
 *
 * The exception is `extensions.vector(1536)`: schema-qualified against an extension that must be
 * installed first, so it is emitted with the guard that makes it restorable.
 */
function sqlType(format) {
  const f = String(format ?? "text");
  if (f.startsWith("extensions.vector")) return f.replace("extensions.", "");
  return f;
}

const PK = /This is a Primary Key/i;
const FK = /Foreign Key to `([a-z_]+)\.([a-z_]+)`/i;

function tableSql(name, def) {
  const props = def.properties ?? {};
  const required = new Set(def.required ?? []);
  const cols = [];
  const pks = [];
  const fks = [];

  for (const [col, p] of Object.entries(props)) {
    const note = String(p.description ?? "");
    if (PK.test(note)) pks.push(col);
    const fk = FK.exec(note);
    if (fk) fks.push(`  constraint ${name}_${col}_fkey foreign key (${col}) references ${fk[1]}(${fk[2]})`);

    // A primary key is NOT NULL whether or not the spec marks it required.
    const notNull = required.has(col) || PK.test(note) ? " not null" : "";
    cols.push(`  ${col} ${sqlType(p.format)}${notNull}`);
  }

  const parts = [...cols];
  if (pks.length) parts.push(`  constraint ${name}_pkey primary key (${pks.join(", ")})`);
  parts.push(...fks);

  return `create table if not exists ${name} (\n${parts.join(",\n")}\n);`;
}

// Dependency order: a table is emitted only once everything it points at exists, so the file can be
// replayed top to bottom into an empty database without foreign keys failing. Self-references are
// ignored for ordering (a table cannot wait on itself), and a cycle falls back to declaration order
// rather than hanging — the constraint would need to be added after the fact in that case.
function ordered(names) {
  const deps = new Map();
  for (const n of names) {
    const targets = new Set();
    for (const p of Object.values(defs[n].properties ?? {})) {
      const fk = FK.exec(String(p.description ?? ""));
      if (fk && fk[1] !== n && names.includes(fk[1])) targets.add(fk[1]);
    }
    deps.set(n, targets);
  }
  const out = [];
  const seen = new Set();
  let progress = true;
  while (out.length < names.length && progress) {
    progress = false;
    for (const n of names) {
      if (seen.has(n)) continue;
      if ([...deps.get(n)].every(d => seen.has(d))) {
        out.push(n); seen.add(n); progress = true;
      }
    }
  }
  for (const n of names) if (!seen.has(n)) out.push(n);   // cycle — emit anyway, order unverified
  return out;
}

const names = Object.keys(defs).filter(n => defs[n].properties).sort();
const body = ordered(names).map(n => tableSql(n, defs[n])).join("\n\n");

const header = `-- SCHEMA SNAPSHOT — generated by scripts/backup/schema-snapshot.mjs
-- Source: ${new URL(URL_).host}   Captured: ${new Date().toISOString()}
--
-- Reconstructed from the live database because ten core tables (nodes, workspaces,
-- workspace_members, activities, tasks, lists, chat_threads, notifications, decision_queue,
-- email_connections) were created by hand and never written into a migration.
--
-- Tables are ordered so foreign keys resolve on a top-to-bottom replay into an empty database.
--
-- CAPTURED: columns, types, NOT NULL, primary keys, foreign keys.
-- NOT CAPTURED: indexes, CHECK constraints, defaults, triggers, RLS policies, views.
-- Do NOT run this against production. It is a restore target, not a migration.

create extension if not exists vector;

`;

const out = header + body + "\n";
const i = process.argv.indexOf("--out");
if (i >= 0) {
  writeFileSync(process.argv[i + 1], out);
  console.error(`${names.length} tables → ${process.argv[i + 1]}`);
} else {
  process.stdout.write(out);
}
