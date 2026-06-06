import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import * as ubc from "@mondaily/db/ubc";

const router = new Hono();

router.post("/", requireAuth, zValidator("json", z.object({
  query: z.string().min(1),
  verticals: z.array(z.string()).optional(),
  object_types: z.array(z.string()).optional(),
  limit: z.number().max(50).default(20)
})), async (c) => {
  const body = c.req.valid("json");
  const results = await ubc.searchNodes(c.get("workspaceId"), body.query, {
    verticals: body.verticals,
    objectTypes: body.object_types,
    limit: body.limit
  });
  return c.json(results);
});

export { router as searchRouter };

