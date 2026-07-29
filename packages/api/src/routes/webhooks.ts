import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabase } from "@mondaily/db/client";
import { inngest } from "../lib/inngest";
import { createNotification } from "../lib/notify";
import { grantTierCredits } from "../lib/credits";
import { activateTier, downgradeToScout, normalizeTier, tierFromPriceId } from "../lib/billing-tiers";
import { verifyLiveKitWebhook, parseEgressWebhook } from "../lib/livekit";
import { ingestRecording } from "../jobs/meeting-memory";

const router = new Hono();

/* ── Nylas webhook — LEGACY / DISABLED ───────────────────────────────────────────
   Mondaily uses DIRECT Google (Gmail API), not Nylas — kept only so a stray old webhook
   registration gets a clean 410 instead of silently processing. Inert unless NYLAS_WEBHOOK_SECRET
   is still set (which a sovereign deployment does NOT set). */
router.post("/nylas", async (c) => {
  const challenge = c.req.query("challenge");
  if (challenge) return c.text(challenge); // harmless verification echo

  if (!process.env.NYLAS_WEBHOOK_SECRET) {
    return c.json({ error: "Nylas integration removed — Mondaily uses direct Google inbox access." }, 410);
  }

  const rawBody = await c.req.text();
  const sig     = c.req.header("x-nylas-signature") ?? "";
  const secret  = process.env.NYLAS_WEBHOOK_SECRET ?? "";

  if (secret && sig) {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (sig !== expected) return c.json({ error: "invalid signature" }, 401);
  }

  const payload = JSON.parse(rawBody) as { type?: string; data?: Record<string, unknown>; deltas?: unknown[] };
  const events  = payload.deltas ?? (payload.data ? [payload] : []);

  for (const evt of events as { type?: string; object?: { grant_id?: string; thread_id?: string; subject?: string } }[]) {
    if (evt.type === "message.created" || evt.type === "message.updated") {
      const grantId  = evt.object?.grant_id;
      const threadId = evt.object?.thread_id;
      if (!grantId || !threadId) continue;

      // Find workspace linked to this grant
      const { data: conn } = await supabase
        .from("email_connections")
        .select("workspace_id, user_id")
        .eq("grant_id", grantId)
        .single();

      if (conn) {
        // Notify workspace about new email
        await createNotification({
          workspace_id: conn.workspace_id,
          type: "email",
          title: "New email received",
          body: evt.object?.subject ?? "No subject",
          metadata: { thread_id: threadId, grant_id: grantId },
        });
      }
    }
  }

  return c.json({ ok: true });
});

