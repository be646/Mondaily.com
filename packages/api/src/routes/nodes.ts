import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { denyViewerWrites } from "../middleware/rbac";
import * as ubc from "@mondaily/db/ubc";
import { supabase } from "@mondaily/db/client";
import { inngest } from "../lib/inngest";
import { createNotification } from "../lib/notify";
import { isEmbeddingsEnabled, embedOne } from "../lib/embeddings";

/** Deal stage lives in data.deal_stage (fallbacks: stage, status). */
function dealStageOf(data: unknown): string {
  const d = (data ?? {}) as Record<string, unknown>;
  return String(d.deal_stage ?? d.stage ?? d.status ?? "").trim();
}

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();

/**
 * GET /nodes/counts — EXACT record counts for this workspace, by object_type.
 *
 * Exists because surfaces that need a total were deriving it from `/nodes?limit=500`, which caps
 * at the page size: a workspace with 900 records displayed "500 total records" as if it were the
 * truth. A count must come from the database, never from the length of a truncated page.
 * Declared before "/:id/*" so the literal path wins the route match.
 */
router.get("/counts", requireAuth, async (c) => {
  const workspaceId = c.get("workspaceId");
  const [{ count: total }, grouped] = await Promise.all([
    supabase.from("nodes").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    // Per-type counts come from the existing SQL aggregate (same one /objects uses for its sidebar
    // counts) — a GROUP BY in the database, never a tally over a fetched page.
    supabase.rpc("object_type_counts", { ws: workspaceId }),
  ]);
  const byType: Record<string, number> = {};
  for (const r of (grouped.data ?? []) as { object_type: string; n: number }[]) {
    byType[r.object_type] = Number(r.n);
  }
  return c.json({ total: total ?? 0, by_type: byType });
});

router.get("/:id/related", requireAuth, async (c) => {
  const id = c.req.param("id");
  const related = await ubc.getRelated(id, c.get("workspaceId"));
  return c.json(related);
});

router.post("/:id/relate", requireAuth, denyViewerWrites, zValidator("json", z.object({
  target_id: z.string(),
  relationship: z.string().default("related"),
})), async (c) => {
  const id = c.req.param("id");
  const workspaceId = c.get("workspaceId");
  const { target_id, relationship } = c.req.valid("json");
  // BOTH endpoints must belong to the caller's workspace before an edge is written. Neither was
  // checked: a member could create edges naming arbitrary foreign node UUIDs (graph pollution and
  // an existence probe). Same guard shape lists.ts uses before adding a list entry.
  const { data: owned } = await supabase.from("nodes").select("id").eq("workspace_id", workspaceId).in("id", [id, target_id]);
  const ownedIds = new Set((owned ?? []).map((n: { id: string }) => n.id));
  if (!ownedIds.has(id) || !ownedIds.has(target_id)) return c.json({ error: "Record not found" }, 404);
  await ubc.createEdge(workspaceId, id, target_id, relationship);
  await ubc.createEdge(workspaceId, target_id, id, relationship);
  return c.json({ ok: true }, 201);
});

// Semantic dedup — before creating a record, surface likely EXISTING duplicates so the user doesn't
// create a second "Acme Corp". Uses the sovereign embedding appliance (cosine over node vectors) when
// configured; falls back to a name ILIKE so it still catches obvious dupes with embeddings off. Read-
// only + fail-soft: any error returns no candidates rather than blocking record creation.
// NOTE: registered BEFORE "/:id" so the static path isn't captured as a record id.
router.get("/similar", requireAuth, zValidator("query", z.object({
  q: z.string().min(2).max(200),
  object_type: z.string().optional(),
  limit: z.coerce.number().min(1).max(10).default(5),
})), async (c) => {
  const workspaceId = c.get("workspaceId");
  const { q, object_type, limit } = c.req.valid("query");
  const SIMILARITY_FLOOR = 0.82; // only flag STRONG matches — a dup warning must be trustworthy
  try {
    if (isEmbeddingsEnabled()) {
      const qv = await embedOne(q);
      if (qv) {
        const { data: matches } = await supabase.rpc("match_node_embeddings", { ws: workspaceId, query_embedding: qv as unknown as string, k: 12 });
        const strong = (matches ?? []).filter((m: { similarity: number }) => m.similarity >= SIMILARITY_FLOOR);
        if (strong.length) {
          const ids = strong.map((m: { node_id: string }) => m.node_id);
          const { data: nodes } = await supabase.from("nodes").select("id, object_type, data").eq("workspace_id", workspaceId).in("id", ids);
          const byId = new Map((nodes ?? []).map((n) => [n.id, n]));
          const candidates = strong
            .map((m: { node_id: string; similarity: number }) => { const n = byId.get(m.node_id); return n ? { id: n.id, object_type: n.object_type, name: String((n.data as Record<string, unknown>).name ?? (n.data as Record<string, unknown>).title ?? (n.data as Record<string, unknown>).full_name ?? "Untitled"), similarity: Math.round(m.similarity * 100) } : null; })
            .filter((x: unknown): x is { id: string; object_type: string; name: string; similarity: number } => !!x)
            .filter((x: { object_type: string }) => !object_type || x.object_type === object_type)
            .slice(0, limit);
          if (candidates.length) return c.json({ candidates, mode: "vector" });
        }
      }
    }
    // Fallback: name ILIKE within the same object type (still catches exact/near-exact dupes).
    let query = supabase.from("nodes").select("id, object_type, data").eq("workspace_id", workspaceId).ilike("data->>name", `%${q}%`).limit(limit);
    if (object_type) query = query.eq("object_type", object_type);
    const { data: nameHits } = await query;
    const candidates = (nameHits ?? []).map((n) => ({ id: n.id, object_type: n.object_type, name: String((n.data as Record<string, unknown>).name ?? (n.data as Record<string, unknown>).title ?? "Untitled"), similarity: null as number | null }));
    return c.json({ candidates, mode: "name" });
  } catch {
    return c.json({ candidates: [], mode: "none" });
  }
});

