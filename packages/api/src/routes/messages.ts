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
  // ── Groups the caller belongs to — last message + real unread (created after my last_read_at,
  //    not sent by me). Tables may predate the 20260709_group_chat.sql migration → empty arrays.
  const groups: { group_id: string; name: string; last: string; last_at: string; unread: number; members: number }[] = [];
  try {
    const { data: myGroups } = await supabase
      .from("chat_group_members").select("group_id").eq("workspace_id", ws).eq("user_id", me);
    const ids = (myGroups ?? []).map((g) => String(g.group_id));
    if (ids.length) {
      const [{ data: groupRows }, { data: msgs }, { data: counts }] = await Promise.all([
        supabase.from("chat_groups").select("id, name, created_at").eq("workspace_id", ws).in("id", ids),
        supabase.from("internal_messages")
          .select("group_id, sender_id, body, created_at")
          .eq("workspace_id", ws).in("group_id", ids)
          .order("created_at", { ascending: false }).limit(400),
        supabase.from("chat_group_members").select("group_id").eq("workspace_id", ws).in("group_id", ids),
      ]);
      const lastRead = new Map((states ?? []).map((s) => [String(s.thread_key), s]));
      const { data: groupStates } = await supabase
        .from("internal_message_thread_state").select("thread_key, last_read_at")
        .eq("workspace_id", ws).eq("user_id", me).in("thread_key", ids.map((id) => `group:${id}`));
      const readAt = new Map((groupStates ?? []).map((s) => [String(s.thread_key), String(s.last_read_at ?? "")]));
      const memberCount = new Map<string, number>();
      for (const r of counts ?? []) memberCount.set(String(r.group_id), (memberCount.get(String(r.group_id)) ?? 0) + 1);
      void lastRead;
      for (const g of groupRows ?? []) {
        const gm = (msgs ?? []).filter((m) => String(m.group_id) === String(g.id));
        const latest = gm[0];
        const myRead = readAt.get(`group:${g.id}`) ?? "";
        const unread = gm.filter((m) => m.sender_id !== me && (!myRead || m.created_at > myRead)).length;
        groups.push({
          group_id: String(g.id), name: g.name,
          last: latest ? String(latest.body).slice(0, 140) : "No messages yet",
          last_at: latest?.created_at ?? g.created_at, unread, members: memberCount.get(String(g.id)) ?? 1,
        });
      }
      groups.sort((a, b) => (a.last_at < b.last_at ? 1 : -1));
    }
  } catch { /* group tables not migrated yet — DMs still work */ }

  const unreadTotal = inbox.reduce((s, t) => s + t.unread, 0) + groups.reduce((s, g) => s + g.unread, 0);
  return c.json({ inbox, groups, unread_total: unreadTotal });
});

// ── Group chats — membership-guarded, workspace-scoped ────────────────────────────────────────
const groupThreadKey = (groupId: string) => `group:${groupId}`;

/** Membership guard: the group must exist in THIS workspace and the caller must be a member. */
async function assertGroupMember(ws: string, groupId: string, me: string): Promise<{ id: string; name: string; created_by: string } | null> {
  const { data: member } = await supabase
    .from("chat_group_members").select("group_id")
    .eq("workspace_id", ws).eq("group_id", groupId).eq("user_id", me).maybeSingle();
  if (!member) return null;
  const { data: group } = await supabase
    .from("chat_groups").select("id, name, created_by")
    .eq("workspace_id", ws).eq("id", groupId).maybeSingle();
  return group ?? null;
}

/** POST /messages/groups — create a group chat. Creator is always a member; every member must
 *  be a real member of THIS workspace. */
