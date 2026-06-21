import { inngest } from "../lib/inngest";
import { supabase } from "@mondaily/db/client";
import { startJob, completeJob, failJob } from "../lib/agent-logger";

/**
 * Operations Agent — queues a real Decision Queue recommendation for each
 * overdue task instead of only showing a live count in the Agent
 * Registry. Mirrors the dedupe pattern in deal-alerts.ts/invoice-chaser.ts:
 * never re-queue a task that already has a pending decision.
 */
export const overdueTaskDecisions = inngest.createFunction(
  { id: "operations-overdue-task-decisions", name: "Operations: Overdue Task Decisions", concurrency: { limit: 2 } },
  { cron: "0 7 * * *" }, // 7am daily, ahead of invoice-chaser/deal-alerts
  async () => {
    const jobId = await startJob({
      workspace_id: "system",
      agent_name: "operations",
      trigger_type: "scheduled",
      input: {},
    });

    try {
      const { data: workspaces } = await supabase.from("workspaces").select("id");
      let queued = 0;

      for (const ws of workspaces ?? []) {
        const { data: tasks } = await supabase
          .from("tasks")
          .select("id, title, due_date, priority, assignee_email")
          .eq("workspace_id", ws.id)
          .eq("completed", false)
          .lt("due_date", new Date().toISOString());

        for (const task of tasks ?? []) {
          const { data: existing } = await supabase
            .from("decision_queue")
            .select("id")
            .eq("workspace_id", ws.id)
            .eq("source_type", "task")
            .eq("source_id", task.id)
            .eq("agent_name", "operations")
            .eq("status", "pending")
            .maybeSingle();
          if (existing) continue;

          const daysOverdue = Math.floor((Date.now() - new Date(task.due_date!).getTime()) / 86_400_000);

          await supabase.from("decision_queue").insert({
            workspace_id: ws.id,
            source_type: "task",
            source_id: task.id,
            agent_name: "operations",
            title: `Overdue: ${task.title}`,
            summary: `${daysOverdue} day(s) overdue${task.assignee_email ? `, assigned to ${task.assignee_email}` : ", unassigned"}.`,
            recommended_action: "Reassign, reschedule, or mark complete",
            risk_level: daysOverdue > 7 || task.priority === "urgent" ? "high" : daysOverdue > 2 ? "medium" : "low",
            evidence: [{ type: "task", title: task.title, node_id: task.id, match_reason: `${daysOverdue} days overdue`, timestamp: task.due_date }],
          });
          queued++;
        }
      }

      await completeJob(jobId, { queued }, []);
      return { queued };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await failJob(jobId, msg);
      throw err;
    }
  },
);
