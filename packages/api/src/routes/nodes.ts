import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { denyViewerWrites } from "../middleware/rbac";
import * as ubc from "@mondaily/db/ubc";
import { inngest } from "../lib/inngest";

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
  const node = await ubc.updateNode(c.req.param("id"), c.get("workspaceId"), updates);
  await ubc.logActivity(node.id!, c.get("workspaceId"), "human", c.get("userId"), "updated", updates);
  return c.json(node);
});

router.delete("/:id", requireAuth, denyViewerWrites, async (c) => {
  await ubc.deleteNode(c.req.param("id"), c.get("workspaceId"));
  return c.json({ ok: true });
});

export { router as nodesRouter };
