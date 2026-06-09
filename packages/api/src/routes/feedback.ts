import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

const router = new Hono();
router.use("*", requireAuth);

router.post("/", zValidator("json", z.object({
  message: z.string(),
  response: z.string(),
  rating: z.union([z.literal(1), z.literal(-1)]),
  thread_id: z.string().optional()
})), async (c) => {
  const body = c.req.valid("json");
  const { error } = await supabase.from("ai_feedback").insert({
    workspace_id: c.get("workspaceId"),
    user_id: c.get("userId"),
    ...body
  });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

export { router as feedbackRouter };
