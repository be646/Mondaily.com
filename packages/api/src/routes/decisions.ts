import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

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
  return c.json(data);
});

async function resolve(c: any, status: "approved" | "rejected" | "snoozed" | "completed", extra: Record<string, unknown> = {}) {
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
async function executeApprovedAction(workspaceId: string, decision: any): Promise<void> {
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
      const { data: emailConn } = await supabase
        .from("email_connections")
        .select("grant_id")
        .eq("workspace_id", workspaceId)
        .limit(1)
        .single();
      if (emailConn?.grant_id) {
        await fetch(`https://api.us.nylas.com/v3/grants/${emailConn.grant_id}/messages/send`, {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.NYLAS_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ subject, body, to: [{ email: clientEmail, name: invoiceData.client_name ?? clientEmail }] }),
        }).catch(() => {});
      } else {
        await supabase.from("nodes").insert({
          workspace_id: workspaceId,
          vertical: "finance",
          object_type: "task",
          created_by: "agent:invoice_chaser",
          data: {
            title: `Chase invoice ${invoiceData.invoice_number ?? invoice.id}`,
            notes: `Approved reminder — send manually:\n\nSubject: ${subject}\n\n${body}`,
            status: "todo",
            priority: "medium",
          },
        });
      }
    }

    await supabase.from("nodes").update({
      data: { ...invoiceData, status: "overdue", last_chased_at: new Date().toISOString(), chase_count: chaseCount },
    }).eq("id", invoice.id);
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
  return resolve(c, "approved");
});
router.post("/:id/reject", async (c) => resolve(c, "rejected"));
router.post("/:id/snooze", zValidator("json", z.object({ until: z.string().optional() }).optional()), async (c) => {
  const body = c.req.valid("json") ?? {};
  const until = body.until ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return resolve(c, "snoozed", { snoozed_until: until });
});

export { router as decisionsRouter };
