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
import { supabase } from "@mondaily/db/client";
import { freshAccessToken, gmailSend } from "./google";

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

/** FALLBACK: transactional provider (Resend) for workspaces with no connected inbox.
 *  Reuses the same RESEND_API_KEY the digest mailer uses (digests.ts), so no new
 *  env var is needed; TRANSACTIONAL_MAIL_API_KEY is accepted as an alias. */
async function sendViaTransactional(msg: OutboundMessage): Promise<boolean> {
  const key = process.env.RESEND_API_KEY ?? process.env.TRANSACTIONAL_MAIL_API_KEY;
  if (!key) return false;
  const from = process.env.RESEND_FROM ?? process.env.TRANSACTIONAL_MAIL_FROM ?? "Mondaily <onboarding@mondaily.com>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
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
 * Send a workspace email: try the connected inbox first, then the transactional
 * fallback. Returns true if either route accepted the message.
 */
export async function sendWorkspaceEmail(workspaceId: string, msg: OutboundMessage): Promise<boolean> {
  if (await sendViaGoogle(workspaceId, msg)) return true;
  return sendViaTransactional(msg);
}
