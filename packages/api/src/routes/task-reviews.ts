import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

const router = new Hono();
router.use("*", requireAuth);

// GET /:id/reviews - get all review rounds for a task
router.get("/:id/reviews", async (c) => {
  const { data, error } = await supabase
    .from("task_reviews")
    .select("*")
    .eq("task_id", c.req.param("id"))
    .order("round", { ascending: true });
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

// POST /:id/reviews - send task for review (new round)
router.post("/:id/reviews", async (c) => {
  const userId = c.get("userId");
  const workspaceId = c.get("workspaceId");
  const body = await c.req.json() as {
    reviewer_id: string; reviewer_name: string;
    sent_by_name: string; context: string;
  };

  // Get current round count
  const { count } = await supabase
    .from("task_reviews")
    .select("*", { count: "exact", head: true })
    .eq("task_id", c.req.param("id"));

  const round = (count || 0) + 1;

  // Close any pending reviews first
  await supabase.from("task_reviews")
    .update({ status: "completed", action: "reassigned", action_at: new Date().toISOString() })
    .eq("task_id", c.req.param("id"))
    .eq("status", "pending");

  // Create new review round
  const { data, error } = await supabase.from("task_reviews").insert({
    task_id: c.req.param("id"),
    round,
    sent_by_id: userId,
    sent_by_name: body.sent_by_name,
    context: body.context,
    reviewer_id: body.reviewer_id,
    reviewer_name: body.reviewer_name,
    status: "pending"
  }).select().single();

  if (error) return c.json({ error: error.message }, 500);

  // Update task status and reviewer
  await supabase.from("tasks").update({
    status: "review",
    reviewer_id: body.reviewer_id,
    reviewer_name: body.reviewer_name,
    review_result: null
  }).eq("id", c.req.param("id"));

  // Notify reviewer
  await supabase.from("notifications").insert({
    workspace_id: workspaceId,
    user_id: body.reviewer_id,
    title: `Review requested (Round ${round})`,
    body: `${body.sent_by_name} sent you a task for review: "${body.context.slice(0, 60)}${body.context.length > 60 ? "..." : ""}"`,
    type: "review",
    task_id: c.req.param("id"),
    is_read: false
  });

  return c.json(data, 201);
});

// PATCH /:id/reviews/:reviewId - take action on a review
router.patch("/:id/reviews/:reviewId", async (c) => {
  const userId = c.get("userId");
  const workspaceId = c.get("workspaceId");
  const body = await c.req.json() as {
    action: "approved" | "changes_requested" | "reassigned";
    action_note?: string;
    reviewer_name: string;
    owner_id: string;
    // For reassign
    new_reviewer_id?: string;
    new_reviewer_name?: string;
    sent_by_name?: string;
    context?: string;
  };

  // Complete this review round
  const { data: review } = await supabase.from("task_reviews")
    .update({
      action: body.action,
      action_note: body.action_note || null,
      action_at: new Date().toISOString(),
      status: "completed"
    })
    .eq("id", c.req.param("reviewId"))
    .select().single();

  // Post auto-comment
  let commentText = "";
  if (body.action === "approved") {
    commentText = `Task approved by ${body.reviewer_name}.${body.action_note ? `\n\nNote: ${body.action_note}` : ""}`;
  } else if (body.action === "changes_requested") {
    commentText = `Changes requested by ${body.reviewer_name}.\n\n${body.action_note || "Please review and update before resubmitting."}`;
  } else if (body.action === "reassigned") {
    commentText = `Review reassigned by ${body.reviewer_name} to ${body.new_reviewer_name}.${body.action_note ? `\n\nNote: ${body.action_note}` : ""}`;
  }

  // Log review action as activity
  if (commentText) {
    await supabase.from("task_activity").insert({
      task_id: c.req.param("id"),
      user_id: userId,
      user_name: body.reviewer_name,
      action: body.action === "approved" ? `approved the task${body.action_note ? `: "${body.action_note}"` : ""}` :
              body.action === "changes_requested" ? `requested changes: "${body.action_note || "please review and update"}"` :
              `reassigned review to ${body.new_reviewer_name}`
    });
  }

  // Update task based on action
  if (body.action === "approved") {
    await supabase.from("tasks").update({
      review_result: "approved",
      reviewed_at: new Date().toISOString(),
      status: "done",
      labels: []
    }).eq("id", c.req.param("id"));
  } else if (body.action === "changes_requested") {
    await supabase.from("tasks").update({
      status: "in_progress",
      review_result: "changes_requested",
      reviewer_id: null,
      reviewer_name: null,
      reviewed_at: new Date().toISOString()
    }).eq("id", c.req.param("id"));
  } else if (body.action === "reassigned" && body.new_reviewer_id) {
    // Create new round for reassigned reviewer
    const { count } = await supabase.from("task_reviews")
      .select("*", { count: "exact", head: true })
      .eq("task_id", c.req.param("id"));

    await supabase.from("task_reviews").insert({
      task_id: c.req.param("id"),
      round: (count || 0) + 1,
      sent_by_id: userId,
      sent_by_name: body.reviewer_name,
      context: body.context || "",
      reviewer_id: body.new_reviewer_id,
      reviewer_name: body.new_reviewer_name || "",
      status: "pending"
    });

    await supabase.from("tasks").update({
      reviewer_id: body.new_reviewer_id,
      reviewer_name: body.new_reviewer_name
    }).eq("id", c.req.param("id"));

    // Notify new reviewer
    await supabase.from("notifications").insert({
      workspace_id: workspaceId,
      user_id: body.new_reviewer_id,
      title: "Review reassigned to you",
      body: `${body.reviewer_name} reassigned a task review to you`,
      type: "review",
      task_id: c.req.param("id"),
      is_read: false
    });
  }

  // Notify task owner
  if (body.action !== "reassigned") {
    await supabase.from("notifications").insert({
      workspace_id: workspaceId,
      user_id: body.owner_id,
      title: body.action === "approved" ? "Task Approved" : "Changes Requested",
      body: body.action === "approved"
        ? `${body.reviewer_name} approved your task`
        : `${body.reviewer_name} requested changes: ${(body.action_note || "").slice(0, 80)}`,
      type: "review",
      task_id: c.req.param("id"),
      is_read: false
    });
  }

  return c.json(review);
});

export { router as taskReviewsRouter };
