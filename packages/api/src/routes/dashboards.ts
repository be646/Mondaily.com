import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

function unpack(node: { id: string; data: Record<string, unknown>; updated_at: string }) {
  return { id: node.id, ...node.data, updated_at: node.updated_at };
}

router.get("/", async (c) => {
  const { data, error } = await supabase.from("nodes").select("id,data,updated_at").eq("workspace_id", c.get("workspaceId")).eq("object_type", "dashboard").order("updated_at", { ascending: false });
  return error ? c.json({ error: error.message }, 400) : c.json((data ?? []).map((node) => unpack(node as never)));
});

router.post("/", zValidator("json", z.object({ name: z.string().min(1) })), async (c) => {
  const { data, error } = await supabase.from("nodes").insert({ workspace_id: c.get("workspaceId"), vertical: "shared", object_type: "dashboard", data: { name: c.req.valid("json").name, access: "private", widgets: [] }, created_by: c.get("userId") }).select("id,data,updated_at").single();
  if (error) return c.json({ error: error.message }, 400);
  await supabase.from("activities").insert({ node_id: data.id, workspace_id: c.get("workspaceId"), actor_type: "human", actor_id: c.get("userId"), action: "created", diff: { object_type: "dashboard" } });
  return c.json(unpack(data as never), 201);
});

router.get("/:id", async (c) => {
  const { data } = await supabase.from("nodes").select("id,data,updated_at").eq("workspace_id", c.get("workspaceId")).eq("object_type", "dashboard").eq("id", c.req.param("id")).maybeSingle();
  return data ? c.json(unpack(data as never)) : c.json({ error: "Dashboard not found" }, 404);
});

router.patch("/:id", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const { data, error } = await supabase.from("nodes").update({ data: body }).eq("workspace_id", c.get("workspaceId")).eq("object_type", "dashboard").eq("id", c.req.param("id")).select("id,data,updated_at").single();
  if (error) return c.json({ error: error.message }, 400);
  await supabase.from("activities").insert({ node_id: data.id, workspace_id: c.get("workspaceId"), actor_type: "human", actor_id: c.get("userId"), action: "updated", diff: { dashboard: body } });
  return c.json(unpack(data as never));
});

export { router as dashboardsRouter };