/* ── Stripe webhook — update billing status ─────────────────────────────────── */
router.post("/stripe", async (c) => {
  const sig    = c.req.header("stripe-signature") ?? "";
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  const rawBody = await c.req.text();

  // FAIL CLOSED: a webhook grants tiers/credits, so an UNVERIFIED body is never trusted. If the secret
  // isn't configured, reject outright rather than parsing a forgeable body (a misconfig must not become
  // a free-credits exploit). A configured secret with a missing/invalid signature is also rejected.
  if (!secret) { console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET not set — rejecting unverifiable webhook"); return c.json({ error: "Webhook not configured." }, 503); }
  if (!sig) return c.json({ error: "Missing signature." }, 401);
  {
    const parts     = Object.fromEntries(sig.split(",").map(p => p.split("="))) as Record<string, string>;
    const timestamp = parts["t"] ?? "0";
    const age       = Math.abs(Date.now() / 1000 - parseInt(timestamp));
    if (age > 300) return c.json({ error: "timestamp too old" }, 400);

    const payload   = `${timestamp}.${rawBody}`;
    const expected  = createHmac("sha256", secret).update(payload).digest("hex");
    const provided  = parts["v1"] ?? "";
    if (provided.length !== expected.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
      return c.json({ error: "invalid signature" }, 401);
    }
  }

  const event = JSON.parse(rawBody) as { id?: string; type: string; data: { object: Record<string, unknown> } };

  // When checkout finishes, link the Stripe customer to the workspace and
  // activate the chosen plan. WITHOUT this, the customer id is never stored,
  // so the portal and subsequent subscription webhooks can't find the workspace.
  if (event.type === "checkout.session.completed") {
    const s = event.data.object;
    const meta = (s.metadata as Record<string, unknown> | undefined) ?? {};
    const workspaceId = (s.client_reference_id as string) || (meta.workspace_id as string | undefined);
    const customerId  = s.customer as string | undefined;

    if (meta.kind === "credit_pack") {
      // One-time AI credit purchase: grant the FINAL credits (base + plan/annual bonus) that the
      // catalog computed at checkout and stamped into metadata — the bonus is enforced here, not
      // just shown in the UI. Falls back to legacy `credits` for any pre-catalog session.
      const finalCredits = Number(meta.final_credits ?? meta.credits ?? 0);
      const base = Number(meta.base_credits ?? finalCredits);
      const bonus = Number(meta.bonus_credits ?? 0);
      const packId = String(meta.pack_id ?? "pack");
      if (workspaceId && customerId) {
        await supabase.from("workspaces").update({ stripe_customer_id: customerId }).eq("id", workspaceId);
      }
      if (workspaceId && finalCredits > 0) {
        // IDEMPOTENCY: Stripe delivers at-least-once and retries on any non-2xx. The checkout session
        // id is unique per payment, so refuse to grant twice for the same session (a credit purchase
        // is additive — replays would stack free credits without this guard).
        const sessionId = String(s.id ?? "");
        const { data: dup } = sessionId
          ? await supabase.from("ai_credits_ledger").select("id").eq("workspace_id", workspaceId).eq("transaction_type", "purchase").ilike("description", `%[${sessionId}]%`).limit(1).maybeSingle()
          : { data: null };
        if (!dup) {
          await supabase.from("ai_credits_ledger").insert({
            workspace_id: workspaceId,
            amount: Math.round(finalCredits),
            transaction_type: "purchase",
            description: `${packId} pack · ${base.toLocaleString()} + ${bonus.toLocaleString()} bonus = ${finalCredits.toLocaleString()} AI credits [${sessionId}]`,
          }).then(() => {}, () => {});
        }
      }
    } else if (workspaceId) {
      // Subscription checkout: link the Stripe customer + activate the real tier (settings.
      // account_tier — what the rest of the app actually reads for gating/seats/nav).
      const tier = normalizeTier(meta.plan as string | undefined);
      if (customerId) await supabase.from("workspaces").update({ stripe_customer_id: customerId }).eq("id", workspaceId);
      await activateTier(workspaceId, tier, s.subscription as string | undefined);
    }
  }

  // A successful recurring payment confirms the workspace is in good standing —
  // record it in settings (covers renewals where no subscription.updated fires).
  if (event.type === "invoice.payment_succeeded") {
    const inv = event.data.object;
    const customerId = inv.customer as string | undefined;
    if (customerId) {
      const { data: ws } = await supabase.from("workspaces").select("id, settings").eq("stripe_customer_id", customerId).maybeSingle();
      if (ws) {
        const prevSettings = (ws.settings as Record<string, unknown> | null) ?? {};
        const settings: Record<string, unknown> = { ...prevSettings, billing_status: "active", last_payment_at: new Date().toISOString() };
        delete settings.trial_ends_at;   // a paid renewal is no longer a trial — clear any stale marker
        // Stamp payment + keep active first (preserves account_tier; activateTier below re-reads and
        // keeps last_payment_at). This event = money genuinely received.
        await supabase.from("workspaces").update({ settings }).eq("id", ws.id as string).then(() => {}, () => {});
        // AUTHORITATIVE ACTIVATION: for an async/ACH FIRST payment we deliberately did NOT grant the
        // tier at /subscribe time, so activate it here from the subscription's plan metadata (Stripe
        // stamps it on the invoice's subscription_details). activateTier is idempotent AND grants the
        // monthly credit top-up, so it doubles as the ordinary renewal path — exactly one grant.
        const planFromInvoice = ((inv.subscription_details as { metadata?: Record<string, unknown> } | undefined)?.metadata?.plan
          ?? settings.account_tier) as string | undefined;
        const tier = normalizeTier(planFromInvoice);
        if (tier && tier !== "scout") {
          await activateTier(ws.id as string, tier, inv.subscription as string | undefined).catch(() => {});
        } else {
          // Unknown/scout plan on a paid invoice — just top up whatever tier is on file.
          await grantTierCredits(ws.id as string, tier, `${tier} plan payment received via Stripe`).catch(() => {});
        }
      }
    }
  }

  // A failed renewal charge — flag it so billing UI can prompt the user, but don't lock them out
  // immediately (Stripe already retries automatically before subscription.deleted fires).
  if (event.type === "invoice.payment_failed") {
    const inv = event.data.object;
    const customerId = inv.customer as string | undefined;
    if (customerId) {
      const { data: ws } = await supabase.from("workspaces").select("id, settings, name").eq("stripe_customer_id", customerId).maybeSingle();
      if (ws) {
        const settings = { ...((ws.settings as Record<string, unknown> | null) ?? {}), billing_status: "payment_failed" };
        await supabase.from("workspaces").update({ settings }).eq("id", ws.id as string).then(() => {}, () => {});
        // Tell the user — in-app notification AND email (createNotification does both, per prefs).
        // Without this the failure was silent: full access kept until Stripe finally cancels.
        await createNotification({
          workspace_id: ws.id as string,
          type: "billing",
          title: "Payment failed — action needed",
          body: "Your subscription payment didn't go through. Update your card in Settings → Billing to keep your plan active.",
          metadata: { billing_status: "payment_failed", cta: "/settings/billing" },
        }).catch(() => {});
      }
    }
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub        = event.data.object;
    const customerId = sub.customer as string;
    const status     = sub.status as string;
    const planMeta   = (sub.metadata as Record<string, unknown> | undefined)?.plan as string | undefined;
    const { data: ws } = await supabase.from("workspaces").select("id").eq("stripe_customer_id", customerId).maybeSingle();
    if (ws) {
      const workspaceId = ws.id as string;
      const isGone = event.type === "customer.subscription.deleted" || !["active", "trialing"].includes(status);
      if (isGone) {
        await downgradeToScout(workspaceId);
        // Never strip access silently — tell the user why features changed and how to restore them.
        await createNotification({
          workspace_id: workspaceId,
          type: "billing",
          title: "Subscription ended — downgraded to Scout",
          body: "Your paid plan lapsed, so the workspace is back on the free Scout tier. Re-subscribe in Settings → Billing to restore full access.",
          metadata: { billing_status: "cancelled", cta: "/settings/billing" },
        }).catch(() => {});
      } else {
        // The PRICE is what the customer actually pays for; metadata.plan is written once at
        // creation and goes stale on any portal-side plan change. Fall back to metadata only when
        // the price isn't one we recognise, and refuse to silently downgrade a live subscription to
        // Scout just because neither source identified a paid tier.
        const priceId = (sub.items as { data?: { price?: { id?: string } }[] } | undefined)?.data?.[0]?.price?.id;
        const resolved = tierFromPriceId(priceId) ?? (planMeta ? normalizeTier(planMeta) : null);
        if (resolved && resolved !== "scout") {
          await activateTier(workspaceId, resolved, sub.id as string | undefined);
        } else {
          console.warn("[stripe] active subscription with unresolvable tier — leaving entitlement untouched", { workspaceId, priceId, planMeta });
        }
      }
    }
  }

  return c.json({ ok: true });
});

/* ── LiveKit egress webhook — Meeting Memory recording lifecycle ──────────────────
   Fires when a recording starts / finishes on the self-hosted LiveKit server. Signed with the
   LiveKit API secret (Authorization JWT whose `sha256` claim must match the body hash); we verify
   before trusting anything. On completion we correlate the egress id back to the call_session and
   kick the sovereign transcription pipeline. FAIL-CLOSED: no LIVEKIT_API_SECRET → 401. */
router.post("/livekit", async (c) => {
  const rawBody = await c.req.text();
  const ok = await verifyLiveKitWebhook(rawBody, c.req.header("Authorization"));
  if (!ok) return c.json({ error: "invalid signature" }, 401);

  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return c.json({ error: "bad payload" }, 400); }
  const hook = parseEgressWebhook(payload);
  if (!hook?.egressId) return c.json({ ok: true }); // not an egress event we track

  const { data: session } = await supabase
    .from("call_sessions").select("id, recording_status").eq("egress_id", hook.egressId).maybeSingle();
  if (!session) return c.json({ ok: true }); // unknown egress — nothing to do

  if (hook.event === "egress_started") {
    await supabase.from("call_sessions").update({ recording_status: "recording" }).eq("id", session.id);
    return c.json({ ok: true });
  }

  if (hook.event === "egress_ended") {
    const failed = hook.status === "EGRESS_FAILED" || !hook.url;
    if (failed) {
      await supabase.from("call_sessions").update({ recording_status: "failed" }).eq("id", session.id);
      return c.json({ ok: true });
    }
    await supabase.from("call_sessions").update({ recording_status: "ready", recording_url: hook.url }).eq("id", session.id);
    // Transcription can outlast a webhook's budget — hand off to Inngest when available, else run
    // inline (short calls). Either path is idempotent via the session's memory_node_id.
    if (process.env.INNGEST_EVENT_KEY) {
      await inngest.send({ name: "meeting/recording.ready", data: { sessionId: session.id } }).catch(() => {});
    } else {
      void ingestRecording(session.id);
    }
    return c.json({ ok: true });
  }

  return c.json({ ok: true });
});

export { router as webhooksRouter };
