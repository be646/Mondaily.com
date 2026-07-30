/**
 * Outbound mail with a two-tier delivery strategy.
 *
 *   1. PRIMARY  — send from the workspace's own connected inbox via the Gmail API
 *                 (direct Google, no middleman — replies land in their box).
 *   2. FALLBACK — Resend (the same RESEND_API_KEY the digest mailer uses), so a
 *                 brand-new workspace that has NOT connected an inbox yet can
 *                 still send invites on day one.
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
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * AUTH/TRANSACTIONAL mail (activation, password reset, anything identity-critical).
 * ALWAYS goes through Resend on our verified domain — it deliberately SKIPS the Gmail path,
 * because routing a reset link through the user's own connected inbox would try to "send from"
 * an address Resend can't authenticate, getting the message blocked/spoof-flagged.
 */
export async function sendTransactionalEmail(msg: OutboundMessage): Promise<boolean> {
  return sendViaTransactional(msg);
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
    // A DISPLAY NAME on the From. The routing address is `ws-<uuid>@inbound.<domain>`, and sent bare
    // it reads — to filters and to humans — like machine-generated throwaway mail: a 36-character
    // hex local part with no name attached. Gmail put the first sovereign send straight in spam.
    // The address itself must not change (inbound routing keys on it), so we only add the name.
    const address = inboundAddressFor(workspaceId);
    const from = address ? `${quotedDisplayName(await workspaceDisplayName(workspaceId))} <${address}>` : CORPORATE_FROM;
    const body = JSON.stringify({ from, to: msg.to.map((t) => t.email), subject: msg.subject, html: msg.body });
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
