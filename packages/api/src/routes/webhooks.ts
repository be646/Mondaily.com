import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabase } from "@mondaily/db/client";
import { inngest } from "../lib/inngest";
import { createNotification } from "../lib/notify";

const router = new Hono();

/* ── Clerk webhook — sync user creates/updates to workspace_members ────────── */
router.post("/clerk", async (c) => {
  const svixId        = c.req.header("svix-id") ?? "";
  const svixTimestamp = c.req.header("svix-timestamp") ?? "";
  const svixSignature = c.req.header("svix-signature") ?? "";
  const rawBody       = await c.req.text();
  const secret        = process.env.CLERK_WEBHOOK_SECRET ?? "";

  if (secret) {
    const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
    const secretBytes   = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected      = createHmac("sha256", secretBytes).update(signedContent).digest("base64");
    const signatures    = svixSignature.split(" ").map(s => s.replace(/^v1,/, ""));
    const valid         = signatures.some(sig => {
      try { return timingSafeEqual(Buffer.from(sig, "base64"), Buffer.from(expected, "base64")); }
      catch { return false; }
    });
    if (!valid) return c.json({ error: "invalid signature" }, 401);
  }

  const event = JSON.parse(rawBody) as { type: string; data: Record<string, unknown> };

  if (event.type === "user.created" || event.type === "user.updated") {
    const u = event.data;
    const email = (u.email_addresses as { email_address: string }[])?.[0]?.email_address ?? "";
    const name  = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
    const userId = u.id as string;
    if (email && userId) {
      // Update all workspace_members rows for this user
      await supabase
        .from("workspace_members")
        .update({ email, name, avatar_url: u.image_url as string ?? null })
        .eq("user_id", userId);
    }
  }

  return c.json({ ok: true });
});

/* ── Nylas webhook — ingest email events ────────────────────────────────────── */
router.post("/nylas", async (c) => {
  const challenge = c.req.query("challenge");
  if (challenge) return c.text(challenge); // Nylas verification handshake

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
    const workspaceId = (s.client_reference_id as string) || ((s.metadata as Record<string, unknown> | undefined)?.workspace_id as string | undefined);
    const customerId  = s.customer as string | undefined;
    const plan        = ((s.metadata as Record<string, unknown> | undefined)?.plan as string | undefined) || "pro";
    if (workspaceId) {
      await supabase
        .from("workspaces")
        .update({ ...(customerId ? { stripe_customer_id: customerId } : {}), plan })
        .eq("id", workspaceId);
    }
  }

  // A successful recurring payment confirms the workspace is in good standing —
  // record it in settings (covers renewals where no subscription.updated fires).
  if (event.type === "invoice.payment_succeeded") {
    const inv = event.data.object;
    const customerId = inv.customer as string | undefined;
    if (customerId) {
      const { data: ws } = await supabase.from("workspaces").select("settings").eq("stripe_customer_id", customerId).maybeSingle();
      if (ws) {
        const settings = { ...((ws.settings as Record<string, unknown> | null) ?? {}), billing_status: "active", last_payment_at: new Date().toISOString() };
        await supabase.from("workspaces").update({ settings }).eq("stripe_customer_id", customerId).then(() => {}, () => {});
      }
    }
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub      = event.data.object;
    const customerId = sub.customer as string;
    const status   = sub.status as string;
    // Keep the plan label if active; reading the plan from subscription metadata
    // when present, else leaving the existing one; downgrade to free when gone.
    const planMeta = ((sub.metadata as Record<string, unknown> | undefined)?.plan as string | undefined);
    const nextPlan = event.type === "customer.subscription.deleted" || status !== "active"
      ? "free"
      : (planMeta ?? "pro");
    await supabase
      .from("workspaces")
      .update({ plan: nextPlan })
      .eq("stripe_customer_id", customerId);
  }

  return c.json({ ok: true });
});

export { router as webhooksRouter };
