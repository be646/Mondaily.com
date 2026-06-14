import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

/* ── helpers ──────────────────────────────────────────────── */

interface AssignmentMeta {
  _type: "_assignment";
  assignee_id: string | null;
  shared_with: string[];
}

function extractAssignment(views: unknown[]): AssignmentMeta {
  const meta = (views ?? []).find((v: any) => v?._type === "_assignment") as AssignmentMeta | undefined;
  return meta ?? { _type: "_assignment", assignee_id: null, shared_with: [] };
}

function patchViews(existing: unknown[], assigneeId: string | null | undefined, sharedWith: string[] | undefined): unknown[] {
  const filtered = (existing ?? []).filter((v: any) => v?._type !== "_assignment");
  const meta = extractAssignment(existing);
  filtered.push({
    _type: "_assignment",
    assignee_id: assigneeId !== undefined ? assigneeId : meta.assignee_id,
    shared_with: sharedWith !== undefined ? sharedWith : meta.shared_with,
  });
  return filtered;
}

function formatList(row: any) {
  const assignment = extractAssignment(row.views ?? []);
  return {
    id: row.id,
    name: row.name,
    object_type: row.object_type,
    access_level: row.access_level,
    owner_id: row.owner_id,
    created_at: row.created_at,
    entry_count: Array.isArray(row.list_entries) ? Number(row.list_entries[0]?.count ?? 0) : (row.entry_count ?? 0),
    assignee_id: assignment.assignee_id,
    shared_with: assignment.shared_with ?? [],
  };
}

/* ── routes ───────────────────────────────────────────────── */

router.get("/", async (c) => {
  const { data, error } = await supabase
    .from("lists")
    .select("id,name,object_type,access_level,owner_id,created_at,views,list_entries(count)")
    .eq("workspace_id", c.get("workspaceId"))
    .order("created_at");
  if (error) return c.json({ error: error.message }, 400);
  return c.json((data ?? []).map(formatList));
});

router.post("/", zValidator("json", z.object({
  name: z.string().min(1),
  object_type: z.string().min(1),
  assignee_id: z.string().optional(),
  shared_with: z.array(z.string()).optional(),
})), async (c) => {
  const { name, object_type, assignee_id, shared_with } = c.req.valid("json");
  const views = patchViews([], assignee_id ?? c.get("userId"), shared_with ?? []);
  const { data, error } = await supabase
    .from("lists")
    .insert({ workspace_id: c.get("workspaceId"), owner_id: c.get("userId"), access_level: "workspace", name, object_type, views })
    .select("id,name,object_type,access_level,owner_id,created_at,views")
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ...formatList(data), entry_count: 0 }, 201);
});

router.get("/:id", async (c) => {
  const { data } = await supabase
    .from("lists")
    .select("id,name,object_type,access_level,owner_id,created_at,views,list_entries(count)")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"))
    .maybeSingle();
  return data ? c.json(formatList(data)) : c.json({ error: "List not found" }, 404);
});

router.patch("/:id", async (c) => {
  const body = await c.req.json<{
    name?: string;
    access_level?: "private" | "workspace" | "team";
    filters?: unknown[];
    views?: unknown[];
    assignee_id?: string | null;
    shared_with?: string[];
  }>();

  const { assignee_id, shared_with, ...rest } = body;
  const needsAssignment = assignee_id !== undefined || shared_with !== undefined;

  let updatePayload: Record<string, unknown> = { ...rest };

  if (needsAssignment) {
    const { data: existing } = await supabase
      .from("lists")
      .select("views")
      .eq("workspace_id", c.get("workspaceId"))
      .eq("id", c.req.param("id"))
      .maybeSingle();
    updatePayload.views = patchViews(existing?.views ?? [], assignee_id, shared_with);
  }

  const { data, error } = await supabase
    .from("lists")
    .update(updatePayload)
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"))
    .select("id,name,object_type,access_level,owner_id,created_at,views,list_entries(count)")
    .single();
  return error ? c.json({ error: error.message }, 400) : c.json(formatList(data));
});

router.delete("/:id", async (c) => {
  const { error } = await supabase.from("lists").delete().eq("workspace_id", c.get("workspaceId")).eq("id", c.req.param("id"));
  return error ? c.json({ error: error.message }, 400) : c.json({ ok: true });
});

router.get("/:id/entries", async (c) => {
  const { data: list } = await supabase.from("lists").select("id").eq("workspace_id", c.get("workspaceId")).eq("id", c.req.param("id")).maybeSingle();
  if (!list) return c.json({ error: "List not found" }, 404);
  const { data: entries, error } = await supabase.from("list_entries").select("position,nodes(id,object_type,data,updated_at,ai_summary)").eq("list_id", list.id).order("position");
  if (error) return c.json({ error: error.message }, 400);
  return c.json((entries ?? []).flatMap((entry) => entry.nodes ? [entry.nodes] : []));
});

router.post("/:id/entries", zValidator("json", z.object({ node_id: z.string().uuid() })), async (c) => {
  const { data: list } = await supabase.from("lists").select("id,object_type").eq("workspace_id", c.get("workspaceId")).eq("id", c.req.param("id")).maybeSingle();
  if (!list) return c.json({ error: "List not found" }, 404);
  const { data: node } = await supabase.from("nodes").select("id,object_type").eq("workspace_id", c.get("workspaceId")).eq("id", c.req.valid("json").node_id).maybeSingle();
  if (!node || node.object_type !== list.object_type) return c.json({ error: "Record does not match this list type" }, 400);
  const { count } = await supabase.from("list_entries").select("*", { count: "exact", head: true }).eq("list_id", list.id);
  const { data, error } = await supabase.from("list_entries").upsert({ list_id: list.id, node_id: node.id, position: (count ?? 0) + 1 }).select().single();
  return error ? c.json({ error: error.message }, 400) : c.json(data, 201);
});

router.delete("/:id/entries/:nodeId", async (c) => {
  const { data: list } = await supabase.from("lists").select("id").eq("workspace_id", c.get("workspaceId")).eq("id", c.req.param("id")).maybeSingle();
  if (!list) return c.json({ error: "List not found" }, 404);
  const { error } = await supabase.from("list_entries").delete().eq("list_id", list.id).eq("node_id", c.req.param("nodeId"));
  return error ? c.json({ error: error.message }, 400) : c.json({ ok: true });
});

export { router as listsRouter };
