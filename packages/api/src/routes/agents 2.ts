import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();
router.get("/", requireAuth, async (c) => c.json({ jobs: [] }));
export { router as agentsRouter };

