import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requireModuleRW } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";
import { makeBaseConverter } from "../lib/currency-store";

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

const invoiceBodySchema = z.object({
  number: z.string().optional(),
  client_name: z.string().min(1),
  client_email: z.string().email().optional(),
  client_address: z.string().optional(),
  line_items: z.array(lineItemSchema).min(1),
  currency: z.string().default("GBP"),
  due_date: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(["draft", "sent", "viewed", "paid", "overdue", "cancelled"]).default("draft"),
  linked_record_id: z.string().uuid().optional(),
  is_recurring: z.boolean().default(false),
  recurring_frequency: z.enum(["monthly", "quarterly", "annual"]).optional(),
  next_due_date: z.string().optional(),
});

function calcTotals(lineItems: z.infer<typeof lineItemSchema>[]) {
  // Round to 2dp, matching quotes.ts. Without this, accumulated float error was STORED on the
  // invoice (3 x 33.33 @20% -> total 119.98800000000001), so: a quote converted to an invoice
  // then silently changed total on the next PATCH, and payment auto-close compared a paid
  // 0.30 against a stored 0.30000000000000004 and left the invoice permanently unpaid with a
  // sub-cent "Remaining" that rendered as 0.00.
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const subtotal = round2(lineItems.reduce((s, i) => s + i.quantity * i.unit_price, 0));
  const tax_total = round2(lineItems.reduce((s, i) => s + i.quantity * i.unit_price * (i.tax_rate / 100), 0));
  return { subtotal, tax_total, total: round2(subtotal + tax_total) };
}

// ─── State machine ────────────────────────────────────────────────────────────
// PATCH previously accepted any status and blindly merged the body, so an invoice could be
// marked `paid` with zero payments recorded (inflating the Collected KPI and /rollup), moved
// back from `paid` to `draft`, or have the line items of an already-sent document rewritten —
// silently changing the total on a document the client already has.
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft:     ["sent", "cancelled"],
  sent:      ["viewed", "paid", "overdue", "cancelled"],
  viewed:    ["paid", "overdue", "cancelled"],
  overdue:   ["paid", "cancelled"],
  paid:      [],          // terminal
  cancelled: [],          // terminal
};
/** Money (line items / currency) is only editable while the document is still a draft. */
const MONEY_LOCKED_AFTER = new Set(["sent", "viewed", "paid", "overdue", "cancelled"]);

async function nextInvoiceNumber(workspaceId: string): Promise<string> {
  // Highest existing number + 1 (not count+1, which collides after a deletion).
  const { data } = await supabase
    .from("nodes")
    .select("data")
    .eq("workspace_id", workspaceId)
    .eq("vertical", "finance")
    .eq("object_type", "invoice")
    .order("data->>number", { ascending: false })
    .limit(1);
  const last = String((data?.[0]?.data as Record<string, unknown> | undefined)?.number ?? "");
  const lastN = parseInt(last.replace(/\D/g, ""), 10) || 0;
  return `INV-${String(lastN + 1).padStart(4, "0")}`;
}

// Per-client finance rollup for the records sheet (one query powers a whole column, no N+1).
// Totals are converted to the workspace BASE currency server-side via the sovereign ECB rates.
router.get("/rollup", async (c) => {
  const workspaceId = c.get("workspaceId");
  const [{ data }, { base, toBase }] = await Promise.all([
    supabase.from("nodes").select("data").eq("workspace_id", workspaceId).eq("vertical", "finance").eq("object_type", "invoice"),
    makeBaseConverter(workspaceId),
  ]);
  const OUTSTANDING = new Set(["sent", "viewed", "overdue"]);
  // "Billed" = real committed billing — a draft or cancelled invoice was never billed to the client.
  const BILLED = new Set(["sent", "viewed", "overdue", "paid"]);
  const byClient: Record<string, { billed: number; collected: number; outstanding: number; count: number }> = {};
  for (const row of data ?? []) {
    const d = (row.data ?? {}) as Record<string, unknown>;
    const name = String(d.client_name ?? "").trim();
    if (!name) continue;
    const amt = toBase(Number(d.total ?? 0) || 0, String(d.currency ?? base));
    const st = String(d.status ?? "draft");
    const b = (byClient[name] ??= { billed: 0, collected: 0, outstanding: 0, count: 0 });
    b.count += 1;
    if (BILLED.has(st)) b.billed += amt;
    if (st === "paid") b.collected += amt;
    if (OUTSTANDING.has(st)) b.outstanding += amt;
  }
  return c.json({ base, clients: byClient });
});

