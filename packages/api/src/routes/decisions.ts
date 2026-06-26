import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import * as ubc from "@mondaily/db/ubc";
import { inngest } from "../lib/inngest";
import { objectTypeToVertical, type ProspectCandidate } from "./prospecting";
import { logDecisionTrainingExample, type TrainingAction } from "../lib/training-ledger";
import { sendWorkspaceEmail } from "../lib/mail";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

/**
 * Decision Queue — the real backing store for "agents recommend, humans
 * approve." Every row here is created by a real signal (overdue task,
 * stale relationship, overdue invoice, credit note dispute, or an Ask
 * Mondaily recommendation) — never fabricated. `confidence` is nullable
 * and only set when a caller actually computed one; the frontend must
 * show "source-backed" rather than a number when it's null.
 */

const evidenceItem = z.object({
  type: z.string(),
  title: z.string(),
  node_id: z.string().optional(),
  object_type: z.string().optional(),
  relationship: z.string().optional(),
  match_reason: z.string().optional(),
  timestamp: z.string().optional(),
});

const createSchema = z.object({
  source_type: z.string(),
  source_id: z.string().optional(),
  agent_name: z.string(),
  title: z.string().min(1),
  summary: z.string().optional(),
  recommended_action: z.string().optional(),
  risk_level: z.enum(["low", "medium", "high"]).default("low"),
  confidence: z.number().min(0).max(100).optional(),
  evidence: z.array(evidenceItem).default([]),
});

router.get("/", async (c) => {
  const workspaceId = c.get("workspaceId");
  const status = c.req.query("status");
  let query = supabase
    .from("decision_queue")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

router.get("/:id", async (c) => {
  const { data, error } = await supabase
    .from("decision_queue")
    .select("*")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"))
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "Decision not found" }, 404);
  return c.json(data);
});

router.post("/", zValidator("json", createSchema), async (c) => {
  const body = c.req.valid("json");
  const { data, error } = await supabase
    .from("decision_queue")
    .insert({ ...body, workspace_id: c.get("workspaceId") })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data, 201);
});

router.patch("/:id", zValidator("json", createSchema.partial()), async (c) => {
  const body = c.req.valid("json");
  const { data, error } = await supabase
    .from("decision_queue")
    .update(body)
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"))
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  // Training ledger — a human manually edited the agent's recommendation; record
  // the edit (best-effort, never blocks). `body` holds the human's modifications.
  await logDecisionTrainingExample(c.get("workspaceId"), data, "EDITED", body);
  return c.json(data);
});

async function resolve(c: any, status: "approved" | "rejected" | "snoozed" | "completed", extra: Record<string, unknown> = {}, trainingAction?: TrainingAction) {
  const { data, error } = await supabase
    .from("decision_queue")
    .update({
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: c.get("userId"),
      ...extra,
    })
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"))
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  // Training ledger — capture the human's verdict on this agent recommendation.
  // Self-contained + error-swallowing, so it can never block the user's action.
  if (trainingAction) await logDecisionTrainingExample(c.get("workspaceId"), data, trainingAction);
  await supabase.from("activities").insert({
    node_id: data.source_id ?? null,
    workspace_id: c.get("workspaceId"),
    actor_type: "human",
    actor_id: c.get("userId"),
    action: `decision_${status}`,
    diff: { decision_id: data.id, title: data.title },
  }).then(() => {}, () => {}); // best-effort — don't fail the request if activity logging fails
  return c.json(data);
}

/**
 * Real action execution on approval — only wired for decision kinds that
 * actually have an automatable action behind them. Everything else (e.g.
 * "reach out to a stale relationship") is advisory; approving it just
 * records the human decision, since there's nothing to execute.
 */
// Outbound agent email (invoice chaser, workflow, …) goes through the shared
// sender: the workspace's connected Gmail inbox first, Resend as fallback.

/** Find a usable recipient email on a record (or its common contact fields). */
function emailFromRecord(data: Record<string, any> | null | undefined): { email: string; name?: string } | undefined {
  if (!data) return undefined;
  const email = data.email ?? data.client_email ?? data.contact_email ?? data.Email ?? data.to_email;
  if (typeof email === "string" && /.+@.+\..+/.test(email)) {
    return { email, name: data.name ?? data.client_name ?? data.contact_name ?? undefined };
  }
  return undefined;
}

/** When we can't safely auto-send (no Nylas grant, or no clear recipient), drop
 *  the drafted email into a task so a human can send it — never silently lose it. */
async function emailFallbackTask(workspaceId: string, createdBy: string, title: string, subject: string, body: string): Promise<void> {
  await supabase.from("nodes").insert({
    workspace_id: workspaceId, vertical: "shared", object_type: "task", created_by: createdBy,
    data: { title, notes: `Approved — send manually:\n\nSubject: ${subject}\n\n${body}`, status: "todo", priority: "medium" },
  });
}

