import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";

type Variables = { userId: string; workspaceId: string; role: string };
type WorkspaceSettings = {
  nylas_grant_id?: string;
  integrations?: Record<string, boolean | { connected?: boolean; grant_id?: string; email?: string }>;
};

const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

async function getSettings(workspaceId: string) {
  const { data } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).single();
  return (data?.settings ?? {}) as WorkspaceSettings;
}

function getGrantId(settings: WorkspaceSettings) {
  if (settings.nylas_grant_id) return settings.nylas_grant_id;
  for (const provider of ["gmail", "outlook"]) {
    const integration = settings.integrations?.[provider];
    if (typeof integration === "object" && integration.grant_id) return integration.grant_id;
  }
}

async function nylasRequest<T>(grantId: string, path: string, init?: RequestInit): Promise<T> {
  if (!process.env.NYLAS_API_KEY) throw new Error("NYLAS_API_KEY is not configured");
  const response = await fetch(`https://api.us.nylas.com/v3/grants/${grantId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.NYLAS_API_KEY}`,
      "Content-Type": "application/json",
      ...init?.headers
    }
  });
  if (!response.ok) throw new Error(`Nylas request failed (${response.status}): ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function localThreads(workspaceId: string) {
  const { data } = await supabase.from("nodes").select("id,data,updated_at").eq("workspace_id", workspaceId).eq("object_type", "email_thread").order("updated_at", { ascending: false }).limit(50);
  return (data ?? []).map((node) => ({
    id: String(node.data.thread_id ?? node.id),
    subject: String(node.data.subject ?? "(no subject)"),
    snippet: String(node.data.snippet ?? node.data.preview ?? ""),
    participants: Array.isArray(node.data.participants) ? node.data.participants : [],
    latest_message_received_date: Number(node.data.latest_message_received_date ?? Math.floor(new Date(node.updated_at).getTime() / 1000)),
    unread: Boolean(node.data.unread),
    folders: Array.isArray(node.data.folders) ? node.data.folders : [],
    contact: node.data.contact,
    linked_records: node.data.linked_records,
    messages: node.data.messages
  }));
}

function matchesFilter(thread: Record<string, unknown>, filter: string) {
  const folders = Array.isArray(thread.folders) ? thread.folders.map(String).map((value) => value.toLowerCase()) : [];
  if (filter === "unread") return Boolean(thread.unread);
  if (filter === "sent") return folders.some((folder) => folder.includes("sent"));
  if (filter === "inbox") return folders.some((folder) => folder.includes("inbox"));
  return true;
}

router.get("/threads", zValidator("query", z.object({
  search: z.string().default(""),
  filter: z.enum(["all", "inbox", "sent", "unread"]).default("all"),
  page_token: z.string().optional()
})), async (c) => {
  const input = c.req.valid("query");
  const settings = await getSettings(c.get("workspaceId"));
  const grantId = getGrantId(settings);
  let threads: Record<string, unknown>[];
  let nextCursor: string | undefined;

  if (grantId && process.env.NYLAS_API_KEY) {
    const params = new URLSearchParams({ limit: "50" });
    if (input.page_token) params.set("page_token", input.page_token);
    const response = await nylasRequest<{ data?: Record<string, unknown>[]; next_cursor?: string }>(grantId, `/threads?${params}`);
    threads = response.data ?? [];
    nextCursor = response.next_cursor;
  } else {
    threads = await localThreads(c.get("workspaceId"));
  }

  const search = input.search.trim().toLowerCase();
  const filtered = threads.filter((thread) => {
    const participants = JSON.stringify(thread.participants ?? []).toLowerCase();
    const haystack = `${thread.subject ?? ""} ${thread.snippet ?? ""} ${participants}`.toLowerCase();
    return matchesFilter(thread, input.filter) && (!search || haystack.includes(search));
  });
  return c.json({ threads: filtered, connected: Boolean(grantId), next_cursor: nextCursor });
});

router.get("/threads/:id", async (c) => {
  const settings = await getSettings(c.get("workspaceId"));
  const grantId = getGrantId(settings);
  if (grantId && process.env.NYLAS_API_KEY) {
    const threadResponse = await nylasRequest<{ data: Record<string, unknown> }>(grantId, `/threads/${encodeURIComponent(c.req.param("id"))}`);
    const thread = threadResponse.data;
    const messageIds = Array.isArray(thread.message_ids) ? thread.message_ids.map(String) : [];
    const messages = await Promise.all(messageIds.map(async (id) => {
      const response = await nylasRequest<{ data: Record<string, unknown> }>(grantId, `/messages/${encodeURIComponent(id)}`);
      const message = response.data;
      return {
        id,
        from: message.from ?? [],
        to: message.to ?? [],
        cc: message.cc ?? [],
        date: message.date ?? 0,
        body: message.body ?? "",
        attachments: message.attachments ?? []
      };
    }));
    return c.json({ ...thread, messages });
  }
  const { data } = await supabase.from("nodes").select("id,data").eq("workspace_id", c.get("workspaceId")).eq("object_type", "email_thread").or(`id.eq.${c.req.param("id")},data->>thread_id.eq.${c.req.param("id")}`).maybeSingle();
  return data ? c.json({ id: data.data.thread_id ?? data.id, ...data.data }) : c.json({ error: "Thread not found" }, 404);
});

router.post("/threads/:id/reply", zValidator("json", z.object({ body: z.string().min(1) })), async (c) => {
  const settings = await getSettings(c.get("workspaceId"));
  const grantId = getGrantId(settings);
  if (!grantId) return c.json({ error: "Connect Gmail or Outlook before replying" }, 400);
  const thread = await nylasRequest<{ data: Record<string, unknown> }>(grantId, `/threads/${encodeURIComponent(c.req.param("id"))}`);
  const messageIds = Array.isArray(thread.data.message_ids) ? thread.data.message_ids.map(String) : [];
  const replyTo = messageIds.at(-1);
  if (!replyTo) return c.json({ error: "Thread has no message to reply to" }, 400);
  const result = await nylasRequest<{ data: Record<string, unknown> }>(grantId, "/messages/send", {
    method: "POST",
    body: JSON.stringify({ body: c.req.valid("json").body, reply_to_message_id: replyTo })
  });
  return c.json(result.data, 201);
});

router.post("/threads/:id/link", zValidator("json", z.object({ node_id: z.string().uuid() })), async (c) => {
  const workspaceId = c.get("workspaceId");
  const threadId = c.req.param("id");
  const { data: target } = await supabase.from("nodes").select("id").eq("workspace_id", workspaceId).eq("id", c.req.valid("json").node_id).maybeSingle();
  if (!target) return c.json({ error: "Record not found" }, 404);
  let { data: emailNode } = await supabase.from("nodes").select("id").eq("workspace_id", workspaceId).eq("object_type", "email_thread").eq("data->>thread_id", threadId).maybeSingle();
  if (!emailNode) {
    const inserted = await supabase.from("nodes").insert({ workspace_id: workspaceId, vertical: "shared", object_type: "email_thread", data: { thread_id: threadId }, created_by: c.get("userId") }).select("id").single();
    if (inserted.error) return c.json({ error: inserted.error.message }, 400);
    emailNode = inserted.data;
  }
  const { error } = await supabase.from("edges").upsert({
    workspace_id: workspaceId,
    from_node_id: emailNode.id,
    to_node_id: target.id,
    relationship: "linked_to"
  });
  if (error) return c.json({ error: error.message }, 400);
  await supabase.from("activities").insert({ node_id: target.id, workspace_id: workspaceId, actor_type: "human", actor_id: c.get("userId"), action: "email_linked", diff: { thread_id: threadId } });
  return c.json({ ok: true });
});

export { router as emailsRouter };