router.post("/groups", zValidator("json", z.object({
  name: z.string().min(1).max(80),
  member_ids: z.array(z.string().min(1)).min(1).max(50),
})), async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const { name, member_ids } = c.req.valid("json");
  const dir = await members(ws);
  const invalid = member_ids.filter((id) => !dir.has(id));
  if (invalid.length) return c.json({ error: "Some selected people are not members of this workspace." }, 400);

  const { data: group, error } = await supabase
    .from("chat_groups").insert({ workspace_id: ws, name, created_by: me }).select("id, name").single();
  if (error) return c.json({ error: error.message }, 400);
  const memberRows = [...new Set([me, ...member_ids])].map((uid) => ({ group_id: group.id, workspace_id: ws, user_id: uid, added_by: me }));
  const { error: mErr } = await supabase.from("chat_group_members").insert(memberRows);
  if (mErr) return c.json({ error: mErr.message }, 400);
  return c.json({ id: group.id, name: group.name }, 201);
});

/** GET /messages/group/:id — the group conversation: members, messages, and mark read for me. */
router.get("/group/:id", async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const groupId = c.req.param("id");
  const group = await assertGroupMember(ws, groupId, me);
  if (!group) return c.json({ error: "Group not found." }, 404);

  const [{ data: rows }, { data: memberRows }] = await Promise.all([
    supabase.from("internal_messages")
      .select("id, sender_id, body, attachments, created_at")
      .eq("workspace_id", ws).eq("group_id", groupId)
      .order("created_at", { ascending: true }).limit(500),
    supabase.from("chat_group_members").select("user_id").eq("workspace_id", ws).eq("group_id", groupId),
  ]);
  const dir = await members(ws);
  const now = new Date().toISOString();
  // Read state for groups is per-user last_read_at on the group thread key.
  await supabase.from("internal_message_thread_state")
    .upsert({ workspace_id: ws, thread_key: groupThreadKey(groupId), user_id: me, last_read_at: now, updated_at: now }, { onConflict: "workspace_id,thread_key,user_id" })
    .then(() => {}, () => {});

  return c.json({
    group: { id: group.id, name: group.name, created_by: group.created_by },
    members: (memberRows ?? []).map((m) => {
      const info = dir.get(String(m.user_id));
      return { user_id: m.user_id, name: info?.name || info?.email || "Member", avatar_url: info?.avatar_url ?? null };
    }),
    messages: (rows ?? []).map((r) => {
      const info = dir.get(String(r.sender_id));
      return { ...r, mine: r.sender_id === me, sender_name: info?.name || info?.email || "Member" };
    }),
  });
});

/** POST /messages/group/:id/members — any member can add workspace members to the group. */
router.post("/group/:id/members", zValidator("json", z.object({ user_ids: z.array(z.string().min(1)).min(1).max(50) })), async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const groupId = c.req.param("id");
  if (!(await assertGroupMember(ws, groupId, me))) return c.json({ error: "Group not found." }, 404);
  const dir = await members(ws);
  const valid = c.req.valid("json").user_ids.filter((id) => dir.has(id));
  if (!valid.length) return c.json({ error: "No valid workspace members selected." }, 400);
  const rows = valid.map((uid) => ({ group_id: groupId, workspace_id: ws, user_id: uid, added_by: me }));
  await supabase.from("chat_group_members").upsert(rows, { onConflict: "group_id,user_id" });
  return c.json({ added: valid.length });
});

/** DELETE /messages/group/:id/members/me — leave the group. */
router.delete("/group/:id/members/me", async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const groupId = c.req.param("id");
  await supabase.from("chat_group_members").delete()
    .eq("workspace_id", ws).eq("group_id", groupId).eq("user_id", me);
  return c.body(null, 204);
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
  // Find the message that references this attachment in THIS workspace, then authorize the caller:
  // a DM participant (sender/recipient) OR a member of the group the message was posted to. The old
  // guard only matched sender/recipient, so group attachments were undownloadable by every recipient.
  const { data: msg } = await supabase
    .from("internal_messages")
    .select("id, sender_id, recipient_id, group_id")
    .eq("workspace_id", ws)
    .contains("attachments", JSON.stringify([{ path }]))
    .limit(1)
    .maybeSingle();
  if (!msg) return c.json({ error: "Attachment not found." }, 404);
  const isDmParticipant = msg.sender_id === me || msg.recipient_id === me;
  const isGroupMember = msg.group_id ? !!(await assertGroupMember(ws, msg.group_id as string, me)) : false;
  if (!isDmParticipant && !isGroupMember) return c.json({ error: "Attachment not found." }, 404);
  const { data, error } = await supabase.storage.from(MSG_ATTACH_BUCKET).createSignedUrl(path, 120);
  if (error || !data?.signedUrl) return c.json({ error: "Attachment not found." }, 404);
  return c.json({ url: data.signedUrl });
});

