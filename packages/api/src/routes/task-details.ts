import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { denyViewerWrites } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";
import { HTTPException } from "hono/http-exception";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();
router.use("*", requireAuth);
router.use("*", denyViewerWrites); // viewers are read-only

// Verify a task belongs to the current workspace before any child-table access.
async function assertTaskOwnership(taskId: string, workspaceId: string) {
  const { data } = await supabase
    .from("tasks")
    .select("id")
    .eq("id", taskId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) throw new HTTPException(404, { message: "Task not found" });
}

// ── Labels ──────────────────────────────────────────────
router.patch("/:id/labels", async (c) => {
  const workspaceId = c.get("workspaceId");
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, workspaceId);
  const { labels } = await c.req.json() as { labels: string[] };
  const update: Record<string, unknown> = { labels };
  if (labels.includes("Need Review")) update.status = "review";
  const { data, error } = await supabase
    .from("tasks").update(update).eq("id", taskId).eq("workspace_id", workspaceId).select().single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// ── Assignees ────────────────────────────────────────────
router.get("/:id/assignees", async (c) => {
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, c.get("workspaceId"));
  const { data, error } = await supabase
    .from("task_assignees").select("*").eq("task_id", taskId);
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

router.post("/:id/assignees", async (c) => {
  const workspaceId = c.get("workspaceId");
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, workspaceId);
  const body = await c.req.json() as { user_id: string; email: string; name: string; permission: string };
  const { data, error } = await supabase
    .from("task_assignees")
    .upsert({ task_id: taskId, workspace_id: workspaceId, ...body }, { onConflict: "task_id,user_id" })
    .select().single();
  if (error) return c.json({ error: error.message }, 500);
  await supabase.from("task_activity").insert({
    task_id: taskId, workspace_id: workspaceId,
    user_id: c.get("userId"), user_name: body.name || body.email,
    action: "was added as collaborator",
  });
  return c.json(data);
});

router.delete("/:id/assignees/:userId", async (c) => {
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, c.get("workspaceId"));
  const { error } = await supabase
    .from("task_assignees")
    .delete().eq("task_id", taskId).eq("user_id", c.req.param("userId"));
  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});

// ── Checklist ────────────────────────────────────────────
router.get("/:id/checklist", async (c) => {
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, c.get("workspaceId"));
  const { data, error } = await supabase
    .from("task_checklist").select("*").eq("task_id", taskId).order("created_at");
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

router.post("/:id/checklist", async (c) => {
  const workspaceId = c.get("workspaceId");
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, workspaceId);
  const body = await c.req.json() as { text: string; added_by_name: string };
  const { data, error } = await supabase
    .from("task_checklist")
    .insert({ task_id: taskId, workspace_id: workspaceId, text: body.text, added_by_user_id: c.get("userId"), added_by_name: body.added_by_name })
    .select().single();
  if (error) return c.json({ error: error.message }, 500);
  await supabase.from("task_activity").insert({
    task_id: taskId, workspace_id: workspaceId,
    user_id: c.get("userId"), user_name: body.added_by_name,
    action: `added checklist item: "${body.text}"`,
  });
  return c.json(data, 201);
});

router.patch("/:id/checklist/:itemId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, workspaceId);
  const body = await c.req.json() as { completed: boolean; _user_name?: string };
  const { _user_name, ...updateBody } = body;
  const { data, error } = await supabase
    .from("task_checklist").update(updateBody).eq("id", c.req.param("itemId")).select().single();
  if (error) return c.json({ error: error.message }, 500);
  if (body.completed !== undefined) {
    await supabase.from("task_activity").insert({
      task_id: taskId, workspace_id: workspaceId,
      user_id: c.get("userId"), user_name: _user_name ?? "Someone",
      action: body.completed ? `completed: "${data?.text}"` : `unchecked: "${data?.text}"`,
    });
  }
  return c.json(data);
});

router.delete("/:id/checklist/:itemId", async (c) => {
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, c.get("workspaceId"));
  const { error } = await supabase
    .from("task_checklist").delete().eq("id", c.req.param("itemId"));
  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});

