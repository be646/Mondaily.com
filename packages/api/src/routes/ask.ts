import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";

const router = new Hono();

router.post("/stream", requireAuth, zValidator("json", z.object({
  message: z.string().min(1),
  thread_id: z.string().uuid().optional()
})), async (c) => {
  const { message } = c.req.valid("json");
  return c.json({
    ok: true,
    message: `Ask Mondaily streaming endpoint scaffolded. Received: ${message}`
  });
});

router.get("/threads", requireAuth, async (c) => c.json([]));

export { router as askRouter };

