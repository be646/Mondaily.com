/**
 * Outbound mail — sends from a workspace's connected inbox via Nylas.
 *
 * Best-effort: returns false (never throws) when Nylas isn't configured or the
 * workspace has no connected inbox, so callers can fall back gracefully (e.g.
 * still surface the invite link). Centralised here so invites, sequences, and
 * agent emails all send the same way.
 */
import { supabase } from "@mondaily/db/client";

export async function sendWorkspaceEmail(
  workspaceId: string,
  msg: { subject: string; body: string; to: { email: string; name?: string }[] },
): Promise<boolean> {
  if (!process.env.NYLAS_API_KEY) return false;
  try {
    const { data: conn } = await supabase
      .from("email_connections")
      .select("grant_id")
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle();
    const grantId = (conn as { grant_id?: string } | null)?.grant_id;
    if (!grantId) return false;
    const res = await fetch(`https://api.us.nylas.com/v3/grants/${grantId}/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.NYLAS_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ subject: msg.subject, body: msg.body, to: msg.to }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
