import { supabase } from "@mondaily/db/client";
import { sendTransactionalEmail } from "./mail";
import { renderEmail, quoteBlock, factRows, esc } from "./email-template";

/**
 * Every email support sends, and the schedule that governs the silent ones.
 *
 * THE POLICY, and why it is not the one first proposed.
 *
 * "Weekly reminder, close after 24h if unanswered" cannot both be true — a weekly cadence never
 * fires before a 24-hour deadline. More importantly, 24 hours is the wrong number for a product
 * launching globally: someone who asks a question on Friday afternoon in Sydney loses their ticket
 * before Monday, having done nothing wrong. Closing a customer's request because they were asleep
 * is a support failure wearing the costume of efficiency.
 *
 * So the deadline is generous and the REMINDERS are frequent enough to be useful:
 *
 *   day 0   we ask for more information        → "we need something from you"
 *   day 3   first reminder                     → still open, no pressure
 *   day 7   second reminder                    → says plainly it will close on day 10
 *   day 10  auto-close                         → "reply to reopen" — nothing is lost
 *
 * Two properties matter more than the exact days. The warning arrives BEFORE the close, so nobody
 * is surprised; and closing is reversible by replying, so the deadline costs the customer nothing
 * except a second message. The clock only runs while WE are waiting — a ticket we have not answered
 * never expires, because that would let us close our own backlog by ignoring it.
 */

export const WAITING_REMINDER_DAYS = [3, 7] as const;
export const WAITING_CLOSE_DAYS = 10;

const APP = () => process.env.APP_URL ?? "https://app.mondaily.com";
const ticketUrl = (id: string) => `${APP()}/settings/support?ticket=${encodeURIComponent(id)}`;

interface Recipient { email: string; name?: string | null }

/**
 * The reply address that carries the ticket.
 *
 * Every support email promises "reply to this email". A plus-address is what makes that promise
 * true rather than decorative: the ticket id travels in the address itself, so a reply is filed by
 * routing rather than by guessing from a subject line the customer may have rewritten or their
 * client may have localised ("Re:" is not "Re:" in every language).
 *
 * Plus-addressing keeps ONE mailbox — no per-ticket addresses to provision or clean up.
 *
 * It reuses SOVEREIGN_MAIL_DOMAIN — the domain the self-hosted receiver already accepts — rather
 * than inventing a support@ mailbox on another domain. Inventing one would have made the whole
 * feature dead on arrival: the reply-to would have pointed somewhere with no MX record and no
 * receiver, so every reply bounced while the code looked complete.
 *
 * Returns null when sovereign receiving is not configured, and the emails then stop PROMISING a
 * reply route (see `replyable` below). An email that says "just reply" into a void is worse than
 * one that only offers a link.
 */
const mailDomain = () => (process.env.SOVEREIGN_MAIL_DOMAIN || "").trim().toLowerCase();
export function supportReplyAddress(ticketId: string): string | null {
  const d = mailDomain();
  return d ? `support+t.${ticketId}@${d}` : null;
}

/** The ticket id an inbound recipient address points at, or null when it points at no ticket. */
export function ticketIdFromRecipient(address: string): string | null {
  const m = /\+t\.([0-9a-f-]{8,})@/i.exec(String(address ?? ""));
  return m ? m[1]! : null;
}

/** Can the customer answer by replying, on THIS deployment? Every "just reply" line depends on it. */
export const canReplyByEmail = () => supportReplyAddress("probe") !== null;

/** The "reply to continue" sentence — or nothing at all, where a reply would bounce. */
function replyLine(text: string): string {
  return canReplyByEmail() ? `<p style="margin:12px 0 0">${text}</p>` : "";
}

async function send(to: Recipient, ticketId: string, subject: string, html: string): Promise<boolean> {
  if (!to.email) return false;
  const replyTo = supportReplyAddress(ticketId);
  return sendTransactionalEmail({
    to: [{ email: to.email, name: to.name ?? undefined }],
    subject,
    body: html,
    ...(replyTo ? { reply_to: replyTo } : {}),
  }).catch(() => false);
}

