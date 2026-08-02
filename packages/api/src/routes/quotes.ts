import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requireModuleRW } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";
import { aiGateway, gatewayEnv } from "../lib/ai-gateway";
import { moneyAt } from "../lib/currency-store";
import { toMinor, fromMinor } from "@mondaily/shared/money";

type Variables = { userId: string; workspaceId: string; role: string };

const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);
router.use("*", requireModuleRW("finance")); // per-member Finance & Billing access

const lineItemSchema = z.object({
  description: z.string(),
  quantity: z.number().positive(),
  unit_price: z.number().min(0),
  tax_rate: z.number().min(0).max(100).default(0),
});

const quoteBodySchema = z.object({
  number: z.string().optional(),
  client_name: z.string().min(1),
  client_email: z.string().email().optional(),
  line_items: z.array(lineItemSchema).min(1),
  currency: z.string().default("GBP"),
  expires_at: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(["draft", "sent", "accepted", "declined", "expired"]).default("draft"),
  linked_record_id: z.string().uuid().optional(),
});

function calcTotals(lineItems: z.infer<typeof lineItemSchema>[], currency = "USD") {
  // Computed in INTEGER MINOR UNITS, then converted back once.
  //
  // The previous version rounded each float sum to 2dp, which is not the same thing: rounding after
  // adding floats still stores the accumulated error, and 3 x 33.33 @20% arrived as
  // 119.98800000000001. It also assumed every currency has 2 decimals, silently mis-stating JPY
  // (none) and KWD (three). Rounding PER LINE is what an invoice actually does — each line is a
  // real charge — and integers then add exactly.
  let subtotalMinor = 0;
  let taxMinor = 0;
  for (const i of lineItems) {
    const line = toMinor(i.quantity * i.unit_price, currency);
    subtotalMinor += line;
    taxMinor += Math.round(line * (i.tax_rate / 100));
  }
  return {
    subtotal: fromMinor(subtotalMinor, currency),
    tax_total: fromMinor(taxMinor, currency),
    total: fromMinor(subtotalMinor + taxMinor, currency),
  };
}

// Next sequence number from the MAX existing number, not count+1 — count collides after any deletion
// (delete QUO-0003 of 5 → count 4 → next QUO-0005, which already exists). Highest-number + 1 is stable.
async function nextSeqNumber(workspaceId: string, objectType: "quote" | "invoice", prefix: string): Promise<string> {
  const { data } = await supabase
    .from("nodes")
    .select("data")
    .eq("workspace_id", workspaceId)
    .eq("vertical", "finance")
    .eq("object_type", objectType)
    .order("data->>number", { ascending: false })
    .limit(1);
  const last = String((data?.[0]?.data as Record<string, unknown> | undefined)?.number ?? "");
  const lastN = parseInt(last.replace(/\D/g, ""), 10) || 0;
  return `${prefix}-${String(lastN + 1).padStart(4, "0")}`;
}

async function nextQuoteNumber(workspaceId: string): Promise<string> {
  return nextSeqNumber(workspaceId, "quote", "QUO");
}

async function nextInvoiceNumber(workspaceId: string): Promise<string> {
  return nextSeqNumber(workspaceId, "invoice", "INV");
}

router.get("/", async (c) => {
  const status = c.req.query("status");
  const search = c.req.query("search") ?? "";
  const linkedRecordId = c.req.query("linked_record_id");

  let query = supabase
    .from("nodes")
    .select("id,data,created_at,updated_at,created_by")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("vertical", "finance")
    .eq("object_type", "quote")
    .order("created_at", { ascending: false });

  if (status) query = query.eq("data->>status", status);
  if (linkedRecordId) query = query.eq("data->>linked_record_id", linkedRecordId);

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

  const result = (data ?? []).filter(row => {
    if (!search) return true;
    const d = row.data as Record<string, unknown>;
    return (
      String(d.number ?? "").toLowerCase().includes(search.toLowerCase()) ||
      String(d.client_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      String(d.client_email ?? "").toLowerCase().includes(search.toLowerCase())
    );
  }).map(row => ({ id: row.id, ...row.data, created_at: row.created_at, updated_at: row.updated_at, created_by: row.created_by }));

  return c.json(result);
});

router.get("/:id", async (c) => {
  const { data, error } = await supabase
    .from("nodes")
    .select("id,data,created_at,updated_at,created_by")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"))
    .eq("vertical", "finance")
    .eq("object_type", "quote")
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "Not found" }, 404);
  return c.json({ id: data.id, ...data.data, created_at: data.created_at, updated_at: data.updated_at, created_by: data.created_by });
});

