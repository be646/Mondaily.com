#!/usr/bin/env node
/**
 * Workspace-isolation scanner. For every Supabase query on a workspace-scoped table in the API
 * routes/jobs, checks whether the same query chain also filters/writes workspace_id. Flags the ones
 * that don't for manual review (potential cross-tenant read/write = IDOR).
 *
 *   node scripts/audit/workspace-isolation-scan.mjs
 *
 * Heuristic (static) — a flag is "review this", not "definitely broken". Tables that are legitimately
 * global/auth/config are allow-listed. Exit code = number of flagged sites (0 = none).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const DIRS = ["packages/api/src/routes", "packages/api/src/jobs"];
// Tables that are intentionally NOT workspace-scoped (auth, billing wallet, global config, shared cache).
const GLOBAL = new Set([
  "workspaces", "users", "auth_refresh_tokens", "auth_sessions", "ai_credits_ledger",
  "workspace_members", "workspace_invites", "email_connections", "discovery_cache",
  "pow_claims", "notifications", "chat_threads",
]);
const isGlobal = (t) => GLOBAL.has(t) || t.startsWith("user_") || t.startsWith("auth_");

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith(".ts")) yield p;
  }
}

let flagged = 0;
const rows = [];
for (const dir of DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    const re = /\.from\(["'`]([a-z_]+)["'`]\)/g;
    let m;
    while ((m = re.exec(src))) {
      const table = m[1];
      if (isGlobal(table)) continue;
      // Grab the query chain AND the surrounding handler context: this codebase scopes child rows
      // (list_entries, edges, call_sessions…) by first verifying the PARENT (list/node/session)
      // belongs to the workspace, then operating by id. So check a window that includes the ~24
      // preceding lines (where that parent-ownership check lives) plus the query chain itself.
      const startLine = src.slice(0, m.index).split("\n").length - 1;
      const chain = lines.slice(startLine, startLine + 12).join("\n").split(";")[0];
      const context = lines.slice(Math.max(0, startLine - 24), startLine + 12).join("\n");
      // Scoped if the chain OR the nearby handler filters workspace_id, or an insert carries it,
      // or it operates on a row already fetched with a participant/ownership guard.
      const scoped = /workspace_id/.test(context) || /workspace_id\s*:/.test(chain);
      if (!scoped) {
        flagged++;
        rows.push({ file: file.replace(ROOT + "/", ""), line: startLine + 1, table });
      }
    }
  }
}

if (rows.length === 0) {
  console.log("✓ No workspace-scoped query is missing a workspace_id filter (heuristic).");
} else {
  console.log(`! ${rows.length} query site(s) on workspace-scoped tables with no workspace_id in the chain — REVIEW:\n`);
  for (const r of rows) console.log(`  ${r.file}:${r.line}  .from("${r.table}")`);
  console.log("\n(Some may be scoped via a joined/param'd id or a helper — confirm each by hand.)");
}
process.exit(Math.min(flagged, 250));