/** POST /messages — send a message to a workspace member (recipient_id) OR a group (group_id). */
router.post("/", zValidator("json", z.object({
  recipient_id: z.string().min(1).optional(),
  group_id: z.string().uuid().optional(),
  body: z.string().min(1).max(5000),
  attachments: z.array(attachmentMeta).max(MSG_ATTACH_MAX_FILES).optional(),
}).refine((v) => Boolean(v.recipient_id) !== Boolean(v.group_id), { message: "Provide exactly one of recipient_id or group_id." })), async (c) => {
  const ws = c.get("workspaceId");
  const me = c.get("userId");
  const { recipient_id, group_id, body, attachments } = c.req.valid("json");

  // Attachment paths must come from the CALLER'S OWN upload prefix (shared by both branches).
  const atts = (attachments ?? []).filter((a) => a.path.startsWith(`${ws}/${me}/`));
  if ((attachments ?? []).length !== atts.length) return c.json({ error: "Invalid attachment reference." }, 400);

  // ── Group branch — membership-guarded; notifies the other members ──
  if (group_id) {
    const group = await assertGroupMember(ws, group_id, me);
    if (!group) return c.json({ error: "Group not found." }, 404);
    const row: Record<string, unknown> = { workspace_id: ws, thread_key: groupThreadKey(group_id), sender_id: me, group_id, body };
    if (atts.length > 0) row.attachments = atts;
    const { data, error } = await supabase.from("internal_messages").insert(row).select("id, created_at").single();
    if (error) return c.json({ error: error.message }, 400);

    const dir = await members(ws);
    const senderName = dir.get(me)?.name || dir.get(me)?.email || "A teammate";
    const { data: gMembers } = await supabase
      .from("chat_group_members").select("user_id").eq("workspace_id", ws).eq("group_id", group_id);
    const others = (gMembers ?? []).map((m) => String(m.user_id)).filter((id) => id !== me).slice(0, 20);
    if (others.length) {
      await supabase.from("notifications").insert(others.map((uid) => ({
        workspace_id: ws, user_id: uid,
        title: `${senderName} in ${group.name}`,
        message: `${senderName} in ${group.name}`,
        body: body.slice(0, 120), type: "message", is_read: false,
        metadata: { route: `/messages?g=${group_id}` },
      }))).then(() => {}, () => {});
    }
    return c.json({ id: data.id, created_at: data.created_at }, 201);
  }

  // ── DM branch (refine guarantees recipient_id is set here) ──
  const rid = recipient_id!;
  if (rid === me) return c.json({ error: "You can't message yourself." }, 400);

  // Recipient must be a real member of THIS workspace (isolation guard).
  const dir = await members(ws);
  const recipient = dir.get(rid);
  if (!recipient) return c.json({ error: "Recipient is not a member of this workspace." }, 404);

  // Only include the attachments column when there are any — so plain text sends keep working
  // even before the 20260709_message_attachments.sql migration has been applied.
  const row: Record<string, unknown> = { workspace_id: ws, thread_key: threadKey(me, rid), sender_id: me, recipient_id: rid, body };
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
    user_id: rid,
    title: `New message from ${senderName}`,
    message: `New message from ${senderName}`,
    body: body.slice(0, 120),
    type: "message",
    is_read: false,
    metadata: { route: `/messages?to=${me}`, thread_key: threadKey(me, rid) },
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
