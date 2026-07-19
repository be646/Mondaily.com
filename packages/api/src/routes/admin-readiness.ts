import { Hono } from "hono";
import { supabase } from "@mondaily/db/client";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";
import { liveKitEnabled, recordingEnabled, transcriptionEnabled, livekitSelfTest } from "../lib/livekit";
import { isEmbeddingsEnabled } from "../lib/embeddings";
import { sendTransactionalEmail } from "../lib/mail";
import { RECORDINGS_BUCKET } from "../jobs/meeting-memory";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth, requireAdminRole);

// In-memory per-user cooldown for the mail self-test (best-effort spam guard; resets on cold start).
// Never blocks product mail — only this admin verification tool.
const MAIL_TEST_COOLDOWN_MS = 60_000;
const lastMailTest = new Map<string, number>();

// A tiny presence check — TRUE only when the env var is set to a non-empty value. NEVER returns or logs
// the value itself, so no secret can leak through this endpoint.
const has = (name: string) => !!(process.env[name] || "").trim();

/**
 * GET /api/v1/admin/readiness — owner/admin-only, READ-ONLY production config inspector.
 *
 * Returns booleans + coarse per-capability status ONLY. It performs NO side effects: it never calls
 * paid AI, Stripe, mail send, LiveKit, STT, search, scrape, or GPU. The single I/O it does is a
 * best-effort Supabase `getBucket` (read metadata) to tell whether the private recordings bucket exists
 * — wrapped so it can never throw and downgrades to `checkable:false` on any error. Reuses the exact
 * same gating helpers the features themselves use, so this can't drift from real behavior.
 */
router.get("/readiness", async (c) => {
  // ── individual config presence (booleans only) ──
  const ai_gateway_configured = has("AI_GATEWAY_BASE_URL") && has("AI_GATEWAY_API_KEY");
  const stripe_configured = has("STRIPE_SECRET_KEY") && has("STRIPE_PUBLISHABLE_KEY");
  const stripe_webhook_configured = has("STRIPE_WEBHOOK_SECRET");
  const stripe_prices_configured = has("STRIPE_PRICE_OPERATOR_MONTH") && has("STRIPE_PRICE_COMMAND_MONTH");
  const transactional_mail_configured = has("RESEND_API_KEY") || has("TRANSACTIONAL_MAIL_API_KEY");
  const sovereign_mail_configured = has("SOVEREIGN_MAIL_SEND_URL") && has("SOVEREIGN_MAIL_SECRET");
  const livekit_configured = liveKitEnabled();
  const native_recording_enabled = recordingEnabled();
  const stt_configured = transcriptionEnabled();
  const supabase_core_configured = has("SUPABASE_URL") && has("SUPABASE_SERVICE_KEY");
  // Realtime credentials — URL + JWT secret + anon key. Presence of all three means the token endpoint
  // can mint valid credentials; a live socket is verified out-of-band by the readiness smoke test (we do
  // NOT open a websocket here — see note below).
  const supabase_realtime_token_configured = has("SUPABASE_URL") && has("SUPABASE_JWT_SECRET") && has("SUPABASE_ANON_KEY");
  const search_configured = has("SOVEREIGN_SEARCH_URL");
  const scrape_configured = has("SOVEREIGN_SCRAPE_URL");
  const embeddings_configured = isEmbeddingsEnabled();
  const cron_configured = has("CRON_SECRET");
  const auth_secret_configured = has("AUTH_JWT_SECRET");

  // ── private recordings bucket: best-effort metadata read, never throws, never leaks anything ──
  let recording_bucket_ready = false;
  let recording_bucket_checkable = true;
  try {
    const { data } = await supabase.storage.getBucket(RECORDINGS_BUCKET);
    recording_bucket_ready = !!data && data.public === false; // must exist AND be private
  } catch { recording_bucket_checkable = false; }

  // ── grouped, coarse status for the UI (ready | partial | missing | unknown) ──
  const group = {
    billing: stripe_configured ? (stripe_webhook_configured && stripe_prices_configured ? "ready" : "partial") : "missing",
    mail: transactional_mail_configured ? "ready" : "missing",
    ai: ai_gateway_configured ? "ready" : "missing",
    calls: livekit_configured ? (native_recording_enabled && recording_bucket_ready ? "ready" : "partial") : "missing",
    meeting_memory: stt_configured ? (ai_gateway_configured ? "ready" : "partial") : "missing",
    // Ready when all three credentials are present. We don't open a socket here; the live subscription
    // is confirmed by the readiness smoke test (env presence is the honest thing this endpoint checks).
    realtime: supabase_realtime_token_configured ? "ready" : "missing",
    search: search_configured && scrape_configured ? "ready" : (search_configured || scrape_configured ? "partial" : "missing"),
    private_inference: embeddings_configured ? "ready" : "missing",
  };

  return c.json({
    deploy_commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    checked_at: null, // stamped client-side; the server stays deterministic + side-effect free
    fields: {
      ai_gateway_configured,
      ai_gateway_healthy: null,   // configured-only: a live probe would cost paid AI requests, so we don't
      stripe_configured,
      stripe_webhook_configured,
      stripe_prices_configured,
      transactional_mail_configured,
      sovereign_mail_configured,
      livekit_configured,
      native_recording_enabled,
      recording_bucket_ready,
      recording_bucket_checkable,
      stt_configured,
      supabase_core_configured,
      supabase_realtime_token_configured,
      supabase_realtime_note: "Realtime credentials are configured. Live subscription should be verified by smoke test after any env change.",
      search_configured,
      scrape_configured,
      embeddings_configured,
      cron_configured,
      auth_secret_configured,
    },
    group,
  });
});

