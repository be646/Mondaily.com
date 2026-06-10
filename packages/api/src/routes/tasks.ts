import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

const tasks = new Hono();
tasks.use("*", requireAuth);

tasks.get("/", async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const filter = c.req.query("filter") || "mine";

  let query = supabase
    .from("tasks")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (filter === "mine") query = query.or(`assignee_id.eq.${userId},assignee_id.is.null`);
  if (filter === "overdue") query = query.lt("due_date", new Date().toISOString()).eq("completed", false);
  if (filter === "review") query = query.eq("status", "review");

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

tasks.post("/", async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const body = await c.req.json();

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      workspace_id: workspaceId,
      title: body.title,
      assignee_id: body.assignee_id || userId,
      assignee_email: body.assignee_email || null,
      completed: false,
      due_date: body.due_date || null,
      record_id: body.record_id || null,
      priority: body.priority || "medium",
      status: body.status || "todo",
      notes: body.notes || null,
    })
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

tasks.patch("/:id", async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json();

  // Extract meta fields before saving
  const userName = body._user_name || "Someone";
  const { _user_name, ...updateBody } = body;

  // Get old values for activity logging
  const { data: oldTask } = await supabase.from("tasks").select("status,priority,assignee_id,assignee_email").eq("id", id).single();

  const { data, error } = await supabase
    .from("tasks")
    .update(updateBody)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);

  // Log activity
  const statusLabels: Record<string,string> = { todo: "To Do", in_progress: "In Progress", review: "Needs Review", done: "Done" };
  const priorityLabels: Record<string,string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
  const activities: string[] = [];

  if (updateBody.status && oldTask?.status !== updateBody.status)
    activities.push(`changed status to ${statusLabels[updateBody.status] || updateBody.status}`);
  if (updateBody.priority && oldTask?.priority !== updateBody.priority)
    activities.push(`changed priority to ${priorityLabels[updateBody.priority] || updateBody.priority}`);
  if (updateBody.assignee_id !== undefined && oldTask?.assignee_id !== updateBody.assignee_id)
    activities.push(updateBody.assignee_id ? `assigned task to ${updateBody.assignee_email || updateBody.assignee_id}` : "removed assignee");
  if (updateBody.due_date !== undefined)
    activities.push(updateBody.due_date ? `set due date to ${new Date(updateBody.due_date).toLocaleDateString()}` : "removed due date");
  if (updateBody.completed === true)
    activities.push("marked task as complete");
  if (updateBody.completed === false)
    activities.push("reopened this task");

  for (const action of activities) {
    await supabase.from("task_activity").insert({ task_id: id, user_id: userId, user_name: userName, action });
  }

  return c.json(data);
});

tasks.delete("/:id", async (c) => {
  const workspaceId = c.get("workspaceId");
  const id = c.req.param("id");

  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});

// PATCH /:id/review-action - approve or request changes
tasks.patch("/:id/review-action", async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const { action, reviewer_name, owner_id, note } = await c.req.json() as { action: "approved" | "changes_requested"; reviewer_name: string; owner_id: string; note?: string };

  const updates: Record<string, any> = {
    review_result: action,
    reviewer_id: userId,
    reviewer_name,
    reviewed_at: new Date().toISOString(),
  };

  if (action === "approved") {
    updates.status = "review";
    updates.labels = [];
  } else {
    updates.status = "in_progress";
    updates.labels = [];
    updates.reviewer_id = null;
    updates.reviewer_name = null;
    updates.review_result = null;
  }

  const { data, error } = await supabase
    .from("tasks").update(updates)
    .eq("id", c.req.param("id"))
    .eq("workspace_id", workspaceId)
    .select().single();

  if (error) return c.json({ error: error.message }, 500);

  // Auto-comment on the task
  const commentText = action === "approved"
    ? `✅ Task approved by ${reviewer_name}.`
    : `🔄 Changes requested by ${reviewer_name}:\n\n${note || "Please review and update the task before resubmitting."}`;

  await supabase.from("task_comments").insert({
    task_id: c.req.param("id"),
    user_id: userId,
    user_name: reviewer_name,
    content: commentText
  });

  // Notify task owner
  const msg = action === "approved"
    ? `${reviewer_name} approved your task`
    : `${reviewer_name} requested changes on your task`;

  await supabase.from("notifications").insert({
    workspace_id: workspaceId,
    user_id: owner_id,
    title: action === "approved" ? "Task Approved ✅" : "Changes Requested 🔄",
    body: msg,
    type: "review",
    task_id: c.req.param("id"),
    is_read: false
  });

  return c.json(data);
});

export default tasks;