router.get("/", async (c) => {
  const status = c.req.query("status");
  const search = c.req.query("search") ?? "";
  const linkedRecordId = c.req.query("linked_record_id");

  let query = supabase
    .from("nodes")
    .select("id,data,created_at,updated_at,created_by")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("vertical", "finance")
    .eq("object_type", "invoice")
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
    .eq("object_type", "invoice")
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "Not found" }, 404);
  return c.json({ id: data.id, ...data.data, created_at: data.created_at, updated_at: data.updated_at, created_by: data.created_by });
});

router.post("/", zValidator("json", invoiceBodySchema), async (c) => {
  const body = c.req.valid("json");
  const number = body.number || await nextInvoiceNumber(c.get("workspaceId"));
  const { subtotal, tax_total, total } = calcTotals(body.line_items);

  const invoiceData = {
    number,
    client_name: body.client_name,
    client_email: body.client_email ?? null,
    client_address: body.client_address ?? null,
    line_items: body.line_items,
    currency: body.currency,
    subtotal,
    tax_total,
    total,
    status: body.status,
    due_date: body.due_date ?? null,
    notes: body.notes ?? null,
    sent_at: null,
    paid_at: null,
    chase_count: 0,
    is_recurring: body.is_recurring,
    recurring_frequency: body.recurring_frequency ?? null,
    next_due_date: body.next_due_date ?? null,
    ...(body.linked_record_id ? { linked_record_id: body.linked_record_id } : {}),
  };

  const { data, error } = await supabase
    .from("nodes")
    .insert({
      workspace_id: c.get("workspaceId"),
      vertical: "finance",
      object_type: "invoice",
      data: invoiceData,
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
      relationship: "BILLED_TO",
    }).then(() => {});
  }

  return c.json({ id: data.id, ...data.data, created_at: data.created_at, created_by: data.created_by }, 201);
});

