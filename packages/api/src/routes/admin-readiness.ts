import { Hono } from "hono";
import { supabase } from "@mondaily/db/client";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";
import { liveKitEnabled, recordingEnabled, transcriptionEnabled } from "../lib/livekit";
import { isEmbeddingsEnabled } from "../lib/embeddings";
import { RECORDINGS_BUCKET } from "../jobs/meeting-memory";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth, requireAdminRole);

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
  // The realtime TOKEN endpoint only needs these three; a live WS still depends on the Supabase project
  // enabling realtime replication on the tables + accepting this anon key (see note below).
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
    // Env token can be present while the live WS is still rejected by the Supabase project → "partial".
    realtime: supabase_realtime_token_configured ? "partial" : "missing",
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
      supabase_realtime_note: "Token env is present, but a live realtime websocket also requires the Supabase project to enable realtime replication on the target tables and to accept this anon key. Verify in the Supabase dashboard.",
      search_configured,
      scrape_configured,
      embeddings_configured,
      cron_configured,
      auth_secret_configured,
    },
    group,
  });
});

export { router as adminReadinessRouter };
