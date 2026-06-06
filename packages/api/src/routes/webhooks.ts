import { Hono } from "hono";

const router = new Hono();
router.post("/stripe", async (c) => c.json({ ok: true }));
router.post("/clerk", async (c) => c.json({ ok: true }));
router.post("/nylas", async (c) => c.json({ ok: true }));
export { router as webhooksRouter };

