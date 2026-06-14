import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

router.get("/", async (c) => {
  const userId = c.get("userId");
  const role = c.get("role");
  let query = supabase
    .from("lists")
    .select("id,name,object_type,access_level,visibility,owner_id,shared_with,created_at,list_entries(count)")
    .eq("workspace_id", c.get("workspaceId"))
    .order("created_at");

  // owners and admins see everything; others filtered by visibility
  if (!["owner", "admin"].includes(role)) {
    query = query.or(`visibility.eq.workspace,owner_id.eq.${userId},shared_with.cs.{"${userId}"}`);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 400);
  return c.json((data ?? []).map((list) => ({ ...list, entry_count: Array.isArray(list.list_entries) ? Number(list.list_entries[0]?.count ?? 0) : 0 })));
});

router.post("/", zValidator("json", z.object({ name: z.string().min(1), object_type: z.string().min(1) })), async (c) => {
  const body = c.req.valid("json");
  const { data, error } = await supabase.from("lists").insert({ workspace_id: c.get("workspaceId"), owner_id: c.get("userId"), visibility: "workspace", access_level: "workspace", ...body }).select().single();
  return error ? c.json({ error: error.message }, 400) : c.json({ ...data, entry_count: 0 }, 201);
});

router.get("/:id", async (c) => {
  const { data } = await supabase.from("lists").select("id,name,object_type,access_level,visibility,owner_id,shared_with,created_at,list_entries(count)").eq("workspace_id", c.get("workspaceId")).eq("id", c.req.param("id")).maybeSingle();
  return data ? c.json({ ...data, entry_count: Array.isArray(data.list_entries) ? Number(data.list_entries[0]?.count ?? 0) : 0 }) : c.json({ error: "List not found" }, 404);
});

router.patch("/:id", async (c) => {
  const body = await c.req.json<{ name?: string; visibility?: "private" | "workspace" | "shared"; access_level?: string; filters?: unknown[]; views?: unknown[]; shared_with?: string[] }>();
  const { data, error } = await supabase.from("lists").update(body).eq("workspace_id", c.get("workspaceId")).eq("id", c.req.param("id")).select().single();
  return error ? c.json({ error: error.message }, 400) : c.json(data);
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
