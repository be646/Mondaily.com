import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { supabase } from "@mondaily/db/client";
import { requireAuth } from "../middleware/auth";
import { sendTransactionalEmail } from "../lib/mail";
import { aiGateway, gatewayEnv } from "../lib/ai-gateway";
import { resolveProfile } from "@mondaily/shared/profile";
import { languageInstruction, normalizeLang } from "@mondaily/shared/i18n";

/**
 * Internal Mondaily messaging — workspace-scoped, member-to-member.
 * Replaces the old `mailto:` action with a real persisted inbox. All reads/writes are
 * scoped to the caller's workspace AND to conversations the caller is part of, so a
 * member can never read another pair's thread. If RESEND_API_KEY is configured the
 * recipient also gets an email *notification* (never the message UI itself).
 */
type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

// Stable pair-key so both directions of a 1:1 conversation share one thread.
const threadKey = (a: string, b: string) => [a, b].sort().join(":");

// Resolve display info for a set of member ids in this workspace.
async function members(workspaceId: string) {
  const { data } = await supabase
    .from("workspace_members")
    .select("user_id, name, email, avatar_url")
    .eq("workspace_id", workspaceId);
  return new Map((data ?? []).map((m) => [String(m.user_id), m]));
}

/** GET /messages/inbox — latest message per conversation for the caller, with unread counts. */
router.get("/inbox", async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const [{ data: rows }, { data: states }] = await Promise.all([
    supabase
      .from("internal_messages")
      .select("id, thread_key, sender_id, recipient_id, body, read_at, created_at")
      .eq("workspace_id", ws)
      .or(`sender_id.eq.${me},recipient_id.eq.${me}`)
      .order("created_at", { ascending: false })
      .limit(500),
    // This caller's OWN archive state — never the other participant's.
    supabase
      .from("internal_message_thread_state")
      .select("thread_key, archived_at")
      .eq("workspace_id", ws)
      .eq("user_id", me),
  ]);
  const archivedAt = new Map((states ?? []).filter(s => s.archived_at).map(s => [String(s.thread_key), String(s.archived_at)]));

  const dir = await members(ws);
  const threads = new Map<string, { thread_key: string; other_id: string; last: string; last_at: string; unread: number; outgoing: boolean }>();
  for (const r of rows ?? []) {
    const otherId = r.sender_id === me ? r.recipient_id : r.sender_id;
    if (!threads.has(r.thread_key)) {
      threads.set(r.thread_key, {
        thread_key: r.thread_key,
        other_id: otherId,
        last: r.body.slice(0, 140),
        last_at: r.created_at,           // rows are newest-first, so the first seen is the latest
        unread: 0,
        outgoing: r.sender_id === me,
      });
    }
    if (r.recipient_id === me && !r.read_at) threads.get(r.thread_key)!.unread += 1;
  }
  const inbox = [...threads.values()]
    // Hide only if THIS user archived the thread AND no newer message arrived since (a new
    // message's created_at > archived_at, so sending re-surfaces the thread automatically).
    .filter((t) => { const a = archivedAt.get(t.thread_key); return !a || t.last_at > a; })
    .map((t) => {
      const m = dir.get(t.other_id);
      return { ...t, name: m?.name || m?.email || "Member", email: m?.email ?? null, avatar_url: m?.avatar_url ?? null };
    });
  const unreadTotal = inbox.reduce((s, t) => s + t.unread, 0);
  return c.json({ inbox, unread_total: unreadTotal });
});

/**
 * GET /messages/search?q= — search message bodies across the CALLER'S OWN conversations only
 * (workspace + participant scoped, same guards as /inbox). Returns matches newest-first with
 * the other party resolved, so the UI can jump straight into the thread.
 */
