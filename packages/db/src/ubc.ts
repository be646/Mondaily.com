import { z } from "zod";
import { supabase } from "./client";

export const NodeSchema = z.object({
  id: z.string().uuid().optional(),
  workspace_id: z.string().uuid(),
  vertical: z.enum(["sales", "realestate", "hr", "finance", "investments", "tasks", "shared"]),
  object_type: z.string(),
  data: z.record(z.unknown()),
  ai_summary: z.string().optional(),
  created_by: z.string().optional()
});

export type Node = z.infer<typeof NodeSchema>;

export async function createNode(input: Omit<Node, "id">): Promise<Node> {
  const validated = NodeSchema.omit({ id: true }).parse(input);
  const { data, error } = await supabase.from("nodes").insert(validated).select().single();
  if (error) throw new Error(`createNode failed: ${error.message}`);
  return data as Node;
}

// SECURITY (multi-tenant): every node accessor REQUIRES the caller's workspaceId
// and filters BOTH id AND workspace_id. The service-role key bypasses RLS, so a
// query by id alone would let one tenant read/write/delete another tenant's row
// by guessing a UUID. Scoping by workspace_id makes cross-tenant access impossible.
export async function updateNode(id: string, workspaceId: string, updates: Partial<Pick<Node, "data" | "ai_summary">>): Promise<Node> {
  const { data, error } = await supabase.from("nodes").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", id).eq("workspace_id", workspaceId).select().single();
  if (error) throw new Error(`updateNode failed: ${error.message}`);
  return data as Node;
}

export async function getNode(id: string, workspaceId: string): Promise<(Node & { activities: Awaited<ReturnType<typeof getActivities>>; updated_at: string; created_at?: string }) | null> {
  const { data, error } = await supabase.from("nodes").select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new Error(`getNode failed: ${error.message}`);
  if (!data) return null;
  const activities = await getActivities(id, 50);
  return { ...(data as Node & { updated_at: string; created_at?: string }), activities };
}

/** One structured filter condition, applied in SQL over the data jsonb.
 *  Ops the database can reproduce exactly: is / is_not / contains / empty / not_empty, plus
 *  before / after (ISO date strings compare correctly as text). Numeric gt/lt are NOT offered
 *  here on purpose — data values are mixed string/number in jsonb, and a text "9" > "10"
 *  comparison would silently lie; callers keep numeric ranges client-side. */
export type NodeFilter = { col: string; op: "is" | "is_not" | "contains" | "empty" | "not_empty" | "before" | "after"; value?: string };
const SAFE_COL = /^[a-zA-Z0-9_. -]{1,64}$/;   // column names come from the client — never into SQL unless shaped like one

export async function listNodes(workspaceId: string, options: { vertical?: string; object_type?: string; objectType?: string; parent_id?: string; q?: string; filters?: NodeFilter[]; limit?: number; offset?: number; cursor?: string } = {}): Promise<Node[]> {
  // Secondary sort on id: range-pagination over updated_at ALONE skips/duplicates rows that share
  // a timestamp (bulk imports and merges write many rows in the same instant), so pages were not
  // deterministic even when offset worked.
  let query = supabase.from("nodes").select("*").eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false }).order("id", { ascending: true });
  if (options.vertical) query = query.eq("vertical", options.vertical);
  if (options.object_type || options.objectType) query = query.eq("object_type", options.object_type || options.objectType);
  // Children of one record (notes/tasks/contact logs hang off data.parent_id). Filtering in SQL —
  // the callers used to pull a capped global page and filter client-side, which silently dropped a
  // record's own children once the workspace had more rows than the page size.
  if (options.parent_id) query = query.eq("data->>parent_id", options.parent_id);
  // Free-text search over the identity fields — so "find a person" filters ALL records of the
  // type in the database, not just whichever page happens to be loaded in the browser.
  if (options.q?.trim()) {
    const term = options.q.trim().replace(/[(),]/g, " ").slice(0, 100);
    query = query.or(["name", "title", "full_name", "email", "phone", "company", "notes"]
      .map(f => `data->>${f}.ilike.%${term}%`).join(","));
  }
  for (const f of options.filters ?? []) {
    if (!SAFE_COL.test(f.col)) continue;         // refuse anything not shaped like a column name
    const col = `data->>${f.col}`;
    const v = String(f.value ?? "");
    if (f.op === "is") query = query.eq(col, v);
    else if (f.op === "is_not") query = query.neq(col, v);
    else if (f.op === "contains") query = query.ilike(col, `%${v.replace(/[%(),]/g, " ")}%`);
    else if (f.op === "empty") query = query.or(`${col}.is.null,${col}.eq.`);
    else if (f.op === "not_empty") query = query.not(col, "is", null).neq(col, "");
    else if (f.op === "after") query = query.gte(col, v);
    else if (f.op === "before") query = query.lte(col, v);
  }
  const limit = options.limit || 50;
  // offset was accepted by callers and SILENTLY IGNORED — GET /nodes?offset=500 returned page one
  // again, so every paginating consumer read duplicate data without knowing. Found live: paged
  // counts came back as exact multiples of the page count.
  const from = Math.max(0, options.offset ?? 0);
  const { data, error } = await query.range(from, from + limit - 1);
  if (error) throw new Error(`listNodes failed: ${error.message}`);
  return (data || []) as Node[];
}

