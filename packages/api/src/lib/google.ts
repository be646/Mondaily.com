/**
 * Direct Google integration (Gmail API) — replaces Nylas for Google accounts.
 *
 * OAuth: we run the Google consent flow ourselves and store the refresh token on
 * email_connections. Access tokens (~1h) are minted on demand from the refresh
 * token and cached back to the row. Sending uses the Gmail API directly — no
 * per-account middleman fee.
 *
 * Needs env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
 */
import { supabase } from "@mondaily/db/client";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

// Phase 1 = send. Add gmail.readonly / gmail.modify for inbox sync (Phase 2).
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
];

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** Build the Google OAuth consent URL (offline access → refresh token). */
export function googleAuthUrl(redirectUri: string, state: string): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  u.searchParams.set("access_type", "offline"); // request a refresh token
  u.searchParams.set("prompt", "consent");      // force refresh-token issuance
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

function decodeJwtEmail(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return undefined;
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof json.email === "string" ? json.email : undefined;
  } catch {
    return undefined;
  }
}

export interface GoogleTokens {
  refresh_token?: string;
  access_token: string;
  expires_in: number;
  email?: string;
}

/** Exchange an authorization code for tokens. */
export async function exchangeCode(code: string, redirectUri: string): Promise<GoogleTokens | null> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    console.error("[google] code exchange failed", res.status, await res.text().catch(() => ""));
    return null;
  }
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string };
  return { access_token: t.access_token, refresh_token: t.refresh_token, expires_in: t.expires_in, email: decodeJwtEmail(t.id_token) };
}

interface ConnRow {
  id: string;
  refresh_token?: string | null;
  access_token?: string | null;
  token_expiry?: string | null;
}

/** Return a valid access token for a connection, refreshing + caching if needed. */
export async function freshAccessToken(conn: ConnRow): Promise<string | null> {
  const stillValid = conn.access_token && conn.token_expiry && new Date(conn.token_expiry).getTime() > Date.now() + 60_000;
  if (stillValid) return conn.access_token!;
  if (!conn.refresh_token) return null;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: conn.refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    console.error("[google] token refresh failed", res.status, await res.text().catch(() => ""));
    return null;
  }
  const t = (await res.json()) as { access_token: string; expires_in: number };
  await supabase.from("email_connections").update({
    access_token: t.access_token,
    token_expiry: new Date(Date.now() + t.expires_in * 1000).toISOString(),
  }).eq("id", conn.id);
  return t.access_token;
}

/** Send an email via the Gmail API as the connected user. */
export async function gmailSend(accessToken: string, msg: { to: string[]; subject: string; html: string; from?: string }): Promise<boolean> {
  const headers = [
    `To: ${msg.to.join(", ")}`,
    msg.from ? `From: ${msg.from}` : "",
    `Subject: ${msg.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    msg.html,
  ].filter(Boolean).join("\r\n");
  const raw = Buffer.from(headers).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  try {
    const res = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
