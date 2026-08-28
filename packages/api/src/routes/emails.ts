import { zValidator } from "../lib/validate";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { parseIcsReply, eventIdFromUid } from "../lib/ics";
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireAuth } from "../middleware/auth";
import { verifyTrackingToken } from "../lib/tracking";
import { orFilterValue } from "../lib/pgrst-filter";
import { ticketIdFromRecipient, fileSupportReply } from "../lib/support-mail";
import { decodeMimeWords } from "@mondaily/shared/mime";
import { threadIdFor, mergeMessage, inboundAddressFor, workspaceIdFromRecipients, mailDomainConfigured, buildOutboundMessage, attachmentPath, type InboundMessage, type ThreadData } from "../lib/email-sovereign";
import { freshAccessToken, gmailThreads, gmailThread, gmailSend } from "../lib/google";
import { sendWorkspaceEmail } from "../lib/mail";
import { aiGateway, gatewayEnv } from "../lib/ai-gateway";

type Variables = { userId: string; workspaceId: string; role: string };
type WorkspaceSettings = {
  integrations?: Record<string, boolean | { connected?: boolean; grant_id?: string; email?: string }>;
};

// 1×1 transparent GIF
const PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

const API_BASE = process.env.API_BASE_URL ?? "https://api.mondaily.com";

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

// Upload a message's attachments to private Supabase Storage, returning stored metadata (never the
// bytes). Capped so a huge mail can't exhaust storage; a failed upload is skipped, not fatal.
const ATTACH_BUCKET = "email-attachments";
const MAX_ATTACH_BYTES = 10 * 1024 * 1024;   // 10 MB per file
async function storeAttachments(workspaceId: string, msg: InboundMessage) {
  const out: { filename: string; content_type: string; size: number; path: string }[] = [];
  for (const [i, a] of (msg.attachments ?? []).slice(0, 15).entries()) {
    try {
      const bytes = new Uint8Array(Buffer.from(a.content_base64 ?? "", "base64"));
      if (bytes.length === 0 || bytes.length > MAX_ATTACH_BYTES) continue;
      const path = attachmentPath(workspaceId, msg.message_id, i, a.filename);
      const { error } = await supabase.storage.from(ATTACH_BUCKET).upload(path, bytes, { contentType: a.content_type || "application/octet-stream", upsert: true });
      if (error) continue;
      out.push({ filename: a.filename || `file-${i}`, content_type: a.content_type || "application/octet-stream", size: bytes.length, path });
    } catch { /* skip this attachment */ }
  }
  return out;
}

// ── Sovereign inbound mail — NO auth (called by the self-hosted mail receiver) ────
// A self-hosted receiver parses incoming SMTP into JSON and POSTs it here, HMAC-signed. We fold it
// into the workspace's email_thread nodes (the same model the inbox UI renders) — no Gmail, no
// third-party provider. FAIL-CLOSED: without SOVEREIGN_MAIL_SECRET every call is 401.

/**
 * Find a calendar REPLY in an inbound message and record it against the meeting.
 *
 * Returns null when there is nothing to record, so the caller falls through to normal handling —
 * an ordinary email that merely mentions a meeting must not be treated as an answer.
 *
 * The attendee is matched against the event's OWN guest list. A reply from an address nobody
 * invited is ignored rather than trusted: the UID is not a secret, and accepting on someone else's
 * behalf is not something an email should be able to do.
 */
