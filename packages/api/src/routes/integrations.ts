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
import { requireAdminRole } from "../middleware/rbac";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { parseSalesforceExport, parseAny, buildPlan } from "../services/salesforce-importer";
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
  const ws = c.get("workspaceId");
  // Prefer the caller's own connection, but fall back to the workspace's connection so a teammate
  // who didn't personally connect still sees the shared calendar (matches the shared-inbox path,
  // which is workspace-scoped — previously this was user-scoped and showed "not connected").
  const cols = "id, provider, refresh_token, access_token, token_expiry, email";
  let { data: conn } = await supabase.from("email_connections").select(cols).eq("workspace_id", ws).eq("user_id", c.get("userId")).maybeSingle();
  if (!conn) ({ data: conn } = await supabase.from("email_connections").select(cols).eq("workspace_id", ws).limit(1).maybeSingle());
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
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[integrations/calendar] fetch failed", msg);
    // Stale-scope token (connected before calendar access existed) → prompt reconnect, not "no meetings".
    if (msg === "calendar_scope") return c.json({ connected: true, provider: conn.provider, email: conn.email, needs_reauth: true, events: [] });
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


// ── Salesforce migration bridge ───────────────────────────────────────────────
/**
 * Two routes, one plan. `/parse` shows what an export contains; `/migrate` turns it into the exact
 * records that would be written and, ONLY with `commit: true`, writes them.
 *
 * Dry-run is the default and the commit path consumes the same plan the dry-run returned, so what
 * an admin approves in the mapping matrix is literally what lands. An importer whose preview is
 * computed by different code from its write is an importer whose preview is a guess.
 *
 * ADMIN-ONLY: this creates records in bulk, which is not a member-level action.
 */
const SF_MAX_BYTES = 8 * 1024 * 1024;   // a 1,400-row Opportunity export is ~300KB; 8MB is generous
const SF_MAX_ROWS = 20_000;             // bounded so one paste cannot pin a serverless function

router.post("/salesforce/parse", requireAdminRole, zValidator("json", z.object({
  raw: z.string().min(1).max(SF_MAX_BYTES),
  object: z.string().max(40).optional(),
})), async (c) => {
  try {
    const { raw, object } = c.req.valid("json");
    const result = parseSalesforceExport(raw, object);
    if (result.rowCount > SF_MAX_ROWS) {
      return c.json({ error: `That export has ${result.rowCount.toLocaleString()} rows. Split it into files of ${SF_MAX_ROWS.toLocaleString()} or fewer.` }, 413);
    }
    return c.json(result);
  } catch (e) {
    // The parser throws only on genuinely unreadable input; say what, not a 500.
    return c.json({ error: e instanceof Error ? e.message : "Could not read that export." }, 422);
  }
});

router.post("/salesforce/migrate", requireAdminRole, zValidator("json", z.object({
  raw: z.string().min(1).max(SF_MAX_BYTES),
  object: z.string().max(40).optional(),
  /** Admin re-bindings from the mapping matrix: { "Renewal_Risk__c": "renewal_risk" } or null to drop. */
  overrides: z.record(z.string().nullable()).optional(),
  /** WITHOUT this the route is a validator and touches nothing. */
  commit: z.boolean().optional(),
})), async (c) => {
  const ws = c.get("workspaceId");
  const userId = c.get("userId");
  const { raw, object, overrides, commit } = c.req.valid("json");

  let parsed: ReturnType<typeof parseSalesforceExport>;
  try { parsed = parseSalesforceExport(raw, object); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : "Could not read that export." }, 422); }

  if (parsed.rowCount > SF_MAX_ROWS) {
    return c.json({ error: `That export has ${parsed.rowCount.toLocaleString()} rows. Split it into files of ${SF_MAX_ROWS.toLocaleString()} or fewer.` }, 413);
  }

  const { rows } = parseAny(raw);
  const plan = buildPlan(parsed.object, rows, parsed.mappings, overrides ?? {});

  // The records themselves are only interesting to the writer; the UI needs the shape and the
  // problems. Returning 20k payloads to draw a summary card is wasted bytes on every dry run.
  const summary = {
    object: plan.object, target_type: plan.targetType,
    scanned: plan.scanned, ready: plan.ready, rejected: plan.rejected,
    currencies: plan.currencies,
    unmapped: parsed.unmapped,
    mappings: parsed.mappings,
    issues: plan.issues.slice(0, 200),
    issue_count: plan.issues.length,
    committed: false as boolean,
    imported: 0,
  };

  if (!commit) return c.json({ ...summary, dry_run: true });

  if (plan.ready === 0) return c.json({ ...summary, dry_run: false, error: "Nothing to import — every row was rejected." }, 422);

  // Chunked insert: one 20k-row statement is a timeout and an all-or-nothing failure. Chunks let a
  // partial import report honestly how far it got instead of claiming zero.
  const CHUNK = 500;
  let imported = 0;
  for (let i = 0; i < plan.records.length; i += CHUNK) {
    const batch = plan.records.slice(i, i + CHUNK);
    // workspace_id is stamped INSIDE the insert statement rather than on a batch built above it.
    // Same rows either way, but the tenant scoping is now visible in the statement itself — which
    // is what the isolation ratchet reads, and what a reviewer reads. A safety property built two
    // lines away from the call it protects is a safety property nobody can check at a glance.
    const { error } = await supabase.from("nodes").insert(
      batch.map(r => ({
        workspace_id: ws, vertical: "shared", object_type: plan.targetType,
        created_by: userId, data: r.data,
      })),
    );
    if (error) {
      return c.json({
        ...summary, dry_run: false, committed: imported > 0, imported,
        error: `Imported ${imported} record(s), then stopped: ${error.message}`,
      }, 500);
    }
    imported += batch.length;
  }

  return c.json({ ...summary, dry_run: false, committed: true, imported });
});

export { router as integrationsRouter };