router.get("/search", async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ results: [] });
  // Escape PostgREST ilike wildcards so a literal "%"/"_" in the query can't widen the match.
  const safe = q.replace(/[%_]/g, (ch) => `\\${ch}`);
  const { data: rows } = await supabase
    .from("internal_messages")
    .select("id, thread_key, sender_id, recipient_id, body, created_at")
    .eq("workspace_id", ws)
    .or(`sender_id.eq.${me},recipient_id.eq.${me}`)
    .ilike("body", `%${safe}%`)
    .order("created_at", { ascending: false })
    .limit(30);
  const dir = await members(ws);
  const results = (rows ?? []).map((r) => {
    const otherId = r.sender_id === me ? r.recipient_id : r.sender_id;
    const m = dir.get(otherId);
    return {
      id: r.id,
      other_id: otherId,
      name: m?.name || m?.email || "Member",
      avatar_url: m?.avatar_url ?? null,
      body: r.body.slice(0, 200),
      created_at: r.created_at,
      mine: r.sender_id === me,
    };
  });
  return c.json({ results });
});

/** GET /messages/thread/:otherId — full 1:1 conversation, and mark incoming as read. */
router.get("/thread/:otherId", async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const other = c.req.param("otherId");
  const key = threadKey(me, other);

  // The other party must be a real member of THIS workspace (isolation guard).
  const dir = await members(ws);
  if (!dir.has(other)) return c.json({ error: "Member not found in this workspace." }, 404);

  // Includes attachments; falls back to the legacy column set if the
  // 20260709_message_attachments.sql migration hasn't been applied yet.
  let { data: rows, error: readErr } = await supabase
    .from("internal_messages")
    .select("id, sender_id, recipient_id, body, attachments, read_at, created_at")
    .eq("workspace_id", ws)
    .eq("thread_key", key)
    .order("created_at", { ascending: true })
    .limit(500);
  if (readErr) {
    const legacy = await supabase
      .from("internal_messages")
      .select("id, sender_id, recipient_id, body, read_at, created_at")
      .eq("workspace_id", ws)
      .eq("thread_key", key)
      .order("created_at", { ascending: true })
      .limit(500);
    rows = (legacy.data ?? []).map((r) => ({ ...r, attachments: [] }));
  }

  const now = new Date().toISOString();
  // Mark the caller's incoming, unread messages as read (per-message read state → unread counts).
  await supabase
    .from("internal_messages")
    .update({ read_at: now })
    .eq("workspace_id", ws)
    .eq("thread_key", key)
    .eq("recipient_id", me)
    .is("read_at", null);
  // Also stamp this user's own thread-state last_read_at (future realtime read-marker; upsert never
  // touches the other participant's row thanks to the (workspace, thread, user) unique key).
  await supabase
    .from("internal_message_thread_state")
    .upsert({ workspace_id: ws, thread_key: key, user_id: me, last_read_at: now, updated_at: now }, { onConflict: "workspace_id,thread_key,user_id" })
    .then(() => {}, () => {});

  const m = dir.get(other);
  return c.json({
    other: { user_id: other, name: m?.name || m?.email || "Member", email: m?.email ?? null, avatar_url: m?.avatar_url ?? null },
    messages: (rows ?? []).map((r) => ({ ...r, mine: r.sender_id === me })),
  });
});

// ── Attachments — private bucket, participant-scoped signed downloads ─────────────────────────
const MSG_ATTACH_BUCKET = "message-attachments";
const MSG_ATTACH_MAX_BYTES = 10 * 1024 * 1024;   // 10 MB per file
const MSG_ATTACH_MAX_FILES = 5;                   // per message
const attachmentMeta = z.object({
  path: z.string().min(1),
  name: z.string().min(1).max(200),
  content_type: z.string().max(120),
  size: z.number().int().positive(),
});
export type MessageAttachment = z.infer<typeof attachmentMeta>;

/**
 * POST /messages/attachments — upload files (base64) to the private bucket BEFORE sending.
 * Objects are keyed under `<workspaceId>/<userId>/…`, so a caller can only ever create paths in
 * their own prefix; the send endpoint then only accepts paths from that same prefix. Uploading
 * without sending leaves an orphan object, never a visible message.
 */
