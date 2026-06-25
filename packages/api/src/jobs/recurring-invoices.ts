import { inngest } from "../lib/inngest";
import { runRecurringInvoices } from "./runners";

export const recurringInvoices = inngest.createFunction(
  { id: "finance-recurring-invoices", name: "Finance: Generate Recurring Invoices", concurrency: { limit: 1 } },
  { cron: "0 6 * * *" },
  async () => runRecurringInvoices(),
);
