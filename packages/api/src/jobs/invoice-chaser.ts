import { inngest } from "../lib/inngest";
import { startJob, completeJob, failJob, logStep } from "../lib/agent-logger";
import { supabase } from "@mondaily/db/client";

interface InvoiceNode {
  id: string;
  workspace_id: string;
  data: {
    status?: string;
    due_date?: string;
    amount?: number;
    currency?: string;
    client_name?: string;
    client_email?: string;
    invoice_number?: string;
    last_chased_at?: string;
    chase_count?: number;
  };
}

function daysOverdue(dueDateStr: string): number {
  const due = new Date(dueDateStr);
  const now = new Date();
  return Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
}

function chaseMessage(invoice: InvoiceNode["data"], days: number): { subject: string; body: string } {
  const num = invoice.invoice_number ?? "your invoice";
  const amount = invoice.amount
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: invoice.currency ?? "USD" }).format(invoice.amount)
    : "the outstanding amount";

  if (days <= 7) {
    return {
      subject: `Friendly reminder: ${num} is overdue`,
      body: `Hi ${invoice.client_name ?? "there"},\n\nThis is a friendly reminder that ${num} for ${amount} was due ${days} day${days === 1 ? "" : "s"} ago.\n\nPlease let us know if you have any questions.\n\nThank you!`,
    };
  }
  if (days <= 14) {
    return {
      subject: `Second notice: ${num} — ${days} days overdue`,
      body: `Hi ${invoice.client_name ?? "there"},\n\nWe noticed that ${num} for ${amount} remains unpaid and is now ${days} days overdue.\n\nPlease arrange payment at your earliest convenience.\n\nIf there's an issue, please reach out so we can resolve it.\n\nRegards`,
    };
  }
  return {
    subject: `Urgent: ${num} — ${days} days past due`,
    body: `Hi ${invoice.client_name ?? "there"},\n\nDespite previous reminders, ${num} for ${amount} remains unpaid at ${days} days overdue.\n\nPlease treat this as urgent. If payment cannot be made immediately, contact us to discuss arrangements.\n\nThis matter may be escalated if not resolved promptly.`,
  };
}

export const invoiceChaser = inngest.createFunction(
  { id: "finance-invoice-chaser", name: "Finance: Invoice Chaser", concurrency: { limit: 1 } },
  { cron: "0 9 * * *" },
  async () => {
    // Get all workspaces
    const { data: workspaces } = await supabase.from("workspaces").select("id, name");
    if (!workspaces?.length) return { workspaces_processed: 0 };

    let totalChased = 0;
    let totalSkipped = 0;

    for (const ws of workspaces) {
      const jobId = await startJob({
        workspace_id: ws.id,
        agent_name: "invoice_chaser",
        trigger_type: "scheduled",
        input: { workspace_id: ws.id },
      });

      try {
        // Fetch sent invoices with due dates in the past
        const today = new Date().toISOString().split("T")[0];
        const { data: invoices } = await supabase
          .from("nodes")
          .select("id, workspace_id, data")
          .eq("workspace_id", ws.id)
          .eq("object_type", "invoice")
          .lt("data->>due_date", today)
          .in("data->>status", ["sent", "overdue", "unpaid"]) as { data: InvoiceNode[] | null };

        if (!invoices?.length) {
          await completeJob(jobId, { chased: 0, message: "no overdue invoices" }, []);
          continue;
        }

        const steps: unknown[] = [];
        let chased = 0;

        for (const invoice of invoices) {
          const due = invoice.data.due_date;
          if (!due) continue;

          const days = daysOverdue(due);
          if (days <= 0) continue;

          // Don't chase more than once every 3 days
          const lastChased = invoice.data.last_chased_at;
          if (lastChased) {
            const daysSinceChase = daysOverdue(lastChased);
            if (daysSinceChase < 3) { totalSkipped++; continue; }
          }

          const { subject, body } = chaseMessage(invoice.data, days);
          const clientEmail = invoice.data.client_email;
          const chaseCount = (invoice.data.chase_count ?? 0) + 1;

          await logStep(jobId, { invoice_id: invoice.id, days_overdue: days, chase_count: chaseCount });

          if (clientEmail) {
            // Attempt send via Nylas if workspace has connection
            const { data: emailConn } = await supabase
              .from("email_connections")
              .select("grant_id")
              .eq("workspace_id", ws.id)
              .limit(1)
              .single();

            if (emailConn?.grant_id) {
              try {
                await fetch(`https://api.us.nylas.com/v3/grants/${emailConn.grant_id}/messages/send`, {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${process.env.NYLAS_API_KEY}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    subject,
                    body,
                    to: [{ email: clientEmail, name: invoice.data.client_name ?? clientEmail }],
                  }),
                });
                steps.push({ sent: true, to: clientEmail, subject });
              } catch {
                steps.push({ sent: false, to: clientEmail, error: "nylas_failed" });
              }
            } else {
              // Create a manual task in the workspace
              await supabase.from("nodes").insert({
                workspace_id: ws.id,
                vertical: "finance",
                object_type: "task",
                created_by: "agent:invoice_chaser",
                data: {
                  title: `Chase invoice ${invoice.data.invoice_number ?? invoice.id} — ${days} days overdue`,
                  notes: `Draft email:\n\nSubject: ${subject}\n\n${body}`,
                  status: "todo",
                  priority: days > 14 ? "urgent" : days > 7 ? "high" : "medium",
                },
              });
              steps.push({ task_created: true, invoice_id: invoice.id });
            }
          }

          // Update invoice data with chase tracking
          await supabase
            .from("nodes")
            .update({
              data: {
                ...invoice.data,
                status: "overdue",
                last_chased_at: new Date().toISOString(),
                chase_count: chaseCount,
              },
            })
            .eq("id", invoice.id);

          // Notification for workspace members
          await supabase.from("notifications").insert({
            workspace_id: ws.id,
            type: "agent",
            title: `Invoice ${invoice.data.invoice_number ?? ""} chased`,
            body: `${days} days overdue · Chase #${chaseCount} sent to ${clientEmail ?? "no email on file"}`,
            metadata: { invoice_id: invoice.id, days_overdue: days },
          });

          chased++;
          totalChased++;
        }

        await completeJob(jobId, { chased, skipped: totalSkipped }, steps);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await failJob(jobId, msg);
      }
    }

    return { workspaces_processed: workspaces.length, total_chased: totalChased, total_skipped: totalSkipped };
  },
);