/**
 * POST /api/v1/admin/readiness/mail-test — send ONE labeled test email to the CALLER'S OWN address.
 *
 * Safety: the recipient is resolved server-side from the caller's workspace_members row — there is NO
 * recipient input, so it can never mail an arbitrary/other user. Fails closed if mail env is absent
 * (sendTransactionalEmail returns false, never throws). A 60s per-user cooldown guards against spam.
 * This does NOT touch onboarding/support/activation mail — it only calls the shared transactional send.
 */
router.post("/readiness/mail-test", async (c) => {
  const userId = c.get("userId");
  const ws = c.get("workspaceId");

  const now = Date.now();
  const prev = lastMailTest.get(userId) ?? 0;
  if (now - prev < MAIL_TEST_COOLDOWN_MS) {
    return c.json({ ok: false, reason: "cooldown", retry_in_ms: MAIL_TEST_COOLDOWN_MS - (now - prev) }, 429);
  }

  // Canonical recipient — the authenticated admin's own email in THIS workspace. Never from the body.
  const { data: member } = await supabase
    .from("workspace_members").select("email, name")
    .eq("user_id", userId).eq("workspace_id", ws).maybeSingle();
  const email = (member?.email as string | undefined)?.trim();
  if (!email) return c.json({ ok: false, reason: "no_admin_email" }, 400);

  lastMailTest.set(userId, now);
  const sent = await sendTransactionalEmail({
    subject: "Mondaily production mail test",
    to: [{ email, name: (member?.name as string | undefined) ?? undefined }],
    body: `<p>This is a <strong>production mail test</strong> triggered by a workspace admin from the Mondaily readiness page.</p>
<p>If you received this, transactional email delivery is working. No action is needed — you can ignore this message.</p>
<p style="color:#888;font-size:12px">Sent to the admin who ran the test; this is not sent to any other user.</p>`,
  });
  return sent
    ? c.json({ ok: true, sent_to_self: true })
    : c.json({ ok: false, reason: "mail_not_configured_or_send_failed" });
});

/**
 * POST /api/v1/admin/readiness/livekit-test — non-destructive LiveKit token-mint self-test.
 * Mints and immediately discards a 60s synthetic-room join token to prove the API key/secret sign.
 * NO room is created, NO participant joins, NO recording/egress starts. Returns booleans only — never
 * the token, key, or secret. Fails closed when LiveKit env is absent.
 */
router.post("/readiness/livekit-test", async (c) => {
  const r = await livekitSelfTest();
  return c.json(r);
});

export { router as adminReadinessRouter };
