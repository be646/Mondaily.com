import { supabase } from "@mondaily/db/client";
import { startJob, completeJob, failJob, step } from "../lib/agent-logger";
import { aiGateway, aiGatewayToolUse } from "../lib/ai-gateway";
import { createNotification } from "../lib/notify";
import { maybeAutoApprove } from "../lib/autonomy";

/**
 * Workflow Agent execution engine.
 *
 * Turns saved workflow definitions (automation nodes, data.type='workflow')
 * into real trigger -> condition -> action execution. Policy:
 *   - SAFE actions (create task/note, update field, add tag, notify) run
 *     automatically.
 *   - RISKY actions (send email/message, invoice, delete) are NEVER executed
 *     directly — they go to the Decision Queue for human approval, consistent
 *     with every other Mondaily agent.
 *
 * Workflow builder blocks carry their intent mostly in `label` (config is
 * often empty), so conditions are evaluated and action parameters drafted by
 * the AI gateway (Cerebras) against the real record — making existing
 * label-only workflows executable without forcing a rebuild.
 *
 * Idempotency: every (workflow, record, trigger_key) fires at most once,
 * enforced by the workflow_runs unique index (migration 0018).
 */

const SAFE_ACTIONS = new Set(["create_task", "create_note", "update_field", "set_field", "add_tag", "notify", "add_note", "draft_quote", "create_quote", "create_record"]);
const RISKY_ACTIONS = new Set(["send_email", "send_message", "send_sms", "create_invoice", "charge", "charge_invoice", "delete_record", "archive_record", "send"]);

interface WorkflowBlock { id: string; kind: string; type: string; label?: string; config?: Record<string, unknown>; }
interface ParsedWorkflow { triggers: WorkflowBlock[]; conditions: WorkflowBlock[]; actions: WorkflowBlock[]; }

function parseWorkflow(blocks: WorkflowBlock[]): ParsedWorkflow {
  return {
    // Multi-trigger (OR logic): a workflow fires if ANY of its triggers matches.
    triggers: blocks.filter((b) => b.kind === "trigger"),
    conditions: blocks.filter((b) => b.kind === "condition"),
    actions: blocks.filter((b) => b.kind === "action"),
  };
}

/** Which records this trigger should evaluate against, scoped to the workspace. */
async function candidateRecords(workspaceId: string, trigger: WorkflowBlock, recordId?: string): Promise<{ id: string; object_type: string; data: Record<string, unknown>; updated_at: string }[]> {
  const t = `${trigger.type} ${trigger.label ?? ""}`.toLowerCase();
  // Also pull the node-level AI scores (lead_score / relationship_health) — they
  // live as columns, not inside data, so a workflow condition like
  // "lead_score gt 70" (the landing's "Score deal intent → High intent" branch)
  // can only work if we merge them into the evaluated data below.
  const base = supabase.from("nodes").select("id, object_type, data, updated_at, lead_score, relationship_health").eq("workspace_id", workspaceId);

  let q = base;
  if (t.includes("deal")) q = base.ilike("object_type", "%deal%");
  else if (t.includes("invoice")) q = base.eq("object_type", "invoice");
  else if (t.includes("contact") || t.includes("person") || t.includes("lead") || t.includes("compan")) {
    q = base.or("object_type.ilike.%contact%,object_type.ilike.%people%,object_type.ilike.%lead%,object_type.ilike.%compan%");
  } else if (t.includes("task")) q = base.ilike("object_type", "%task%");
  // Event-driven path: evaluate ONLY the record that just fired the trigger.
  if (recordId) q = q.eq("id", recordId);
  // record_created / record_updated / generic → most-recent records
  const { data } = await q.order("updated_at", { ascending: false }).limit(recordId ? 1 : 200);
  return (data ?? []).map((row) => {
    const r = row as { id: string; object_type: string; data: Record<string, unknown>; updated_at: string; lead_score?: number | null; relationship_health?: number | null };
    return {
      id: r.id, object_type: r.object_type, updated_at: r.updated_at,
      data: {
        ...r.data,
        ...(r.lead_score != null ? { lead_score: r.lead_score } : {}),
        ...(r.relationship_health != null ? { relationship_health: r.relationship_health } : {}),
      },
    };
  });
}

