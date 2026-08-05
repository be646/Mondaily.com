/**
 * Outbound mail with a two-tier delivery strategy.
 *
 * Two audiences, two senders:
 *   sendWorkspaceEmail  — FROM a workspace (sovereign relay → their connected Gmail → Resend).
 *   sendTransactionalEmail / sendPlatformEmail — FROM Mondaily (sovereign relay → Resend). It
 *     deliberately skips the Gmail path: routing a password reset through a customer's own inbox
 *     would send from an address we cannot authenticate, and get it spoof-flagged.
 *
 * Best-effort: every path returns a boolean and never throws, so callers can
 * surface the invite link as a manual fallback when neither route is configured.
 */
import { createHmac } from "node:crypto";
import { supabase } from "@mondaily/db/client";
import { freshAccessToken, gmailSend } from "./google";
import { inboundAddressFor } from "./email-sovereign";

export type OutboundMessage = {
  subject: string;
  /** HTML body. */
  body: string;
  to: { email: string; name?: string }[];
  /**
   * Where a reply should land, when that is not the From address.
   *
   * Support uses this to carry the ticket id in a plus-address, which is what makes "just reply to
   * this email" true rather than decorative: the reply arrives at an address that identifies the
   * conversation, so /emails/inbound can file it back onto the ticket instead of guessing from a
   * subject line the customer may have edited.
   */
  reply_to?: string;
};

/** PRIMARY: send from the workspace's connected Gmail inbox (direct Google API). */
async function sendViaGoogle(workspaceId: string, msg: OutboundMessage): Promise<boolean> {
  try {
    const { data: conn } = await supabase
      .from("email_connections")
      .select("id, refresh_token, access_token, token_expiry, email")
      .eq("workspace_id", workspaceId)
      .eq("provider", "google")
      .limit(1)
      .maybeSingle();
    if (!conn) return false; // no Google inbox connected → fall back
    const token = await freshAccessToken(conn as { id: string; refresh_token?: string | null; access_token?: string | null; token_expiry?: string | null });
    if (!token) return false;
    return gmailSend(token, {
      to: msg.to.map((t) => t.email),
      subject: msg.subject,
      html: msg.body,
      from: (conn as { email?: string }).email || undefined,
    });
  } catch {
    return false;
  }
}

/** Verified corporate sender on our own registered domain. Auth/transactional mail MUST come
 *  from here (never the user's Gmail) so SPF/DKIM pass and the message isn't dropped as a spoof. */
const CORPORATE_FROM = process.env.RESEND_FROM ?? process.env.TRANSACTIONAL_MAIL_FROM ?? "Mondaily Networks <no-reply@mondaily.com>";

/** Send via Resend with our verified API key + corporate from-address. Used both as the
 *  inbox fallback AND directly for auth mail (which must bypass the Gmail path entirely). */
