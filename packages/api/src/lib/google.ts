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
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_SEND_URL = `${GMAIL_BASE}/messages/send`;

// Send + read (inbox sync) + calendar (read-only). One consent grants mail + calendar so
// "Connect Google" wires both the inbox and the Meetings card in a single flow.
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
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

/** Send an email via the Gmail API as the connected user. Supports threading a
 *  reply (threadId keeps it in the Gmail conversation; In-Reply-To/References
 *  thread it in other clients). */
export async function gmailSend(
  accessToken: string,
  msg: { to: string[]; subject: string; html: string; from?: string; threadId?: string; inReplyTo?: string },
): Promise<boolean> {
  const headers = [
    `To: ${msg.to.join(", ")}`,
    msg.from ? `From: ${msg.from}` : "",
    `Subject: ${msg.subject}`,
    msg.inReplyTo ? `In-Reply-To: ${msg.inReplyTo}` : "",
    msg.inReplyTo ? `References: ${msg.inReplyTo}` : "",
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
      body: JSON.stringify(msg.threadId ? { raw, threadId: msg.threadId } : { raw }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Read (inbox sync) ─────────────────────────────────────────────────────────

export interface GmailThreadSummary {
  id: string;
  subject: string;
  snippet: string;
  from: string;
  date: string;
  unread: boolean;
}

const header = (headers: Array<{ name: string; value: string }> | undefined, name: string): string =>
  headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/** List recent threads with subject/from/date/snippet. `q` is a Gmail search query. */
export async function gmailThreads(accessToken: string, opts: { q?: string; max?: number } = {}): Promise<GmailThreadSummary[]> {
  const params = new URLSearchParams({ maxResults: String(opts.max ?? 20) });
  if (opts.q) params.set("q", opts.q);
  const listRes = await fetch(`${GMAIL_BASE}/threads?${params.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!listRes.ok) return [];
  const list = (await listRes.json()) as { threads?: Array<{ id: string }> };
  const ids = (list.threads ?? []).map((t) => t.id);
  const summaries = await Promise.all(ids.map(async (id) => {
    const r = await fetch(`${GMAIL_BASE}/threads/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) return null;
    const t = (await r.json()) as { id: string; messages?: Array<{ snippet?: string; labelIds?: string[]; payload?: { headers?: Array<{ name: string; value: string }> } }> };
    const msgs = t.messages ?? [];
    const last = msgs[msgs.length - 1];
    return {
      id: t.id,
      subject: header(last?.payload?.headers, "Subject"),
      from: header(last?.payload?.headers, "From"),
      date: header(last?.payload?.headers, "Date"),
      snippet: last?.snippet ?? "",
      unread: msgs.some((m) => (m.labelIds ?? []).includes("UNREAD")),
    } as GmailThreadSummary;
  }));
  return summaries.filter((s): s is GmailThreadSummary => s !== null);
}

interface GmailMessageDetail { id: string; messageId: string; from: string; to: string; date: string; subject: string; snippet: string; body: string }

function decodeBody(payload: { mimeType?: string; body?: { data?: string }; parts?: any[] } | undefined): string {
  if (!payload) return "";
  if (payload.body?.data) {
    try { return Buffer.from(payload.body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); } catch { return ""; }
  }
  for (const part of payload.parts ?? []) {
    if (part.mimeType === "text/html" || part.mimeType === "text/plain") {
      const b = decodeBody(part);
      if (b) return b;
    }
  }
  for (const part of payload.parts ?? []) { const b = decodeBody(part); if (b) return b; }
  return "";
}

// ── Calendar (read) ─────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;      // ISO
  end?: string;
  allDay: boolean;
  location?: string;
  attendees: number;
  meetingUrl?: string; // Google Meet / Zoom link if present
  provider: "google" | "microsoft";
}

/** Fetch the connected calendar's events between two ISO instants (primary calendar). */
export async function googleCalendarEvents(accessToken: string, timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin, timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    console.error("[google] calendar fetch failed", res.status, await res.text().catch(() => ""));
    return [];
  }
  const data = (await res.json()) as { items?: any[] };
  return (data.items ?? [])
    .filter((e) => e.status !== "cancelled")
    .map((e): CalendarEvent => ({
      id: String(e.id),
      title: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? "",
      end: e.end?.dateTime ?? e.end?.date,
      allDay: !e.start?.dateTime,
      location: e.location,
      attendees: Array.isArray(e.attendees) ? e.attendees.length : 0,
      meetingUrl: e.hangoutLink ?? (Array.isArray(e.conferenceData?.entryPoints) ? e.conferenceData.entryPoints.find((p: any) => p.entryPointType === "video")?.uri : undefined),
      provider: "google",
    }))
    .filter((e) => e.start);
}

/** Full thread with each message's headers + decoded body. */
export async function gmailThread(accessToken: string, threadId: string): Promise<GmailMessageDetail[]> {
  const r = await fetch(`${GMAIL_BASE}/threads/${threadId}?format=full`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) return [];
  const t = (await r.json()) as { messages?: Array<{ id: string; snippet?: string; payload?: { headers?: Array<{ name: string; value: string }>; mimeType?: string; body?: { data?: string }; parts?: any[] } }> };
  return (t.messages ?? []).map((m) => ({
    id: m.id,
    messageId: header(m.payload?.headers, "Message-ID"),
    from: header(m.payload?.headers, "From"),
    to: header(m.payload?.headers, "To"),
    date: header(m.payload?.headers, "Date"),
    subject: header(m.payload?.headers, "Subject"),
    snippet: m.snippet ?? "",
    body: decodeBody(m.payload),
  }));
}
