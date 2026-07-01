import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { denyViewerWrites } from "../middleware/rbac";

type Variables = { userId: string; workspaceId: string; role: string };
type NoteEvent = {
  id: string;
  node_id: string;
  actor_id: string | null;
  actor_type: string;
  action: string;
  diff: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  nodes: { id: string; object_type: string; data: Record<string, unknown> } | null;
};

const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);
router.use("*", denyViewerWrites); // viewers are read-only

const noteBody = z.object({
  content: z.string().min(1),
  node_id: z.string().uuid()
});

async function getRootNote(workspaceId: string, id: string) {
  const { data } = await supabase
    .from("activities")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .eq("action", "note")
    .maybeSingle();
  return data;
}

router.get("/", zValidator("query", z.object({
  filter: z.enum(["all", "mine", "following"]).default("all"),
  sort: z.enum(["newest", "oldest", "updated"]).default("newest"),
  search: z.string().default(""),
  node_id: z.string().uuid().optional()
})), async (c) => {
  const input = c.req.valid("query");
  let query = supabase
    .from("activities")
    .select("id,node_id,actor_id,actor_type,action,diff,metadata,created_at,nodes(id,object_type,data)")
    .eq("workspace_id", c.get("workspaceId"))
    .in("action", ["note", "note_edited", "note_deleted"])
    .order("created_at", { ascending: true });
  if (input.node_id) query = query.eq("node_id", input.node_id);
  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 400);

  const notes = new Map<string, {
    id: string;
    node_id: string;
    content: string;
    author_id: string | null;
    author_name: string;
    actor_type: string;
    created_at: string;
    updated_at: string;
    deleted: boolean;
    reactions: Record<string, number>;
    reply_count: number;
    followers: string[];
    record: { id: string; object_type: string; name: string };
  }>();

  for (const event of (data ?? []) as unknown as NoteEvent[]) {
    if (event.action === "note") {
      notes.set(event.id, {
        id: event.id,
        node_id: event.node_id,
        content: String(event.diff?.content ?? ""),
        author_id: event.actor_id,
        author_name: String(event.metadata?.author_name ?? (event.actor_type === "ai_agent" ? "Mondaily AI" : "Workspace member")),
        actor_type: event.actor_type,
        created_at: event.created_at,
        updated_at: event.created_at,
        deleted: false,
        reactions: (event.metadata?.reactions as Record<string, number>) ?? {},
        reply_count: Number(event.metadata?.reply_count ?? 0),
        followers: (event.metadata?.followers as string[]) ?? [],
        record: {
          id: event.nodes?.id ?? event.node_id,
          object_type: event.nodes?.object_type ?? "record",
          name: String(event.nodes?.data?.name ?? event.nodes?.data?.title ?? "Linked record")
        }
      });
      continue;
    }
    const rootId = String(event.metadata?.note_id ?? "");
    const note = notes.get(rootId);
    if (!note) continue;
    if (event.action === "note_deleted") note.deleted = true;
    if (event.action === "note_edited") {
      note.content = String(event.diff?.content ?? note.content);
      note.updated_at = event.created_at;
    }
  }

  const search = input.search.trim().toLowerCase();
  const result = [...notes.values()]
    .filter((note) => !note.deleted)
    .filter((note) => input.filter !== "mine" || note.author_id === c.get("userId"))
    .filter((note) => input.filter !== "following" || note.followers.includes(c.get("userId")))
    .filter((note) => !search || `${note.content} ${note.record.name}`.toLowerCase().includes(search))
    .sort((a, b) => {
      const left = new Date(input.sort === "updated" ? a.updated_at : a.created_at).getTime();
      const right = new Date(input.sort === "updated" ? b.updated_at : b.created_at).getTime();
      return input.sort === "oldest" ? left - right : right - left;
    });
  return c.json(result);
});

router.post("/", zValidator("json", noteBody), async (c) => {
  const body = c.req.valid("json");
  const { data: node } = await supabase.from("nodes").select("id").eq("workspace_id", c.get("workspaceId")).eq("id", body.node_id).maybeSingle();
  if (!node) return c.json({ error: "Linked record not found" }, 404);
  const { data, error } = await supabase.from("activities").insert({
    node_id: body.node_id,
    workspace_id: c.get("workspaceId"),
    actor_type: "human",
    actor_id: c.get("userId"),
    action: "note",
    diff: { content: body.content },
    metadata: { reactions: {}, reply_count: 0 }
  }).select().single();
  return error ? c.json({ error: error.message }, 400) : c.json(data, 201);
});

router.patch("/:id", zValidator("json", z.object({ content: z.string().min(1) })), async (c) => {
  const root = await getRootNote(c.get("workspaceId"), c.req.param("id"));
  if (!root) return c.json({ error: "Note not found" }, 404);
  if (root.actor_id !== c.get("userId") && !["owner", "admin"].includes(c.get("role"))) return c.json({ error: "Forbidden" }, 403);
  const { data, error } = await supabase.from("activities").insert({
    node_id: root.node_id,
    workspace_id: c.get("workspaceId"),
    actor_type: "human",
    actor_id: c.get("userId"),
    action: "note_edited",
    diff: c.req.valid("json"),
    metadata: { note_id: root.id }
  }).select().single();
  return error ? c.json({ error: error.message }, 400) : c.json(data);
});

router.delete("/:id", async (c) => {
  const root = await getRootNote(c.get("workspaceId"), c.req.param("id"));
  if (!root) return c.json({ error: "Note not found" }, 404);
  if (root.actor_id !== c.get("userId") && !["owner", "admin"].includes(c.get("role"))) return c.json({ error: "Forbidden" }, 403);
  const { error } = await supabase.from("activities").insert({
    node_id: root.node_id,
    workspace_id: c.get("workspaceId"),
    actor_type: "human",
    actor_id: c.get("userId"),
    action: "note_deleted",
    metadata: { note_id: root.id }
  });
  return error ? c.json({ error: error.message }, 400) : c.json({ ok: true });
});

export { router as notesRouter };
