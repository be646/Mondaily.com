import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();
router.use("*", requireAuth);

// GET /chats - list all threads for user
router.get("/", async (c) => {
  const { data, error } = await supabase
    .from("chat_threads")
    .select("id, title, updated_at, messages")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("user_id", c.get("userId"))
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

// POST /chats - create new thread
router.post("/", async (c) => {
  const body = await c.req.json() as { title: string; messages?: unknown[] };
  const { data, error } = await supabase
    .from("chat_threads")
    .insert({
      workspace_id: c.get("workspaceId"),
      user_id: c.get("userId"),
      title: body.title.slice(0, 45),
      messages: body.messages ?? []
    })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

// PATCH /chats/:id - upsert thread by client-provided id.
// UPSERT (not update) is critical: the frontend generates the thread id
// locally, so the first sync must CREATE the row with that exact id. A plain
// update missed every time and the client then POSTed a brand-new chat per
// message — which is what produced dozens of duplicate threads in history.
router.patch("/:id", async (c) => {
  const body = await c.req.json() as { title?: string; messages?: unknown[] };
  const id = c.req.param("id");
  const { data, error } = await supabase
    .from("chat_threads")
    .upsert({
      id,
      workspace_id: c.get("workspaceId"),
      user_id: c.get("userId"),
      title: (body.title ?? "Chat").slice(0, 45),
      messages: body.messages ?? [],
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// DELETE /chats/:id
router.delete("/:id", async (c) => {
  const { error } = await supabase
    .from("chat_threads")
    .delete()
    .eq("id", c.req.param("id"))
    .eq("user_id", c.get("userId"));
  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});

export { router as chatsRouter };
