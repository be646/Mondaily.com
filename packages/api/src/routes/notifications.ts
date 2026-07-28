import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import { categorizeNotification, extractSource } from "../lib/notify";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();
router.use("*", requireAuth);

// GET /notifications — scoped to workspace + requesting user. Each row is enriched with a derived
// `category` (for the grouped bell) and a compacted `source` (the audit-trail links) — both computed
// from the row's own fields, never fabricated. Original fields are preserved (unread/read intact).
router.get("/", async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  // Callers ask for a page size (Home/agent dock request ?limit=50); it was ignored and
  // every caller got 100 rows. Honour it, clamped to a sane range so a bad value can't
  // turn this into an unbounded scan. Default stays 100 — unchanged for callers that omit it.
  const requested = Number.parseInt(c.req.query("limit") ?? "", 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 200) : 100;
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("workspace_id", workspaceId)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return c.json({ error: error.message }, 500);
  const rows = (data ?? []).map((n) => ({
    ...n,
    category: categorizeNotification(n),
    source: extractSource(n),
  }));
  return c.json(rows);
});

// POST /notifications
router.post("/", async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const body = await c.req.json() as {
    user_id?: string;
    title: string;
    body?: string;
    type?: string;
    task_id?: string;
  };
  // Prevent spoofing a notification to an arbitrary id: a caller may only target THEMSELVES or a
  // real member of this workspace.
  let targetUserId = userId;
  if (body.user_id && body.user_id !== userId) {
    const { data: member } = await supabase.from("workspace_members")
      .select("user_id").eq("workspace_id", workspaceId).eq("user_id", body.user_id).maybeSingle();
    if (!member) return c.json({ error: "Target user is not a member of this workspace." }, 403);
    targetUserId = body.user_id;
  }
  const { data, error } = await supabase
    .from("notifications")
    .insert({
      workspace_id: workspaceId,
      user_id: targetUserId,
      title: body.title,
      body: body.body ?? null,
      message: body.title,        // keep legacy column populated
      type: body.type ?? "system",
      task_id: body.task_id ?? null,
      is_read: false,
    })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

// PATCH /notifications/read-all — must be before /:id/read
router.patch("/read-all", async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .eq("is_read", false);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// PATCH /notifications/:id/read
router.patch("/:id/read", async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("id", c.req.param("id"))
    .eq("workspace_id", workspaceId)
    .or(`user_id.eq.${userId},user_id.is.null`);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// DELETE /notifications/:id
router.delete("/:id", async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", c.req.param("id"))
    .eq("workspace_id", workspaceId)
    .or(`user_id.eq.${userId},user_id.is.null`);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

export { router as notificationsRouter };