router.patch("/:id", zValidator("json", invoiceBodySchema.partial()), async (c) => {
  const { data: existing, error: fetchErr } = await supabase
    .from("nodes")
    .select("id,data")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"))
    .eq("vertical", "finance")
    .eq("object_type", "invoice")
    .maybeSingle();

  if (fetchErr) return c.json({ error: fetchErr.message }, 500);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = c.req.valid("json");
  const current = existing.data as Record<string, unknown>;
  const currentStatus = String(current.status ?? "draft");

  // Guard the status transition.
  if (body.status && body.status !== currentStatus) {
    const allowed = VALID_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(body.status)) {
      return c.json({ error: `Cannot move an invoice from ${currentStatus} to ${body.status}.` }, 422);
    }
    // Marking paid by hand must reflect real money: require payments covering the total.
    if (body.status === "paid") {
      const payments = Array.isArray(current.payments) ? (current.payments as Array<Record<string, unknown>>) : [];
      const paid = Math.round(payments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0) * 100) / 100;
      const owed = Number(current.total ?? 0);
      if (paid + 0.005 < owed) {
        return c.json({ error: `Cannot mark paid: ${paid} of ${owed} recorded. Record the payment first.` }, 422);
      }
    }
  }

  // Money is frozen once the document has left draft.
  const editsMoney = body.line_items !== undefined || body.currency !== undefined;
  if (editsMoney && MONEY_LOCKED_AFTER.has(currentStatus)) {
    return c.json({ error: `Line items and currency cannot change on a ${currentStatus} invoice.` }, 422);
  }

  const lineItems = (body.line_items ?? current.line_items) as z.infer<typeof lineItemSchema>[];
  const { subtotal, tax_total, total } = calcTotals(lineItems);

  const statusUpdates: Record<string, unknown> = {};
  if (body.status === "sent" && !current.sent_at) statusUpdates.sent_at = new Date().toISOString();
  if (body.status === "paid" && !current.paid_at) statusUpdates.paid_at = new Date().toISOString();

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
    .eq("object_type", "invoice");
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// ─── Record payment ───────────────────────────────────────────────────────────
router.post("/:id/payments", zValidator("json", z.object({
  amount: z.number().positive(),
  method: z.enum(["bank_transfer", "card", "cash", "cheque", "other"]).default("bank_transfer"),
  reference: z.string().optional(),
  paid_at: z.string().optional(),
})), async (c) => {
  const workspaceId = c.get("workspaceId");
  const { data: existing, error: fetchErr } = await supabase
    .from("nodes")
    .select("id,data")
    .eq("workspace_id", workspaceId)
    .eq("id", c.req.param("id"))
    .eq("vertical", "finance")
    .eq("object_type", "invoice")
    .maybeSingle();

  if (fetchErr) return c.json({ error: fetchErr.message }, 500);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = c.req.valid("json");
  const current = existing.data as Record<string, unknown>;
  const payments = Array.isArray(current.payments) ? (current.payments as Array<Record<string, unknown>>) : [];
  const newPayment = {
    id: crypto.randomUUID(),
    amount: body.amount,
    method: body.method,
    reference: body.reference ?? null,
    paid_at: body.paid_at ?? new Date().toISOString(),
  };
  const updatedPayments = [...payments, newPayment];
  // Payments are recorded in the invoice's own currency (no per-payment currency field), so a plain
  // sum is correct here. Guard against a malformed amount poisoning the total with NaN.
  const totalPaid = updatedPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const invoiceTotal = Number(current.total ?? 0) || 0;
  const statusUpdates: Record<string, unknown> = {};
  if (invoiceTotal > 0 && totalPaid >= invoiceTotal && current.status !== "paid") {
    statusUpdates.status = "paid";
    statusUpdates.paid_at = new Date().toISOString();
  }

  const updatedData = { ...current, payments: updatedPayments, ...statusUpdates };
  const { data, error } = await supabase
    .from("nodes")
    .update({ data: updatedData, updated_at: new Date().toISOString() })
    .eq("id", c.req.param("id"))
    .select("id,data,updated_at")
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ id: data.id, ...data.data, updated_at: data.updated_at });
});

// ─── Get credit notes applied to this invoice ────────────────────────────────
router.get("/:id/credit-notes", async (c) => {
  const workspaceId = c.get("workspaceId");
  const invoiceId = c.req.param("id");

  const { data: edges, error: edgeErr } = await supabase
    .from("edges")
    .select("from_node_id")
    .eq("workspace_id", workspaceId)
    .eq("to_node_id", invoiceId)
    .eq("relationship", "APPLIED_TO");

  if (edgeErr) return c.json({ error: edgeErr.message }, 500);
  if (!edges || edges.length === 0) return c.json([]);

  const creditNoteIds = edges.map(e => e.from_node_id);
  const { data, error } = await supabase
    .from("nodes")
    .select("id,data,created_at,updated_at,created_by")
    .eq("workspace_id", workspaceId)
    .eq("object_type", "credit_note")
    .in("id", creditNoteIds);

  if (error) return c.json({ error: error.message }, 500);
  return c.json((data ?? []).map(row => ({ id: row.id, ...(row.data as object), created_at: row.created_at, updated_at: row.updated_at, created_by: row.created_by })));
});

export { router as invoicesRouter };