async function recordRsvpFromInbound(msg: InboundMessage & { attachments?: { content_type?: string; content_base64?: string }[] }): Promise<{ event_id: string; email: string; response: string } | null> {
  const parts = (msg.attachments ?? [])
    .filter(a => (a.content_type ?? "").toLowerCase().includes("calendar") && a.content_base64)
    .map(a => Buffer.from(a.content_base64 as string, "base64").toString("utf8"));
  // Some clients put the calendar payload straight in the body rather than as a part.
  if (typeof msg.text === "string" && /BEGIN:VCALENDAR/i.test(msg.text)) parts.push(msg.text);

  for (const raw of parts) {
    const reply = parseIcsReply(raw);
    if (!reply) continue;
    const eventId = eventIdFromUid(reply.uid);
    if (!eventId) continue;

    const { data: node } = await supabase.from("nodes")
      .select("id, workspace_id, data").eq("id", eventId).eq("object_type", "calendar_event").maybeSingle();
    if (!node) continue;

    const data = (node.data ?? {}) as Record<string, unknown>;
    const guests = ((data.guest_emails as string[] | undefined) ?? []).map(e => e.toLowerCase());
    if (!guests.includes(reply.attendeeEmail)) {
      console.warn(`[rsvp] ignored a reply from ${reply.attendeeEmail} — not an invited guest of ${eventId}`);
      continue;
    }

    const responses = { ...((data.guest_responses as Record<string, string> | undefined) ?? {}), [reply.attendeeEmail]: reply.response };
    const { error } = await supabase.from("nodes")
      .update({ data: { ...data, guest_responses: responses } })
      .eq("id", node.id).eq("workspace_id", node.workspace_id).eq("object_type", "calendar_event");
    if (error) { console.error(`[rsvp] could not record: ${error.message}`); continue; }

    console.log(`[rsvp] ${reply.attendeeEmail} ${reply.response} for ${eventId}`);
    return { event_id: eventId, email: reply.attendeeEmail, response: reply.response };
  }
  return null;
}

router.post("/inbound", async (c) => {
  const raw = await c.req.text();
  const secret = process.env.SOVEREIGN_MAIL_SECRET;
  const sig = c.req.header("x-mondaily-mail-signature") ?? "";
  if (!secret) return c.json({ error: "Sovereign mail isn't configured." }, 401);
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return c.json({ error: "invalid signature" }, 401);

  let msg: InboundMessage & { recipients?: string[] };
  try { msg = JSON.parse(raw); } catch { return c.json({ error: "bad payload" }, 400); }
  if (!msg?.message_id || !msg?.from) return c.json({ error: "missing message_id/from" }, 400);
  // The receiver forwards headers verbatim, so an RFC 2047 subject ("=?UTF-8?Q?...?=") arrives
  // encoded — decode ONCE at ingest so every stored row reads as the sender wrote it.
  msg.subject = decodeMimeWords(msg.subject);

  // Route to the owning workspace from the ENVELOPE recipients (falls back to the To/Cc headers).
  const recipients = msg.recipients?.length ? msg.recipients : [msg.to, msg.cc].filter(Boolean) as string[];

  /**
   * SUPPORT REPLIES ARE CHECKED FIRST, and never fall through to the inbox.
   *
   * Every support email carries Reply-To: support+t.<ticket-id>@… so a reply identifies its
   * conversation by routing rather than by subject-line guessing. Without this branch the promise
   * printed at the bottom of every one of those emails — "reply to this email directly" — was
   * false: the reply landed in an email_thread node nobody triaging tickets ever looks at, so the
   * customer had answered and the ticket still read as waiting on them, all the way to auto-close.
   */
  for (const r of recipients) {
    const ticketId = ticketIdFromRecipient(r);
    if (!ticketId) continue;
    const filed = await fileSupportReply(ticketId, msg);
    // 200 either way: a reply to a ticket that has since been deleted is not something the mail
    // receiver can fix by retrying forever.
    return c.json({ ok: true, support_ticket: filed ? ticketId : null, ignored: filed ? undefined : "unknown ticket" });
  }

  /**
   * AN RSVP IS AN ANSWER, NOT AN EMAIL.
   *
   * When a guest clicks Accept, their client mails back a `text/calendar; method=REPLY` part. Those
   * were already arriving here — confirmed in the receiver log — and nothing read them, so a guest
   * could accept an invitation while the meeting still showed them as not having answered. Filed as
   * an ordinary message it would sit in a thread nobody reads, which is the same failure the
   * support branch above exists to prevent.
   *
   * Checked BEFORE workspace routing because the UID identifies the meeting directly; a reply does
   * not need to be addressed to a workspace mailbox to be meaningful.
   */
  const rsvp = await recordRsvpFromInbound(msg);
  if (rsvp) return c.json({ ok: true, rsvp });

  const workspaceId = workspaceIdFromRecipients(recipients);
  if (!workspaceId) return c.json({ ok: true, ignored: "no matching workspace address" });   // not for us — 200 so the receiver doesn't retry forever
  const { data: ws } = await supabase.from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
  if (!ws) return c.json({ ok: true, ignored: "unknown workspace" });

  const threadId = threadIdFor(msg);
  const { data: existing } = await supabase.from("nodes").select("id,data")
    .eq("workspace_id", workspaceId).eq("object_type", "email_thread").eq("data->>thread_id", threadId).maybeSingle();
  const stored = await storeAttachments(workspaceId, msg);
  const merged = mergeMessage((existing?.data ?? null) as ThreadData | null, msg, threadId, "inbound", stored);
  if (existing) {
    await supabase.from("nodes").update({ data: merged }).eq("id", existing.id).eq("workspace_id", workspaceId).eq("object_type", "email_thread");
  } else {
    await supabase.from("nodes").insert({ workspace_id: workspaceId, vertical: "shared", object_type: "email_thread", created_by: "agent:mail", data: merged });
  }
  return c.json({ ok: true, thread_id: threadId });
});

