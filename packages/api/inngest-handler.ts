import type { IncomingMessage, ServerResponse } from "node:http";
import { serve } from "inngest/node";
import { inngest } from "./src/lib/inngest";
import { enrichRecord, invoiceChaser, relationshipHealth } from "./src/jobs/index";

const handler = serve({
  client: inngest,
  functions: [enrichRecord, invoiceChaser, relationshipHealth],
});

module.exports = handler;
