import { inngest } from "../lib/inngest";
import { runLeadScoring } from "./runners";

// Runs daily at 3am (after relationship-health at 2am) — computes the AI
// lead score for every deal/opportunity in every workspace and writes it to
// nodes.lead_score, the column the records sheet and pipeline read.
export const leadScoring = inngest.createFunction(
  { id: "crm-lead-scoring", name: "AI Lead Scoring", concurrency: { limit: 1 } },
  { cron: "0 3 * * *" },
  async () => runLeadScoring(),
);
