import { inngest } from "../lib/inngest";
import { runRelationshipHealth } from "./runners";

// Runs daily at 2am — scores every contact/company per workspace
export const relationshipHealth = inngest.createFunction(
  { id: "crm-relationship-health", name: "CRM: Relationship Health Scoring", concurrency: { limit: 1 } },
  { cron: "0 2 * * *" },
  async () => runRelationshipHealth(),
);
