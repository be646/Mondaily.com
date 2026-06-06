import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";

const router = new Hono();
router.get("/", requireAuth, async (c) => c.json({ activities: [] }));
export { router as activitiesRouter };

