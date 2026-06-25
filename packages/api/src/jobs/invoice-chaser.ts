import { inngest } from "../lib/inngest";
import { runInvoiceChaser } from "./runners";

export const invoiceChaser = inngest.createFunction(
  { id: "finance-invoice-chaser", name: "Finance: Invoice Chaser", concurrency: { limit: 1 } },
  { cron: "0 9 * * *" },
  async () => runInvoiceChaser(),
);
