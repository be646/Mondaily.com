import { supabase } from "@mondaily/db/client";
import { embedBatch, isEmbeddingsEnabled } from "./embeddings";

/**
 * Keeps the pgvector index fresh automatically. `reconcileWorkspaceEmbeddings` embeds only the
 * nodes that are NEW or EDITED since their last embedding (so it's cheap to run often), and the
 * cron calls `reconcileAllEmbeddings` across every already-indexed workspace. No-op when
 * SOVEREIGN_EMBED_URL is unset. Deleted nodes drop out automatically via the ON DELETE CASCADE fk.
 */

// The text we embed for a record — the meaning-bearing fields, one line. Shared with search.ts.
export function nodeEmbedText(objectType: string, data: Record<string, unknown>): string {
  const d = data ?? {};
  const pick = (...keys: string[]) => keys.map((k) => d[k]).find((v) => v != null && v !== "");
  const name = pick("name", "title", "full_name", "company", "client_name", "number") ?? "Record";
  const bits = [
    pick("email"), pick("company", "organization"), pick("location", "region", "city"),
    pick("status", "stage"), pick("role", "job_title"), pick("description", "notes", "summary"),
  ].filter(Boolean).map((v) => String(v).slice(0, 120));
  return `${objectType}: ${String(name).slice(0, 120)}${bits.length ? " — " + bits.join(" · ") : ""}`;
}

const BATCH = 32;

/** Embed the new/stale nodes of one workspace. Returns how many were (re)embedded. */
export async function reconcileWorkspaceEmbeddings(workspaceId: string, cap = 1000): Promise<number> {
  if (!isEmbeddingsEnabled()) return 0;
  const [{ data: nodes }, { data: existing }] = await Promise.all([
    supabase.from("nodes").select("id, object_type, data, updated_at").eq("workspace_id", workspaceId).limit(20_000),
    supabase.from("node_embeddings").select("node_id, updated_at").eq("workspace_id", workspaceId).limit(20_000),
  ]);
  const embeddedAt = new Map((existing ?? []).map((e) => [e.node_id as string, new Date(e.updated_at as string).getTime()]));
  // Needs embedding = no row yet, OR the node was edited after it was last embedded.
  const stale = (nodes ?? []).filter((n) => {
    const at = embeddedAt.get(n.id as string);
    return at === undefined || new Date((n as { updated_at: string }).updated_at).getTime() > at;
  }).slice(0, cap);
  if (!stale.length) return 0;

  let done = 0;
  for (let i = 0; i < stale.length; i += BATCH) {
    const slice = stale.slice(i, i + BATCH);
    const texts = slice.map((n) => nodeEmbedText(n.object_type as string, n.data as Record<string, unknown>));
    const vectors = await embedBatch(texts);
    if (!vectors) continue; // appliance hiccup — try again next run
    const rows = slice.map((n, j) => ({ node_id: n.id, workspace_id: workspaceId, content: texts[j], embedding: vectors[j] as unknown as string, updated_at: new Date().toISOString() }));
    const { error } = await supabase.from("node_embeddings").upsert(rows, { onConflict: "node_id" });
    if (!error) done += slice.length;
  }
  return done;
}

/** Reconcile every workspace that has ever been indexed. Called by the cron. */
export async function reconcileAllEmbeddings(): Promise<{ workspaces: number; embedded: number }> {
  if (!isEmbeddingsEnabled()) return { workspaces: 0, embedded: 0 };
  const { data } = await supabase.from("node_embeddings").select("workspace_id").limit(50_000);
  const ids = [...new Set((data ?? []).map((r) => r.workspace_id as string))];
  let embedded = 0;
  for (const ws of ids) embedded += await reconcileWorkspaceEmbeddings(ws);
  return { workspaces: ids.length, embedded };
}
