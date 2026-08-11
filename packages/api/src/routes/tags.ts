import { Hono } from "hono";
import { zValidator } from "../lib/validate";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { denyViewerWrites } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();
router.use("*", requireAuth);
router.use("*", denyViewerWrites); // viewers are read-only

// List all tags for workspace
router.get("/", async (c) => {
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
  const workspaceId = c.get("workspaceId");
  const nodeId = c.req.param("nodeId");
  // Both ids must be OURS. Neither was validated: the row was written with the caller's
  // workspace_id but a foreign node_id/tag_id, and because GET /node/:nodeId joins tags(...)
  // filtered on node_tags.workspace_id, planting a foreign tag_id read that tag's name and colour
  // straight back out — a genuine cross-tenant read path, not just pollution.
  const [{ data: node }, { data: tag }] = await Promise.all([
    supabase.from("nodes").select("id").eq("id", nodeId).eq("workspace_id", workspaceId).maybeSingle(),
    supabase.from("tags").select("id").eq("id", tag_id).eq("workspace_id", workspaceId).maybeSingle(),
  ]);
  if (!node || !tag) return c.json({ error: "Not found" }, 404);
  const { error } = await supabase.from("node_tags").insert({
    node_id: nodeId,
    tag_id,
    workspace_id: workspaceId,
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