/** Stable per-record trigger key so a record fires a workflow once per relevant state. */
function triggerKeyFor(trigger: WorkflowBlock, record: { data: Record<string, unknown> }): string {
  const t = `${trigger.type}`.toLowerCase();
  if (t.includes("stage") || t.includes("deal")) {
    const stage = String(record.data.stage ?? record.data.status ?? record.data.deal_stage ?? "");
    return `stage:${stage}`;
  }
  return trigger.type || "fired";
}

/** AI condition evaluation — do ALL conditions hold for this record? */
async function evaluateConditions(workspaceId: string, conditions: WorkflowBlock[], record: { object_type: string; data: Record<string, unknown> }): Promise<boolean> {
  if (conditions.length === 0) return true;
  // Structured fast-path: if any condition has explicit field/operator/value config.
  const structured = conditions.every((c) => c.config && c.config.field && "value" in (c.config ?? {}));
  if (structured) {
    return conditions.every((c) => {
      const cfg = c.config!;
      const actual = String((record.data as Record<string, unknown>)[String(cfg.field)] ?? "").toLowerCase();
      const expected = String(cfg.value ?? "").toLowerCase();
      // Operator comes from explicit config, else inferred from the block type
      // (field_gt/field_lt/field_contains) the builder emits.
      const typeOp = c.type === "field_gt" ? "gt" : c.type === "field_lt" ? "lt" : c.type === "field_contains" ? "contains" : "equals";
      const op = String(cfg.operator ?? typeOp);
      if (op === "equals") return actual === expected;
      if (op === "not_equals") return actual !== expected;
      if (op === "contains") return actual.includes(expected);
      if (op === "gt") return Number(actual) > Number(expected);
      if (op === "lt") return Number(actual) < Number(expected);
      return actual === expected;
    });
  }
  const recordText = JSON.stringify(record.data).toLowerCase();

  // Deterministic path for "equals/is" conditions: extract the target value
  // from the label and decide purely on whether it's present in the record —
  // NO AI call. Covers the common case ("status equals Won") instantly, both
  // for matches and non-matches, so the engine never makes 25 AI calls a run.
  const extracted = conditions.map((c) => {
    const label = (c.label ?? c.type ?? "").toLowerCase();
    const m = label.match(/(?:equals?|is|=|matches|contains)\s+["']?([a-z0-9 _-]{2,})["']?\s*$/i);
    return m?.[1]?.trim() ?? null;
  });
  if (extracted.every((v) => v !== null)) {
    return extracted.every((v) => recordText.includes(v!));
  }

  // AI fallback for conditions we can't parse structurally — plain text YES/NO
  // (reliable on reasoning models, unlike forced tool-use which gpt-oss leaves empty).
  const { text } = await aiGateway({
    system: "You evaluate workflow conditions. Answer with exactly one word: YES or NO.",
    prompt: `Record (${record.object_type}):\n${JSON.stringify(record.data).slice(0, 1500)}\n\nConditions (ALL must hold):\n${conditions.map((c, i) => `${i + 1}. ${c.label ?? c.type}`).join("\n")}\n\nDo ALL conditions hold for this record? Answer YES or NO.`,
    maxTokens: 1500,
    workspaceId, feature: "workflow_condition",
  }).catch(() => ({ text: "" }));
  return /\byes\b/i.test(text) && !/\bno\b/i.test(text.replace(/yes/gi, ""));
}

interface ActionOutcome { action: string; mode: "executed" | "queued"; detail: string }

async function runAction(workspaceId: string, action: WorkflowBlock, record: { id: string; object_type: string; data: Record<string, unknown> }): Promise<ActionOutcome> {
  const type = action.type.toLowerCase();
  const recName = String(record.data.name ?? record.data.title ?? record.data.full_name ?? record.id);

  // RISKY → always queue for approval, with AI-drafted content.
  if (RISKY_ACTIONS.has(type) || (!SAFE_ACTIONS.has(type))) {
    // Dedup: don't queue a second pending decision for the same record + workflow agent — re-runs
    // (retries, re-evaluations) must not pile up duplicates while one is still awaiting review.
    const { data: pendingDupe } = await supabase.from("decision_queue").select("id")
      .eq("workspace_id", workspaceId).eq("source_id", record.id).eq("agent_name", "workflow")
      .eq("status", "pending").maybeSingle();
    if (pendingDupe) return { action: action.type, mode: "queued", detail: "already awaiting approval" };
    const draft = await aiGatewayToolUse({
      prompt: `Workflow action: "${action.label ?? action.type}" for ${record.object_type} "${recName}".\nRecord:\n${JSON.stringify(record.data).slice(0, 1200)}\n\nDraft the content this action would produce (e.g. the email subject+body, or a one-line description).`,
      toolName: "draft_action",
      toolDescription: "Draft the content for a sensitive workflow action awaiting approval",
      toolSchema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title"] },
      maxTokens: 800,
    }).catch(() => ({ title: action.label ?? action.type }));
    const d = draft as { title?: string; body?: string };
    const { data: wfDecision } = await supabase.from("decision_queue").insert({
      workspace_id: workspaceId, source_type: "node", source_id: record.id, agent_name: "workflow",
      title: `Workflow: ${d.title ?? action.label ?? action.type}`,
      summary: (d.body ?? "").slice(0, 1000) || `Action "${action.label ?? action.type}" ready for ${recName}.`,
      recommended_action: action.label ?? action.type,
      risk_level: type.includes("delete") || type.includes("charge") || type.includes("invoice") ? "high" : "medium",
      evidence: [{ type: "record", title: recName, node_id: record.id, match_reason: `Workflow action: ${action.label ?? action.type}` }],
    }).select("*").single().then((r) => r, () => ({ data: null }));
    if (wfDecision) await maybeAutoApprove(workspaceId, wfDecision);
    return { action: action.type, mode: "queued", detail: d.title ?? action.label ?? action.type };
  }

  // SAFE → execute directly.
  if (type === "create_task") {
    const p = await aiGatewayToolUse({
      prompt: `Create a task for this workflow action: "${action.label}". Record: ${recName} (${record.object_type}).`,
      toolName: "task_fields", toolDescription: "Extract task fields",
      toolSchema: { type: "object", properties: { title: { type: "string" }, priority: { type: "string", enum: ["low", "medium", "high", "urgent"] } }, required: ["title"] },
      maxTokens: 300,
    }).catch(() => ({ title: action.label ?? "Workflow task" }));
    const pf = p as { title?: string; priority?: string };
    await supabase.from("tasks").insert({
      workspace_id: workspaceId, title: pf.title ?? action.label ?? "Workflow task",
      completed: false, priority: pf.priority ?? "medium", status: "todo",
      notes: `Created by workflow for ${recName}`,
    });
    return { action: action.type, mode: "executed", detail: pf.title ?? "task" };
  }
  if (type === "create_note" || type === "add_note") {
    const p = await aiGatewayToolUse({
      prompt: `Write a short note for this workflow action: "${action.label}". Record: ${recName}.\n${JSON.stringify(record.data).slice(0, 800)}`,
      toolName: "note_fields", toolDescription: "Draft a note",
      toolSchema: { type: "object", properties: { title: { type: "string" }, content: { type: "string" } }, required: ["content"] },
      maxTokens: 500,
    }).catch(() => ({ content: action.label ?? "Workflow note" }));
    const nf = p as { title?: string; content?: string };
    await supabase.from("nodes").insert({
      workspace_id: workspaceId, vertical: "shared", object_type: "note", created_by: "agent:workflow",
      data: { parent_id: record.id, title: nf.title ?? "Workflow note", content: nf.content ?? action.label, created_at: new Date().toISOString() },
    });
    return { action: action.type, mode: "executed", detail: nf.title ?? "note" };
  }
  // Cross-object: create a linked record of ANY target object type (from config or the action
  // name, e.g. "create_contact"), AI-populated from the trigger record. Finance docs are always
  // created as DRAFT (safe — a human sends/charges later). Grounded in the trigger; never invents.
  if (type === "create_record") {
    const cfg = (action.config ?? {}) as Record<string, unknown>;
    const targetType = String(cfg.object_type ?? cfg.target ?? cfg.type ?? "").toLowerCase().trim();
    if (!targetType || targetType === "record") return { action: action.type, mode: "executed", detail: "no target object type" };
    const isFinance = /invoice|quote|expense|credit/.test(targetType);
    const p = await aiGatewayToolUse({
      prompt: `A ${record.object_type} "${recName}" triggered a workflow to create a linked ${targetType}. Trigger record:\n${JSON.stringify(record.data).slice(0, 1000)}\nDraft the new ${targetType}'s fields — a name/title plus only fields clearly derivable from the trigger record. Never invent facts (client names, amounts) not present or implied.`,
      toolName: "record_fields", toolDescription: `Draft the fields for the new ${targetType}`,
      toolSchema: { type: "object", properties: { name: { type: "string" }, fields: { type: "object", additionalProperties: true } }, required: ["name"] },
      maxTokens: 400,
    }).catch(() => ({ name: `${recName} — ${targetType}` }));
    const rf = p as { name?: string; fields?: Record<string, unknown> };
    await supabase.from("nodes").insert({
      workspace_id: workspaceId, vertical: isFinance ? "finance" : "shared", object_type: targetType, created_by: "agent:workflow",
      data: {
        name: rf.name ?? recName, ...(rf.fields ?? {}),
        ...(isFinance ? { status: "draft" } : {}),
        linked_record_id: record.id, source_object_type: record.object_type, created_at: new Date().toISOString(),
      },
    });
    return { action: action.type, mode: "executed", detail: `created ${targetType}: ${rf.name ?? recName}` };
  }
  if (type === "draft_quote" || type === "create_quote") {
    // Deal-stage-triggered quote drafting (Finance Agent). Creates a DRAFT quote
    // node (never sent) with AI-drafted line items derived from the deal — a human
    // reviews/sends it from Finance → Quotes.
    const p = await aiGatewayToolUse({
      prompt: `Draft a sales quote for the deal "${recName}". Deal data:\n${JSON.stringify(record.data).slice(0, 1000)}\nProduce 1–5 realistic line items grounded in the deal's value/products. Do not invent a customer name.`,
      toolName: "quote_draft", toolDescription: "Draft quote line items for a deal",
      toolSchema: { type: "object", properties: { line_items: { type: "array", items: { type: "object", properties: { description: { type: "string" }, quantity: { type: "number" }, unit_price: { type: "number" } }, required: ["description", "quantity", "unit_price"] } } }, required: ["line_items"] },
      maxTokens: 600,
    }).catch(() => ({ line_items: [] as { description: string; quantity: number; unit_price: number }[] }));
    const raw = (p as { line_items?: { description: string; quantity: number; unit_price: number }[] }).line_items ?? [];
    const items = raw.filter((li) => li && typeof li.unit_price === "number");
    const safeItems = items.length ? items : [{ description: `Proposal for ${recName}`, quantity: 1, unit_price: Number(record.data.amount ?? record.data.value ?? 0) || 0 }];
    const subtotal = safeItems.reduce((s, li) => s + (Number(li.quantity) || 1) * (Number(li.unit_price) || 0), 0);
    await supabase.from("nodes").insert({
      workspace_id: workspaceId, vertical: "finance", object_type: "quote", created_by: "agent:workflow",
      data: {
        title: `Quote for ${recName}`, line_items: safeItems,
        subtotal, tax_total: 0, total: subtotal,
        status: "draft", deal_id: record.id, created_at: new Date().toISOString(),
      },
    });
    return { action: action.type, mode: "executed", detail: `draft quote · ${safeItems.length} item(s)` };
  }
  if (type === "update_field" || type === "set_field" || type === "add_tag") {
    const p = await aiGatewayToolUse({
      prompt: `Workflow action: "${action.label}" on ${record.object_type} "${recName}". Current data: ${JSON.stringify(record.data).slice(0, 800)}.\nWhat single field should be set to what value?`,
      toolName: "field_update", toolDescription: "Extract the field and value to set",
      toolSchema: { type: "object", properties: { field: { type: "string" }, value: { type: "string" } }, required: ["field", "value"] },
      maxTokens: 200,
    }).catch(() => ({}));
    const fu = p as { field?: string; value?: string };
    if (fu.field) {
      const merged = { ...record.data };
      if (type === "add_tag") {
        const tags = Array.isArray(merged.tags) ? (merged.tags as unknown[]) : [];
        merged.tags = [...new Set([...tags.map(String), fu.value ?? String(fu.field)])];
      } else {
        merged[fu.field] = fu.value;
      }
      await supabase.from("nodes").update({ data: merged }).eq("id", record.id);
      return { action: action.type, mode: "executed", detail: `${fu.field}=${fu.value}` };
    }
    return { action: action.type, mode: "executed", detail: "no field resolved" };
  }
  if (type === "notify") {
    await createNotification({
      workspace_id: workspaceId, type: "agent", title: `Workflow: ${action.label ?? "notification"}`,
      body: `Triggered for ${recName}`,
      source: { source_agent: "workflow", node_id: record.id, object_type: record.object_type },
    });
    return { action: action.type, mode: "executed", detail: "notified" };
  }
  return { action: action.type, mode: "executed", detail: "no-op" };
}

export interface WorkflowRunSummary {
  workflows_evaluated: number; records_matched: number; actions_executed: number; actions_queued: number;
}

/**
 * Evaluate active workflows for a workspace. `opts.workflowId` restricts to one
 * workflow (on-demand "Run"); `opts.limitRecords` caps work per workflow.
 */
export async function runWorkflowsForWorkspace(
  workspaceId: string,
  opts: { workflowId?: string; limitRecords?: number; recordId?: string } = {},
): Promise<WorkflowRunSummary> {
  const jobId = await startJob({
    workspace_id: workspaceId, agent_name: "workflow",
    trigger_type: opts.workflowId ? "manual" : "scheduled", input: opts,
  });
  const summary: WorkflowRunSummary = { workflows_evaluated: 0, records_matched: 0, actions_executed: 0, actions_queued: 0 };

  try {
    let wfQuery = supabase.from("nodes").select("id, data")
      .eq("workspace_id", workspaceId).eq("object_type", "automation").eq("data->>type", "workflow");
    if (opts.workflowId) wfQuery = wfQuery.eq("id", opts.workflowId);
    else wfQuery = wfQuery.eq("data->>status", "active");
    const { data: workflows } = await wfQuery;

    for (const wf of workflows ?? []) {
      const blocks = (((wf.data as Record<string, unknown>).nodes as WorkflowBlock[]) ?? []);
      const parsed = parseWorkflow(blocks);
      if (parsed.triggers.length === 0 || parsed.actions.length === 0) continue;
      summary.workflows_evaluated++;

      // Union candidate records across ALL triggers (OR logic), deduped by record
      // id so a record that matches two triggers still fires the workflow once.
      // The first matching trigger sets the trigger_key for that record.
      const matched = new Map<string, { record: { id: string; object_type: string; data: Record<string, unknown>; updated_at: string }; trigger: WorkflowBlock }>();
      for (const trigger of parsed.triggers) {
        const recs = (await candidateRecords(workspaceId, trigger, opts.recordId)).slice(0, opts.limitRecords ?? 25);
        for (const r of recs) if (!matched.has(r.id)) matched.set(r.id, { record: r, trigger });
      }
      for (const { record, trigger } of matched.values()) {
        const triggerKey = triggerKeyFor(trigger, record);

        // Dedup: only skip if this workflow already EXECUTED/queued actions for
        // this record+trigger. A prior condition_failed must NOT block re-eval
        // (the record may now satisfy the condition, or a past eval was wrong).
        const { data: priorRuns } = await supabase.from("workflow_runs").select("id,status")
          .eq("workflow_id", wf.id).eq("record_id", record.id).eq("trigger_key", triggerKey);
        const alreadyActioned = (priorRuns ?? []).some((r) => r.status === "executed" || r.status === "queued");
        if (alreadyActioned) continue;
        // Clear any stale condition_failed rows so the unique index doesn't block a fresh insert.
        if ((priorRuns ?? []).length > 0) {
          await supabase.from("workflow_runs").delete()
            .eq("workflow_id", wf.id).eq("record_id", record.id).eq("trigger_key", triggerKey).then(() => {}, () => {});
        }

        const pass = await evaluateConditions(workspaceId, parsed.conditions, record);
        if (!pass) {
          await supabase.from("workflow_runs").insert({
            workspace_id: workspaceId, workflow_id: wf.id, record_id: record.id, trigger_key: triggerKey,
            status: "condition_failed", actions: [],
          }).then(() => {}, () => {});
          continue;
        }

        summary.records_matched++;
        const outcomes: ActionOutcome[] = [];
        for (const action of parsed.actions) {
          const outcome = await runAction(workspaceId, action, record).catch((e): ActionOutcome => ({ action: action.type, mode: "queued", detail: `error: ${e instanceof Error ? e.message : String(e)}` }));
          outcomes.push(outcome);
          if (outcome.mode === "executed") summary.actions_executed++; else summary.actions_queued++;
        }
        await supabase.from("workflow_runs").insert({
          workspace_id: workspaceId, workflow_id: wf.id, record_id: record.id, trigger_key: triggerKey,
          status: outcomes.some((o) => o.mode === "queued") ? "queued" : "executed",
          actions: outcomes, detail: `${outcomes.length} action(s)`,
        }).then(() => {}, () => {});
      }
    }

    await completeJob(jobId, { ...summary, summary: `${summary.records_matched} record(s) matched, ${summary.actions_executed} action(s) run, ${summary.actions_queued} queued` }, [
      step(`Evaluated ${summary.workflows_evaluated} active workflow(s)`),
      step(`${summary.records_matched} record(s) matched trigger conditions`),
      step(`Executed ${summary.actions_executed} safe action(s)`, { status: "ok" }),
      step(`Queued ${summary.actions_queued} risky action(s) for approval`, { status: summary.actions_queued ? "warn" : "ok" }),
    ]);
    return summary;
  } catch (err: unknown) {
    await failJob(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** All workspaces — used by the daily cron. */
export async function runAllWorkflows(): Promise<Record<string, unknown>> {
  const { data: workspaces } = await supabase.from("workspaces").select("id");
  let totalMatched = 0, totalExecuted = 0, totalQueued = 0;
  for (const ws of workspaces ?? []) {
    const s = await runWorkflowsForWorkspace(ws.id as string).catch(() => null);
    if (s) { totalMatched += s.records_matched; totalExecuted += s.actions_executed; totalQueued += s.actions_queued; }
  }
  return { matched: totalMatched, executed: totalExecuted, queued: totalQueued };
}