router.post("/", zValidator("json", quoteBodySchema), async (c) => {
  const body = c.req.valid("json");
  const number = body.number || await nextQuoteNumber(c.get("workspaceId"));
  const { subtotal, tax_total, total } = calcTotals(body.line_items, body.currency);

  // Same money model as invoices: freeze what the client is quoted and the rate that valued it
  // that day. Without this a quote's base value is recomputed on every read at today's rate.
  const issuedOn = new Date().toISOString().slice(0, 10);
  const money = await moneyAt(c.get("workspaceId"), total, body.currency, issuedOn);

  const quoteData = {
    number,
    client_name: body.client_name,
    client_email: body.client_email ?? null,
    line_items: body.line_items,
    currency: body.currency,
    subtotal,
    tax_total,
    total,
    ...(money ?? {}),
    issued_on: issuedOn,
    status: body.status,
    expires_at: body.expires_at ?? null,
    notes: body.notes ?? null,
    sent_at: null,
    ...(body.linked_record_id ? { linked_record_id: body.linked_record_id } : {}),
  };

  const { data, error } = await supabase
    .from("nodes")
    .insert({
      workspace_id: c.get("workspaceId"),
      vertical: "finance",
      object_type: "quote",
      data: quoteData,
      created_by: c.get("userId"),
    })
    .select("id,data,created_at,created_by")
    .single();

  if (error) return c.json({ error: error.message }, 500);

  if (body.linked_record_id) {
    supabase.from("edges").insert({
      workspace_id: c.get("workspaceId"),
      from_node_id: data.id,
      to_node_id: body.linked_record_id,
      relationship: "QUOTED_FOR",
    }).then(() => {});
  }

  return c.json({ id: data.id, ...data.data, created_at: data.created_at, created_by: data.created_by }, 201);
});

router.patch("/:id", zValidator("json", quoteBodySchema.partial()), async (c) => {
  const { data: existing, error: fetchErr } = await supabase
    .from("nodes")
    .select("id,data")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"))
    .eq("vertical", "finance")
    .eq("object_type", "quote")
    .maybeSingle();

  if (fetchErr) return c.json({ error: fetchErr.message }, 500);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = c.req.valid("json");
  const current = existing.data as Record<string, unknown>;
  const lineItems = (body.line_items ?? current.line_items) as z.infer<typeof lineItemSchema>[];
  const { subtotal, tax_total, total } = calcTotals(lineItems, String(body.currency ?? current.currency ?? "USD"));

  const statusUpdates: Record<string, unknown> = {};
  if (body.status === "sent" && !current.sent_at) statusUpdates.sent_at = new Date().toISOString();

  const updatedData = {
    ...current,
    ...body,
    line_items: lineItems,
    subtotal,
    tax_total,
    total,
    ...statusUpdates,
  };

  const { data, error } = await supabase
    .from("nodes")
    .update({ data: updatedData, updated_at: new Date().toISOString() })
    // Scoped on the WRITE too, not only on the read above. The prior fetch already 404s a
    // foreign id, so this is defence in depth: it keeps the guarantee local to the statement
    // that mutates, instead of depending on a check several lines away staying correct.
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"))
    .select("id,data,updated_at")
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ id: data.id, ...data.data, updated_at: data.updated_at });
});

