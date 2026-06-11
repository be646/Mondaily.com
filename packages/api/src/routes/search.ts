import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import * as ubc from "@mondaily/db/ubc";
import { supabase } from "@mondaily/db/client";

const router = new Hono();

router.post("/", requireAuth, zValidator("json", z.object({
  query: z.string().min(1),
  verticals: z.array(z.string()).optional(),
  object_types: z.array(z.string()).optional(),
  limit: z.number().max(50).default(20)
})), async (c) => {
  const body = c.req.valid("json");
  const workspaceId = c.get("workspaceId");

  const [nodeResults, taskResults, noteResults] = await Promise.all([
    ubc.searchNodes(workspaceId, body.query, {
      verticals: body.verticals,
      objectTypes: body.object_types,
      limit: body.limit
    }).catch(() => []),
    supabase.from("tasks")
      .select("id, title, priority, status, due_date, updated_at")
      .eq("workspace_id", workspaceId)
      .ilike("title", `%${body.query}%`)
      .limit(10),
    supabase.from("activities")
      .select("id, node_id, action, created_at")
      .eq("workspace_id", workspaceId)
      .ilike("action", `%${body.query}%`)
      .limit(5)
  ]);

  const ids = (nodeResults as any[]).flatMap((result: any) => result.id ? [result.id] : []);
  const { data: activities } = ids.length
    ? await supabase.from("activities").select("node_id,created_at").in("node_id", ids).order("created_at", { ascending: false })
    : { data: [] };
  const latest = new Map<string, string>();
  for (const activity of activities ?? []) if (!latest.has(activity.node_id)) latest.set(activity.node_id, activity.created_at);

  const crmResults = (nodeResults as any[]).map((result: any) => ({ ...result, last_activity_at: result.id ? latest.get(result.id) : undefined }));

  const taskItems = (taskResults.data ?? []).map((t: any) => ({
    id: t.id,
    object_type: "task",
    data: { name: t.title, status: t.status, priority: t.priority, due_date: t.due_date },
    updated_at: t.updated_at
  }));

  return c.json([...crmResults, ...taskItems]);
});

export { router as searchRouter };