async function sendViaTransactional(msg: OutboundMessage): Promise<boolean> {
  const key = process.env.RESEND_API_KEY ?? process.env.TRANSACTIONAL_MAIL_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: CORPORATE_FROM,
        to: msg.to.map((t) => t.email),
        subject: msg.subject,
        html: msg.body,
        ...(msg.reply_to ? { reply_to: msg.reply_to } : {}),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Auth, invites, digests, notifications — everything Mondaily sends that is not from a workspace.
 *
 * SOVEREIGN RELAY FIRST, transactional only as a fallback. This used to go straight to Resend, and
 * the cost was measured on 2026-08-05: of thirteen accounts registered in three weeks, ZERO had
 * ever verified their email, and our own mail server had never relayed a single message to any of
 * them — its only external recipient in its entire history was the owner. Four of those thirteen
 * look like real people who signed up, never got a verification mail, and never came back.
 *
 * Whether Resend was silently rejecting (an unverified sender domain 403s, and the caller's
 * `catch {}` swallowed it) barely matters: the relay is the path we have PROVEN end-to-end, with
 * DKIM aligned and Gmail accepting into the inbox rather than spam. Trying a third party first for
 * the most important mail in the product, while our own server sat idle, was backwards twice over —
 * for deliverability and for sovereignty.
 */
export async function sendTransactionalEmail(msg: OutboundMessage): Promise<boolean> {
  return sendPlatformEmail(msg, { localPart: "no-reply", displayName: "Mondaily" });
}

/**
 * SOVEREIGN: relay through Mondaily's own self-hosted mail sender (the deploy/ appliance's /send
 * endpoint), from the workspace's own address so replies route back to /emails/inbound. Fully
 * self-hosted — no third-party. Fail-closed: without SOVEREIGN_MAIL_SEND_URL + _SECRET this returns
 * false and we fall through to the next tier.
 */
/**
 * RFC 5322 display-name quoting. A workspace called `Acme, Inc.` contains a comma, which unquoted
 * turns one From into two malformed addresses; embedded quotes and backslashes must be escaped.
 */
export function quotedDisplayName(name: string): string {
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Workspace name for the From display name, cached — one extra read per send is not worth it. */
const wsNameCache = new Map<string, { name: string; at: number }>();
const WS_NAME_TTL_MS = 5 * 60 * 1000;

async function workspaceDisplayName(workspaceId: string): Promise<string> {
  const hit = wsNameCache.get(workspaceId);
  if (hit && Date.now() - hit.at < WS_NAME_TTL_MS) return hit.name;
  let name = "Mondaily";      // never blank: an empty display name is worse than a generic one
  try {
    const { data } = await supabase.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
    const n = String((data as { name?: string } | null)?.name ?? "").trim();
    if (n) name = n;
  } catch { /* fall back to the default rather than failing a send over a display name */ }
  wsNameCache.set(workspaceId, { name, at: Date.now() });
  return name;
}

async function sendViaSovereignRelay(workspaceId: string, msg: OutboundMessage): Promise<boolean> {
  // A DISPLAY NAME on the From. The routing address is `ws-<uuid>@inbound.<domain>`, and sent bare
  // it reads — to filters and to humans — like machine-generated throwaway mail.
  const address = inboundAddressFor(workspaceId);
  const from = address ? `${quotedDisplayName(await workspaceDisplayName(workspaceId))} <${address}>` : CORPORATE_FROM;
  return relaySend(from, msg);
}

/**
 * Relay one message through the sovereign appliance, from an explicit address.
 *
 * Split out from the workspace path because not every sovereign send is FROM a workspace. Support
 * mail comes from Mondaily itself, and routing it through the workspace address would have put a
 * customer's own `ws-<id>@…` in the From of an email Mondaily wrote — and pointed replies at their
 * inbox instead of ours.
 */
async function relaySend(from: string, msg: OutboundMessage): Promise<boolean> {
  const url = process.env.SOVEREIGN_MAIL_SEND_URL;
  const secret = process.env.SOVEREIGN_MAIL_SECRET;
  if (!url || !secret) return false;
  // BOUNDED. This fetch had no timeout, so a SEND_URL pointing at an unreachable host stalled every
  // outbound email on TCP connect (tens of seconds) before falling through to Gmail/transactional —
  // long enough to blow the serverless function limit and turn a working send into a failure. Found
  // exactly that way: the appliance's :8095 is not reachable from the public internet, so the tier
  // chain was "intact" while being unusable. A degraded appliance must cost ~5s, not the request.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const body = JSON.stringify({ from, to: msg.to.map((t) => t.email), subject: msg.subject, html: msg.body, ...(msg.reply_to ? { reply_to: msg.reply_to } : {}) });
    const res = await fetch(url.replace(/\/$/, "") + "/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mondaily-mail-signature": createHmac("sha256", secret).update(body).digest("hex") },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) console.warn(`[mail] sovereign relay HTTP ${res.status} — falling through`);
    return res.ok;
  } catch (e) {
    // Say so. A silent false here is indistinguishable from "not configured", which is how an
    // unreachable relay stayed invisible.
    console.warn("[mail] sovereign relay unreachable — falling through:", e instanceof Error ? e.message : String(e));
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a workspace email: the sovereign self-hosted relay first (when configured), then a connected
 * Gmail inbox, then the transactional fallback. Returns true if any route accepted the message.
 */
/**
 * Send AS MONDAILY — support mail, and anything else the platform itself writes.
 *
 * Sovereign relay first, transactional only as a fallback. Support's lifecycle originally used
 * `sendTransactionalEmail`, which is Resend-only: our own self-hosted mail server was never even
 * tried for the mail we send most of, which is precisely backwards for a product whose rule is that
 * nothing is outsourced.
 *
 * `localPart` also determines what a customer reaches by hitting Reply on the From (rather than the
 * Reply-To), so it must be an address the receiver forwards — which, since the receiver accepts any
 * recipient on its domain, any local part on SOVEREIGN_MAIL_DOMAIN is.
 */
export async function sendPlatformEmail(
  msg: OutboundMessage, opts: { localPart: string; displayName: string },
): Promise<boolean> {
  const domain = (process.env.SOVEREIGN_MAIL_DOMAIN || "").trim().toLowerCase();
  if (domain) {
    const from = `${quotedDisplayName(opts.displayName)} <${opts.localPart}@${domain}>`;
    if (await relaySend(from, msg)) return true;
  }
  return sendViaTransactional(msg);
}

export async function sendWorkspaceEmail(workspaceId: string, msg: OutboundMessage): Promise<boolean> {
  if (await sendViaSovereignRelay(workspaceId, msg)) return true;
  if (await sendViaGoogle(workspaceId, msg)) return true;
  return sendViaTransactional(msg);
}

/**
 * Is the sovereign mail appliance actually THERE? A read-only liveness probe for the readiness
 * inspector — `GET /health`, no HMAC, no secret, no message, never throws.
 *
 * Lives here rather than in routes/admin-readiness because that endpoint is guarded (correctly)
 * against reading env VALUES and against calling `fetch` at all — and because a probe of the relay
 * belongs beside the code that sends through it, so the two cannot drift apart.
 *
 * Returns:
 *   configured   — both envs are set (a claim)
 *   reachable    — the appliance answered 2xx (evidence)
 *   checkable    — false when we could not find out (unset, or the probe errored/timed out)
 *
 * `configured && !reachable` is the state that reported a healthy relay for a day while every
 * outbound send silently fell back to Gmail.
 */
export async function sovereignRelayStatus(): Promise<{ configured: boolean; reachable: boolean; checkable: boolean }> {
  const url = (process.env.SOVEREIGN_MAIL_SEND_URL ?? "").trim();
  const secret = (process.env.SOVEREIGN_MAIL_SECRET ?? "").trim();
  const configured = !!url && !!secret;
  if (!configured) return { configured: false, reachable: false, checkable: false };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3_000);
  try {
    const res = await fetch(url.replace(/\/$/, "") + "/health", { signal: ctrl.signal });
    return { configured: true, reachable: res.ok, checkable: true };
  } catch {
    // Unreachable is a real answer, but we mark it un-checkable too: a network blip and a dead
    // appliance look identical from here, and claiming certainty would repeat the original mistake.
    return { configured: true, reachable: false, checkable: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Recordings-bucket usage — the readiness inspector's storage probe. Lives beside the other
 * appliance probes for the same reason sovereignRelayStatus does: readiness may not call fetch or
 * read env values itself.
 *
 * Supabase exposes no total-usage API to the service client, so this WALKS the meeting-recordings
 * bucket (the only uncapped-growth bucket — attachments are 10MB-capped) and sums file sizes, one
 * folder level deep, bounded at 2000 objects. Past the bound it reports `partial: true` rather than
 * pretending the sum is the total — an understated storage number is how limits sneak up.
 */
/** Walk ONE bucket to file depth (bounded BFS) and sum sizes. */
async function bucketUsage(BUCKET: string, CAP = 2000): Promise<{ bytes: number; files: number; partial: boolean; checkable: boolean }> {
  try {
    const MAX_DEPTH = 4;     // paths are ws/session/file (3 deep); one spare level of headroom
    let bytes = 0, files = 0, partial = false;
    // BFS over folder prefixes. The first version walked ONE level and read back 0 bytes with
    // checkable:true while the dashboard said ~7GB — a probe confidently measuring the wrong thing,
    // the exact false-confidence failure this codebase keeps hunting. Recording paths are
    // `${ws}/${session.id}/${filename}`, so a fixed one-level walk saw only empty-looking folders.
    const queue: { prefix: string; depth: number }[] = [{ prefix: "", depth: 0 }];
    while (queue.length) {
      const { prefix, depth } = queue.shift()!;
      if (files >= CAP) { partial = true; break; }
      const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 });
      if (error) { if (prefix === "") return { bytes: 0, files: 0, partial: false, checkable: false }; continue; }
      const entries = data ?? [];
      if (entries.length === 1000) partial = true;   // this listing itself truncated
      for (const e of entries) {
        const size = (e.metadata as { size?: number } | null)?.size;
        if (typeof size === "number") { bytes += size; files++; }
        else if (depth + 1 < MAX_DEPTH) queue.push({ prefix: prefix ? `${prefix}/${e.name}` : e.name, depth: depth + 1 });
        else partial = true;   // deeper than we walk — say so rather than undercount silently
      }
    }
    return { bytes, files, partial, checkable: true };
  } catch {
    return { bytes: 0, files: 0, partial: false, checkable: false };
  }
}

/**
 * Usage across EVERY bucket. Exists because the recordings-only probe read a truthful zero while
 * the dashboard warned ~7GB — the growth was somewhere else, and a storage row that watches one
 * bucket answers the wrong question. Per-bucket breakdown so the readiness page can NAME the
 * consumer, not just alarm.
 */
export async function recordingsStorageUsage(): Promise<{ bytes: number; files: number; partial: boolean; checkable: boolean; buckets: { name: string; bytes: number; files: number; partial: boolean }[] }> {
  try {
    const { data: bucketList, error } = await supabase.storage.listBuckets();
    if (error) return { bytes: 0, files: 0, partial: false, checkable: false, buckets: [] };
    let bytes = 0, files = 0, partial = false;
    const buckets: { name: string; bytes: number; files: number; partial: boolean }[] = [];
    for (const b of bucketList ?? []) {
      const u = await bucketUsage(b.name);
      if (!u.checkable) { partial = true; continue; }
      bytes += u.bytes; files += u.files; partial = partial || u.partial;
      buckets.push({ name: b.name, bytes: u.bytes, files: u.files, partial: u.partial });
    }
    buckets.sort((a, b2) => b2.bytes - a.bytes);
    return { bytes, files, partial, checkable: true, buckets };
  } catch {
    return { bytes: 0, files: 0, partial: false, checkable: false, buckets: [] };
  }
}