router.delete("/:id", async (c) => {
  const { error } = await supabase
    .from("nodes")
    .delete()
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"))
    .eq("vertical", "finance")
    .eq("object_type", "quote");
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// ─── Convert quote to invoice ─────────────────────────────────────────────────
router.post("/:id/convert", async (c) => {
  const workspaceId = c.get("workspaceId");

  const { data: quote, error: fetchErr } = await supabase
    .from("nodes")
    .select("id,data")
    .eq("workspace_id", workspaceId)
    .eq("id", c.req.param("id"))
    .eq("vertical", "finance")
    .eq("object_type", "quote")
    .maybeSingle();

  if (fetchErr) return c.json({ error: fetchErr.message }, 500);
  if (!quote) return c.json({ error: "Not found" }, 404);

  const qd = quote.data as Record<string, unknown>;
  // Idempotency: a quote converts to an invoice exactly once. If it already has, return the existing
  // invoice instead of minting a duplicate (double-click / retry safe).
  if (qd.converted_to_invoice_id) {
    const { data: existing } = await supabase.from("nodes")
      .select("id,data,created_at,created_by").eq("workspace_id", workspaceId).eq("id", qd.converted_to_invoice_id as string).maybeSingle();
    if (existing) return c.json({ id: existing.id, ...(existing.data as object), created_at: existing.created_at, created_by: existing.created_by, already_converted: true }, 200);
  }
  const invoiceNumber = await nextInvoiceNumber(workspaceId);

  // The new invoice is a NEW money event: it is issued today, so it is valued at today's rate, not
  // at the rate that valued the quote weeks ago. Copying the quote's block would misdate it.
  const convertedOn = new Date().toISOString().slice(0, 10);
  const invoiceMoney = await moneyAt(workspaceId, Number(qd.total ?? 0) || 0, String(qd.currency ?? "GBP"), convertedOn);

  const invoiceData = {
    number: invoiceNumber,
    client_name: qd.client_name ?? "",
    client_email: qd.client_email ?? null,
    line_items: qd.line_items ?? [],
    currency: qd.currency ?? "GBP",
    subtotal: qd.subtotal ?? 0,
    tax_total: qd.tax_total ?? 0,
    total: qd.total ?? 0,
    ...(invoiceMoney ?? {}),
    issued_on: convertedOn,
    status: "draft",
    sent_at: null,
    paid_at: null,
    chase_count: 0,
    notes: qd.notes ?? null,
    ...(qd.linked_record_id ? { linked_record_id: qd.linked_record_id } : {}),
    converted_from_quote_id: quote.id,
  };

  const { data: newInvoice, error: insertErr } = await supabase
    .from("nodes")
    .insert({
      workspace_id: workspaceId,
      vertical: "finance",
      object_type: "invoice",
      data: invoiceData,
      created_by: c.get("userId"),
    })
    .select("id,data,created_at,created_by")
    .single();

  if (insertErr) return c.json({ error: insertErr.message }, 500);

  // Mark the quote accepted AND record the invoice id so a re-convert is a no-op. Scope the write.
  await supabase
    .from("nodes")
    .update({ data: { ...qd, status: "accepted", converted_to_invoice_id: newInvoice.id }, updated_at: new Date().toISOString() })
    .eq("id", quote.id).eq("workspace_id", workspaceId).eq("object_type", "quote");

  return c.json({ id: newInvoice.id, ...newInvoice.data, created_at: newInvoice.created_at, created_by: newInvoice.created_by }, 201);
});

// ─── AI: draft a quote from a short brief ─────────────────────────────────────
// Drafting aid only — grounded in the brief the user typed (which may describe a deal).
// Returns a client name, an amount, and a one/two-line deliverable note for the modal to
// fill; the user reviews and edits before creating. Never invents figures not implied.
router.post("/draft", zValidator("json", z.object({ brief: z.string().min(1).max(1000), currency: z.string().max(8).optional() })), async (c) => {
  const env = gatewayEnv();
  if (!env.baseURL || !env.apiKey) return c.json({ error: "AI isn't available right now." }, 503);
  const { brief, currency } = c.req.valid("json");
  const system = `You draft a business sales quote from a short brief${currency ? ` (currency ${currency})` : ""}. Reply with ONLY compact JSON {"client_name":"<name or empty>","amount":<number in major units, 0 if unknown>,"notes":"<one or two lines describing the deliverable>"}. Use ONLY what the brief implies — never invent a client or a price that isn't suggested. If a value is unknown, use "" or 0.`;
  try {
    const res = await aiGateway({ system, prompt: brief, maxTokens: 220, workspaceId: c.get("workspaceId"), userId: c.get("userId"), feature: "quote_draft" });
    const raw = (res.text ?? "").trim();
    if (!raw || res.provider === "none") return c.json({ error: "Couldn't draft that (check your AI credits)." }, 200);
    let client_name = "", amount = 0, notes = "";
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      const p = m ? JSON.parse(m[0]) : {};
      if (typeof p.client_name === "string") client_name = p.client_name.slice(0, 200);
      if (typeof p.amount === "number" && Number.isFinite(p.amount) && p.amount >= 0) amount = Math.min(p.amount, 1_000_000_000);
      if (typeof p.notes === "string") notes = p.notes.slice(0, 600);
    } catch { /* leave defaults if the model didn't return clean JSON */ }
    return c.json({ client_name, amount, notes });
  } catch { return c.json({ error: "Couldn't draft that — please try again." }, 200); }
});

export { router as quotesRouter };
