import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();
router.use("*", requireAuth);

// GET /notifications
router.get("/", async (c) => {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

// POST /notifications - create notification
router.post("/", async (c) => {
  const body = await c.req.json() as { user_id?: string; title: string; body: string; type?: string; task_id?: string };
  const { data, error } = await supabase
    .from("notifications")
    .insert({
      workspace_id: c.get("workspaceId"),
      user_id: body.user_id || c.get("userId"),
      title: body.title,
      body: body.body,
      type: body.type || "system",
      task_id: body.task_id || null,
      is_read: false
    })
    .select().single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

// PATCH /notifications/read-all — must be before /:id/read
router.patch("/read-all", async (c) => {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("workspace_id", c.get("workspaceId"))
    .eq("is_read", false);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// PATCH /notifications/:id/read
router.patch("/:id/read", async (c) => {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("id", c.req.param("id"))
    .eq("workspace_id", c.get("workspaceId"));
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// DELETE /notifications/:id
router.delete("/:id", async (c) => {
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", c.req.param("id"))
    .eq("workspace_id", c.get("workspaceId"));
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

export { router as notificationsRouter };
