import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import { inngest } from "../lib/inngest";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

// ─── State machine ────────────────────────────────────────────────────────────
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft:            ["pending_review", "void"],
  pending_review:   ["manager_approved", "void"],
  manager_approved: ["executed", "void"],
  executed:         [],
  void:             [],
};

const ADMIN_ONLY_TRANSITIONS = new Set(["manager_approved", "executed", "void"]);

const creditNoteSchema = z.object({
  amount_cents:  z.number().int().positive(),
  currency:      z.string().default("GBP"),
  credit_reason: z.enum(["refund", "billing_error", "goodwill", "contract_discount"]),
  status:        z.enum(["draft", "pending_review", "manager_approved", "executed", "void"]).default("draft"),
  invoice_id:    z.string().uuid().optional(),
  reviewer_id:   z.string().optional(),
  ai_summary:    z.string().optional(),
  notes:         z.string().optional(),
  client_name:   z.string().optional(),
  linked_record_id: z.string().uuid().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function notifyAdmins(workspaceId: string, title: string, body: string) {
  const { data: admins } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .in("role", ["admin", "owner"]);

  if (!admins?.length) return;
  await supabase.from("notifications").insert(
    admins.map(a => ({
      workspace_id: workspaceId,
      user_id: a.user_id,
      title,
      body,
      type: "credit_note",
      is_read: false,
    }))
  );
}

async function getCreditNote(workspaceId: string, id: string) {
  const { data, error } = await supabase
    .from("nodes")
    .select("id,data,created_at,updated_at,created_by")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .eq("object_type", "credit_note")
    .maybeSingle();
  if (error) throw new HTTPException(500, { message: error.message });
  if (!data) throw new HTTPException(404, { message: "Credit note not found" });
  return data;
}

// ─── LIST ─────────────────────────────────────────────────────────────────────
router.get("/", async (c) => {
  const status = c.req.query("status");
  const search = c.req.query("search") ?? "";
  const linkedRecordId = c.req.query("linked_record_id");
  const appliedToInvoice = c.req.query("applied_to_invoice");

  let q = supabase
    .from("nodes")
    .select("id,data,created_at,updated_at,created_by")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("object_type", "credit_note")
    .order("created_at", { ascending: false });

  if (status) q = q.eq("data->>status", status);
  if (linkedRecordId) q = q.eq("data->>linked_record_id", linkedRecordId);

  // applied_to_invoice: look up via edges
  if (appliedToInvoice) {
    const { data: edges } = await supabase
      .from("edges")
      .select("from_node_id")
      .eq("workspace_id", c.get("workspaceId"))
      .eq("to_node_id", appliedToInvoice)
      .eq("relationship", "APPLIED_TO");
    const ids = (edges ?? []).map(e => e.from_node_id);
    if (ids.length === 0) return c.json([]);
    q = q.in("id", ids);
  }

  const { data, error } = await q;
  if (error) return c.json({ error: error.message }, 500);

  const result = (data ?? [])
    .filter(row => {
      if (!search) return true;
      const d = row.data as Record<string, unknown>;
      return String(d.client_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
             String(d.credit_reason ?? "").toLowerCase().includes(search.toLowerCase());
    })
    .map(row => ({ id: row.id, ...(row.data as object), created_at: row.created_at, updated_at: row.updated_at, created_by: row.created_by }));

  // Fetch linked invoice IDs via edges in one shot
  if (result.length) {
    const ids = result.map(r => r.id);
    const { data: edges } = await supabase
      .from("edges")
      .select("from_node_id,to_node_id,relationship")
      .in("from_node_id", ids)
      .in("relationship", ["APPLIED_TO", "ASSIGNED_REVIEWER"]);

    const edgeMap: Record<string, Record<string, string>> = {};
    for (const e of edges ?? []) {
      edgeMap[e.from_node_id] ??= {};
      edgeMap[e.from_node_id]![e.relationship] = e.to_node_id;
    }
    return c.json(result.map(r => ({ ...r, edges: edgeMap[r.id] ?? {} })));
  }

  return c.json(result);
});

// ─── GET single ───────────────────────────────────────────────────────────────
router.get("/:id", async (c) => {
  const node = await getCreditNote(c.get("workspaceId"), c.req.param("id"));

  const { data: edges } = await supabase
    .from("edges")
    .select("to_node_id,relationship")
    .eq("from_node_id", node.id)
    .in("relationship", ["APPLIED_TO", "ASSIGNED_REVIEWER"]);

  const edgeMap: Record<string, string> = {};
  for (const e of edges ?? []) edgeMap[e.relationship] = e.to_node_id;

  return c.json({ id: node.id, ...(node.data as object), created_at: node.created_at, updated_at: node.updated_at, created_by: node.created_by, edges: edgeMap });
});

// ─── CREATE ───────────────────────────────────────────────────────────────────
router.post("/", zValidator("json", creditNoteSchema), async (c) => {
  const body = c.req.valid("json");
  const workspaceId = c.get("workspaceId");

  const { data, error } = await supabase
    .from("nodes")
    .insert({
      workspace_id: workspaceId,
      vertical: "finance",
      object_type: "credit_note",
      data: {
        amount_cents:  body.amount_cents,
        currency:      body.currency,
        credit_reason: body.credit_reason,
        status:        body.status,
        notes:         body.notes ?? null,
        ai_summary:    body.ai_summary ?? null,
        client_name:   body.client_name ?? null,
        created_at:    new Date().toISOString(),
        ...(body.linked_record_id ? { linked_record_id: body.linked_record_id } : {}),
      },
      created_by: c.get("userId"),
    })
    .select("id,data,created_at,created_by")
    .single();

  if (error) return c.json({ error: error.message }, 500);

  // Wire up graph edges immediately if provided
  if (body.invoice_id) {
    await supabase.from("edges").upsert({ workspace_id: workspaceId, from_node_id: data.id, to_node_id: body.invoice_id, relationship: "APPLIED_TO" });
  }
  if (body.reviewer_id) {
    await supabase.from("edges").upsert({ workspace_id: workspaceId, from_node_id: data.id, to_node_id: body.reviewer_id, relationship: "ASSIGNED_REVIEWER" });
  }

  // Notify admins when created in pending_review (AI path or manual escalation)
  if (body.status === "pending_review") {
    await notifyAdmins(workspaceId, "Credit note pending review", `A ${body.credit_reason.replace(/_/g, " ")} credit note for ${(body.amount_cents / 100).toLocaleString("en-GB", { style: "currency", currency: body.currency })} requires your approval.`);
  }

  // Fire Inngest event so other jobs can react
  inngest.send({
    name: "finance/credit_note.created",
    data: { workspaceId, nodeId: data.id, status: body.status, amount_cents: body.amount_cents },
  }).catch(() => {});

  return c.json({ id: data.id, ...(data.data as object), created_at: data.created_at, created_by: data.created_by }, 201);
});

// ─── PATCH — status machine + field updates ────────────────────────────────────
router.patch("/:id", zValidator("json", creditNoteSchema.partial()), async (c) => {
  const workspaceId = c.get("workspaceId");
  const node = await getCreditNote(workspaceId, c.req.param("id"));
  const current = node.data as Record<string, unknown>;
  const body = c.req.valid("json");
  const role = c.get("role");

  // State machine enforcement
  if (body.status && body.status !== current.status) {
    const allowed = VALID_TRANSITIONS[String(current.status)] ?? [];
    if (!allowed.includes(body.status)) {
      return c.json({ error: `Cannot transition from '${current.status}' to '${body.status}'` }, 422);
    }
    if (ADMIN_ONLY_TRANSITIONS.has(body.status) && !["admin", "owner"].includes(role)) {
      throw new HTTPException(403, { message: "Only admins or owners can perform this transition." });
    }
  }

  const updatedData = { ...current, ...body };
  const { data, error } = await supabase
    .from("nodes")
    .update({ data: updatedData, updated_at: new Date().toISOString() })
    .eq("id", c.req.param("id"))
    .select("id,data,updated_at")
    .single();

  if (error) return c.json({ error: error.message }, 500);

  // Post-transition side effects
  if (body.status === "executed") {
    const amount = (Number(current.amount_cents ?? 0) / 100).toLocaleString("en-GB", { style: "currency", currency: String(current.currency ?? "GBP") });
    await notifyAdmins(workspaceId, "Credit note executed", `A ${String(current.credit_reason ?? "").replace(/_/g, " ")} credit note of ${amount} has been executed.`);
  }
  if (body.status === "pending_review") {
    await notifyAdmins(workspaceId, "Credit note pending review", `A credit note has been submitted for your approval.`);
  }

  return c.json({ id: data.id, ...(data.data as object), updated_at: data.updated_at });
});

// ─── Apply to invoice (creates APPLIED_TO edge) ───────────────────────────────
router.post("/:id/apply-to-invoice", zValidator("json", z.object({ invoice_id: z.string().uuid() })), async (c) => {
  const workspaceId = c.get("workspaceId");
  await getCreditNote(workspaceId, c.req.param("id"));

  const { invoice_id } = c.req.valid("json");
  const { error } = await supabase.from("edges").upsert({
    workspace_id: workspaceId,
    from_node_id: c.req.param("id"),
    to_node_id: invoice_id,
    relationship: "APPLIED_TO",
  });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// ─── Assign reviewer (creates ASSIGNED_REVIEWER edge) ─────────────────────────
router.post("/:id/assign-reviewer", zValidator("json", z.object({ user_id: z.string() })), async (c) => {
  const workspaceId = c.get("workspaceId");
  await getCreditNote(workspaceId, c.req.param("id"));

  const { user_id } = c.req.valid("json");
  await supabase.from("edges").delete().eq("from_node_id", c.req.param("id")).eq("relationship", "ASSIGNED_REVIEWER");
  const { error } = await supabase.from("edges").insert({
    workspace_id: workspaceId,
    from_node_id: c.req.param("id"),
    to_node_id: user_id,
    relationship: "ASSIGNED_REVIEWER",
  });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// ─── DELETE (hard delete, only void/draft) ────────────────────────────────────
router.delete("/:id", async (c) => {
  const workspaceId = c.get("workspaceId");
  const node = await getCreditNote(workspaceId, c.req.param("id"));
  const status = String((node.data as Record<string, unknown>).status ?? "");
  if (!["draft", "void"].includes(status)) {
    return c.json({ error: "Only draft or void credit notes can be deleted." }, 422);
  }
  await supabase.from("nodes").delete().eq("id", c.req.param("id"));
  return c.json({ ok: true });
});

export { router as creditNotesRouter };
