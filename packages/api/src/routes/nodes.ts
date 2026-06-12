import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import * as ubc from "@mondaily/db/ubc";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();

router.get("/:id", requireAuth, async (c) => {
  const node = await ubc.getNode(c.req.param("id"));
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

router.post("/", requireAuth, zValidator("json", z.object({
  vertical: z.enum(["sales", "realestate", "hr", "finance", "investments", "tasks", "shared"]),
  object_type: z.string().min(1),
  data: z.record(z.unknown())
})), async (c) => {
  const body = c.req.valid("json");
  const node = await ubc.createNode({ workspace_id: c.get("workspaceId"), created_by: c.get("userId"), ...body });
  await ubc.logActivity(node.id!, c.get("workspaceId"), "human", c.get("userId"), "created", undefined, `Created ${body.object_type}`);
  return c.json(node, 201);
});

router.patch("/:id", requireAuth, zValidator("json", z.object({
  data: z.record(z.unknown()).optional(),
  ai_summary: z.string().optional()
})), async (c) => {
  const updates = c.req.valid("json");
  const node = await ubc.updateNode(c.req.param("id"), updates);
  await ubc.logActivity(node.id!, c.get("workspaceId"), "human", c.get("userId"), "updated", updates);
  return c.json(node);
});

export { router as nodesRouter };