// ── Comments ─────────────────────────────────────────────
router.get("/:id/comments", async (c) => {
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, c.get("workspaceId"));
  const { data, error } = await supabase
    .from("task_comments").select("*").eq("task_id", taskId).order("created_at");
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

router.post("/:id/comments", async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, workspaceId);
  // Accept `body` (the column name, what the UI sends) and tolerate a legacy `content`
  // payload. `body` is NOT NULL, so reject an empty comment with 400 rather than a 500.
  const payload = await c.req.json() as { body?: string; content?: string; user_name?: string };
  const text = (payload.body ?? payload.content ?? "").trim();
  if (!text) return c.json({ error: "Comment body is required." }, 400);
  const { data, error } = await supabase
    .from("task_comments")
    .insert({ task_id: taskId, workspace_id: workspaceId, user_id: userId, user_name: payload.user_name, body: text })
    .select().single();
  if (error) return c.json({ error: error.message }, 500);

  // Notify assignee on new comment (if different user)
  const { data: task } = await supabase.from("tasks").select("title,assignee_id").eq("id", taskId).single();
  if (task?.assignee_id && task.assignee_id !== userId) {
    await supabase.from("notifications").insert({
      workspace_id: workspaceId,
      user_id: task.assignee_id,
      message: `New comment on "${task.title}"`,
      title: `New comment on "${task.title}"`,
      body: `${payload.user_name ?? "Someone"}: ${text.slice(0, 80)}`,
      type: "comment",
      task_id: taskId,
      is_read: false,
    });
  }

  return c.json(data, 201);
});

router.delete("/:id/comments/:commentId", async (c) => {
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, c.get("workspaceId"));
  const { error } = await supabase
    .from("task_comments").delete()
    .eq("id", c.req.param("commentId"))
    .eq("task_id", taskId)                 // isolation: comment must belong to the verified task
    .eq("user_id", c.get("userId"));
  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});

// ── Comment Reactions ─────────────────────────────────────
/**
 * ISOLATION GUARD: verifying the TASK isn't enough — the commentId is also caller-supplied and
 * must belong to THAT task, or a caller could pass their own task id + a foreign workspace's
 * comment id to read/toggle reactions cross-workspace. 404s when the pair doesn't match.
 */
async function assertCommentOnTask(commentId: string, taskId: string): Promise<void> {
  const { data } = await supabase
    .from("task_comments").select("id").eq("id", commentId).eq("task_id", taskId).maybeSingle();
  if (!data) throw new HTTPException(404, { message: "Comment not found" });
}

router.get("/:id/comments/:commentId/reactions", async (c) => {
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, c.get("workspaceId"));
  await assertCommentOnTask(c.req.param("commentId"), taskId);
  const { data } = await supabase
    .from("task_comment_reactions").select("*").eq("comment_id", c.req.param("commentId"));
  return c.json(data ?? []);
});

