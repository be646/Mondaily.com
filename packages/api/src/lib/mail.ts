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
async function sendViaSovereignRelay(workspaceId: string, msg: OutboundMessage): Promise<boolean> {
  const url = process.env.SOVEREIGN_MAIL_SEND_URL;
  const secret = process.env.SOVEREIGN_MAIL_SECRET;
  if (!url || !secret) return false;
  try {
    const from = inboundAddressFor(workspaceId) ?? CORPORATE_FROM;
    const body = JSON.stringify({ from, to: msg.to.map((t) => t.email), subject: msg.subject, html: msg.body });
    const res = await fetch(url.replace(/\/$/, "") + "/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mondaily-mail-signature": createHmac("sha256", secret).update(body).digest("hex") },
      body,
    });
    return res.ok;
  } catch {
    return false;
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