/** 1 — We received it. Sent immediately, so nobody wonders whether the form worked. */
export async function mailTicketCreated(to: Recipient, t: { id: string; subject: string; message: string; category: string }) {
  const html = renderEmail({
    title: "We have your request",
    preheader: `We're looking at "${t.subject}".`,
    bodyHtml: `<p style="margin:0 0 10px">Thanks — this is with the Mondaily team now. You'll get an email the moment someone replies.</p>
      ${factRows([{ label: "Reference", value: t.id.slice(0, 8) }, { label: "Topic", value: t.category.replace(/_/g, " ") }])}
      ${quoteBlock("You wrote", t.message)}`,
    replyable: canReplyByEmail(),
    action: { label: "View your request", url: ticketUrl(t.id) },
  });
  return send(to, t.id, `We have your request — ${t.subject}`, html);
}

/** 2 — A human replied. The reply is IN the email: nobody should have to log in to read one sentence. */
export async function mailSupportReplied(to: Recipient, t: { id: string; subject: string }, reply: { author: string; body: string; at: string }) {
  const html = renderEmail({
    title: "Mondaily support replied",
    preheader: reply.body.slice(0, 110),
    bodyHtml: `${quoteBlock(reply.author, reply.body, new Date(reply.at).toLocaleString())}
      ${replyLine("Reply to this email to continue the conversation.")}`,
    replyable: canReplyByEmail(),
    action: { label: "Open the conversation", url: ticketUrl(t.id) },
  });
  return send(to, t.id, `Re: ${t.subject}`, html);
}

/** 3 — We need something back. Starts the clock described at the top of this file. */
export async function mailWaitingOnUser(to: Recipient, t: { id: string; subject: string }, ask: string) {
  const html = renderEmail({
    title: "We need one thing from you",
    preheader: ask.slice(0, 110),
    bodyHtml: `${quoteBlock("Mondaily support", ask)}
      <p style="margin:12px 0 0">Reply whenever suits — this stays open for ${WAITING_CLOSE_DAYS} days.</p>`,
    replyable: canReplyByEmail(),
    action: { label: "Reply now", url: ticketUrl(t.id) },
  });
  return send(to, t.id, `Re: ${t.subject} — one question`, html);
}

/**
 * 4 — Reminder while we wait.
 *
 * `closesInDays` is stated only on the LAST reminder. Leading with a deadline on day 3 reads as
 * pressure over a question the customer may simply not have got to yet.
 */
export async function mailWaitingReminder(
  to: Recipient, t: { id: string; subject: string }, daysWaiting: number, closesInDays: number | null,
) {
  const html = renderEmail({
    title: "Still waiting on you",
    preheader: `Your request "${t.subject}" is open and needs a reply.`,
    bodyHtml: `<p style="margin:0 0 10px">We asked a question about <strong style="color:#141414">${esc(t.subject)}</strong> ${daysWaiting} days ago and haven't heard back. No rush — we just don't want to leave it half-finished.</p>
      ${closesInDays !== null
        ? `<p style="margin:0">If we don't hear from you, we'll close it in ${closesInDays} day${closesInDays === 1 ? "" : "s"}. Replying at any point — even later — reopens it.</p>`
        : `<p style="margin:0">It stays open; reply whenever you can.</p>`}`,
    replyable: canReplyByEmail(),
    action: { label: "Reply now", url: ticketUrl(t.id) },
  });
  return send(to, t.id, `Reminder: ${t.subject}`, html);
}

/** 5 — Closed for silence. Framed as reversible, because it is. */
export async function mailAutoClosed(to: Recipient, t: { id: string; subject: string }) {
  const html = renderEmail({
    title: "Closed for now",
    preheader: `"${t.subject}" was closed — reply any time to reopen it.`,
    bodyHtml: `<p style="margin:0 0 10px">We didn't hear back on <strong style="color:#141414">${esc(t.subject)}</strong>, so we've closed it to keep your list tidy.</p>
      <p style="margin:0">Nothing is lost${canReplyByEmail() ? " — reply to this email and it reopens exactly where it left off" : "; reopen it any time from the link below"}.</p>`,
    replyable: canReplyByEmail(),
    action: { label: "Reopen the request", url: ticketUrl(t.id) },
  });
  return send(to, t.id, `Closed: ${t.subject}`, html);
}

/** 6 — Solved. Says what was done, not merely that it is over. */
export async function mailResolved(to: Recipient, t: { id: string; subject: string }, summary?: string) {
  const html = renderEmail({
    title: "That's sorted",
    preheader: `"${t.subject}" is resolved.`,
    bodyHtml: `<p style="margin:0 0 10px">We've marked <strong style="color:#141414">${esc(t.subject)}</strong> as resolved.</p>
      ${summary ? quoteBlock("What we did", summary) : ""}
      <p style="margin:12px 0 0">If it isn't right, ${canReplyByEmail() ? "reply and it reopens" : "reopen it from the link below"} — you don't need to file a new request.</p>`,
    replyable: canReplyByEmail(),
    action: { label: "View the conversation", url: ticketUrl(t.id) },
  });
  return send(to, t.id, `Resolved: ${t.subject}`, html);
}

