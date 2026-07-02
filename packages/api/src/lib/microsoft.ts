/**
 * Direct Microsoft (Graph) integration — the Outlook/Microsoft 365 counterpart to lib/google.ts.
 * No middleman: we run Microsoft's OAuth ourselves and store the refresh token on
 * email_connections (provider="microsoft"). Access tokens are minted on demand from the refresh
 * token and cached back to the row — same shape as the Google flow so the rest of the app treats
 * both providers uniformly.
 *
 * Needs env: MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET. Uses the "common" tenant so both
 * personal (outlook.com) and work/school accounts can connect.
 */
import { supabase } from "@mondaily/db/client";
import type { CalendarEvent } from "./google";

const TENANT = "common";
const AUTH_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`;
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const GRAPH = "https://graph.microsoft.com/v1.0";

// offline_access → refresh token. Mail.Send + Mail.Read mirror the Gmail scopes; Calendars.Read
// powers the Meetings card. openid/email/profile identify the account.
export const MICROSOFT_SCOPES = [
  "openid", "email", "profile", "offline_access",
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/Calendars.Read",
];

export function microsoftConfigured(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

export function microsoftAuthUrl(redirectUri: string, state: string): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", process.env.MICROSOFT_CLIENT_ID ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", MICROSOFT_SCOPES.join(" "));
  u.searchParams.set("state", state);
  return u.toString();
}

export interface MicrosoftTokens {
  refresh_token?: string;
  access_token: string;
  expires_in: number;
  email?: string;
}

function decodeJwtEmail(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return undefined;
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return json.email ?? json.preferred_username ?? json.upn;
  } catch { return undefined; }
}

export async function exchangeCode(code: string, redirectUri: string): Promise<MicrosoftTokens | null> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
      client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: MICROSOFT_SCOPES.join(" "),
    }),
  });
  if (!res.ok) {
    console.error("[microsoft] code exchange failed", res.status, await res.text().catch(() => ""));
    return null;
  }
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string };
  return { access_token: t.access_token, refresh_token: t.refresh_token, expires_in: t.expires_in, email: decodeJwtEmail(t.id_token) };
}

interface ConnRow { id: string; refresh_token?: string | null; access_token?: string | null; token_expiry?: string | null }

export async function freshAccessToken(conn: ConnRow): Promise<string | null> {
  const stillValid = conn.access_token && conn.token_expiry && new Date(conn.token_expiry).getTime() > Date.now() + 60_000;
  if (stillValid) return conn.access_token!;
  if (!conn.refresh_token) return null;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: conn.refresh_token,
      client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
      client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      scope: MICROSOFT_SCOPES.join(" "),
    }),
  });
  if (!res.ok) {
    console.error("[microsoft] token refresh failed", res.status, await res.text().catch(() => ""));
    return null;
  }
  const t = (await res.json()) as { access_token: string; expires_in: number };
  await supabase.from("email_connections").update({
    access_token: t.access_token,
    token_expiry: new Date(Date.now() + t.expires_in * 1000).toISOString(),
  }).eq("id", conn.id);
  return t.access_token;
}

/** Calendar events between two ISO instants via Microsoft Graph calendarView. */
export async function microsoftCalendarEvents(accessToken: string, timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    startDateTime: timeMin,
    endDateTime: timeMax,
    $orderby: "start/dateTime",
    $top: "50",
  });
  const res = await fetch(`${GRAPH}/me/calendarView?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' },
  });
  if (!res.ok) {
    console.error("[microsoft] calendar fetch failed", res.status, await res.text().catch(() => ""));
    return [];
  }
  const data = (await res.json()) as { value?: any[] };
  return (data.value ?? [])
    .filter((e) => !e.isCancelled)
    .map((e): CalendarEvent => ({
      id: String(e.id),
      title: e.subject ?? "(no title)",
      // Graph returns naive UTC strings (no Z) when we ask for UTC — normalize to ISO.
      start: e.start?.dateTime ? `${e.start.dateTime.replace(/(\.\d+)?$/, "")}Z`.replace("ZZ", "Z") : "",
      end: e.end?.dateTime ? `${e.end.dateTime.replace(/(\.\d+)?$/, "")}Z`.replace("ZZ", "Z") : undefined,
      allDay: Boolean(e.isAllDay),
      location: e.location?.displayName || undefined,
      attendees: Array.isArray(e.attendees) ? e.attendees.length : 0,
      meetingUrl: e.onlineMeeting?.joinUrl || undefined,
      provider: "microsoft",
    }))
    .filter((e) => e.start);
}

/** Send an email as the connected user via Graph. */
export async function microsoftSend(accessToken: string, msg: { to: string[]; subject: string; html: string }): Promise<boolean> {
  try {
    const res = await fetch(`${GRAPH}/me/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: msg.subject,
          body: { contentType: "HTML", content: msg.html },
          toRecipients: msg.to.map((address) => ({ emailAddress: { address } })),
        },
        saveToSentItems: true,
      }),
    });
    return res.ok;
  } catch { return false; }
}
