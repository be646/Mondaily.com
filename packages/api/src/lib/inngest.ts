import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "mondaily",
  eventKey: process.env.INNGEST_EVENT_KEY,
});

export type Events = {
  "crm/record.created": {
    data: {
      workspaceId: string;
      nodeId: string;
      objectType: string;
      vertical: string;
      recordData: Record<string, unknown>;
    };
  };
  "finance/invoice.overdue.check": {
    data: Record<string, never>;
  };
  "crm/record.enriched": {
    data: {
      workspaceId: string;
      nodeId: string;
      fields: Record<string, unknown>;
    };
  };
  "finance/credit_note.created": {
    data: {
      workspaceId: string;
      nodeId: string;
      status: string;
      amount_cents: number;
    };
  };
  "finance/dispute.email.received": {
    data: {
      workspaceId: string;
      clientName?: string;
      disputeBody: string;
      invoiceId?: string;
      suggestedAmountCents?: number;
      currency?: string;
    };
  };
  "finance/invoice.recurring.generated": {
    data: { workspaceId: string; originalInvoiceId: string; newInvoiceId: string; };
  };
};