/**
 * 7 — Tell MONDAILY a ticket arrived.
 *
 * The customer-facing half of this file was complete while our own half was not: a new ticket
 * raised an in-app notification for the *customer's* workspace admins and nothing at all for the
 * people who actually answer tickets. Whoever is on support would have had to remember to open the
 * dashboard — which is how the oldest open ticket in production reached 762 hours.
 *
 * Goes to PLATFORM_ADMIN_EMAILS, so it is silent (not broken) where that allowlist is unset, the
 * same fail-closed rule the platform routes use.
 */
export async function mailPlatformNewTicket(t: {
  id: string; subject: string; message: string; category: string;
  workspace_name?: string; requester_email?: string; plan?: string;
}): Promise<number> {
  const { platformAdminEmails } = await import("../middleware/platform-admin");
  const to = platformAdminEmails();
  if (to.length === 0) return 0;

  const html = renderEmail({
    title: "New support request",
    preheader: `${t.subject} — ${t.workspace_name ?? "a workspace"}`,
    bodyHtml: `${factRows([
      { label: "Workspace", value: t.workspace_name ?? "—" },
      { label: "From", value: t.requester_email ?? "—" },
      { label: "Plan", value: t.plan ?? "—" },
      { label: "Topic", value: t.category.replace(/_/g, " ") },
    ])}${quoteBlock(t.subject, t.message)}`,
    action: { label: "Open in the support dashboard", url: `${APP()}/platform/support?ticket=${encodeURIComponent(t.id)}` },
  });

  let sent = 0;
  for (const email of to) {
    // One send per operator, not one mail with everyone in To: — an internal alert should not
    // disclose the rest of the allowlist to each recipient.
    if (await sendTransactionalEmail({ to: [{ email }], subject: `[support] ${t.subject}`, body: html }).catch(() => false)) sent++;
  }
  return sent;
}

// ── inbound: a reply by email is a reply on the ticket ────────────────────────

/**
 * Strip the quoted history off a reply.
 *
 * Mail clients append the entire prior thread below the new text. Stored verbatim, a ticket's third
 * reply contains three copies of the conversation and the actual sentence someone wrote is buried
 * under our own boilerplate. Cutting at the usual attribution markers keeps what the customer
 * typed; if none match we keep everything, because losing a reply is far worse than an untidy one.
 */
export function stripQuotedReply(raw: string): string {
  const text = String(raw ?? "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const cut = [
    /^\s*On .+ wrote:\s*$/m,            // Gmail / Apple Mail
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^\s*From:\s.+$/m,                  // Outlook
    /^\s*_{5,}\s*$/m,
    /^\s*Sent by Mondaily\./m,          // our own footer, quoted back at us
  ].map((re) => text.search(re)).filter((i) => i > 0);
  const body = (cut.length ? text.slice(0, Math.min(...cut)) : text).trim();
  // A reply that is ONLY quoted history (someone hit send on an empty compose) still has to be
  // recorded as activity, so fall back to the untrimmed text rather than storing nothing.
  return body || text.trim();
}

/**
 * File an inbound email onto its ticket. Returns false when the ticket no longer exists.
 *
 * Mirrors what POST /support/tickets/:id/comments does for the in-app path — deliberately, because
 * the two must not diverge: an emailed reply and a typed reply are the same event, and if only one
 * of them stopped the reminder clock the other would auto-close a live conversation.
 */
