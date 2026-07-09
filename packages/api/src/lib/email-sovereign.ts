import { createHash } from "node:crypto";

/**
 * Sovereign email — the pure thread engine.
 *
 * Mondaily can receive + send real email WITHOUT any third-party provider: a self-hosted mail
 * receiver (see deploy/) POSTs parsed inbound messages to /emails/inbound, and this module folds
 * them into the SAME `email_thread` node model the existing inbox UI already renders. No Gmail
 * required. Everything here is pure + deterministic so the threading, address routing, and node
 * shaping are fully unit-testable without a mailbox.
 *
 * FAIL-CLOSED at the route layer: inbound needs SOVEREIGN_MAIL_SECRET; addressing needs
 * SOVEREIGN_MAIL_DOMAIN. Unset ⇒ the feature is simply off (like LiveKit/STT/search).
 */

const strip = (s: string) => (s ?? "").replace(/^<|>$/g, "").trim();

/** Strip repeated Re:/Fwd:/Fw:/Aw: prefixes and collapse whitespace — the stable subject for grouping. */
export function normalizeSubject(subject: string): string {
  let s = (subject ?? "").trim();
  // Remove one-or-more localized reply/forward prefixes from the front.
  while (true) {
    const next = s.replace(/^(re|fwd?|aw|wg|sv|vs|res|antw)\s*(\[\d+\])?\s*:\s*/i, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").trim();
}

/** Parse an RFC-822 "Name <email>" (or bare address) into {name?, email}. */
export function parseAddr(s: string): { name?: string; email: string } {
  const m = (s ?? "").match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  if (m) return { name: (m[1] ?? "").trim() || undefined, email: (m[2] ?? "").trim().toLowerCase() };
  return { email: (s ?? "").trim().toLowerCase() };
}

export interface InboundMessage {
  message_id: string;
  in_reply_to?: string;
  references?: string[];
  from: string;                 // RFC-822 header value
  to: string;                   // RFC-822 header value (primary recipient shown)
  cc?: string;
  subject: string;
  text?: string;
  html?: string;
  date?: string;                // RFC-822 / ISO date
}

/**
 * The canonical thread id for a message. Real mail threads reference their root message, so we
 * prefer References[0] / In-Reply-To (the conversation root). With neither (a fresh mail), we derive
 * a STABLE id from the normalized subject + the sorted participant set, so a later reply that DOES
 * carry the same subject+people still lands in one thread rather than fragmenting.
 */
export function threadIdFor(msg: Pick<InboundMessage, "references" | "in_reply_to" | "message_id" | "from" | "to" | "subject">): string {
  const root = (msg.references && msg.references.length > 0 ? msg.references[0] : msg.in_reply_to) || "";
  if (strip(root)) return strip(root);
  const people = [parseAddr(msg.from).email, ...(msg.to ?? "").split(",").map((a) => parseAddr(a).email)].filter(Boolean).sort();
  const seed = `${normalizeSubject(msg.subject).toLowerCase()}|${[...new Set(people)].join(",")}`;
  return `mtd-${createHash("sha1").update(seed).digest("hex").slice(0, 24)}`;
}

const toUnixSeconds = (dateStr?: string): number => {
  const t = Date.parse(dateStr ?? "");
  return Number.isNaN(t) ? Math.floor(Date.now() / 1000) : Math.floor(t / 1000);
};

interface StoredMsg { id: string; from: string; to: string; cc?: string; date: string; body: string; message_id: string }
export interface ThreadData {
  thread_id: string; subject: string; snippet: string;
  participants: { name?: string; email: string }[];
  latest_message_received_date: number; unread: boolean; folders: string[];
  messages: StoredMsg[]; source: "sovereign";
}

/**
 * Fold an inbound message into a thread's data (existing or null → new). Idempotent by Message-ID:
 * re-delivering the same message won't duplicate it. `direction` marks whether WE received it
 * (inbox, unread) or sent it (sent folder, read).
 */
export function mergeMessage(existing: ThreadData | null, msg: InboundMessage, threadId: string, direction: "inbound" | "outbound"): ThreadData {
  const body = (msg.html || msg.text || "").toString();
  const stored: StoredMsg = { id: strip(msg.message_id) || `${threadId}-${(existing?.messages.length ?? 0) + 1}`, message_id: strip(msg.message_id), from: msg.from, to: msg.to, cc: msg.cc, date: msg.date ?? new Date().toISOString(), body };

  const priorMsgs = existing?.messages ?? [];
  // De-dupe by Message-ID (webhook redelivery safety).
  const messages = priorMsgs.some((m) => m.message_id && m.message_id === stored.message_id)
    ? priorMsgs
    : [...priorMsgs, stored].sort((a, b) => toUnixSeconds(a.date) - toUnixSeconds(b.date));

  const participants = [...new Map(
    messages.flatMap((m) => [m.from, ...(m.to ?? "").split(","), ...((m.cc ?? "").split(","))])
      .map((a) => parseAddr(a)).filter((p) => p.email)
      .map((p) => [p.email, p] as const),
  ).values()];

  const folders = [...new Set([...(existing?.folders ?? []), direction === "inbound" ? "inbox" : "sent"])];
  const snippet = (msg.text || msg.html || "").toString().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);

  return {
    thread_id: threadId,
    subject: existing?.subject || normalizeSubject(msg.subject) || "(no subject)",
    snippet,
    participants,
    latest_message_received_date: toUnixSeconds(stored.date),
    unread: direction === "inbound" ? true : (existing?.unread ?? false),
    folders,
    messages,
    source: "sovereign",
  };
}

// ── Address routing ─────────────────────────────────────────────────────────────

const mailDomain = () => (process.env.SOVEREIGN_MAIL_DOMAIN || "").trim().toLowerCase();
/** Sovereign email is available for INBOUND addressing when a domain is configured. */
export const mailDomainConfigured = () => mailDomain().length > 0;

/** The workspace's own sovereign inbound address: ws-<workspaceId>@<domain>. Deterministic — no
 *  table needed, and the workspace id can't collide across tenants. */
export function inboundAddressFor(workspaceId: string): string | null {
  const d = mailDomain();
  return d ? `ws-${workspaceId}@${d}` : null;
}

/** Resolve which workspace a delivered message belongs to, from its recipient list. Only accepts
 *  our own domain + the ws-<id> local-part form, so a spoofed To: can't target another workspace. */
export function workspaceIdFromRecipients(recipients: string[]): string | null {
  const d = mailDomain();
  if (!d) return null;
  for (const raw of recipients) {
    const email = parseAddr(raw).email;
    const at = email.lastIndexOf("@");
    if (at < 0 || email.slice(at + 1) !== d) continue;
    const local = email.slice(0, at);
    if (local.startsWith("ws-")) return local.slice(3);
  }
  return null;
}