router.post("/attachments", zValidator("json", z.object({
  files: z.array(z.object({
    name: z.string().min(1).max(200),
    content_type: z.string().max(120).default("application/octet-stream"),
    content_base64: z.string().min(1),
  })).min(1).max(MSG_ATTACH_MAX_FILES),
})), async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const out: MessageAttachment[] = [];
  for (const [i, f] of c.req.valid("json").files.entries()) {
    const bytes = new Uint8Array(Buffer.from(f.content_base64, "base64"));
    if (bytes.length === 0) continue;
    if (bytes.length > MSG_ATTACH_MAX_BYTES) return c.json({ error: `"${f.name}" is over the 10 MB limit.` }, 413);
    const safeName = f.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    const path = `${ws}/${me}/${Date.now()}-${i}-${safeName}`;
    const { error } = await supabase.storage.from(MSG_ATTACH_BUCKET).upload(path, bytes, { contentType: f.content_type || "application/octet-stream", upsert: false });
    if (error) return c.json({ error: `Couldn't store "${f.name}" — ${error.message}` }, 500);
    out.push({ path, name: f.name, content_type: f.content_type || "application/octet-stream", size: bytes.length });
  }
  if (!out.length) return c.json({ error: "No valid files." }, 400);
  return c.json({ attachments: out }, 201);
});

/**
 * GET /messages/attachment?path= — short-lived signed URL. Guards: the path must live under this
 * workspace's prefix AND a message the CALLER participates in must reference it — so neither a
 * guessed path nor another member of the same workspace outside the conversation can fetch it.
 */
router.get("/attachment", zValidator("query", z.object({ path: z.string().min(1) })), async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const path = c.req.valid("query").path;
  if (!path.startsWith(`${ws}/`)) return c.json({ error: "Not allowed." }, 403);
  const { data: msg } = await supabase
    .from("internal_messages")
    .select("id")
    .eq("workspace_id", ws)
    .or(`sender_id.eq.${me},recipient_id.eq.${me}`)
    .contains("attachments", JSON.stringify([{ path }]))
    .limit(1)
    .maybeSingle();
  if (!msg) return c.json({ error: "Attachment not found." }, 404);
  const { data, error } = await supabase.storage.from(MSG_ATTACH_BUCKET).createSignedUrl(path, 120);
  if (error || !data?.signedUrl) return c.json({ error: "Attachment not found." }, 404);
  return c.json({ url: data.signedUrl });
});

/** POST /messages — send a message to a workspace member. */
router.post("/", zValidator("json", z.object({
  recipient_id: z.string().min(1),
  body: z.string().min(1).max(5000),
  attachments: z.array(attachmentMeta).max(MSG_ATTACH_MAX_FILES).optional(),
})), async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const { recipient_id, body, attachments } = c.req.valid("json");
  if (recipient_id === me) return c.json({ error: "You can't message yourself." }, 400);

  // Recipient must be a real member of THIS workspace (isolation guard).
  const dir = await members(ws);
  const recipient = dir.get(recipient_id);
  if (!recipient) return c.json({ error: "Recipient is not a member of this workspace." }, 404);

  // Attachment paths must come from the CALLER'S OWN upload prefix — no referencing other
  // people's files (or other workspaces') by path.
  const atts = (attachments ?? []).filter((a) => a.path.startsWith(`${ws}/${me}/`));
  if ((attachments ?? []).length !== atts.length) return c.json({ error: "Invalid attachment reference." }, 400);

  // Only include the attachments column when there are any — so plain text sends keep working
  // even before the 20260709_message_attachments.sql migration has been applied.
  const row: Record<string, unknown> = { workspace_id: ws, thread_key: threadKey(me, recipient_id), sender_id: me, recipient_id, body };
  if (atts.length > 0) row.attachments = atts;
  const { data, error } = await supabase
    .from("internal_messages")
    .insert(row)
    .select("id, created_at")
    .single();
  if (error) return c.json({ error: error.message }, 400);

  const sender = dir.get(me);
  const senderName = sender?.name || sender?.email || "A teammate";

  // In-app notification (best-effort). metadata.route deep-links the recipient straight to THIS
  // thread (opened against the sender) — resolveNotificationLink honors metadata.route.
  await supabase.from("notifications").insert({
    workspace_id: ws,
    user_id: recipient_id,
    title: `New message from ${senderName}`,
    message: `New message from ${senderName}`,
    body: body.slice(0, 120),
    type: "message",
    is_read: false,
    metadata: { route: `/messages?to=${me}`, thread_key: threadKey(me, recipient_id) },
  }).then(() => {}, () => {});

  // Email notification (best-effort; only if a mail provider is configured).
  if (recipient.email) {
    void sendTransactionalEmail({
      subject: `New message from ${senderName} on Mondaily`,
      body: `<p>${senderName} sent you a message on Mondaily:</p><blockquote>${body.slice(0, 500).replace(/</g, "&lt;")}</blockquote><p>Open Mondaily to reply.</p>`,
      to: [{ email: recipient.email, name: recipient.name ?? undefined }],
    }).catch(() => {});
  }

  return c.json({ id: data.id, created_at: data.created_at }, 201);
});

