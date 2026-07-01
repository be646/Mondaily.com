import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { runWorkflowsForWorkspace } from "../jobs/workflow-engine";
import { planLimits, workspaceTier } from "../lib/plan-limits";

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
    // Tier cap: Scout is limited to 3 automations. Enforce before insert (align account with plan).
    const limits = planLimits(await workspaceTier(workspaceId));
    if (limits.maxAutomations >= 0) {
      const { count } = await supabase
        .from("nodes").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).eq("object_type", "automation");
      if ((count ?? 0) >= limits.maxAutomations) {
        return c.json({ error: `Your plan includes ${limits.maxAutomations} automations. Upgrade to Operator for unlimited.`, upgrade: true }, 403);
      }
    }
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

// Run history (evidence trail): what fired, when, on which record, what it did.
router.get("/:id/runs", async (c) => {
  const id = c.req.param("id");
  if (id === "new") return c.json({ runs: [] });
  const { data: runs } = await supabase
    .from("workflow_runs")
    .select("id,record_id,trigger_key,status,actions,detail,created_at")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("workflow_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  // Resolve record titles so the trail is human-readable, scoped to the workspace.
  const ids = [...new Set((runs ?? []).map((r) => r.record_id).filter(Boolean))];
  const titles = new Map<string, string>();
  if (ids.length) {
    const { data: recs } = await supabase
      .from("nodes").select("id,data,object_type")
      .eq("workspace_id", c.get("workspaceId")).in("id", ids as string[]);
    for (const r of recs ?? []) {
      const d = (r.data ?? {}) as Record<string, unknown>;
      titles.set(r.id, String(d.name ?? d.title ?? d.company ?? r.object_type ?? r.id));
    }
  }
  return c.json({
    runs: (runs ?? []).map((r) => ({ ...r, record_title: titles.get(r.record_id) ?? r.record_id })),
  });
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
