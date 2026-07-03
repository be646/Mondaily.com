import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { denyViewerWrites } from "../middleware/rbac";
import * as ubc from "@mondaily/db/ubc";
import { supabase } from "@mondaily/db/client";
import { inngest } from "../lib/inngest";
import { createNotification } from "../lib/notify";

/** Deal stage lives in data.deal_stage (fallbacks: stage, status). */
function dealStageOf(data: unknown): string {
  const d = (data ?? {}) as Record<string, unknown>;
  return String(d.deal_stage ?? d.stage ?? d.status ?? "").trim();
}

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();

router.get("/:id/related", requireAuth, async (c) => {
  const id = c.req.param("id");
  const related = await ubc.getRelated(id, c.get("workspaceId"));
  return c.json(related);
});

router.post("/:id/relate", requireAuth, denyViewerWrites, zValidator("json", z.object({
  target_id: z.string(),
  relationship: z.string().default("related"),
})), async (c) => {
  const id = c.req.param("id");
  const { target_id, relationship } = c.req.valid("json");
  await ubc.createEdge(c.get("workspaceId"), id, target_id, relationship);
  await ubc.createEdge(c.get("workspaceId"), target_id, id, relationship);
  return c.json({ ok: true }, 201);
});

router.get("/:id", requireAuth, async (c) => {
  const node = await ubc.getNode(c.req.param("id"), c.get("workspaceId"));
  if (!node) return c.json({ error: "Not found" }, 404);
  return c.json(node);
});

router.get("/", requireAuth, zValidator("query", z.object({
  vertical: z.string().optional(),
  object_type: z.string().optional(),
  limit: z.coerce.number().default(50),
  cursor: z.string().optional()
})), async (c) => {
  const query = c.req.valid("query");
  const nodes = await ubc.listNodes(c.get("workspaceId"), query);
  return c.json(nodes);
});

router.post("/", requireAuth, denyViewerWrites, zValidator("json", z.object({
  vertical: z.enum(["sales", "realestate", "hr", "finance", "investments", "tasks", "shared"]),
  object_type: z.string().min(1),
  data: z.record(z.unknown())
})), async (c) => {
  const body = c.req.valid("json");
  const node = await ubc.createNode({ workspace_id: c.get("workspaceId"), created_by: c.get("userId"), ...body });
  await ubc.logActivity(node.id!, c.get("workspaceId"), "human", c.get("userId"), "created", undefined, `Created ${body.object_type}`);

  // Fire background enrichment (non-blocking — never fails the request)
  inngest.send({
    name: "crm/record.created",
    data: {
      workspaceId: c.get("workspaceId"),
      nodeId: node.id!,
      objectType: body.object_type,
      vertical: body.vertical,
      recordData: body.data,
    },
  }).catch(() => {/* enrichment is best-effort */});

  return c.json(node, 201);
});

router.patch("/:id", requireAuth, denyViewerWrites, zValidator("json", z.object({
  data: z.record(z.unknown()).optional(),
  ai_summary: z.string().optional()
})), async (c) => {
  const updates = c.req.valid("json");
  const workspaceId = c.get("workspaceId");
  const nodeId = c.req.param("id");
  // Capture the previous stage BEFORE updating so we can detect a deal stage move.
  const { data: prev } = await supabase.from("nodes").select("object_type, data").eq("id", nodeId).eq("workspace_id", workspaceId).single();
  const node = await ubc.updateNode(nodeId, workspaceId, updates);
  await ubc.logActivity(node.id!, workspaceId, "human", c.get("userId"), "updated", updates);

  // Deal stage change → real notification, so the bell + "what changed" pick it up.
  try {
    const isDeal = String(node.object_type ?? "").toLowerCase().includes("deal");
    const oldStage = dealStageOf(prev?.data);
    const newStage = dealStageOf(node.data);
    if (isDeal && newStage && oldStage !== newStage) {
      const d = (node.data ?? {}) as Record<string, unknown>;
      const name = String(d.name ?? d.title ?? "A deal");
      await createNotification({
        workspace_id: workspaceId,
        user_id: c.get("userId"),
        title: "Deal stage changed",
        body: `${name} moved${oldStage ? ` from ${oldStage}` : ""} to ${newStage}.`,
        type: "deal_stage",
        // Human-triggered record event (no autonomous agent) — link the record, don't attribute an agent.
        metadata: { from: oldStage || null, to: newStage },
        source: { node_id: node.id, object_type: node.object_type },
      });
    }
  } catch { /* best-effort — never block the update on the notification */ }

  // Real-time automation triggers (record_updated / deal_stage_change).
  inngest.send({
    name: "crm/record.updated",
    data: { workspaceId, nodeId: node.id!, objectType: node.object_type, vertical: node.vertical },
  }).catch(() => {/* best-effort */});
  return c.json(node);
});

router.delete("/:id", requireAuth, denyViewerWrites, async (c) => {
  await ubc.deleteNode(c.req.param("id"), c.get("workspaceId"));
  return c.json({ ok: true });
});

export { router as nodesRouter };
