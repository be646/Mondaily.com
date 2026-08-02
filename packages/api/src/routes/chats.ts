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
  const ws = c.get("workspaceId");
  const me = c.get("userId");

  // OWNERSHIP CHECK — an upsert conflicts on `id` ALONE, so the .eq() filters that protect every
  // other handler in this file do not apply to it. Without this, a request carrying someone else's
  // thread id overwrites that row: their messages are replaced and user_id/workspace_id are
  // rewritten to the caller's, so the thread changes hands silently. Ids are client-generated,
  // which is exactly why the row must be checked before it is written.
  const { data: existing } = await supabase
    .from("chat_threads").select("user_id, workspace_id").eq("id", id).maybeSingle();
  if (existing && (existing.user_id !== me || existing.workspace_id !== ws)) {
    return c.json({ error: "Not found" }, 404);
  }

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
  // Partition by BOTH user_id AND workspace_id — a user in multiple workspaces
  // must not be able to delete a thread that belongs to a different workspace
  // than the one they presented in X-Workspace-Id.
  const { error } = await supabase
    .from("chat_threads")
    .delete()
    .eq("id", c.req.param("id"))
    .eq("user_id", c.get("userId"))
    .eq("workspace_id", c.get("workspaceId"));
  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});

export { router as chatsRouter };