router.get("/:id", requireAuth, async (c) => {
  const node = await ubc.getNode(c.req.param("id"), c.get("workspaceId"));
  if (!node) return c.json({ error: "Not found" }, 404);
  return c.json(node);
});

router.get("/", requireAuth, zValidator("query", z.object({
  vertical: z.string().optional(),
  object_type: z.string().optional(),
  parent_id: z.string().optional(),   // children of one record, filtered in SQL (see ubc.listNodes)
  limit: z.coerce.number().min(1).max(1000).default(50),
  // offset was missing from this schema entirely — zod STRIPPED it from the query, so clients that
  // paginated received page one repeatedly and could not tell.
  offset: z.coerce.number().min(0).default(0),
  cursor: z.string().optional()
})), async (c) => {
  const query = c.req.valid("query");
  const nodes = await ubc.listNodes(c.get("workspaceId"), query);
  return c.json(nodes);
});

router.post("/", requireAuth, denyViewerWrites, zValidator("json", z.object({
  vertical: z.enum(["sales", "realestate", "hr", "finance", "investments", "tasks", "shared"]),
  object_type: z.string().min(1),
  data: z.record(z.unknown())
})), async (c) => {
  const body = c.req.valid("json");
  const node = await ubc.createNode({ workspace_id: c.get("workspaceId"), created_by: c.get("userId"), ...body });
  await ubc.logActivity(node.id!, c.get("workspaceId"), "human", c.get("userId"), "created", undefined, `Created ${body.object_type}`);

  // Fire background enrichment (non-blocking — never fails the request)
  inngest.send({
    name: "crm/record.created",
    data: {
      workspaceId: c.get("workspaceId"),
      nodeId: node.id!,
      objectType: body.object_type,
      vertical: body.vertical,
      recordData: body.data,
    },
  }).catch(() => {/* enrichment is best-effort */});

  return c.json(node, 201);
});

router.patch("/:id", requireAuth, denyViewerWrites, zValidator("json", z.object({
  data: z.record(z.unknown()).optional(),
  ai_summary: z.string().optional()
})), async (c) => {
  const updates = c.req.valid("json");
  const workspaceId = c.get("workspaceId");
  const nodeId = c.req.param("id");
  // Capture the previous stage BEFORE updating so we can detect a deal stage move.
  const { data: prev } = await supabase.from("nodes").select("object_type, data").eq("id", nodeId).eq("workspace_id", workspaceId).single();

  // Stamp `won_at` the moment a deal moves INTO a won stage. Measured in production: zero of 44
  // deals carry any close date, so "closed this month" could only ever approximate via updated_at —
  // which moves on every edit. This makes the metric exact for every future close while the money
  // model (lib/money) falls back to updated_at for legacy rows and labels the difference.
  // Only on the transition, so re-saving an already-won deal never refreshes its close date.
  if (updates.data && String(prev?.object_type ?? "").toLowerCase().includes("deal")) {
    const prevData = (prev?.data as Record<string, unknown>) ?? {};
    const nextData = updates.data as Record<string, unknown>;
    const before = dealStageOf(prevData);
    const after = dealStageOf({ ...prevData, ...nextData });
    if (/won/i.test(after) && !/won/i.test(before) && !nextData.won_at) {
      nextData.won_at = new Date().toISOString();
    } else if (prevData.won_at && !nextData.won_at) {
      // updateNode REPLACES data wholesale, so a client that fetched the record before the stamp
      // existed and edits any other field would silently erase it. A server-stamped fact must
      // survive client round-trips the client doesn't know about.
      nextData.won_at = prevData.won_at;
    }
  }

  const node = await ubc.updateNode(nodeId, workspaceId, updates);
  await ubc.logActivity(node.id!, workspaceId, "human", c.get("userId"), "updated", updates);

  // Deal stage change → real notification, so the bell + "what changed" pick it up.
  try {
    const isDeal = String(node.object_type ?? "").toLowerCase().includes("deal");
    const oldStage = dealStageOf(prev?.data);
    const newStage = dealStageOf(node.data);
    if (isDeal && newStage && oldStage !== newStage) {
      const d = (node.data ?? {}) as Record<string, unknown>;
      const name = String(d.name ?? d.title ?? "A deal");
      await createNotification({
        workspace_id: workspaceId,
        user_id: c.get("userId"),
        title: "Deal stage changed",
        body: `${name} moved${oldStage ? ` from ${oldStage}` : ""} to ${newStage}.`,
        type: "deal_stage",
        // Human-triggered record event (no autonomous agent) — link the record, don't attribute an agent.
        metadata: { from: oldStage || null, to: newStage },
        source: { node_id: node.id, object_type: node.object_type },
      });
    }
  } catch { /* best-effort — never block the update on the notification */ }

  // Real-time automation triggers (record_updated / deal_stage_change).
  inngest.send({
    name: "crm/record.updated",
    data: { workspaceId, nodeId: node.id!, objectType: node.object_type, vertical: node.vertical },
  }).catch(() => {/* best-effort */});
  return c.json(node);
});

router.delete("/:id", requireAuth, denyViewerWrites, async (c) => {
  await ubc.deleteNode(c.req.param("id"), c.get("workspaceId"));
  return c.json({ ok: true });
});

export { router as nodesRouter };