export async function executeApprovedAction(workspaceId: string, decision: any): Promise<void> {
  if (decision.agent_name === "prospecting" && decision.source_type === "prospecting_candidate") {
    const evidenceItem = (decision.evidence ?? [])[0] as { candidate?: ProspectCandidate; destination_list_id?: string | null } | undefined;
    const candidate = evidenceItem?.candidate;
    if (!candidate) return;

    const node = await ubc.createNode({
      workspace_id: workspaceId,
      vertical: objectTypeToVertical(candidate.object_type),
      object_type: candidate.object_type,
      created_by: "agent:prospecting",
      data: {
        name: candidate.name,
        email: candidate.email ?? undefined,
        domain: candidate.domain ?? undefined,
        website: candidate.website ?? undefined,
        linkedin: candidate.linkedin ?? undefined,
        description: candidate.description ?? undefined,
        location: candidate.location ?? undefined,
        source_url: candidate.source_url,
        source_title: candidate.source_title,
        confidence_label: candidate.confidence_label,
      },
    });
    await ubc.logActivity(node.id!, workspaceId, "ai_agent", "prospecting", "created", undefined, `Approved from Decision Queue: ${candidate.reason}`);
    inngest.send({
      name: "crm/record.created",
      data: { workspaceId, nodeId: node.id!, objectType: candidate.object_type, vertical: objectTypeToVertical(candidate.object_type) },
    }).catch(() => {});

    if (evidenceItem?.destination_list_id) {
      const { count } = await supabase.from("list_entries").select("*", { count: "exact", head: true }).eq("list_id", evidenceItem.destination_list_id);
      await supabase.from("list_entries").upsert({ list_id: evidenceItem.destination_list_id, node_id: node.id, position: (count ?? 0) + 1 });
    }
    return;
  }

  if (decision.agent_name === "invoice_chaser" && decision.source_type === "invoice") {
    const { data: invoice } = await supabase
      .from("nodes")
      .select("id, data")
      .eq("id", decision.source_id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!invoice) return;
    const invoiceData = invoice.data as Record<string, any>;
    const clientEmail = invoiceData.client_email as string | undefined;
    const subject = String(decision.recommended_action ?? "").replace(/^Send: "(.+)"$/, "$1") || `Invoice ${invoiceData.invoice_number ?? invoice.id} reminder`;
    const body = decision.summary ?? "";
    const chaseCount = (invoiceData.chase_count ?? 0) + 1;

    if (clientEmail) {
      const sent = await sendWorkspaceEmail(workspaceId, { subject, body, to: [{ email: clientEmail, name: invoiceData.client_name ?? clientEmail }] });
      if (!sent) {
        await emailFallbackTask(workspaceId, "agent:invoice_chaser", `Chase invoice ${invoiceData.invoice_number ?? invoice.id}`, subject, body);
      }
    }

    await supabase.from("nodes").update({
      data: { ...invoiceData, status: "overdue", last_chased_at: new Date().toISOString(), chase_count: chaseCount },
    }).eq("id", invoice.id);
    return;
  }

  // Workflow Agent — an approved email action (e.g. a Deal-Won congratulations
  // email) flows out of the user's connected inbox via Nylas. We only auto-send
  // when there's a clear recipient on the linked record AND a connected inbox;
  // otherwise the draft becomes a task so it's never sent to the wrong person
  // or silently dropped.
  if (decision.agent_name === "workflow") {
    const subject = String(decision.title ?? "Workflow email").replace(/^Workflow:\s*/i, "") || "Workflow email";
    const body = String(decision.summary ?? decision.recommended_action ?? "");
    let recipient: { email: string; name?: string } | undefined;
    if (decision.source_id) {
      const { data: rec } = await supabase
        .from("nodes").select("data").eq("id", decision.source_id).eq("workspace_id", workspaceId).maybeSingle();
      recipient = emailFromRecord(rec?.data as Record<string, any> | undefined);
    }
    if (recipient) {
      const sent = await sendWorkspaceEmail(workspaceId, { subject, body, to: [recipient] });
      if (!sent) await emailFallbackTask(workspaceId, "agent:workflow", `Send: ${subject}`, subject, body);
    } else {
      // No clear recipient — hand it to a human rather than guess.
      await emailFallbackTask(workspaceId, "agent:workflow", `Send: ${subject}`, subject, body);
    }
    return;
  }
}

router.post("/:id/approve", async (c) => {
  const { data: decision } = await supabase
    .from("decision_queue")
    .select("*")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"))
    .maybeSingle();
  if (decision) await executeApprovedAction(c.get("workspaceId"), decision).catch(() => {});
  return resolve(c, "approved", {}, "APPROVED");
});
router.post("/:id/reject", async (c) => resolve(c, "rejected", {}, "REJECTED"));
router.post("/:id/snooze", zValidator("json", z.object({ until: z.string().optional() }).optional()), async (c) => {
  const body = c.req.valid("json") ?? {};
  const until = body.until ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return resolve(c, "snoozed", { snoozed_until: until });
});

export { router as decisionsRouter };
