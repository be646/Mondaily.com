import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { requireAuth } from "../middleware/auth";
import { requireModuleRW } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";
import { inngest } from "../lib/inngest";
import { createNotification } from "../lib/notify";
import { aiGateway, gatewayEnv } from "../lib/ai-gateway";
import { moneyAt } from "../lib/currency-store";

type Variables = { userId: string; workspaceId: string; role: string; financeRole: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);
router.use("*", requireModuleRW("finance")); // per-member Finance & Billing access

// ─── State machine ────────────────────────────────────────────────────────────
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft:          ["pending_review", "void"],
  pending_review: ["verified", "rejected", "void"],
  verified:       ["executed", "rejected", "void"],
  rejected:       ["pending_review", "void"],
  executed:       [],
  void:           [],
};

// Stage 2: pending_review → verified needs reviewer+
const REVIEWER_TRANSITIONS = new Set(["verified"]);
// Stage 3+: needs approver or admin/owner
const APPROVER_TRANSITIONS = new Set(["executed", "void"]);

const creditNoteSchema = z.object({
  amount_cents:  z.number().int().positive(),
  currency:      z.string().default("GBP"),
  credit_reason: z.enum(["refund", "billing_error", "goodwill", "contract_discount"]),
  status:        z.enum(["draft", "pending_review", "verified", "rejected", "executed", "void"]).default("draft"),
  note:          z.string().optional(),
  invoice_id:    z.string().uuid().optional(),
  reviewer_id:   z.string().optional(),
  ai_summary:    z.string().optional(),
  notes:         z.string().optional(),
  client_name:   z.string().optional(),
  linked_record_id: z.string().uuid().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function notifyAdmins(workspaceId: string, title: string, body: string, creditNoteId?: string) {
  const { data: admins } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .in("role", ["admin", "owner"]);

  if (!admins?.length) return;
  await Promise.all(admins.map(a => createNotification({
    workspace_id: workspaceId,
    user_id: a.user_id,
    title,
    body,
    type: "credit_note",
    metadata: { credit_note_id: creditNoteId },
    source: { node_id: creditNoteId, object_type: "credit_note", route: creditNoteId ? `/finance/credit-notes/${creditNoteId}` : undefined },
  })));
}

async function notifyReviewers(workspaceId: string, title: string, body: string, creditNoteId?: string) {
  const { data: reviewers } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .in("finance_role" as never, ["reviewer", "approver"]);
  if (!reviewers?.length) return;
  await Promise.all(reviewers.map((r) => createNotification({
    workspace_id: workspaceId,
    user_id: r.user_id,
    title,
    body,
    type: "credit_note",
    metadata: { credit_note_id: creditNoteId },
    source: { node_id: creditNoteId, object_type: "credit_note", route: creditNoteId ? `/finance/credit-notes/${creditNoteId}` : undefined },
  })));
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

  // A credit note reverses money, so it needs the same frozen valuation as the invoice it offsets —
  // otherwise the credit and the charge are valued at different rates and never cancel out.
  const issuedOn = new Date().toISOString().slice(0, 10);
  const money = await moneyAt(workspaceId, body.amount_cents / 100, body.currency, issuedOn);

  const { data, error } = await supabase
    .from("nodes")
    .insert({
      workspace_id: workspaceId,
      vertical: "finance",
      object_type: "credit_note",
      data: {
        amount_cents:  body.amount_cents,
        currency:      body.currency,
        ...(money ?? {}),
        issued_on:     issuedOn,
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
    await notifyAdmins(workspaceId, "Credit note pending review", `A ${body.credit_reason.replace(/_/g, " ")} credit note for ${(body.amount_cents / 100).toLocaleString("en-GB", { style: "currency", currency: body.currency })} requires your approval.`, data.id);
  }

  // Fire Inngest event so other jobs can react
  inngest.send({
    name: "finance/credit_note.created",
    data: { workspaceId, nodeId: data.id, status: body.status, amount_cents: body.amount_cents },
  }).catch((e) => console.error("[bg-task] swallowed error:", e));

  return c.json({ id: data.id, ...(data.data as object), created_at: data.created_at, created_by: data.created_by }, 201);
});

// ─── PATCH — status machine + field updates ────────────────────────────────────
router.patch("/:id", zValidator("json", creditNoteSchema.partial()), async (c) => {
  const workspaceId = c.get("workspaceId");
  const node = await getCreditNote(workspaceId, c.req.param("id"));
  const current = node.data as Record<string, unknown>;
  const body = c.req.valid("json");
  const wsRole = c.get("role");
  const financeRole = c.get("financeRole") as string;

  let updatedData: Record<string, unknown> = { ...current, ...body };

  // State machine enforcement
  if (body.status && body.status !== current.status) {
    const allowed = VALID_TRANSITIONS[String(current.status)] ?? [];
    if (!allowed.includes(body.status)) {
      return c.json({ error: `Cannot transition from '${current.status}' to '${body.status}'` }, 422);
    }

    const isAdminOrOwner = ["admin", "owner"].includes(wsRole);
    const isApprover = isAdminOrOwner || financeRole === "approver";
    const isReviewer = isApprover || financeRole === "reviewer";

    if (APPROVER_TRANSITIONS.has(body.status) && !isApprover) {
      return c.json({ error: "Only finance approvers or admins can perform this action." }, 403);
    }
    if (REVIEWER_TRANSITIONS.has(body.status) && !isReviewer) {
      return c.json({ error: "Only finance reviewers or above can perform this action." }, 403);
    }

    // Append approval audit entry
    const approvalEntry = {
      user_id: c.get("userId"),
      action: body.status,
      note: (body as Record<string, unknown>).note as string | undefined ?? null,
      at: new Date().toISOString(),
    };
    const existingApprovals = Array.isArray(current.approvals) ? current.approvals as unknown[] : [];
    updatedData = { ...current, ...body, approvals: [...existingApprovals, approvalEntry] };
  }

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

  // Post-transition side effects
  const cnId = c.req.param("id");
  if (body.status === "executed") {
    const amount = (Number(current.amount_cents ?? 0) / 100).toLocaleString("en-GB", { style: "currency", currency: String(current.currency ?? "GBP") });
    await notifyAdmins(workspaceId, "Credit note executed", `A ${String(current.credit_reason ?? "").replace(/_/g, " ")} credit note of ${amount} has been executed.`, cnId);
  }
  if (body.status === "pending_review") {
    await notifyAdmins(workspaceId, "Credit note pending review", `A credit note has been submitted for your approval.`, cnId);
    await notifyReviewers(workspaceId, "Credit note pending review", `A credit note requires reviewer sign-off.`, cnId);
  }
  if (body.status === "verified") {
    await notifyAdmins(workspaceId, "Credit note verified", `A credit note has been verified and is awaiting final execution.`, cnId);
  }
  if (body.status === "rejected") {
    // Notify the creator
    const creatorId = node.created_by;
    if (creatorId) {
      await createNotification({
        workspace_id: workspaceId,
        user_id: creatorId,
        title: "Credit note rejected",
        body: `Your credit note has been rejected.`,
        type: "credit_note",
        metadata: { credit_note_id: cnId },
        source: { node_id: cnId, object_type: "credit_note", route: `/finance/credit-notes/${cnId}` },
      });
    }
  }

  return c.json({ id: data.id, ...(data.data as object), updated_at: data.updated_at });
});

// ─── Apply to invoice (creates APPLIED_TO edge) ───────────────────────────────
router.post("/:id/apply-to-invoice", zValidator("json", z.object({ invoice_id: z.string().uuid() })), async (c) => {
  const workspaceId = c.get("workspaceId");
  const note = await getCreditNote(workspaceId, c.req.param("id"));
  // A voided credit note can't be applied to anything.
  if (String((note.data as Record<string, unknown>).status) === "void") return c.json({ error: "This credit note is void." }, 422);

  const { invoice_id } = c.req.valid("json");
  // The target invoice must exist IN THIS WORKSPACE — never link to an arbitrary/cross-tenant id.
  const { data: invoice } = await supabase.from("nodes")
    .select("id").eq("workspace_id", workspaceId).eq("id", invoice_id).eq("object_type", "invoice").maybeSingle();
  if (!invoice) return c.json({ error: "Invoice not found in this workspace." }, 404);
  const { error } = await supabase.from("edges").upsert({
    workspace_id: workspaceId,
    from_node_id: c.req.param("id"),
    to_node_id: invoice_id,
    relationship: "APPLIED_TO",
  });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// ─── AI: generate an on-demand summary from the note's REAL fields ────────────
// Grounded strictly in the stored credit note — never invents figures. Persists to
// data.ai_summary so the list "AI SUMMARY" column and the detail page both reflect it.
router.post("/:id/summarize", async (c) => {
  const workspaceId = c.get("workspaceId");
  const node = await getCreditNote(workspaceId, c.req.param("id"));
  const env = gatewayEnv();
  if (!env.baseURL || !env.apiKey) return c.json({ error: "AI isn't available right now." }, 503);

  const d = node.data as Record<string, unknown>;
  const amount = ((Number(d.amount_cents ?? 0)) / 100).toLocaleString("en-GB", { style: "currency", currency: String(d.currency ?? "GBP"), minimumFractionDigits: 2 });
  const facts = [
    `Amount: ${amount}`,
    `Reason: ${String(d.credit_reason ?? "unspecified").replace(/_/g, " ")}`,
    `Status: ${String(d.status ?? "draft").replace(/_/g, " ")}`,
    d.client_name ? `Client: ${d.client_name}` : null,
    d.notes ? `Internal notes: ${String(d.notes).slice(0, 500)}` : null,
  ].filter(Boolean).join("\n");
  const system = "You summarize a finance credit note for an operator in ONE or TWO sentences. Use ONLY the facts provided — never invent amounts, clients, or reasons. Be plain and specific: what the credit is for, its size, and where it stands. No preamble.";
  const prompt = `Credit note facts:\n${facts}`;

  try {
    const res = await aiGateway({ system, prompt, maxTokens: 160, workspaceId, userId: c.get("userId"), feature: "credit_note_summary" });
    const summary = (res.text ?? "").trim();
    if (!summary || res.provider === "none") return c.json({ error: "Couldn't generate a summary (check your AI credits)." }, 200);
    const nextData = { ...(node.data as object), ai_summary: summary };
    const { error } = await supabase.from("nodes").update({ data: nextData, updated_at: new Date().toISOString() }).eq("id", c.req.param("id")).eq("workspace_id", workspaceId);
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ ai_summary: summary });
  } catch { return c.json({ error: "Couldn't generate a summary — please try again." }, 200); }
});

// ─── Assign reviewer (creates ASSIGNED_REVIEWER edge) ─────────────────────────
router.post("/:id/assign-reviewer", zValidator("json", z.object({ user_id: z.string() })), async (c) => {
  const workspaceId = c.get("workspaceId");
  await getCreditNote(workspaceId, c.req.param("id"));

  const { user_id } = c.req.valid("json");
  // The reviewer must be a member of this workspace — never assign to an arbitrary user id.
  const { data: member } = await supabase.from("workspace_members")
    .select("user_id").eq("workspace_id", workspaceId).eq("user_id", user_id).maybeSingle();
  if (!member) return c.json({ error: "Reviewer is not a member of this workspace." }, 403);
  await supabase.from("edges").delete().eq("workspace_id", workspaceId).eq("from_node_id", c.req.param("id")).eq("relationship", "ASSIGNED_REVIEWER");
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
  // getCreditNote above already scopes to the workspace; the extra filters keep this safe
  // even if that guard is ever refactored away.
  await supabase.from("nodes").delete()
    .eq("id", c.req.param("id"))
    .eq("workspace_id", workspaceId)
    .eq("object_type", "credit_note");
  return c.json({ ok: true });
});

export { router as creditNotesRouter };
