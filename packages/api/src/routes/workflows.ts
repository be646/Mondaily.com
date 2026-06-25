import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { runWorkflowsForWorkspace } from "../jobs/workflow-engine";

type Variables = { userId: string; workspaceId: string; role: string };
type WorkflowData = Record<string, unknown> & { name?: string; status?: string; nodes?: Record<string, unknown>[] };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

async function getWorkflow(workspaceId: string, id: string) {
  const { data } = await supabase
    .from("nodes")
    .select("id,data,updated_at")
    .eq("workspace_id", workspaceId)
    .eq("object_type", "automation")
    .eq("data->>type", "workflow")
    .eq("id", id)
    .maybeSingle();
  return data;
}

function response(node: { id: string; data: WorkflowData; updated_at?: string }) {
  return {
    id: node.id,
    name: node.data.name ?? "Untitled workflow",
    status: node.data.status ?? "draft",
    nodes: Array.isArray(node.data.nodes) ? node.data.nodes : [],
    updated_at: node.updated_at,
  };
}

router.get("/:id", async (c) => {
  if (c.req.param("id") === "new") {
    return c.json({ id: "new", name: "New Workflow", status: "draft", nodes: [] });
  }
  const node = await getWorkflow(c.get("workspaceId"), c.req.param("id"));
  return node ? c.json(response(node as never)) : c.json({ error: "Workflow not found" }, 404);
});

router.patch("/:id", async (c) => {
  const body = await c.req.json<WorkflowData>();
  const workspaceId = c.get("workspaceId");
  let result;

  if (c.req.param("id") === "new") {
    result = await supabase
      .from("nodes")
      .insert({
        workspace_id: workspaceId,
        vertical: "shared",
        object_type: "automation",
        data: { ...body, type: "workflow" },
        created_by: c.get("userId"),
      })
      .select("id,data,updated_at")
      .single();
  } else {
    result = await supabase
      .from("nodes")
      .update({ data: { ...body, type: "workflow" } })
      .eq("workspace_id", workspaceId)
      .eq("object_type", "automation")
      .eq("id", c.req.param("id"))
      .select("id,data,updated_at")
      .single();
  }

  if (result.error) return c.json({ error: result.error.message }, 400);
  await supabase.from("activities").insert({
    node_id: result.data.id,
    workspace_id: workspaceId,
    actor_type: "human",
    actor_id: c.get("userId"),
    action: c.req.param("id") === "new" ? "created" : "updated",
    diff: { workflow: true },
  });
  return c.json(response(result.data as never));
});

/**
 * Run a workflow now — executes its trigger -> condition -> action logic
 * against current records. Safe actions run; risky ones queue for approval.
 */
router.post("/:id/run", async (c) => {
  const id = c.req.param("id");
  if (id === "new") return c.json({ error: "Save the workflow before running it." }, 400);
  try {
    const summary = await runWorkflowsForWorkspace(c.get("workspaceId"), { workflowId: id });
    return c.json({ ran: true, ...summary });
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

router.delete("/:id", async (c) => {
  const { error } = await supabase
    .from("nodes")
    .delete()
    .eq("workspace_id", c.get("workspaceId"))
    .eq("object_type", "automation")
    .eq("id", c.req.param("id"));
  return error ? c.json({ error: error.message }, 400) : c.json({ ok: true });
});

export { router as workflowsRouter };
