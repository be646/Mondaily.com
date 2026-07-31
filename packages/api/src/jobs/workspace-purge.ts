import { supabase } from "@mondaily/db/client";

/**
 * Workspace hard-erase — runs with the daily cron, ONLY on workspaces whose 14-day grace window
 * has fully elapsed (deleted_at < now − 14d). Paged deletes per table (the export taught us:
 * Supabase caps single operations — never assume one call cleared a table), and a per-table
 * RECEIPT is returned/logged so the erasure is provable, not presumed. Storage objects for the
 * workspace's recordings are removed best-effort. The workspaces row goes LAST — if anything
 * fails mid-way, the workspace stays flagged and the next run finishes the job.
 */
const WORKSPACE_TABLES = [
  "intelligence_signals", "brain_runs", "inference_shadow_runs",
  "internal_messages", "chat_groups", "chat_group_members",
  "call_transcript_lines", "caption_translations",
  "decision_queue", "workspace_goals", "tasks", "activities",
  "ai_usage", "ai_training_logs", "discovered_leads", "lists", "list_entries",
  "nodes", "workspace_members",
] as const;

export async function purgeDeletedWorkspaces(now: Date = new Date()): Promise<{ purged: number; receipts: Record<string, Record<string, number | string>> }> {
  const cutoff = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const { data: doomed, error } = await supabase.from("workspaces")
    .select("id, name, deleted_at").not("deleted_at", "is", null).lt("deleted_at", cutoff).limit(10);
  if (error || !doomed?.length) return { purged: 0, receipts: {} };

  const receipts: Record<string, Record<string, number | string>> = {};
  let purged = 0;
  for (const w of doomed) {
    const ws = String(w.id);
    const receipt: Record<string, number | string> = {};
    let failed = false;
    for (const table of WORKSPACE_TABLES) {
      let total = 0;
      // paged delete: select ids in chunks, delete by id — bounded, restartable
      for (let round = 0; round < 200; round++) {
        const { data: rows, error: selErr } = await supabase.from(table).select("id").eq("workspace_id", ws).limit(500);
        if (selErr) { receipt[table] = `skipped: ${selErr.code ?? "error"}`; break; }   // table absent → skip honestly
        if (!rows?.length) { receipt[table] = total; break; }
        const { error: delErr } = await supabase.from(table).delete().in("id", rows.map(r => r.id));
        if (delErr) { receipt[table] = `failed at ${total}: ${delErr.code ?? "error"}`; failed = true; break; }
        total += rows.length;
        if (rows.length < 500) { receipt[table] = total; break; }
      }
    }
    // storage: recordings bucket prefix (best-effort; absence is fine)
    try {
      const { data: files } = await supabase.storage.from("call-recordings").list(ws, { limit: 1000 });
      if (files?.length) await supabase.storage.from("call-recordings").remove(files.map(f => `${ws}/${f.name}`));
      receipt["storage:call-recordings"] = files?.length ?? 0;
    } catch { receipt["storage:call-recordings"] = "unavailable"; }

    if (!failed) {
      const { error: wsErr } = await supabase.from("workspaces").delete().eq("id", ws);
      if (!wsErr) { purged++; receipt["workspaces"] = 1; }
      else receipt["workspaces"] = `failed: ${wsErr.code ?? "error"}`;
    } else {
      receipt["workspaces"] = "retained — a table failed; next run retries";
    }
    receipts[ws] = receipt;
    console.log(`[workspace-purge] ${ws} (${w.name ?? "unnamed"})`, JSON.stringify(receipt));
  }
  return { purged, receipts };
}
