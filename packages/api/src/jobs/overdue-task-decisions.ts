import { inngest } from "../lib/inngest";
import { runOverdueTaskDecisions } from "./runners";

/**
 * Operations Agent — queues a real Decision Queue recommendation for each
 * overdue task instead of only showing a live count in the Agent Registry.
 */
export const overdueTaskDecisions = inngest.createFunction(
  { id: "operations-overdue-task-decisions", name: "Operations: Overdue Task Decisions", concurrency: { limit: 2 } },
  { cron: "0 7 * * *" }, // 7am daily, ahead of invoice-chaser/deal-alerts
  async () => runOverdueTaskDecisions(),
);