router.post("/:id/comments/:commentId/reactions", async (c) => {
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, c.get("workspaceId"));
  const { emoji } = await c.req.json() as { emoji: string };
  const userId = c.get("userId");
  const commentId = c.req.param("commentId");
  await assertCommentOnTask(commentId, taskId);
  const { data: existing } = await supabase
    .from("task_comment_reactions").select("id")
    .eq("comment_id", commentId).eq("user_id", userId).eq("emoji", emoji).maybeSingle();
  if (existing) {
    await supabase.from("task_comment_reactions").delete().eq("id", existing.id);
    return c.json({ removed: true });
  }
  const { data, error } = await supabase
    .from("task_comment_reactions")
    .insert({ comment_id: commentId, user_id: userId, emoji })
    .select().single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// ── Attachments ──────────────────────────────────────────
const TASK_ATTACH_BUCKET = "task-attachments";
const TASK_ATTACH_MAX_BYTES = 10 * 1024 * 1024;
router.get("/:id/attachments", async (c) => {
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, c.get("workspaceId"));
  const { data, error } = await supabase
    .from("task_attachments").select("*").eq("task_id", taskId).order("created_at");
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

router.post("/:id/attachments", async (c) => {
  const workspaceId = c.get("workspaceId");
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, workspaceId);
  const body = await c.req.json() as { name: string; url: string; mime_type?: string; size?: number };
  const { data, error } = await supabase
    .from("task_attachments")
    .insert({ task_id: taskId, workspace_id: workspaceId, name: body.name, url: body.url, mime_type: body.mime_type, size: body.size, uploaded_by: c.get("userId") })
    .select().single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

/**
 * POST /tasks/:id/upload — real file upload. The UI has always posted multipart here, but the
 * route did not exist: the fetch 404'd into an empty catch, so attaching a file spun and then
 * silently did nothing. Stores the bytes in a PRIVATE bucket under the workspace prefix and
 * records the row; the file is served later through a short-lived signed URL, never publicly.
 */
router.post("/:id/upload", async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, workspaceId);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return c.json({ error: "No file provided." }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) return c.json({ error: "That file is empty." }, 400);
  if (bytes.length > TASK_ATTACH_MAX_BYTES) return c.json({ error: `"${file.name}" is over the 10 MB limit.` }, 413);

  const safeName = (file.name || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  const path = `${workspaceId}/${taskId}/${Date.now()}-${safeName}`;
  const contentType = file.type || "application/octet-stream";
  const { error: upErr } = await supabase.storage.from(TASK_ATTACH_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (upErr) return c.json({ error: `Couldn't store "${safeName}" — ${upErr.message}` }, 500);

  const { data, error } = await supabase
    .from("task_attachments")
    // Requires 20260728_reconcile_task_attachments.sql — production drifted from 0014 and was
    // missing `name`/`mime_type`, which made every attachment write 500.
    .insert({ task_id: taskId, workspace_id: workspaceId, name: safeName, url: path, mime_type: contentType, size: bytes.length, uploaded_by: userId })
    .select().single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

/**
 * GET /tasks/:id/attachments/:attachmentId/download — short-lived signed URL. The stored `url` is a
 * bucket PATH, not a public link, and it must sit under this workspace's prefix.
 */
router.get("/:id/attachments/:attachmentId/download", async (c) => {
  const workspaceId = c.get("workspaceId");
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, workspaceId);
  const { data: row } = await supabase
    .from("task_attachments").select("url")
    .eq("id", c.req.param("attachmentId")).eq("task_id", taskId).eq("workspace_id", workspaceId)
    .maybeSingle();
  const path = row?.url as string | undefined;
  if (!path) return c.json({ error: "Attachment not found." }, 404);
  if (/^https?:\/\//i.test(path)) return c.json({ url: path });   // legacy rows stored a real URL
  if (!path.startsWith(`${workspaceId}/`)) return c.json({ error: "Not allowed." }, 403);
  const { data, error } = await supabase.storage.from(TASK_ATTACH_BUCKET).createSignedUrl(path, 120);
  if (error || !data?.signedUrl) return c.json({ error: "Attachment not found." }, 404);
  return c.json({ url: data.signedUrl });
});

router.delete("/:id/attachments/:attachmentId", async (c) => {
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, c.get("workspaceId"));
  const { error } = await supabase
    .from("task_attachments").delete()
    .eq("id", c.req.param("attachmentId"))
    .eq("uploaded_by", c.get("userId"));
  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});

// ── Views ────────────────────────────────────────────────
router.post("/:id/view", async (c) => {
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, c.get("workspaceId"));
  await supabase.from("task_views").upsert(
    { task_id: taskId, user_id: c.get("userId"), viewed_at: new Date().toISOString() },
    { onConflict: "task_id,user_id" }
  );
  return c.json({ ok: true });
});

router.get("/:id/views", async (c) => {
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, c.get("workspaceId"));
  const { data } = await supabase
    .from("task_views").select("user_id, viewed_at")
    .eq("task_id", taskId).order("viewed_at", { ascending: false });
  const rows = data ?? [];
  // task_views stores only user_id, but the "seen by" avatars need a name. Resolve it from
  // the workspace roster (the UI used to read a user_name that was never returned and threw).
  const ids = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: members } = await supabase
      .from("workspace_members").select("user_id, name, email")
      .eq("workspace_id", c.get("workspaceId")).in("user_id", ids);
    for (const m of members ?? []) names.set(m.user_id, m.name || m.email || "");
  }
  return c.json(rows.map(r => ({ ...r, user_name: names.get(r.user_id) || "" })));
});

// ── Activity ─────────────────────────────────────────────
router.get("/:id/activity", async (c) => {
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, c.get("workspaceId"));
  const { data } = await supabase
    .from("task_activity").select("*")
    .eq("task_id", taskId).order("created_at", { ascending: true });
  return c.json(data ?? []);
});

router.post("/:id/activity", async (c) => {
  const workspaceId = c.get("workspaceId");
  const taskId = c.req.param("id");
  await assertTaskOwnership(taskId, workspaceId);
  const { action, user_name } = await c.req.json() as { action: string; user_name: string };
  const { data, error } = await supabase
    .from("task_activity")
    .insert({ task_id: taskId, workspace_id: workspaceId, user_id: c.get("userId"), user_name, action })
    .select().single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

export { router as taskDetailsRouter };
