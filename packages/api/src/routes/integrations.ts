/**
 * Email inbox connect flow — DIRECT Google OAuth (Gmail API), no Nylas.
 *
 * Makes "Connect Gmail" work without a per-account middleman: runs Google's OAuth
 * consent, exchanges the code ourselves, and stores the refresh token in
 * email_connections (what mail.ts uses to send). Outlook (Microsoft Graph) is a
 * later phase.
 *
 * SECURITY: the popup can't carry the SPA's bearer token, so we never put a token
 * in a URL. /connect is AUTHED and returns the Google auth URL with an HMAC-signed
 * `state` (user, workspace, exp); the public /callback verifies that signature
 * before trusting any identity — so it can't be forged to attach an inbox to
 * someone else's workspace.
 */
import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabase } from "@mondaily/db/client";
import { requireAuth } from "../middleware/auth";
import { googleConfigured, googleAuthUrl, exchangeCode } from "../lib/google";
import { microsoftConfigured, microsoftAuthUrl, exchangeCode as exchangeMicrosoftCode } from "../lib/microsoft";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();

const stateSecret = () =>
  process.env.NYLAS_STATE_SECRET || process.env.CRON_SECRET || "mondaily-dev-oauth-state";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function signState(payload: Record<string, unknown>): string {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", stateSecret()).update(body).digest());
  return `${body}.${sig}`;
}

function verifyState(token: string): Record<string, unknown> | null {
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = b64url(createHmac("sha256", stateSecret()).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof obj.exp === "number" && obj.exp < Math.floor(Date.now() / 1000)) return null;
    return obj;
  } catch {
    return null;
  }
}

const callbackUrl = () => `${(process.env.API_BASE_URL ?? "").replace(/\/$/, "")}/api/v1/integrations/callback`;

function normalizeProvider(p?: string): "google" | "microsoft" | "imap" {
  if (p === "outlook" || p === "microsoft") return "microsoft";
  if (p === "imap") return "imap";
  return "google";
}

