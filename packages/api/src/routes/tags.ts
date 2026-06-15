import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();

// List all tags for workspace
router.get("/", requireAuth, async (c) => {
  const { data } = await supabase
    .from("tags")
    .select("*")
    .eq("workspace_id", c.get("workspaceId"))
    .order("name");
  return c.json(data ?? []);
});

// Create tag
router.post("/", requireAuth, zValidator("json", z.object({
  name: z.string().min(1),
  color: z.string().default("#6366f1"),
})), async (c) => {
  const { name, color } = c.req.valid("json");
  const { data, error } = await supabase.from("tags").insert({
    workspace_id: c.get("workspaceId"),
    name: name.trim(),
    color,
  }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data, 201);
});

// Delete tag
router.delete("/:id", requireAuth, async (c) => {
  await supabase.from("tags").delete().eq("id", c.req.param("id")).eq("workspace_id", c.get("workspaceId"));
  return c.json({ ok: true });
});

// Get tags for a node
router.get("/node/:nodeId", requireAuth, async (c) => {
  const { data } = await supabase
    .from("node_tags")
    .select("tag_id, tags(id, name, color)")
    .eq("node_id", c.req.param("nodeId"))
    .eq("workspace_id", c.get("workspaceId"));
  return c.json((data ?? []).map((r: Record<string, unknown>) => r.tags));
});

// Add tag to node
router.post("/node/:nodeId", requireAuth, zValidator("json", z.object({
  tag_id: z.string().uuid(),
})), async (c) => {
  const { tag_id } = c.req.valid("json");
  const { error } = await supabase.from("node_tags").insert({
    node_id: c.req.param("nodeId"),
    tag_id,
    workspace_id: c.get("workspaceId"),
  });
  if (error && !error.message.includes("duplicate")) return c.json({ error: error.message }, 400);
  return c.json({ ok: true });
});

// Remove tag from node
router.delete("/node/:nodeId/:tagId", requireAuth, async (c) => {
  await supabase.from("node_tags")
    .delete()
    .eq("node_id", c.req.param("nodeId"))
    .eq("tag_id", c.req.param("tagId"))
    .eq("workspace_id", c.get("workspaceId"));
  return c.json({ ok: true });
});

export { router as tagsRouter };
