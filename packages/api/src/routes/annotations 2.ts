import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

function unpack(node: { id: string; data: Record<string, unknown>; created_at?: string; updated_at: string }) {
  return { id: node.id, ...node.data, updated_at: node.updated_at };
}

router.get("/", zValidator("query", z.object({ object_type: z.string().optional() })), async (c) => {
  let q = supabase
    .from("nodes")
    .select("id,data,updated_at")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("object_type", "chart_annotation")
    .order("updated_at", { ascending: false });

  const { object_type } = c.req.valid("query");
  if (object_type) q = q.eq("data->>source_object", object_type);

  const { data, error } = await q;
  return error ? c.json({ error: error.message }, 400) : c.json((data ?? []).map(n => unpack(n as never)));
});

router.post("/", zValidator("json", z.object({
  source_object: z.string().min(1),
  bucket_label:  z.string().min(1),
  text:          z.string().min(1),
  color:         z.string().default("#f59e0b"),
})), async (c) => {
  const body = c.req.valid("json");
  const { data, error } = await supabase
    .from("nodes")
    .insert({
      workspace_id: c.get("workspaceId"),
      vertical: "shared",
      object_type: "chart_annotation",
      data: body,
      created_by: c.get("userId"),
    })
    .select("id,data,updated_at")
    .single();
  return error ? c.json({ error: error.message }, 400) : c.json(unpack(data as never), 201);
});

router.delete("/:id", async (c) => {
  const { error } = await supabase
    .from("nodes")
    .delete()
    .eq("workspace_id", c.get("workspaceId"))
    .eq("object_type", "chart_annotation")
    .eq("id", c.req.param("id"));
  return error ? c.json({ error: error.message }, 400) : c.json({ ok: true });
});

export { router as annotationsRouter };
