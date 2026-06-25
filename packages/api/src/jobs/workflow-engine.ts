import { supabase } from "@mondaily/db/client";
import { startJob, completeJob, failJob } from "../lib/agent-logger";
import { aiGateway, aiGatewayToolUse } from "../lib/ai-gateway";

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

const SAFE_ACTIONS = new Set(["create_task", "create_note", "update_field", "set_field", "add_tag", "notify", "add_note"]);
const RISKY_ACTIONS = new Set(["send_email", "send_message", "send_sms", "create_invoice", "charge", "charge_invoice", "delete_record", "archive_record", "send"]);

interface WorkflowBlock { id: string; kind: string; type: string; label?: string; config?: Record<string, unknown>; }
interface ParsedWorkflow { trigger: WorkflowBlock | null; conditions: WorkflowBlock[]; actions: WorkflowBlock[]; }

function parseWorkflow(blocks: WorkflowBlock[]): ParsedWorkflow {
  return {
    trigger: blocks.find((b) => b.kind === "trigger") ?? null,
    conditions: blocks.filter((b) => b.kind === "condition"),
    actions: blocks.filter((b) => b.kind === "action"),
  };
}

/** Which records this trigger should evaluate against, scoped to the workspace. */
async function candidateRecords(workspaceId: string, trigger: WorkflowBlock): Promise<{ id: string; object_type: string; data: Record<string, unknown>; updated_at: string }[]> {
  const t = `${trigger.type} ${trigger.label ?? ""}`.toLowerCase();
  const base = supabase.from("nodes").select("id, object_type, data, updated_at").eq("workspace_id", workspaceId);

  let q = base;
  if (t.includes("deal")) q = base.ilike("object_type", "%deal%");
  else if (t.includes("invoice")) q = base.eq("object_type", "invoice");
  else if (t.includes("contact") || t.includes("person") || t.includes("lead") || t.includes("compan")) {
    q = base.or("object_type.ilike.%contact%,object_type.ilike.%people%,object_type.ilike.%lead%,object_type.ilike.%compan%");
  } else if (t.includes("task")) q = base.ilike("object_type", "%task%");
  // record_created / record_updated / generic → most-recent records
  const { data } = await q.order("updated_at", { ascending: false }).limit(200);
  return (data ?? []) as { id: string; object_type: string; data: Record<string, unknown>; updated_at: string }[];
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
async function evaluateConditions(conditions: WorkflowBlock[], record: { object_type: string; data: Record<string, unknown> }): Promise<boolean> {
  if (conditions.length === 0) return true;
  // Structured fast-path: if any condition has explicit field/operator/value config.
  const structured = conditions.every((c) => c.config && c.config.field && "value" in (c.config ?? {}));
  if (structured) {
    return conditions.every((c) => {
      const cfg = c.config!;
      const actual = String((record.data as Record<string, unknown>)[String(cfg.field)] ?? "").toLowerCase();
      const expected = String(cfg.value ?? "").toLowerCase();
      const op = String(cfg.operator ?? "equals");
      if (op === "equals") return actual === expected;
      if (op === "not_equals") return actual !== expected;
      if (op === "contains") return actual.includes(expected);
      if (op === "gt") return Number(actual) > Number(expected);
      if (op === "lt") return Number(actual) < Number(expected);
      return actual === expected;
    });
  }
  // Keyword fast-path: if a condition names a value that's literally present
  // in the record (e.g. "status equals Won" + a "Closed Won" stage), pass
  // without an AI round-trip. Robust and free for the common equals case.
  const recordText = JSON.stringify(record.data).toLowerCase();
  const keywordPass = conditions.every((c) => {
    const label = (c.label ?? c.type).toLowerCase();
    // pull the value after equals/is/= , else the last capitalised-ish token
    const m = label.match(/(?:equals?|is|=|matches)\s+["']?([a-z0-9 _-]{2,})["']?$/i)
      ?? (c.label ?? "").match(/\b([A-Z][a-zA-Z]{2,})\s*$/);
    const val = (m?.[1] ?? "").trim().toLowerCase();
    return val.length >= 2 && recordText.includes(val);
  });
  if (keywordPass) return true;

  // AI fallback — plain text YES/NO (reliable on reasoning models, unlike
  // forced tool-use which gpt-oss often leaves empty).
  const { text } = await aiGateway({
    system: "You evaluate workflow conditions. Answer with exactly one word: YES or NO.",
    prompt: `Record (${record.object_type}):\n${JSON.stringify(record.data).slice(0, 1500)}\n\nConditions (ALL must hold):\n${conditions.map((c, i) => `${i + 1}. ${c.label ?? c.type}`).join("\n")}\n\nDo ALL conditions hold for this record? Answer YES or NO.`,
    maxTokens: 1500,
  }).catch(() => ({ text: "" }));
  return /\byes\b/i.test(text) && !/\bno\b/i.test(text.replace(/\byes\b/i, ""));
}

interface ActionOutcome { action: string; mode: "executed" | "queued"; detail: string }

async function runAction(workspaceId: string, action: WorkflowBlock, record: { id: string; object_type: string; data: Record<string, unknown> }): Promise<ActionOutcome> {
  const type = action.type.toLowerCase();
  const recName = String(record.data.name ?? record.data.title ?? record.data.full_name ?? record.id);

  // RISKY → always queue for approval, with AI-drafted content.
  if (RISKY_ACTIONS.has(type) || (!SAFE_ACTIONS.has(type))) {
    const draft = await aiGatewayToolUse({
      prompt: `Workflow action: "${action.label ?? action.type}" for ${record.object_type} "${recName}".\nRecord:\n${JSON.stringify(record.data).slice(0, 1200)}\n\nDraft the content this action would produce (e.g. the email subject+body, or a one-line description).`,
      toolName: "draft_action",
      toolDescription: "Draft the content for a sensitive workflow action awaiting approval",
      toolSchema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title"] },
      maxTokens: 800,
    }).catch(() => ({ title: action.label ?? action.type }));
    const d = draft as { title?: string; body?: string };
    await supabase.from("decision_queue").insert({
      workspace_id: workspaceId, source_type: "node", source_id: record.id, agent_name: "workflow",
      title: `Workflow: ${d.title ?? action.label ?? action.type}`,
      summary: (d.body ?? "").slice(0, 1000) || `Action "${action.label ?? action.type}" ready for ${recName}.`,
      recommended_action: action.label ?? action.type,
      risk_level: type.includes("delete") || type.includes("charge") || type.includes("invoice") ? "high" : "medium",
      evidence: [{ type: "record", title: recName, node_id: record.id, match_reason: `Workflow action: ${action.label ?? action.type}` }],
    });
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
    await supabase.from("notifications").insert({
      workspace_id: workspaceId, type: "agent", title: `Workflow: ${action.label ?? "notification"}`,
      body: `Triggered for ${recName}`, metadata: { node_id: record.id },
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
  opts: { workflowId?: string; limitRecords?: number } = {},
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
      if (!parsed.trigger || parsed.actions.length === 0) continue;
      summary.workflows_evaluated++;

      const candidates = (await candidateRecords(workspaceId, parsed.trigger)).slice(0, opts.limitRecords ?? 25);
      for (const record of candidates) {
        const triggerKey = triggerKeyFor(parsed.trigger, record);

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

        const pass = await evaluateConditions(parsed.conditions, record);
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

    await completeJob(jobId, { ...summary, summary: `${summary.records_matched} record(s) matched, ${summary.actions_executed} action(s) run, ${summary.actions_queued} queued` }, []);
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
