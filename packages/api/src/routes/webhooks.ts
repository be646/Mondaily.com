import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabase } from "@mondaily/db/client";
import { inngest } from "../lib/inngest";
import { createNotification } from "../lib/notify";
import { grantTierCredits } from "../lib/credits";
import { activateTier, downgradeToScout, normalizeTier } from "../lib/billing-tiers";

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

  // Basic timestamp tolerance check (Stripe embeds t= in signature)
  if (secret && sig) {
    const parts     = Object.fromEntries(sig.split(",").map(p => p.split("="))) as Record<string, string>;
    const timestamp = parts["t"] ?? "0";
    const age       = Math.abs(Date.now() / 1000 - parseInt(timestamp));
    if (age > 300) return c.json({ error: "timestamp too old" }, 400);

    const payload   = `${timestamp}.${rawBody}`;
    const expected  = createHmac("sha256", secret).update(payload).digest("hex");
    const provided  = parts["v1"] ?? "";
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(provided.padEnd(expected.length, "0")))) {
      return c.json({ error: "invalid signature" }, 401);
    }
  }

  const event = JSON.parse(rawBody) as { type: string; data: { object: Record<string, unknown> } };

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
        await supabase.from("ai_credits_ledger").insert({
          workspace_id: workspaceId,
          amount: Math.round(finalCredits),
          transaction_type: "purchase",
          description: `${packId} pack · ${base.toLocaleString()} + ${bonus.toLocaleString()} bonus = ${finalCredits.toLocaleString()} AI credits`,
        }).then(() => {}, () => {});
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
        await supabase.from("workspaces").update({ settings }).eq("id", ws.id as string).then(() => {}, () => {});
        // Renewal — top the wallet back up to the tier's monthly allotment.
        const tier = normalizeTier(settings.account_tier as string | undefined);
        await grantTierCredits(ws.id as string, tier, `${tier} plan renewed via Stripe`).catch(() => {});
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
      } else {
        await activateTier(workspaceId, normalizeTier(planMeta), sub.id as string | undefined);
      }
    }
  }

  return c.json({ ok: true });
});

export { router as webhooksRouter };