export async function fileSupportReply(
  ticketId: string,
  msg: { from: string; text?: string; html?: string; message_id?: string; date?: string },
): Promise<boolean> {
  const { data: node } = await supabase.from("nodes")
    .select("id, workspace_id, created_by, data")
    .eq("object_type", "support_ticket").eq("id", ticketId).maybeSingle();
  if (!node) return false;

  const d = ((node as TicketRow).data ?? {}) as Record<string, unknown>;
  const comments = (d.comments as unknown[] | undefined) ?? [];
  // Idempotent by Message-ID: mail receivers redeliver, and a redelivery must not look like the
  // customer writing twice.
  const mid = String(msg.message_id ?? "");
  if (mid && comments.some((cm) => (cm as { message_id?: string }).message_id === mid)) return true;

  const now = new Date().toISOString();
  const body = stripQuotedReply(msg.html || msg.text || "").slice(0, 8000);
  const status = String(d.status ?? "open");

  await supabase.from("nodes").update({
    data: {
      ...d,
      updated_at: now,
      comments: [...comments, {
        author_id: `email:${msg.from}`, author_role: "requester", body, at: msg.date ?? now,
        ...(mid ? { message_id: mid } : {}),
      }],
      // REPLYING REOPENS. Every closing email says so, including the auto-close one, so a reply to
      // a resolved or auto-closed ticket must genuinely bring it back rather than vanish.
      ...(status === "resolved" || status === "closed" || status === "waiting_on_user"
        ? {
            status: "open",
            waiting_since: undefined,
            reminders_sent: undefined,
            status_history: [...((d.status_history as unknown[]) ?? []),
              { status: "open", at: now, by: "system:email_reply" }],
          }
        : {}),
    },
  }).eq("id", node.id).eq("workspace_id", (node as TicketRow).workspace_id);
  return true;
}

// ── the scheduled half ────────────────────────────────────────────────────────

interface TicketRow { id: string; workspace_id: string; created_by: string | null; data: Record<string, unknown> }

/**
 * Walk every ticket waiting on a customer and send exactly what is due.
 *
 * IDEMPOTENT by stamping what was sent onto the ticket. A cron that runs twice — a retry, an
 * overlapping schedule, a manual trigger — must not email the same person twice about the same day.
 * `reminders_sent` is the record of intent, not a log of attempts.
 */
export async function runWaitingOnUserSweep(now = new Date()): Promise<{
  examined: number; reminded: number; closed: number;
}> {
  const { data } = await supabase.from("nodes")
    .select("id, workspace_id, created_by, data")
    .eq("object_type", "support_ticket")
    .eq("data->>status", "waiting_on_user")
    .limit(500);

  let reminded = 0, closed = 0;
  for (const row of (data ?? []) as TicketRow[]) {
    const d = (row.data ?? {}) as Record<string, unknown>;
    const meta = (d.metadata ?? {}) as Record<string, unknown>;
    const r = (meta.requester ?? {}) as { email?: string; name?: string };
    // No mailbox, no clock. A ticket we cannot warn must never be auto-closed for silence — that
    // would close it on someone who was never asked.
    if (!r.email) continue;
    const requester: Recipient = { email: r.email, name: r.name };

    // The clock starts when WE last asked — not when the ticket was created. A ticket that sat in
    // our queue for a week must not arrive at the customer already three days into its deadline.
    const since = String(d.waiting_since ?? d.updated_at ?? "");
    const startedAt = since ? new Date(since).getTime() : NaN;
    if (!Number.isFinite(startedAt)) continue;
    const days = Math.floor((now.getTime() - startedAt) / 86_400_000);

    const sent = new Set((d.reminders_sent as number[] | undefined) ?? []);
    const subject = String(d.subject ?? "your request");
    const t = { id: row.id, subject };

    if (days >= WAITING_CLOSE_DAYS) {
      await mailAutoClosed(requester, t);
      await supabase.from("nodes").update({
        data: {
          ...d, status: "closed", updated_at: now.toISOString(),
          closed_reason: "no_reply",
          status_history: [...((d.status_history as unknown[]) ?? []), { status: "closed", at: now.toISOString(), by: "system:no_reply" }],
        },
      }).eq("id", row.id).eq("workspace_id", row.workspace_id);
      closed++;
      continue;
    }

    const due = WAITING_REMINDER_DAYS.filter((r) => days >= r && !sent.has(r));
    if (due.length === 0) continue;
    // Only the LATEST milestone is sent: a ticket that slipped past both marks (a paused cron, a
    // long outage) should produce one reminder, not a burst that reads as spam.
    const milestone = Math.max(...due);
    const isLast = milestone === WAITING_REMINDER_DAYS[WAITING_REMINDER_DAYS.length - 1];
    await mailWaitingReminder(requester, t, days, isLast ? WAITING_CLOSE_DAYS - days : null);
    await supabase.from("nodes").update({
      data: { ...d, reminders_sent: [...sent, ...due] },
    }).eq("id", row.id).eq("workspace_id", row.workspace_id);
    reminded++;
  }

  return { examined: (data ?? []).length, reminded, closed };
}
