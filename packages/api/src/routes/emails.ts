import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { verifyTrackingToken } from "../lib/tracking";
import { freshAccessToken, gmailThreads, gmailThread } from "../lib/google";

type Variables = { userId: string; workspaceId: string; role: string };
type WorkspaceSettings = {
  nylas_grant_id?: string;
  integrations?: Record<string, boolean | { connected?: boolean; grant_id?: string; email?: string }>;
};

// 1×1 transparent GIF
const PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

const API_BASE = process.env.API_BASE_URL ?? "https://mondaily-api.onrender.com";

const router = new Hono<{ Variables: Variables }>();

// ── Public tracking routes — NO auth (called by email clients) ────────────────
router.get("/track/:token/open.gif", async (c) => {
  // Verify the signed, opaque token → node id. An unsigned/forged token resolves
  // to null and we just serve the pixel without touching the DB, so the raw node
  // UUID is never accepted from the URL (closes the IDOR enumeration leak).
  const trackingId = verifyTrackingToken(c.req.param("token"));
  if (trackingId) {
    // Fire-and-forget: log the open event on the email_outbox node
    supabase.from("nodes")
      .select("id,data")
      .eq("object_type", "email_outbox")
      .eq("id", trackingId)
      .maybeSingle()
      .then(({ data: node }) => {
        if (!node) return;
        const opens: string[] = Array.isArray((node.data as Record<string,unknown>).opens)
          ? (node.data as Record<string,unknown>).opens as string[]
          : [];
        const ts = new Date().toISOString();
        opens.push(ts);
        supabase.from("nodes").update({ data: { ...(node.data as object), opens, last_opened_at: ts } })
          .eq("id", trackingId).then(() => {});
      });
  }
  return new Response(PIXEL_GIF, {
    status: 200,
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache" }
  });
});

router.get("/track/:token/click", async (c) => {
  const trackingId = verifyTrackingToken(c.req.param("token"));
  const url = c.req.query("url") ?? "/";
  // Fire-and-forget: log click (only on a valid signed token)
  if (trackingId) {
    supabase.from("nodes")
      .select("id,data")
      .eq("object_type", "email_outbox")
      .eq("id", trackingId)
      .maybeSingle()
      .then(({ data: node }) => {
        if (!node) return;
        const clicks: { url: string; at: string }[] = Array.isArray((node.data as Record<string,unknown>).clicks)
          ? (node.data as Record<string,unknown>).clicks as { url: string; at: string }[]
          : [];
        clicks.push({ url, at: new Date().toISOString() });
        supabase.from("nodes").update({ data: { ...(node.data as object), clicks, last_clicked_at: new Date().toISOString() } })
          .eq("id", trackingId).then(() => {});
      });
  }
  return c.redirect(url, 302);
});

// ─────────────────────────────────────────────────────────────────────────────
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

// Parse an RFC822 "Name <email>" header into the {name, email} shape the UI wants.
function parseAddr(s: string): { name?: string; email: string } {
  const m = (s ?? "").match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  if (m) return { name: (m[1] ?? "").trim() || undefined, email: (m[2] ?? "").trim() };
  return { email: (s ?? "").trim() };
}
// The UI's relativeDate() multiplies by 1000, so it expects UNIX SECONDS.
function toUnixSeconds(dateStr: string): number {
  const t = Date.parse(dateStr ?? "");
  return Number.isNaN(t) ? Math.floor(Date.now() / 1000) : Math.floor(t / 1000);
}

router.get("/threads", zValidator("query", z.object({
  search: z.string().default(""),
  filter: z.enum(["all", "inbox", "sent", "unread"]).default("all"),
  page_token: z.string().optional()
})), async (c) => {
  const input = c.req.valid("query");
  const settings = await getSettings(c.get("workspaceId"));
  const grantId = getGrantId(settings);

  // DIRECT GOOGLE (Gmail API) — preferred when a Google inbox is connected.
  const { data: gconn } = await supabase
    .from("email_connections")
    .select("id, refresh_token, access_token, token_expiry, email, provider")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("provider", "google")
    .limit(1)
    .maybeSingle();
  const gc = gconn as { id: string; refresh_token?: string | null; access_token?: string | null; token_expiry?: string | null; email?: string } | null;
  if (gc && (gc.refresh_token || gc.access_token)) {
    const token = await freshAccessToken(gc);
    if (token) {
      const filterQ = input.filter === "unread" ? "is:unread" : input.filter === "sent" ? "in:sent" : input.filter === "inbox" ? "in:inbox" : "";
      const q = [filterQ, input.search.trim()].filter(Boolean).join(" ");
      const gthreads = await gmailThreads(token, { q, max: 25 });
      const mapped = gthreads.map((t) => ({
        id: t.id,
        subject: t.subject,
        snippet: t.snippet,
        participants: [parseAddr(t.from)],
        latest_message_received_date: toUnixSeconds(t.date),
        unread: t.unread,
        folders: [] as string[],
      }));
      return c.json({ threads: mapped, connected: true, connected_email: gc.email, next_cursor: undefined });
    }
  }

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
  // Reflect ANY connected inbox — a direct-Google connection (email_connections
  // row with a refresh token) OR a legacy Nylas grant — not just the Nylas path.
  const { data: conn } = await supabase
    .from("email_connections")
    .select("email, grant_id, refresh_token")
    .eq("workspace_id", c.get("workspaceId"))
    .limit(1)
    .maybeSingle();
  const connected = Boolean(grantId) || Boolean((conn as { grant_id?: string; refresh_token?: string } | null)?.grant_id || (conn as { refresh_token?: string } | null)?.refresh_token);
  return c.json({ threads: filtered, connected, connected_email: (conn as { email?: string } | null)?.email, next_cursor: nextCursor });
});