function popupHtml(message: string, ok: boolean): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${ok ? "Connected" : "Connection failed"}</title></head>
<body style="font-family:system-ui,sans-serif;padding:2.5rem;text-align:center;color:#1c1917">
<p style="font-size:15px">${ok ? "✅" : "⚠️"} ${message}</p>
<p style="font-size:13px;color:#78716c">You can close this window.</p>
<script>try{window.opener&&window.opener.postMessage({type:"nylas-connect",ok:${ok}},"*")}catch(e){}setTimeout(function(){window.close()},1500)</script>
</body></html>`;
}

// 1) INITIATE — authed. Returns the provider's OAuth consent URL (signed state). Google grants
// Gmail + Calendar; Microsoft grants Outlook mail + Calendar — both in one consent.
router.post("/connect", requireAuth, async (c) => {
  const body = await c.req.json<{ provider?: string }>().catch(() => ({} as { provider?: string }));
  const provider = normalizeProvider(body.provider);
  if (provider === "imap") {
    return c.json({ error: "Direct IMAP isn't supported yet — connect Google or Microsoft." }, 400);
  }
  if (!process.env.API_BASE_URL) return c.json({ error: "API_BASE_URL is not configured (needed for the OAuth redirect)." }, 503);

  if (provider === "microsoft") {
    if (!microsoftConfigured()) return c.json({ error: "MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET are not configured on the server." }, 503);
    const state = signState({ u: c.get("userId"), w: c.get("workspaceId"), p: "microsoft", exp: Math.floor(Date.now() / 1000) + 600 });
    return c.json({ auth_url: microsoftAuthUrl(callbackUrl(), state) });
  }

  if (!googleConfigured()) return c.json({ error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured on the server." }, 503);
  const state = signState({ u: c.get("userId"), w: c.get("workspaceId"), p: "google", exp: Math.floor(Date.now() / 1000) + 600 });
  return c.json({ auth_url: googleAuthUrl(callbackUrl(), state) });
});

// 2) CALLBACK — public (Google redirects the browser here). Verify state, exchange
// the code for tokens, store them. Identity is trusted ONLY via the signed state.
router.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const oauthErr = c.req.query("error");
  if (oauthErr) return c.html(popupHtml(`Connection cancelled (${oauthErr}).`, false));
  if (!code || !state) return c.html(popupHtml("Missing authorization code.", false));

  const st = verifyState(state);
  if (!st || typeof st.u !== "string" || typeof st.w !== "string") {
    return c.html(popupHtml("Invalid or expired connection request.", false));
  }

  const provider = st.p === "microsoft" ? "microsoft" : "google";
  try {
    const tokens = provider === "microsoft"
      ? await exchangeMicrosoftCode(code, callbackUrl())
      : await exchangeCode(code, callbackUrl());
    if (!tokens) return c.html(popupHtml(`Could not complete ${provider === "microsoft" ? "Microsoft" : "Google"} sign-in. Please try again.`, false));

    // Only set refresh_token when the provider returned one (both do on first consent), so a
    // re-auth never wipes the stored token. grant_id is cleared — this is a direct connection.
    const row: Record<string, unknown> = {
      workspace_id: st.w as string,
      user_id: st.u as string,
      provider,
      grant_id: null,
      email: tokens.email ?? "",
      access_token: tokens.access_token,
      token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    };
    if (tokens.refresh_token) row.refresh_token = tokens.refresh_token;

    const { error } = await supabase.from("email_connections").upsert(row, { onConflict: "workspace_id,user_id" });
    if (error) {
      console.error("[integrations/callback] saving connection failed", error.message);
      return c.html(popupHtml("Connected, but saving the connection failed.", false));
    }
    return c.html(popupHtml(`Connected ${tokens.email ?? "your account"}.`, true));
  } catch {
    return c.html(popupHtml("Something went wrong connecting your account.", false));
  }
});

// 3) MEETINGS — authed. Real calendar events from the connected provider (Google or Microsoft)
// for a window (default: today). Returns { connected, provider, events } so the UI can show a
// connect prompt vs. real meetings without guessing.
router.get("/calendar/events", requireAuth, async (c) => {
  const { data: conn } = await supabase
    .from("email_connections")
    .select("id, provider, refresh_token, access_token, token_expiry, email")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("user_id", c.get("userId"))
    .maybeSingle();
  if (!conn) return c.json({ connected: false, events: [] });

  const now = new Date();
  const days = Math.min(14, Math.max(1, Number(c.req.query("days") ?? "1")));
  const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const timeMax = new Date(now.getTime() + days * 86400000).toISOString();

  try {
    if (conn.provider === "microsoft") {
      const { freshAccessToken, microsoftCalendarEvents } = await import("../lib/microsoft");
      const token = await freshAccessToken(conn);
      if (!token) return c.json({ connected: true, provider: "microsoft", email: conn.email, needs_reauth: true, events: [] });
      return c.json({ connected: true, provider: "microsoft", email: conn.email, events: await microsoftCalendarEvents(token, timeMin, timeMax) });
    }
    const { freshAccessToken, googleCalendarEvents } = await import("../lib/google");
    const token = await freshAccessToken(conn);
    if (!token) return c.json({ connected: true, provider: "google", email: conn.email, needs_reauth: true, events: [] });
    return c.json({ connected: true, provider: "google", email: conn.email, events: await googleCalendarEvents(token, timeMin, timeMax) });
  } catch (e) {
    console.error("[integrations/calendar] fetch failed", e instanceof Error ? e.message : e);
    return c.json({ connected: true, provider: conn.provider, error: "Could not read your calendar.", events: [] });
  }
});

// Reveal this workspace's MCP key + endpoint so a user can configure an external
// AI client (Claude Desktop, an IDE, etc.). Authed — only a workspace member can
// see their own key. The key grants read-only access to the whole graph.
router.get("/mcp-token", requireAuth, async (c) => {
  const { mintMcpToken } = await import("../lib/mcp-token");
  const base = process.env.API_BASE_URL || "https://api.mondaily.com";
  return c.json({
    token: mintMcpToken(c.get("workspaceId")),
    url: `${base}/api/mcp`,
    transport: "streamable-http",
    note: "Use as Authorization: Bearer <token>. Read-only access to this workspace's records.",
  });
});

export { router as integrationsRouter };