/** PATCH /messages/thread/:otherId/archive — archive a conversation for THE CALLER ONLY.
 *  Archive is a personal view choice, stored in the caller's own thread-state row — it never
 *  hides the thread for the other participant. A later message re-surfaces it (see /inbox). */
router.patch("/thread/:otherId/archive", async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const now = new Date().toISOString();
  const key = threadKey(me, c.req.param("otherId"));
  const { error } = await supabase
    .from("internal_message_thread_state")
    .upsert({ workspace_id: ws, thread_key: key, user_id: me, archived_at: now, updated_at: now }, { onConflict: "workspace_id,thread_key,user_id" });
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true });
});

/**
 * POST /messages/draft — AI writing assist. Drafts or rewrites a short internal message and RETURNS
 * the text; it NEVER sends. The user reviews it in the compose box and clicks Send themselves.
 * Language-aware (per-user override → workspace profile → English). Fails closed if the sovereign
 * gateway isn't configured. Metered like any AI action (workspaceId passed).
 */
router.post("/draft", zValidator("json", z.object({
  prompt: z.string().min(1).max(1000),
  existing: z.string().max(5000).optional(),   // an existing draft to rewrite/improve
})), async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const { prompt, existing } = c.req.valid("json");

  const env = gatewayEnv();
  if (!env.baseURL || !env.apiKey) return c.json({ error: "AI drafting isn't available right now." }, 503);

  // Resolve the writer's language (never translates message CONTENT — only guides the draft language).
  const { data: wsRow } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const settings = (wsRow?.settings ?? {}) as Record<string, unknown>;
  const userLang = (settings.user_preferences as Record<string, { language?: string }> | undefined)?.[me]?.language;
  const lang = normalizeLang(userLang || resolveProfile(settings).language);

  const system = `You help a workspace member write a short, professional internal message to a teammate. Return ONLY the message text — no preamble, quotes, or explanation. Keep it concise and natural.${languageInstruction(lang)}`;
  const userPrompt = existing?.trim()
    ? `Rewrite/improve this draft: "${existing.trim()}"\n\nInstruction: ${prompt}`
    : `Write the message. Instruction: ${prompt}`;

  try {
    const res = await aiGateway({ system, prompt: userPrompt, maxTokens: 300, workspaceId: ws, userId: me, feature: "message_draft" });
    const draft = (res.text ?? "").trim();
    // If the wallet is exhausted the gateway returns provider "none" — surface a clean message.
    if (!draft || res.provider === "none") return c.json({ error: "AI draft unavailable (check your AI credits)." }, 200);
    return c.json({ draft });
  } catch {
    return c.json({ error: "Couldn't draft that — please try again." }, 200);
  }
});

/** DELETE /messages/:id — delete YOUR OWN message. Sender-only, workspace-scoped. A recipient (or
 *  anyone else) can never delete someone else's message — the eq(sender_id, me) guard enforces it. */
router.delete("/:id", async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const { error, count } = await supabase
    .from("internal_messages")
    .delete({ count: "exact" })
    .eq("workspace_id", ws)
    .eq("id", c.req.param("id"))
    .eq("sender_id", me);           // ONLY the sender can delete their own message
  if (error) return c.json({ error: error.message }, 400);
  if (!count) return c.json({ error: "Message not found or not yours." }, 404);
  return c.json({ ok: true });
});

export { router as messagesRouter };
