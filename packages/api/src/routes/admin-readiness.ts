import { Hono } from "hono";
import { supabase } from "@mondaily/db/client";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";
import { liveKitEnabled, recordingEnabled, transcriptionEnabled, livekitSelfTest } from "../lib/livekit";
import { isEmbeddingsEnabled, embedOne } from "../lib/embeddings";
import { inferenceMode, sovereignVllmConfigured, sovereignVllmProbe } from "../lib/inference-backend";
import { sendTransactionalEmail, sovereignRelayStatus, recordingsStorageUsage } from "../lib/mail";
import { RECORDINGS_BUCKET } from "../jobs/meeting-memory";
import { rateLimitStoreHealth } from "../lib/rate-limit-store";

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
 * paid AI, Stripe, mail SEND, LiveKit, STT, search, scrape, or GPU. Reuses the exact same gating
 * helpers the features themselves use, so this can't drift from real behavior.
 *
 * It makes exactly THREE read-only probes, each wrapped so it can never throw and each downgrading
 * honestly on error:
 *   - Supabase `getBucket` — does the private recordings bucket exist and is it private?
 *   - `GET {SOVEREIGN_MAIL_SEND_URL}/health` — is the mail appliance actually reachable? No HMAC, no
 *     secret, no message. Added because env-presence alone reported a healthy relay for a day while
 *     the appliance was unreachable and every send was silently falling back.
 *   - one embedding round-trip against OUR OWN appliance (when configured) + a head-count of this
 *     workspace's indexed vectors. Vector search fails SOFT to LLM-rerank, so a dead appliance or an
 *     unapplied pgvector migration is invisible from the product — this is the only place it shows.
 *     No third party, no paid AI: the appliance is ours and the call is negligible.
 */
