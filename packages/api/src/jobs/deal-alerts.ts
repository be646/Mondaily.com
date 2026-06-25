import { inngest } from "../lib/inngest";
import { runDealAlerts } from "./runners";

export const dealAlerts = inngest.createFunction(
  { id: "crm-deal-alerts", name: "CRM: Deal Alerts", concurrency: { limit: 2 } },
  { cron: "0 8 * * *" }, // 8am daily
  async () => runDealAlerts(),
);
