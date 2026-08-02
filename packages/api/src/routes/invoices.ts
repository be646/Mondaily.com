import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requireModuleRW } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";
import { nextInvoiceNumber } from "../lib/document-numbers";
import { makeBaseConverter, moneyAt, settlementRateAt } from "../lib/currency-store";
import { buildSettlement, hasMoney, readMoney, toMinor, fromMinor } from "@mondaily/shared/money";
import { isBilled, isCollected, isOutstanding } from "@mondaily/shared/finance";

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


// Per-client finance rollup for the records sheet (one query powers a whole column, no N+1).
// Totals are converted to the workspace BASE currency server-side via the sovereign ECB rates.
/**
 * Per-client / per-record invoice rollup — the UNI-DIRECTIONAL link from invoices to leads and
 * sheet rows.
 *
 * Money is never copied onto a lead. The invoice is the sole writer; everything else READS this
 * derived view. Copying a paid status and a total onto the linked record would create a second
 * writable source of truth for the same money, which drifts the moment either side is edited and
 * can loop if both sides sync — the same failure the six hand-written status sets caused.
 *
 * Keyed two ways because the data is two ways: `records` by linked_record_id (structural, exact)
 * and `clients` by client name (all that exists for most invoices today — 13 of 16 here). The name
 * key is a fallback, and `basis` reports how much of the total came from each so a caller can say
 * which it is rather than implying both are equally reliable.
 */