router.get("/threads/:id", async (c) => {
  const settings = await getSettings(c.get("workspaceId"));
  const grantId = getGrantId(settings);

  // Direct Google
  const { data: gconn } = await supabase
    .from("email_connections")
    .select("id, refresh_token, access_token, token_expiry")
    .eq("workspace_id", c.get("workspaceId")).eq("provider", "google").limit(1).maybeSingle();
  const gc = gconn as { id: string; refresh_token?: string | null; access_token?: string | null; token_expiry?: string | null } | null;
  if (gc && (gc.refresh_token || gc.access_token)) {
    const token = await freshAccessToken(gc);
    if (token) {
      const msgs = await gmailThread(token, c.req.param("id"));
      const last = msgs[msgs.length - 1];
      return c.json({
        id: c.req.param("id"),
        subject: last?.subject ?? "",
        snippet: last?.snippet ?? "",
        participants: last ? [parseAddr(last.from)] : [],
        latest_message_received_date: last ? toUnixSeconds(last.date) : 0,
        unread: false,
        folders: [] as string[],
        messages: msgs.map((m) => ({ id: m.id, from: [parseAddr(m.from)], to: m.to ? [parseAddr(m.to)] : [], cc: [], date: toUnixSeconds(m.date), body: m.body, attachments: [] })),
      });
    }
  }

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

// ── Inject tracking pixel + wrap links in HTML body ──────────────────────────
function injectTracking(html: string, trackingId: string): string {
  // Wrap all <a href="..."> links to go through click tracking
  const withLinks = html.replace(
    /<a\s+([^>]*?)href="([^"]+)"([^>]*?)>/gi,
    (_, before, url, after) => {
      if (url.startsWith(`${API_BASE}/api/v1/emails/track/`)) return _;
      const tracked = `${API_BASE}/api/v1/emails/track/${trackingId}/click?url=${encodeURIComponent(url)}`;
      return `<a ${before}href="${tracked}"${after}>`;
    }
  );
  // Append 1×1 open tracking pixel before </body> or at the end
  const pixel = `<img src="${API_BASE}/api/v1/emails/track/${trackingId}/open.gif" width="1" height="1" style="display:block;width:1px;height:1px;opacity:0;" alt=""/>`;
  return withLinks.includes("</body>")
    ? withLinks.replace("</body>", `${pixel}</body>`)
    : withLinks + pixel;
}

router.post("/threads/:id/reply", zValidator("json", z.object({ body: z.string().min(1) })), async (c) => {
  const settings = await getSettings(c.get("workspaceId"));
  const grantId = getGrantId(settings);
  if (!grantId) return c.json({ error: "Connect Gmail or Outlook before replying" }, 400);
  const thread = await nylasRequest<{ data: Record<string, unknown> }>(grantId, `/threads/${encodeURIComponent(c.req.param("id"))}`);
  const messageIds = Array.isArray(thread.data.message_ids) ? thread.data.message_ids.map(String) : [];
  const replyTo = messageIds.at(-1);
  if (!replyTo) return c.json({ error: "Thread has no message to reply to" }, 400);

  // Create an outbox node to track opens/clicks for this reply
  const { data: trackNode } = await supabase.from("nodes").insert({
    workspace_id: c.get("workspaceId"),
    vertical: "sales",
    object_type: "email_outbox",
    data: { thread_id: c.req.param("id"), subject: "(reply)", status: "sent", sent_at: new Date().toISOString(), opens: [], clicks: [] },
    created_by: c.get("userId")
  }).select("id").single();

  const trackedBody = trackNode ? injectTracking(c.req.valid("json").body, trackNode.id) : c.req.valid("json").body;
  const result = await nylasRequest<{ data: Record<string, unknown> }>(grantId, "/messages/send", {
    method: "POST",
    body: JSON.stringify({ body: trackedBody, reply_to_message_id: replyTo })
  });
  return c.json({ ...result.data, tracking_id: trackNode?.id }, 201);
});

// ── List outbox (sent + tracked emails) ──────────────────────────────────────
router.get("/outbox", async (c) => {
  const { data } = await supabase.from("nodes")
    .select("id,data,created_at")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("object_type", "email_outbox")
    .order("created_at", { ascending: false })
    .limit(100);
  return c.json((data ?? []).map(n => ({
    id: n.id,
    created_at: n.created_at,
    ...(n.data as object),
    open_count: Array.isArray((n.data as Record<string,unknown>).opens) ? ((n.data as Record<string,unknown>).opens as unknown[]).length : 0,
    click_count: Array.isArray((n.data as Record<string,unknown>).clicks) ? ((n.data as Record<string,unknown>).clicks as unknown[]).length : 0,
  })));
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
