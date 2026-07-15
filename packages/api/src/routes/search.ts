import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import { aiGatewayToolUse } from "../lib/ai-gateway";
import { isEmbeddingsEnabled, embedOne, embedBatch } from "../lib/embeddings";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();

// A compact one-line summary of a record for the semantic ranker — pulls the fields that carry
// meaning (name, who/where, and any free text) without dumping the whole JSON blob.
function summarizeNode(objectType: string, data: Record<string, unknown>): string {
  const d = data ?? {};
  const pick = (...keys: string[]) => keys.map(k => d[k]).find(v => v != null && v !== "");
  const name = pick("name", "title", "full_name", "company", "client_name", "number") ?? "Record";
  const bits = [
    pick("email"), pick("company", "organization"), pick("location", "region", "city"),
    pick("status", "stage"), pick("role", "job_title"), pick("description", "notes", "summary"),
  ].filter(Boolean).map(v => String(v).slice(0, 120));
  return `${objectType}: ${String(name).slice(0, 120)}${bits.length ? " — " + bits.join(" · ") : ""}`;
}

router.post("/", requireAuth, zValidator("json", z.object({
  query: z.string().min(1),
  verticals: z.array(z.string()).optional(),
  object_types: z.array(z.string()).optional(),
  limit: z.number().max(50).default(20)
})), async (c) => {
  const body = c.req.valid("json");
  const workspaceId = c.get("workspaceId");
  const q = body.query;

  // Sanitized copy for the PostgREST .or() filter, whose grammar uses commas/parens as separators.
  const orQ = q.replace(/[(),]/g, " ").trim();

  const [nameResults, emailResults, financeResults, taskResults] = await Promise.all([
    supabase.from("nodes")
      .select("id, object_type, vertical, data, updated_at")
      .eq("workspace_id", workspaceId)
      .ilike("data->>name", `%${q}%`)
      .limit(body.limit),
    supabase.from("nodes")
      .select("id, object_type, vertical, data, updated_at")
      .eq("workspace_id", workspaceId)
      .ilike("data->>email", `%${q}%`)
      .limit(10),
    // Finance nodes store client_name / invoice number, not "name", so they were invisible to
    // search. Index them by client + number so "Acme invoices" and "INV-0007" both resolve.
    supabase.from("nodes")
      .select("id, object_type, vertical, data, updated_at")
      .eq("workspace_id", workspaceId)
      .eq("vertical", "finance")
      .or(`data->>client_name.ilike.%${orQ}%,data->>number.ilike.%${orQ}%`)
      .limit(10),
    supabase.from("tasks")
      .select("id, title, priority, status, due_date, updated_at")
      .eq("workspace_id", workspaceId)
      .ilike("title", `%${q}%`)
      .limit(10)
  ]);

  // Merge node results, deduplicate by id
  const seen = new Set<string>();
  const nodeItems = [...(nameResults.data ?? []), ...(emailResults.data ?? [])]
    .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
    .map(r => ({ id: r.id, object_type: r.object_type, data: r.data, updated_at: r.updated_at }));

  // Finance items carry a display name (number · client) so the palette shows something legible.
  const financeItems = (financeResults.data ?? [])
    .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
    .map((r: any) => {
      const d = r.data ?? {};
      const name = [d.number, d.client_name].filter(Boolean).join(" · ") || d.description || "Finance item";
      return { id: r.id, object_type: r.object_type, data: { ...d, name }, updated_at: r.updated_at };
    });

  const taskItems = (taskResults.data ?? []).map((t: any) => ({
    id: t.id,
    object_type: "task",
    data: { name: t.title, status: t.status, priority: t.priority, due_date: t.due_date },
    updated_at: t.updated_at
  }));

  return c.json([...nodeItems, ...financeItems, ...taskItems]);
});

