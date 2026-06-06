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

export async function updateNode(id: string, updates: Partial<Pick<Node, "data" | "ai_summary">>): Promise<Node> {
  const { data, error } = await supabase.from("nodes").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw new Error(`updateNode failed: ${error.message}`);
  return data as Node;
}

export async function getNode(id: string): Promise<Node | null> {
  const { data, error } = await supabase.from("nodes").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`getNode failed: ${error.message}`);
  return data as Node | null;
}

export async function listNodes(workspaceId: string, options: { vertical?: string; object_type?: string; objectType?: string; limit?: number; cursor?: string } = {}): Promise<Node[]> {
  let query = supabase.from("nodes").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false });
  if (options.vertical) query = query.eq("vertical", options.vertical);
  if (options.object_type || options.objectType) query = query.eq("object_type", options.object_type || options.objectType);
  const { data, error } = await query.limit(options.limit || 50);
  if (error) throw new Error(`listNodes failed: ${error.message}`);
  return (data || []) as Node[];
}

export async function deleteNode(id: string): Promise<void> {
  const { error } = await supabase.from("nodes").delete().eq("id", id);
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

export async function getRelated(nodeId: string, relationship?: string): Promise<Node[]> {
  let query = supabase.from("edges").select("to_node_id").eq("from_node_id", nodeId);
  if (relationship) query = query.eq("relationship", relationship);
  const { data, error } = await query;
  if (error) throw new Error(`getRelated failed: ${error.message}`);
  const ids = (data || []).map((edge) => edge.to_node_id);
  if (!ids.length) return [];
  const { data: nodes, error: nodeError } = await supabase.from("nodes").select("*").in("id", ids);
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