export async function deleteNode(id: string, workspaceId: string): Promise<void> {
  const { error } = await supabase.from("nodes").delete().eq("id", id).eq("workspace_id", workspaceId);
  if (error) throw new Error(`deleteNode failed: ${error.message}`);
}

export async function searchNodes(workspaceId: string, query: string, options: { verticals?: string[]; objectTypes?: string[]; limit?: number } = {}): Promise<Node[]> {
  const { data, error } = await supabase.rpc("search_nodes_keyword_only", {
    p_workspace_id: workspaceId,
    p_query_text: query,
    p_verticals: options.verticals ?? null,
    p_object_types: options.objectTypes ?? null,
    p_limit: options.limit ?? 20
  });
  if (error) throw new Error(`searchNodes failed: ${error.message}`);
  return (data || []) as Node[];
}

export async function createEdge(workspaceId: string, fromNodeId: string, toNodeId: string, relationship: string, metadata: Record<string, unknown> = {}): Promise<void> {
  const { error } = await supabase.from("edges").insert({ workspace_id: workspaceId, from_node_id: fromNodeId, to_node_id: toNodeId, relationship, metadata });
  if (error) throw new Error(`createEdge failed: ${error.message}`);
}

export async function getRelated(nodeId: string, workspaceId: string, relationship?: string): Promise<Node[]> {
  // Scope BOTH the edge traversal and the node fetch to the workspace so a tenant
  // can never walk another tenant's graph by passing a foreign node id.
  let query = supabase.from("edges").select("to_node_id").eq("workspace_id", workspaceId).eq("from_node_id", nodeId);
  if (relationship) query = query.eq("relationship", relationship);
  const { data, error } = await query;
  if (error) throw new Error(`getRelated failed: ${error.message}`);
  const ids = (data || []).map((edge) => edge.to_node_id);
  if (!ids.length) return [];
  const { data: nodes, error: nodeError } = await supabase.from("nodes").select("*").eq("workspace_id", workspaceId).in("id", ids);
  if (nodeError) throw new Error(`getRelated nodes failed: ${nodeError.message}`);
  return (nodes || []) as Node[];
}

export async function logActivity(nodeId: string, workspaceId: string, actorType: "human" | "ai_agent" | "integration" | "system", actorId: string, action: string, diff?: Record<string, unknown>, aiSummary?: string): Promise<void> {
  const { error } = await supabase.from("activities").insert({ node_id: nodeId, workspace_id: workspaceId, actor_type: actorType, actor_id: actorId, action, diff: diff ?? null, ai_summary: aiSummary ?? null });
  if (error) throw new Error(`logActivity failed: ${error.message}`);
}

export async function getActivities(nodeId: string, limit = 20) {
  const { data, error } = await supabase.from("activities").select("*").eq("node_id", nodeId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`getActivities failed: ${error.message}`);
  return data || [];
}