// ── Semantic search — find records by MEANING, not just keyword overlap. No embedding appliance
//    yet, so this is LLM reranking (sovereign, via the AI gateway): gather a broad candidate set
//    (keyword matches ∪ most-recent records), then let the model rank the ones that truly match the
//    intent, with a one-line reason. Fail-soft to keyword results if the AI is unavailable. ──
router.post("/semantic", requireAuth, zValidator("json", z.object({
  query: z.string().min(1).max(300),
  limit: z.number().max(30).default(12),
})), async (c) => {
  const workspaceId = c.get("workspaceId");
  const q = c.req.valid("json").query;
  const limit = c.req.valid("json").limit;

  // True vector search — when the embedding appliance is configured. Embed the query, find the
  // nearest record vectors (pgvector cosine), return them. Falls through to LLM-rerank on any
  // failure (appliance down, index empty, RPC error) so search never hard-fails.
  if (isEmbeddingsEnabled()) {
    try {
      const qv = await embedOne(q);
      if (qv) {
        const { data: matches } = await supabase.rpc("match_node_embeddings", { ws: workspaceId, query_embedding: qv as unknown as string, k: limit });
        if (matches && matches.length) {
          const ids = matches.map((m: { node_id: string }) => m.node_id);
          const { data: nodes } = await supabase.from("nodes").select("id, object_type, data, updated_at").eq("workspace_id", workspaceId).in("id", ids);
          const byId = new Map((nodes ?? []).map((n) => [n.id, n]));
          const results = matches
            .map((m: { node_id: string; similarity: number }) => { const n = byId.get(m.node_id); return n ? { id: n.id, object_type: n.object_type, data: n.data, updated_at: n.updated_at, reason: `${Math.round(m.similarity * 100)}% semantic match` } : null; })
            .filter(Boolean);
          if (results.length) return c.json({ results, mode: "vector" });
        }
      }
    } catch (e) {
      console.error("[search] vector path failed, falling back to rerank:", e instanceof Error ? e.message : String(e));
    }
  }

  // Broaden lexical recall: match each meaningful word AND its stem (so "skincare" also catches
  // "skin", "cosmetics" catches "cosmetic") across the fields that carry meaning.
  const words = q.replace(/[(),]/g, " ").split(/\s+/).map(w => w.toLowerCase()).filter(w => w.length > 2).slice(0, 8);
  const stems = [...new Set(words.flatMap(w => [w, w.replace(/(s|es|ed|ing|care)$/, "")]).filter(w => w.length > 2))];
  const orFilter = stems.length
    ? stems.flatMap(w => [`data->>name.ilike.%${w}%`, `data->>description.ilike.%${w}%`, `data->>company.ilike.%${w}%`, `data->>notes.ilike.%${w}%`]).join(",")
    : `data->>name.ilike.%${q}%`;

  const [keyword, recent] = await Promise.all([
    supabase.from("nodes").select("id, object_type, data, updated_at").eq("workspace_id", workspaceId).or(orFilter).limit(120),
    supabase.from("nodes").select("id, object_type, data, updated_at").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(120),
  ]);

  const byId = new Map<string, { id: string; object_type: string; data: Record<string, unknown>; updated_at: string }>();
  for (const r of [...(keyword.data ?? []), ...(recent.data ?? [])]) if (!byId.has(r.id)) byId.set(r.id, r as never);
  const candidates = [...byId.values()];
  if (!candidates.length) return c.json({ results: [], mode: "semantic" });

  const listing = candidates.map((r, i) => `[${i}] ${summarizeNode(r.object_type, r.data)}`).join("\n").slice(0, 12_000);
  let ranked: { index: number; reason?: string }[] = [];
  try {
    const out = await aiGatewayToolUse({
      system: `You are a semantic search ranker over a business workspace. Given a query and candidate records, return ONLY the candidates whose MEANING genuinely matches the query intent (not mere keyword overlap), most relevant first. Return AT MOST ${limit} matches. If none truly fit, return an empty list. Never invent indices; keep each reason under 12 words.`,
      prompt: `Query: "${q}"\n\nCandidates:\n${listing}\n\nReturn up to ${limit} matching candidate indices, most relevant first, each with a very short reason.`,
      toolName: "rank_matches",
      toolDescription: "Return the semantically-matching candidate indices, best first",
      toolSchema: { type: "object", properties: { matches: { type: "array", items: { type: "object", properties: { index: { type: "number" }, reason: { type: "string" } }, required: ["index"] } } }, required: ["matches"] },
      maxTokens: 1400, workspaceId, userId: c.get("userId"), feature: "semantic_search", taskClass: "reasoning",
    });
    ranked = Array.isArray((out as { matches?: unknown[] }).matches) ? (out as { matches: { index: number; reason?: string }[] }).matches : [];
  } catch {
    // AI unavailable → fail soft to keyword order so search still returns something honest.
    ranked = candidates.slice(0, limit).map((_, i) => ({ index: i }));
  }

  const results = ranked
    .map(m => { const r = candidates[m.index]; return r ? { id: r.id, object_type: r.object_type, data: r.data, updated_at: r.updated_at, reason: m.reason ?? null } : null; })
    .filter(Boolean)
    .slice(0, limit);
  return c.json({ results, mode: "semantic" });
});

// ── Reindex — embed every node in the workspace into node_embeddings (for true vector search). A
//    no-op returning {enabled:false} until SOVEREIGN_EMBED_URL is set. Safe to re-run; upserts. ──
router.post("/reindex", requireAuth, async (c) => {
  if (!isEmbeddingsEnabled()) return c.json({ enabled: false, message: "Set SOVEREIGN_EMBED_URL on the API to enable vector search." }, 200);
  const workspaceId = c.get("workspaceId");
  let from = 0, indexed = 0, failed = 0;
  const PAGE = 200, BATCH = 32;
  for (;;) {
    const { data: nodes } = await supabase.from("nodes").select("id, object_type, data").eq("workspace_id", workspaceId).range(from, from + PAGE - 1);
    if (!nodes || nodes.length === 0) break;
    for (let i = 0; i < nodes.length; i += BATCH) {
      const slice = nodes.slice(i, i + BATCH);
      const texts = slice.map((n) => summarizeNode(n.object_type, n.data as Record<string, unknown>));
      const vectors = await embedBatch(texts);
      if (!vectors) { failed += slice.length; continue; }
      const rows = slice.map((n, j) => ({ node_id: n.id, workspace_id: workspaceId, content: texts[j], embedding: vectors[j] as unknown as string, updated_at: new Date().toISOString() }));
      const { error } = await supabase.from("node_embeddings").upsert(rows, { onConflict: "node_id" });
      if (error) failed += slice.length; else indexed += slice.length;
    }
    if (nodes.length < PAGE) break;
    from += PAGE;
  }
  return c.json({ enabled: true, indexed, failed });
});

export { router as searchRouter };
