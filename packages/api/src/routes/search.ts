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
  const ids = results.flatMap((result) => result.id ? [result.id] : []);
  const { data: activities } = ids.length
    ? await import("@mondaily/db/client").then(({ supabase }) => supabase.from("activities").select("node_id,created_at").in("node_id", ids).order("created_at", { ascending: false }))
    : { data: [] };
  const latest = new Map<string, string>();
  for (const activity of activities ?? []) if (!latest.has(activity.node_id)) latest.set(activity.node_id, activity.created_at);
  return c.json(results.map((result) => ({ ...result, last_activity_at: result.id ? latest.get(result.id) : undefined })));
});

export { router as searchRouter };