// ─────────────────────────────────────────────────────────────────────────────
router.use("*", requireAuth);

// GET /emails/inbound-address — the workspace's own sovereign inbound address (+ whether receiving
// is configured on this deployment). The UI shows it as "forward or point your MX here".
router.get("/inbound-address", (c) => c.json({
  address: inboundAddressFor(c.get("workspaceId")),
  enabled: mailDomainConfigured(),
}));

// GET /emails/attachment?path=<storage path> — a short-lived signed URL for an email attachment.
// Workspace-scoped: the path MUST live under this workspace's prefix, so one tenant can never fetch
// another's files even with a guessed path.
router.get("/attachment", zValidator("query", z.object({ path: z.string().min(1) })), async (c) => {
  const path = c.req.valid("query").path;
  if (!path.startsWith(`${c.get("workspaceId")}/`)) return c.json({ error: "Not allowed." }, 403);
  const { data, error } = await supabase.storage.from(ATTACH_BUCKET).createSignedUrl(path, 120);
  if (error || !data?.signedUrl) return c.json({ error: "Attachment not found." }, 404);
  return c.json({ url: data.signedUrl });
});

async function getSettings(workspaceId: string) {
  const { data } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).single();
  return (data?.settings ?? {}) as WorkspaceSettings;
}

// Legacy grant id (from an old integration profile) — only used to reflect "connected" state
// in the UI; all real inbox access is direct Google (lib/google). Nylas fully removed.
function getGrantId(settings: WorkspaceSettings) {
  for (const provider of ["gmail", "outlook"]) {
    const integration = settings.integrations?.[provider];
    if (typeof integration === "object" && integration.grant_id) return integration.grant_id;
  }
}

