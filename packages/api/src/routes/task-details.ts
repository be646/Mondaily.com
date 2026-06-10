import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

const router = new Hono();
router.use("*", requireAuth);

// ── Labels ──────────────────────────────────────────────
router.patch("/:id/labels", async (c) => {
  const { labels } = await c.req.json() as { labels: string[] };
  const { data, error } = await supabase
    .from("tasks").update({ labels, status: labels.includes("Need Review") ? "review" : undefined })
    .eq("id", c.req.param("id")).select().single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// ── Assignees ────────────────────────────────────────────
router.get("/:id/assignees", async (c) => {
  const { data, error } = await supabase
    .from("task_assignees").select("*").eq("task_id", c.req.param("id"));
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

router.post("/:id/assignees", async (c) => {
  const body = await c.req.json() as { user_id: string; email: string; name: string; permission: string };
  const { data, error } = await supabase
    .from("task_assignees")
    .upsert({ task_id: c.req.param("id"), ...body }, { onConflict: "task_id,user_id" })
    .select().single();
  if (error) return c.json({ error: error.message }, 500);
  await supabase.from("task_activity").insert({ task_id: c.req.param("id"), user_id: c.get("userId"), user_name: body.name || body.email, action: `was added as collaborator` });
  return c.json(data);
});

router.delete("/:id/assignees/:userId", async (c) => {
  const { error } = await supabase
    .from("task_assignees")
    .delete().eq("task_id", c.req.param("id")).eq("user_id", c.req.param("userId"));
  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});

// ── Checklist ────────────────────────────────────────────
router.get("/:id/checklist", async (c) => {
  const { data, error } = await supabase
    .from("task_checklist").select("*").eq("task_id", c.req.param("id")).order("created_at");
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

router.post("/:id/checklist", async (c) => {
  const body = await c.req.json() as { text: string; added_by_name: string };
  const { data, error } = await supabase
    .from("task_checklist")
    .insert({ task_id: c.req.param("id"), text: body.text, added_by_user_id: c.get("userId"), added_by_name: body.added_by_name })
    .select().single();
  if (error) return c.json({ error: error.message }, 500);
  await supabase.from("task_activity").insert({ task_id: c.req.param("id"), user_id: c.get("userId"), user_name: body.added_by_name, action: `added checklist item: "${body.text}"` });
  return c.json(data, 201);
});

router.patch("/:id/checklist/:itemId", async (c) => {
  const body = await c.req.json() as { completed: boolean; _user_name?: string };
  const { _user_name, ...updateBody } = body;
  const { data, error } = await supabase
    .from("task_checklist").update(updateBody).eq("id", c.req.param("itemId")).select().single();
  if (error) return c.json({ error: error.message }, 500);
  if (body.completed !== undefined) {
    const userId = c.get("userId");
    const userName = _user_name || "Someone";
    await supabase.from("task_activity").insert({ task_id: c.req.param("id"), user_id: userId, user_name: userName, action: body.completed ? `completed: "${data?.text}"` : `unchecked: "${data?.text}"` });
  }
  return c.json(data);
});

router.delete("/:id/checklist/:itemId", async (c) => {
  const { error } = await supabase
    .from("task_checklist").delete().eq("id", c.req.param("itemId"));
  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});

// ── Comments ─────────────────────────────────────────────
router.get("/:id/comments", async (c) => {
  const { data, error } = await supabase
    .from("task_comments").select("*").eq("task_id", c.req.param("id")).order("created_at");
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

router.post("/:id/comments", async (c) => {
  const body = await c.req.json() as { content: string; user_name: string };
  const { data, error } = await supabase
    .from("task_comments")
    .insert({ task_id: c.req.param("id"), user_id: c.get("userId"), user_name: body.user_name, content: body.content })
    .select().single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

router.delete("/:id/comments/:commentId", async (c) => {
  const { error } = await supabase
    .from("task_comments").delete().eq("id", c.req.param("commentId")).eq("user_id", c.get("userId"));
  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});

// ── Attachments ──────────────────────────────────────────
router.get("/:id/attachments", async (c) => {
  const { data, error } = await supabase
    .from("task_attachments").select("*").eq("task_id", c.req.param("id")).order("created_at");
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

router.post("/:id/attachments", async (c) => {
  const body = await c.req.json() as { file_name: string; file_url: string; file_type: string; file_size: number; user_name: string };
  const { data, error } = await supabase
    .from("task_attachments")
    .insert({ task_id: c.req.param("id"), user_id: c.get("userId"), user_name: body.user_name, file_name: body.file_name, file_url: body.file_url, file_type: body.file_type, file_size: body.file_size })
    .select().single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

router.delete("/:id/attachments/:attachmentId", async (c) => {
  const { error } = await supabase
    .from("task_attachments").delete().eq("id", c.req.param("attachmentId")).eq("user_id", c.get("userId"));
  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});

// ── File Upload ──────────────────────────────────────────
router.post("/:id/upload", async (c) => {
  const taskId = c.req.param("id");
  const userId = c.get("userId");
  const formData = await c.req.formData();
  const file = formData.get("file") as File;
  const userName = formData.get("user_name") as string || "Unknown";

  if (!file) return c.json({ error: "No file provided" }, 400);

  const fileExt = file.name.split(".").pop() || "bin";
  const filePath = `${taskId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from("task-attachments")
    .upload(filePath, arrayBuffer, { contentType: file.type });

  if (uploadError) return c.json({ error: uploadError.message }, 500);

  const { data: urlData } = supabase.storage
    .from("task-attachments")
    .getPublicUrl(filePath);

  const { data, error } = await supabase
    .from("task_attachments")
    .insert({
      task_id: taskId,
      user_id: userId,
      user_name: userName,
      file_name: file.name,
      file_url: urlData.publicUrl,
      file_type: file.type,
      file_size: file.size
    })
    .select().single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

// ── Views ────────────────────────────────────────────────
router.post("/:id/view", async (c) => {
  const { user_name } = await c.req.json() as { user_name: string };
  await supabase.from("task_views").upsert({
    task_id: c.req.param("id"),
    user_id: c.get("userId"),
    user_name,
    viewed_at: new Date().toISOString()
  }, { onConflict: "task_id,user_id" });
  return c.json({ ok: true });
});

router.get("/:id/views", async (c) => {
  const { data } = await supabase
    .from("task_views").select("user_id, user_name, viewed_at")
    .eq("task_id", c.req.param("id"))
    .order("viewed_at", { ascending: false });
  return c.json(data ?? []);
});

// ── Comment Reactions ─────────────────────────────────────
router.get("/:id/comments/:commentId/reactions", async (c) => {
  const { data } = await supabase
    .from("task_comment_reactions").select("*")
    .eq("comment_id", c.req.param("commentId"));
  return c.json(data ?? []);
});

router.post("/:id/comments/:commentId/reactions", async (c) => {
  const { emoji, user_name } = await c.req.json() as { emoji: string; user_name: string };
  const existing = await supabase.from("task_comment_reactions")
    .select("id").eq("comment_id", c.req.param("commentId"))
    .eq("user_id", c.get("userId")).eq("emoji", emoji).maybeSingle();
  if (existing.data) {
    await supabase.from("task_comment_reactions").delete().eq("id", existing.data.id);
    return c.json({ removed: true });
  }
  const { data, error } = await supabase.from("task_comment_reactions")
    .insert({ comment_id: c.req.param("commentId"), user_id: c.get("userId"), user_name, emoji })
    .select().single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// ── Activity ─────────────────────────────────────────────
router.get("/:id/activity", async (c) => {
  const { data } = await supabase
    .from("task_activity")
    .select("*")
    .eq("task_id", c.req.param("id"))
    .order("created_at", { ascending: true });
  return c.json(data ?? []);
});

router.post("/:id/activity", async (c) => {
  const { action, user_name } = await c.req.json() as { action: string; user_name: string };
  const { data, error } = await supabase.from("task_activity").insert({
    task_id: c.req.param("id"),
    user_id: c.get("userId"),
    user_name,
    action
  }).select().single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

export { router as taskDetailsRouter };
