import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();

// Timeline for a specific node
router.get("/node/:nodeId", requireAuth, async (c) => {
  const { data } = await supabase
    .from("activities")
    .select("*")
    .eq("node_id", c.req.param("nodeId"))
    .eq("workspace_id", c.get("workspaceId"))
    .order("created_at", { ascending: false })
    .limit(50);
  return c.json(data ?? []);
});

// All activities for workspace (feed)
router.get("/", requireAuth, async (c) => {
  const limit = Number(c.req.query("limit") ?? 50);
  const { data } = await supabase
    .from("activities")
    .select("*, nodes(id, object_type, data)")
    .eq("workspace_id", c.get("workspaceId"))
    .order("created_at", { ascending: false })
    .limit(limit);
  return c.json(data ?? []);
});

export { router as activitiesRouter };