async function localThreads(workspaceId: string) {
  const { data } = await supabase.from("nodes").select("id,data,updated_at").eq("workspace_id", workspaceId).eq("object_type", "email_thread").order("updated_at", { ascending: false }).limit(50);
  return (data ?? []).map((node) => ({
    id: String(node.data.thread_id ?? node.id),
    // decodeMimeWords: rows stored before ingest decoded RFC 2047 still read correctly.
    subject: decodeMimeWords(String(node.data.subject ?? "(no subject)")),
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

  // No direct-Google inbox → fall back to the locally-cached email threads.
  const threads = await localThreads(c.get("workspaceId"));
  const nextCursor: string | undefined = undefined;

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
        subject: decodeMimeWords(last?.subject ?? ""),
        snippet: last?.snippet ?? "",
        participants: last ? [parseAddr(last.from)] : [],
        latest_message_received_date: last ? toUnixSeconds(last.date) : 0,
        unread: false,
        folders: [] as string[],
        messages: msgs.map((m) => ({ id: m.id, from: [parseAddr(m.from)], to: m.to ? [parseAddr(m.to)] : [], cc: [], date: toUnixSeconds(m.date), body: m.body, attachments: [] })),
      });
    }
  }

  const { data } = await supabase.from("nodes").select("id,data").eq("workspace_id", c.get("workspaceId")).eq("object_type", "email_thread").or(`id.eq.${orFilterValue(c.req.param("id"))},data->>thread_id.eq.${orFilterValue(c.req.param("id"))}`).maybeSingle();
  if (!data) return c.json({ error: "Thread not found" }, 404);
  // Same legacy-row decode as the list: subjects stored before ingest-decode read correctly.
  return c.json({ id: data.data.thread_id ?? data.id, ...data.data, subject: decodeMimeWords(String(data.data.subject ?? "")) });
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

  // DIRECT GOOGLE reply (preferred when a Gmail inbox is connected).
  const { data: gconn } = await supabase
    .from("email_connections")
    .select("id, refresh_token, access_token, token_expiry, email")
    .eq("workspace_id", c.get("workspaceId")).eq("provider", "google").limit(1).maybeSingle();
  const gc = gconn as { id: string; refresh_token?: string | null; access_token?: string | null; token_expiry?: string | null; email?: string } | null;
  if (gc && (gc.refresh_token || gc.access_token)) {
    const token = await freshAccessToken(gc);
    if (!token) return c.json({ error: "Gmail session expired — reconnect Gmail." }, 400);
    const msgs = await gmailThread(token, c.req.param("id"));
    const last = msgs[msgs.length - 1];
    if (!last) return c.json({ error: "Thread has no message to reply to" }, 400);
    const replyTo = parseAddr(last.from).email;
    const subject = /^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`;
    const { data: trackNode } = await supabase.from("nodes").insert({
      workspace_id: c.get("workspaceId"), vertical: "sales", object_type: "email_outbox",
      data: { thread_id: c.req.param("id"), subject, status: "sent", sent_at: new Date().toISOString(), opens: [], clicks: [] },
      created_by: c.get("userId"),
    }).select("id").single();
    const trackedBody = trackNode ? injectTracking(c.req.valid("json").body, trackNode.id) : c.req.valid("json").body;
    const ok = await gmailSend(token, { to: [replyTo], subject, html: trackedBody, from: gc.email, threadId: c.req.param("id"), inReplyTo: last.messageId });
    if (!ok) return c.json({ error: "Failed to send the reply via Gmail." }, 502);
    return c.json({ ok: true, tracking_id: trackNode?.id }, 201);
  }

  // SOVEREIGN reply — no Gmail: reply through the workspace's own mail system and fold the sent
  // message back into the local email_thread node so it shows in the conversation.
  const threadId = c.req.param("id");
  const { data: node } = await supabase.from("nodes").select("id,data")
    .eq("workspace_id", c.get("workspaceId")).eq("object_type", "email_thread")
    .or(`id.eq.${orFilterValue(threadId)},data->>thread_id.eq.${orFilterValue(threadId)}`).maybeSingle();
  if (!node) return c.json({ error: "Connect a Gmail inbox in Settings → Email, or configure native mail, before replying." }, 400);
  const tdata = node.data as ThreadData;
  const last = (tdata.messages ?? [])[tdata.messages.length - 1];
  const replyTo = last ? parseAddr(last.from).email : "";
  if (!replyTo) return c.json({ error: "This thread has no address to reply to." }, 400);
  const subject = /^re:/i.test(tdata.subject ?? "") ? tdata.subject : `Re: ${tdata.subject ?? ""}`;
  const from = inboundAddressFor(c.get("workspaceId")) ?? undefined;

  const { data: trackNode } = await supabase.from("nodes").insert({
    workspace_id: c.get("workspaceId"), vertical: "sales", object_type: "email_outbox",
    data: { thread_id: tdata.thread_id, subject, status: "sent", sent_at: new Date().toISOString(), opens: [], clicks: [] },
    created_by: c.get("userId"),
  }).select("id").single();
  const trackedBody = trackNode ? injectTracking(c.req.valid("json").body, trackNode.id) : c.req.valid("json").body;
  const ok = await sendWorkspaceEmail(c.get("workspaceId"), { subject, body: trackedBody, to: [{ email: replyTo }] });
  if (!ok) return c.json({ error: "Couldn't send the reply. Connect a Gmail inbox or configure native mail." }, 502);

  // Fold the sent message into the thread (outbound).
  const sent = buildOutboundMessage({ from: from ?? "me", to: replyTo, subject, html: c.req.valid("json").body, inReplyTo: last?.message_id ? `<${last.message_id}>` : undefined, references: last?.message_id ? [`<${last.message_id}>`] : undefined });
  const merged = mergeMessage(tdata, sent, tdata.thread_id, "outbound");
  await supabase.from("nodes").update({ data: merged }).eq("id", node.id).eq("workspace_id", c.get("workspaceId")).eq("object_type", "email_thread");
  return c.json({ ok: true, tracking_id: trackNode?.id }, 201);
});

// ── Compose + send a fresh email (from Discovery, a record, anywhere) ─────────
// Sends through the workspace's own system: connected Gmail if present, else Resend.
router.post("/compose", zValidator("json", z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(300),
  body: z.string().min(1),
  name: z.string().max(160).optional(),
})), async (c) => {
  const { to, subject, body, name } = c.req.valid("json");
  // Outbox node so the send is tracked (opens/clicks) and shows in the outbox.
  const { data: trackNode } = await supabase.from("nodes").insert({
    workspace_id: c.get("workspaceId"), vertical: "sales", object_type: "email_outbox",
    data: { to, subject, status: "sent", sent_at: new Date().toISOString(), opens: [], clicks: [] },
    created_by: c.get("userId"),
  }).select("id").single();
  const html = trackNode ? injectTracking(body, trackNode.id) : body;
  const ok = await sendWorkspaceEmail(c.get("workspaceId"), { subject, body: html, to: [{ email: to, name }] });
  if (!ok) return c.json({ error: "Couldn't send — connect a Gmail inbox in Settings → Email, or set RESEND_API_KEY on the API." }, 502);

  // When native mail is configured, fold this sent message into a thread so it shows in the inbox
  // (and a later reply from the recipient groups with it). No-op for the Gmail/Resend-only path.
  if (mailDomainConfigured()) {
    const from = inboundAddressFor(c.get("workspaceId")) ?? "me";
    const sent = buildOutboundMessage({ from, to, subject, html: body });
    const threadId = threadIdFor(sent);
    const { data: existing } = await supabase.from("nodes").select("id,data")
      .eq("workspace_id", c.get("workspaceId")).eq("object_type", "email_thread").eq("data->>thread_id", threadId).maybeSingle();
    const merged = mergeMessage((existing?.data ?? null) as ThreadData | null, sent, threadId, "outbound");
    if (existing) await supabase.from("nodes").update({ data: merged }).eq("id", existing.id).eq("workspace_id", c.get("workspaceId")).eq("object_type", "email_thread");
    else await supabase.from("nodes").insert({ workspace_id: c.get("workspaceId"), vertical: "shared", object_type: "email_thread", created_by: c.get("userId"), data: merged });
  }
  return c.json({ ok: true, tracking_id: trackNode?.id }, 201);
});

// ── AI: improve an email draft (real gateway call — replaces the old client-side regex stub) ──
router.post("/improve-draft", zValidator("json", z.object({ body: z.string().min(1).max(20000), instruction: z.string().max(400).optional() })), async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const env = gatewayEnv();
  if (!env.baseURL || !env.apiKey) return c.json({ error: "AI isn't available right now." }, 503);
  const { instruction } = c.req.valid("json");
  const plain = c.req.valid("json").body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return c.json({ error: "Nothing to improve." }, 400);
  const system = "You improve a business email draft: clearer, warmer, professional, concise. Keep the sender's intent and facts EXACTLY — never invent details, recipients, or commitments. Return ONLY the rewritten email body as clean HTML paragraphs, no preamble, no subject line.";
  const prompt = `${instruction ? `Instruction: ${instruction}\n\n` : ""}Draft to improve:\n${plain}`;
  try {
    const res = await aiGateway({ system, prompt, maxTokens: 700, workspaceId: ws, userId: me, feature: "email_improve" });
    const improved = (res.text ?? "").trim();
    if (!improved || res.provider === "none") return c.json({ error: "Couldn't improve that (check your AI credits)." }, 200);
    return c.json({ html: improved });
  } catch { return c.json({ error: "Couldn't improve that — please try again." }, 200); }
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
