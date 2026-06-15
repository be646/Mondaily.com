import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

type Variables = { userId: string; workspaceId: string; role: string };

const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

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

function calcTotals(lineItems: z.infer<typeof lineItemSchema>[]) {
  const subtotal = lineItems.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const tax_total = lineItems.reduce((s, i) => s + i.quantity * i.unit_price * (i.tax_rate / 100), 0);
  return { subtotal, tax_total, total: subtotal + tax_total };
}

async function nextQuoteNumber(workspaceId: string): Promise<string> {
  const { count } = await supabase
    .from("nodes")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("vertical", "finance")
    .eq("object_type", "quote");
  const n = (count ?? 0) + 1;
  return `QUO-${String(n).padStart(4, "0")}`;
}

async function nextInvoiceNumber(workspaceId: string): Promise<string> {
  const { count } = await supabase
    .from("nodes")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("vertical", "finance")
    .eq("object_type", "invoice");
  const n = (count ?? 0) + 1;
  return `INV-${String(n).padStart(4, "0")}`;
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
  const { subtotal, tax_total, total } = calcTotals(body.line_items);

  const quoteData = {
    number,
    client_name: body.client_name,
    client_email: body.client_email ?? null,
    line_items: body.line_items,
    currency: body.currency,
    subtotal,
    tax_total,
    total,
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
  const { subtotal, tax_total, total } = calcTotals(lineItems);

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
  const invoiceNumber = await nextInvoiceNumber(workspaceId);

  const invoiceData = {
    number: invoiceNumber,
    client_name: qd.client_name ?? "",
    client_email: qd.client_email ?? null,
    line_items: qd.line_items ?? [],
    currency: qd.currency ?? "GBP",
    subtotal: qd.subtotal ?? 0,
    tax_total: qd.tax_total ?? 0,
    total: qd.total ?? 0,
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

  // Update quote status to accepted
  await supabase
    .from("nodes")
    .update({ data: { ...qd, status: "accepted" }, updated_at: new Date().toISOString() })
    .eq("id", quote.id);

  return c.json({ id: newInvoice.id, ...newInvoice.data, created_at: newInvoice.created_at, created_by: newInvoice.created_by }, 201);
});

export { router as quotesRouter };