router.get("/readiness", async (c) => {
  // ── individual config presence (booleans only) ──
  const ai_gateway_configured = has("AI_GATEWAY_BASE_URL") && has("AI_GATEWAY_API_KEY");
  const stripe_configured = has("STRIPE_SECRET_KEY") && has("STRIPE_PUBLISHABLE_KEY");
  const stripe_webhook_configured = has("STRIPE_WEBHOOK_SECRET");
  const stripe_prices_configured = has("STRIPE_PRICE_OPERATOR_MONTH") && has("STRIPE_PRICE_COMMAND_MONTH");
  const transactional_mail_configured = has("RESEND_API_KEY") || has("TRANSACTIONAL_MAIL_API_KEY");
  const sovereign_mail_configured = has("SOVEREIGN_MAIL_SEND_URL") && has("SOVEREIGN_MAIL_SECRET");
  // Can a customer answer a support email by REPLYING to it? Support's whole lifecycle — the
  // reminders, the auto-close, "reply to reopen" — assumes yes. Without an inbound domain the
  // replies bounce and every waiting ticket marches to auto-close on people who did answer, so it
  // is worth its own row rather than being folded into "mail works".
  const support_email_replies_configured = has("SOVEREIGN_MAIL_DOMAIN");
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

  // ── embeddings: LIVE, not merely configured — the same lesson the mail-relay probe encodes.
  // Vector search fails SOFT to LLM-rerank, which makes a dead appliance or an unapplied pgvector
  // migration invisible from the product: everything still answers, just slower and dumber. The
  // only way to know the vector path is real is to (a) round-trip one embedding through the
  // appliance and (b) count what is actually indexed for THIS workspace.
  let embeddings_live: boolean | null = null;        // null = not configured, nothing to probe
  let embeddings_indexed_rows: number | null = null;
  if (embeddings_configured) {
    try { embeddings_live = Array.isArray(await embedOne("readiness probe")) ; } catch { embeddings_live = false; }
    try {
      const { count, error } = await supabase.from("node_embeddings")
        .select("node_id", { count: "exact", head: true }).eq("workspace_id", c.get("workspaceId"));
      if (!error) embeddings_indexed_rows = count ?? 0;
    } catch { /* table missing (migration unapplied) → stays null, which the UI shows as unknown */ }
  }
  const inference_mode = inferenceMode();
  const sovereign_vllm_configured = sovereignVllmConfigured();
  const cron_configured = has("CRON_SECRET");
  const auth_secret_configured = has("AUTH_JWT_SECRET");

  // ── private recordings bucket: best-effort metadata read, never throws, never leaks anything ──
  let recording_bucket_ready = false;
  let recording_bucket_checkable = true;
  try {
    const { data } = await supabase.storage.getBucket(RECORDINGS_BUCKET);
    recording_bucket_ready = !!data && data.public === false; // must exist AND be private
  } catch { recording_bucket_checkable = false; }

  // ── sovereign mail relay: is it actually THERE, not merely configured? ──
  //
  // `sovereign_mail_configured` above only proves two env vars are non-empty. For a full day that
  // read "true" while SOVEREIGN_MAIL_SEND_URL pointed at a host unreachable from the public internet
  // — the dashboard asserted a working relay while every outbound send silently fell back to Gmail.
  // Env presence is a claim; reachability is evidence.
  //
  // The probe itself lives in lib/mail (GET /health, no HMAC, no secret, no message, 3s ceiling,
  // never throws) so this route keeps reading env only through `has()` and holds no fetch of its
  // own — both properties this endpoint's guards enforce.
  const relay = await sovereignRelayStatus();
  // Storage: the recordings bucket is the only uncapped-growth store (attachments are 10MB-capped).
  // Reported as measured bytes, flagged partial when the walk hit its bound — never an undercount
  // presented as a total. The 5GB free-plan scare of 2026-07-30 is why this row exists.
  const storage = await recordingsStorageUsage();

  // Unresolved client errors. Stored is not the same as SEEN — a sink nobody reads is a slower
  // version of console.error. Surfacing the count here puts it next to everything else an operator
  // already checks. `null` means the migration has not run, which is distinct from "zero errors".
  let unresolved_client_errors: number | null = null;
  {
    const { count, error } = await supabase
      .from("client_errors").select("fingerprint", { count: "exact", head: true })
      .is("resolved_at", null);
    if (!error) unresolved_client_errors = count ?? 0;
  }
  const sovereign_mail_reachable = relay.reachable;
  const sovereign_mail_checkable = relay.checkable;

  // ── grouped, coarse status for the UI (ready | partial | missing | unknown) ──
  const group = {
    billing: stripe_configured ? (stripe_webhook_configured && stripe_prices_configured ? "ready" : "partial") : "missing",
    // A configured-but-unreachable sovereign relay is PARTIAL, not ready: mail still goes out via
    // the fallback, but the sovereign path the operator thinks they enabled is dead.
    mail: sovereign_mail_configured && !sovereign_mail_reachable ? "partial"
      : transactional_mail_configured || sovereign_mail_reachable ? "ready" : "missing",
    ai: ai_gateway_configured ? "ready" : "missing",
    calls: livekit_configured ? (native_recording_enabled && recording_bucket_ready ? "ready" : "partial") : "missing",
    meeting_memory: stt_configured ? (ai_gateway_configured ? "ready" : "partial") : "missing",
    // Ready when all three credentials are present. We don't open a socket here; the live subscription
    // is confirmed by the readiness smoke test (env presence is the honest thing this endpoint checks).
    realtime: supabase_realtime_token_configured ? "ready" : "missing",
    search: search_configured && scrape_configured ? "ready" : (search_configured || scrape_configured ? "partial" : "missing"),
    // Sovereign vLLM: selected+configured → ready (reachability via the POST self-test, like
    // LiveKit); selected but unconfigured → partial (the gateway is FAILING CLOSED right now);
    // not selected → embeddings-only status as before.
    // Configured but failing the live probe (or indexing nothing) is PARTIAL: the product works —
    // fail-soft — but the acceleration the operator thinks is on is not actually happening.
    private_inference: inference_mode === "sovereign_vllm"
      ? (sovereign_vllm_configured ? "ready" : "partial")
      : embeddings_configured
        ? (embeddings_live && (embeddings_indexed_rows ?? 0) > 0 ? "ready" : "partial")
        : "missing",
  };

  return c.json({
    deploy_commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    checked_at: null, // stamped client-side; the server stays deterministic + side-effect free
    fields: {
      // Whether the DURABLE rate limiter is actually working — not merely configured. An in-memory
      // fallback is invisible from outside, which is how a limiter that had silently stopped
      // protecting anything went unnoticed until it was probed with sixteen requests.
      unresolved_client_errors,
      rate_limit_durable: rateLimitStoreHealth().durable,
      rate_limit_error: rateLimitStoreHealth().error,
      rate_limit_last_hits: rateLimitStoreHealth().last_hits,
      rate_limit_row_shape: rateLimitStoreHealth().row_shape,
      ai_gateway_configured,
      ai_gateway_healthy: null,   // configured-only: a live probe would cost paid AI requests, so we don't
      stripe_configured,
      stripe_webhook_configured,
      stripe_prices_configured,
      transactional_mail_configured,
      sovereign_mail_configured,
      // Configured says the envs are set; reachable says the appliance answered. They diverge
      // exactly when something is wrong, which is the case worth surfacing.
      sovereign_mail_reachable,
      sovereign_mail_checkable,
      support_email_replies_configured,
      recordings_storage_bytes: storage.bytes,
      recordings_storage_files: storage.files,
      recordings_storage_partial: storage.partial,
      recordings_storage_checkable: storage.checkable,
      storage_buckets: storage.buckets,
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
      embeddings_live,
      embeddings_indexed_rows,
      inference_mode,
      sovereign_vllm_configured,
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

/**
 * POST /api/v1/admin/readiness/vllm-test — MEASURED handshake against the sovereign vLLM engine.
 * Reports served models, GET /models round-trip, and a real 1-token TTFT. Booleans + measurements
 * only — never the key; URL host-only. No fabricated engine internals (vLLM does not report
 * PagedAttention state per request, so we do not display one).
 */
router.post("/readiness/vllm-test", async (c) => {
  const r = await sovereignVllmProbe();
  return c.json(r);
});

/**
 * GET /api/v1/admin/readiness/inference-shadow — per-task-class shadow comparison aggregates.
 * Metadata aggregates only (runs, error rate, avg latencies, avg similarity). Honest states:
 * enabled:false until the migration is applied or while the shadow switches are off.
 */
router.get("/readiness/inference-shadow", async (c) => {
  const ws = c.get("workspaceId");
  const q = await supabase.from("inference_shadow_runs")
    .select("task_class, shadow_ok, primary_latency_ms, shadow_latency_ms, similarity_pct, primary_tokens, shadow_tokens, created_at")
    .eq("workspace_id", ws).order("created_at", { ascending: false }).limit(2000);
  if (q.error && (q.error.code === "42P01" || q.error.code === "PGRST205" || /does not exist|could not find the table/i.test(q.error.message ?? ""))) {
    return c.json({ enabled: false, reason: "migration_not_applied" });
  }
  const rows = q.data ?? [];
  const byClass = new Map<string, { runs: number; ok: number; p_lat: number[]; s_lat: number[]; sim: number[] }>();
  for (const r of rows) {
    const k = String(r.task_class ?? "unclassified");
    const b = byClass.get(k) ?? { runs: 0, ok: 0, p_lat: [], s_lat: [], sim: [] };
    b.runs += 1;
    if (r.shadow_ok) {
      b.ok += 1;
      if (r.shadow_latency_ms != null) b.s_lat.push(Number(r.shadow_latency_ms));
      if (r.similarity_pct != null) b.sim.push(Number(r.similarity_pct));
    }
    if (r.primary_latency_ms != null) b.p_lat.push(Number(r.primary_latency_ms));
    byClass.set(k, b);
  }
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  return c.json({
    enabled: true,
    total_runs: rows.length,
    classes: [...byClass.entries()].map(([task_class, b]) => ({
      task_class, runs: b.runs, error_rate_pct: Math.round(((b.runs - b.ok) / b.runs) * 100),
      avg_primary_ms: avg(b.p_lat), avg_shadow_ms: avg(b.s_lat), avg_similarity_pct: avg(b.sim),
    })).sort((a, b) => b.runs - a.runs),
  });
});

export { router as adminReadinessRouter };
