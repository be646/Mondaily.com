// Auto-detect updates from deploy/commit metadata.
//
// Runs in the Vercel build (see vercel.json buildCommand). Reads the commit that
// triggered the deploy from Vercel's env vars (falls back to local git) and, for
// conventional feat:/fix: commits, appends a "shipped" row to project_log so the
// Status page "Recent Updates" stays current without anyone hand-writing it.
//
// Best-effort by design: every failure path exits 0 so it can NEVER fail a deploy.
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

function commitMessage() {
  if (process.env.VERCEL_GIT_COMMIT_MESSAGE) return process.env.VERCEL_GIT_COMMIT_MESSAGE;
  try { return execSync("git log -1 --pretty=%B").toString(); } catch { return ""; }
}
function commitSha() {
  return (process.env.VERCEL_GIT_COMMIT_SHA || (() => {
    try { return execSync("git rev-parse HEAD").toString(); } catch { return ""; }
  })()).trim().slice(0, 7);
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log("[log-deploy] no supabase env — skipping"); return; }

  const subject = commitMessage().split("\n")[0].trim();
  const sha = commitSha();
  // Only log meaningful, user-facing changes (conventional commits). Skip chore/
  // docs/refactor/test/build noise and merge commits.
  const m = subject.match(/^(feat|fix)(?:\([^)]*\))?:\s*(.+)$/i);
  if (!m) { console.log(`[log-deploy] "${subject}" is not feat/fix — skipping`); return; }
  const verb = m[1].toLowerCase();
  const title = m[2].trim().replace(/\s+/g, " ").slice(0, 120);

  const supabase = createClient(url, key);
  // Dedupe: the same commit lands on both the api and app deploys, and re-deploys
  // happen — key on the sha embedded in detail so we insert each commit once.
  const tag = sha ? `[${sha}]` : "";
  if (sha) {
    const { data: existing } = await supabase
      .from("project_log").select("id").ilike("detail", `%${tag}%`).limit(1);
    if (existing && existing.length) { console.log(`[log-deploy] ${tag} already logged — skipping`); return; }
  }
  const { error } = await supabase.from("project_log").insert({
    kind: "update",
    status: "shipped",
    title: title.charAt(0).toUpperCase() + title.slice(1),
    detail: `${verb === "feat" ? "New" : "Fix"} shipped from commit ${tag}`.trim(),
    category: "auto",
    sort_order: 0,
    completed_at: new Date().toISOString(),
  });
  if (error) console.log(`[log-deploy] insert error (ignored): ${error.message}`);
  else console.log(`[log-deploy] logged "${title}" ${tag}`);
}

main().catch((e) => console.log(`[log-deploy] ignored: ${e?.message ?? e}`)).finally(() => process.exit(0));