router.get("/rollup", async (c) => {
  const workspaceId = c.get("workspaceId");
  const [{ data }, { base, toBase }] = await Promise.all([
    supabase.from("nodes").select("data").eq("workspace_id", workspaceId).eq("vertical", "finance").eq("object_type", "invoice"),
    makeBaseConverter(workspaceId),
  ]);
  // Status meanings come from @mondaily/shared/finance — the SAME source the reports chart, the
  // invoice list, insights and the detail page read. They were written out by hand in six places
  // and had already drifted: the reports chart counted drafts as billed while this rollup didn't.
  type Bucket = { billed: number; collected: number; outstanding: number; count: number; last_paid_at: string | null };
  const mk = (): Bucket => ({ billed: 0, collected: 0, outstanding: 0, count: 0, last_paid_at: null });
  const byClient: Record<string, Bucket> = {};
  const byRecord: Record<string, Bucket> = {};
  let frozen = 0, live = 0;

  for (const row of data ?? []) {
    const d = (row.data ?? {}) as Record<string, unknown>;
    const st = String(d.status ?? "draft");
    const m = readMoney(d);

    // Value from the FROZEN base where the record has one, so this rollup stops moving with
    // today's rate. It previously re-converted `total` on every request, which is why a client's
    // lifetime value was a slightly different number each morning.
    let amt: number;
    if (m.modelled && m.base_amount != null && (m.base_currency ?? "").toUpperCase() === base.toUpperCase()) {
      amt = m.base_amount; frozen += 1;
    } else {
      amt = toBase(m.amount, m.currency || base); live += 1;
    }

    const apply = (b: Bucket) => {
      b.count += 1;
      if (isBilled(st)) b.billed += amt;
      if (isCollected(st)) {
        b.collected += amt;
        const paid = String(d.paid_at ?? "").slice(0, 10);
        if (paid && (!b.last_paid_at || paid > b.last_paid_at)) b.last_paid_at = paid;
      }
      if (isOutstanding(st)) b.outstanding += amt;
    };

    const name = String(d.client_name ?? "").trim();
    if (name) apply(byClient[name] ??= mk());
    const linked = String(d.linked_record_id ?? "").trim();
    if (linked) apply(byRecord[linked] ??= mk());
  }

  return c.json({
    base,
    clients: byClient,
    records: byRecord,
    // How the figures were valued, so a consumer can disclose a mixed basis instead of implying
    // every number is frozen.
    basis: { frozen, live },
  });
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
  // Surfaced rather than thrown: numbering failing produced a bare "Internal Server Error" with
  // no clue which of the four things involved had broken. An operator-facing message costs nothing
  // and is the difference between a two-minute fix and a bisect.
  let number: string;
  try {
    number = body.number || await nextInvoiceNumber(c.get("workspaceId"));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Could not allocate an invoice number." }, 500);
  }
  const { subtotal, tax_total, total } = calcTotals(body.line_items, body.currency);

  // Freeze the money at issue: what the client is charged, in their currency, and the rate that
  // related it to the workspace's reporting currency THAT DAY. Without this the base value is
  // recomputed on every read at whatever today's rate happens to be, so a June invoice is worth a
  // different number each morning. Additive — `total`/`currency` stay exactly as they were, so
  // every existing reader is untouched. Null when no rate exists: fail-closed, never a guess.
  const issuedOn = new Date().toISOString().slice(0, 10);
  const money = await moneyAt(c.get("workspaceId"), total, body.currency, issuedOn);

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
    ...(money ?? {}),
    issued_on: issuedOn,
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
  const { subtotal, tax_total, total } = calcTotals(lineItems, String(body.currency ?? current.currency ?? "USD"));

  const statusUpdates: Record<string, unknown> = {};
  if (body.status === "sent" && !current.sent_at) statusUpdates.sent_at = new Date().toISOString();
  if (body.status === "paid" && !current.paid_at) statusUpdates.paid_at = new Date().toISOString();

  // Money is only editable while the invoice is a draft (guarded above), so a changed total means
  // the document has not been issued yet — re-freeze it at today's rate, which is its issue date.
  const issuedOn = String(current.issued_on ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const currency = String(body.currency ?? current.currency ?? "");
  const moneyUpdates = editsMoney || !hasMoney(current)
    ? (await moneyAt(c.get("workspaceId"), total, currency, issuedOn)) ?? {}
    : {};

  // Settlement: the rate on the day the money actually arrives is rarely the rate at issue, and the
  // difference is a real gain or loss the business made by waiting. Recording it here is what makes
  // that derivable at all — recomputing later would only ever find TODAY's rate.
  let settlementUpdates: Record<string, unknown> = {};
  if (body.status === "paid" && currentStatus !== "paid") {
    const paidOn = String(statusUpdates.paid_at ?? current.paid_at ?? new Date().toISOString()).slice(0, 10);
    const merged = { ...current, ...moneyUpdates } as Record<string, unknown>;
    if (hasMoney(merged)) {
      const s = await settlementRateAt(c.get("workspaceId"), String(merged.currency_presentment), paidOn);
      if (s) {
        settlementUpdates = buildSettlement(
          {
            amount_presentment: Number(merged.amount_presentment),
            currency_presentment: String(merged.currency_presentment),
            fx_rate: Number(merged.fx_rate),
            amount_base: Number(merged.amount_base),
            currency_base: String(merged.currency_base),
            fx_rate_as_of: (merged.fx_rate_as_of as string | null) ?? null,
            fx_rate_source: String(merged.fx_rate_source ?? "ecb"),
          },
          { rate: s.rate, on: paidOn, as_of: s.as_of },
        ) as unknown as Record<string, unknown>;
      }
    }
  }

  const updatedData = {
    ...current,
    ...body,
    line_items: lineItems,
    subtotal,
    tax_total,
    total,
    ...moneyUpdates,
    ...settlementUpdates,
    issued_on: issuedOn,
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
  // Auto-close must respect the SAME state machine PATCH enforces — this route writes the row
  // directly, so without this check recording a payment on a terminal (cancelled/paid) invoice would
  // resurrect it to "paid", a transition the API otherwise forbids.
  const canAutoClose = (VALID_TRANSITIONS[String(current.status)] ?? []).includes("paid");
  if (invoiceTotal > 0 && totalPaid >= invoiceTotal && current.status !== "paid" && canAutoClose) {
    statusUpdates.status = "paid";
    statusUpdates.paid_at = new Date().toISOString();
  }

  const updatedData = { ...current, payments: updatedPayments, ...statusUpdates };
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
