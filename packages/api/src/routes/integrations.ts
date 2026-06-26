/**
 * Email inbox connect flow (Nylas v3 hosted auth).
 *
 * The missing piece that makes "Connect Gmail/Outlook" work: it initiates Nylas
 * OAuth, handles the callback, exchanges the code for a grant, and stores it in
 * email_connections — which is what the send/read paths (mail.ts, emails.ts) need.
 *
 * SECURITY: the popup can't carry the SPA's bearer token, so we never put a token
 * in a URL. Instead /connect is AUTHED and returns the Nylas auth URL with an
 * HMAC-signed `state` encoding (user, workspace, provider, exp). The public
 * /callback verifies that signature before trusting any identity — so the
 * callback can't be forged to attach an inbox to someone else's workspace.
 */
import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import { supabase } from "@mondaily/db/client";
import { requireAuth } from "../middleware/auth";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();

const NYLAS_BASE = "https://api.us.nylas.com"; // US region (per workspace config)

const stateSecret = () =>
  process.env.NYLAS_STATE_SECRET || process.env.CLERK_SECRET_KEY || process.env.CRON_SECRET || "mondaily-dev-oauth-state";

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

// 1) INITIATE — authed. Returns the Nylas hosted-auth URL (signed state).
router.post("/connect", requireAuth, async (c) => {
  const body = await c.req.json<{ provider?: string; login_hint?: string }>().catch(() => ({} as { provider?: string; login_hint?: string }));
  const provider = normalizeProvider(body.provider);
  const clientId = process.env.NYLAS_CLIENT_ID;
  if (!clientId) return c.json({ error: "NYLAS_CLIENT_ID is not configured on the server." }, 503);
  if (!process.env.API_BASE_URL) return c.json({ error: "API_BASE_URL is not configured (needed for the OAuth redirect)." }, 503);

  // Resolve the user's email for login_hint so Nylas skips its email-entry screen
  // and goes straight to the provider. Prefer a client-supplied hint; otherwise
  // look it up from Clerk. Best-effort — connect still works without it.
  let loginHint = typeof body.login_hint === "string" ? body.login_hint : undefined;
  if (!loginHint && process.env.CLERK_SECRET_KEY) {
    try {
      const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
      const u = await clerk.users.getUser(c.get("userId"));
      loginHint = u.primaryEmailAddress?.emailAddress ?? u.emailAddresses?.[0]?.emailAddress;
    } catch { /* best-effort */ }
  }

  const state = signState({
    u: c.get("userId"),
    w: c.get("workspaceId"),
    p: provider,
    exp: Math.floor(Date.now() / 1000) + 600, // 10 min
  });
  const url = new URL(`${NYLAS_BASE}/v3/connect/auth`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callbackUrl());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("provider", provider);
  // login_hint = the signed-in user's email → Nylas skips its own email-entry
  // screen and routes straight to Google's consent (the "just sign in with Gmail"
  // experience users expect).
  if (loginHint && /.+@.+\..+/.test(loginHint)) {
    url.searchParams.set("login_hint", loginHint);
  }
  url.searchParams.set("state", state);
  return c.json({ auth_url: url.toString() });
});

// 2) CALLBACK — public (Nylas redirects the browser here). Verify state, exchange
// the code for a grant, store it. No client identity is trusted except via the
// signed state.
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
  const clientId = process.env.NYLAS_CLIENT_ID;
  const apiKey = process.env.NYLAS_API_KEY;
  if (!clientId || !apiKey) return c.html(popupHtml("Email integration is not configured.", false));

  try {
    const res = await fetch(`${NYLAS_BASE}/v3/connect/token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: apiKey,
        code,
        redirect_uri: callbackUrl(),
        grant_type: "authorization_code",
      }),
    });
    if (!res.ok) return c.html(popupHtml(`Could not complete sign-in (${res.status}).`, false));
    const tok = (await res.json()) as { grant_id?: string; email?: string };
    if (!tok.grant_id) return c.html(popupHtml("No mailbox grant was returned.", false));

    const { error } = await supabase.from("email_connections").upsert(
      {
        workspace_id: st.w as string,
        user_id: st.u as string,
        provider: (st.p as string) ?? "google",
        grant_id: tok.grant_id,
        email: tok.email ?? "",
      },
      { onConflict: "workspace_id,user_id" },
    );
    if (error) return c.html(popupHtml("Connected, but saving the mailbox failed.", false));
    return c.html(popupHtml(`Connected ${tok.email ?? "your inbox"}.`, true));
  } catch {
    return c.html(popupHtml("Something went wrong connecting your inbox.", false));
  }
});

export { router as integrationsRouter };
