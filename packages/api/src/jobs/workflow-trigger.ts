import { inngest } from "../lib/inngest";
import { runWorkflowsForWorkspace } from "./workflow-engine";

/**
 * Real-time automation triggers. When a record is created or updated, run the
 * workspace's active workflows against JUST that record — so a "deal → Won →
 * congrats email" workflow fires immediately, not once a day on the cron.
 *
 * Safe to fire on every change: the engine dedups per (workflow, record,
 * trigger_key) via the workflow_runs table, so a record fires each workflow at
 * most once per relevant state change. The daily cron (runAllWorkflows) stays as
 * a backstop/sweep.
 */
export const workflowTrigger = inngest.createFunction(
  { id: "workflow-realtime-trigger", name: "Automations: real-time trigger", concurrency: { limit: 5 } },
  [{ event: "crm/record.created" }, { event: "crm/record.updated" }],
  async ({ event }) => {
    const { workspaceId, nodeId } = event.data as { workspaceId?: string; nodeId?: string };
    if (!workspaceId || !nodeId) return { skipped: true };
    const summary = await runWorkflowsForWorkspace(workspaceId, { recordId: nodeId, limitRecords: 1 });
    return { workspaceId, recordId: nodeId, ...summary };
  },
);
