import { inngest } from "../lib/inngest";
import { startJob, completeJob, failJob } from "../lib/agent-logger";
import { supabase } from "@mondaily/db/client";

interface RecurringInvoiceNode {
  id: string;
  workspace_id: string;
  data: {
    status?: string;
    is_recurring?: boolean;
    recurring_frequency?: "monthly" | "quarterly" | "annual";
    next_due_date?: string;
    number?: string;
    client_name?: string;
    client_email?: string;
    client_address?: string;
    currency?: string;
    line_items?: unknown[];
    subtotal?: number;
    tax_total?: number;
    total?: number;
    notes?: string;
    linked_record_id?: string;
  };
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split("T")[0] ?? dateStr;
}

function nextDueDateAfter(current: string, frequency: string): string {
  if (frequency === "quarterly") return addMonths(current, 3);
  if (frequency === "annual") return addMonths(current, 12);
  return addMonths(current, 1); // monthly default
}

async function nextInvoiceNumber(workspaceId: string): Promise<string> {
  const { count } = await supabase
    .from("nodes")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("vertical", "finance")
    .eq("object_type", "invoice");
  const n = (count ?? 0) + 1;
  return `INV-${String(n).padStart(4, "0")}`;
}

export const recurringInvoices = inngest.createFunction(
  { id: "finance-recurring-invoices", name: "Finance: Generate Recurring Invoices", concurrency: { limit: 1 } },
  { cron: "0 6 * * *" },
  async () => {
    const { data: workspaces } = await supabase.from("workspaces").select("id, name");
    if (!workspaces?.length) return { workspaces_processed: 0, generated: 0 };

    let totalGenerated = 0;

    for (const ws of workspaces) {
      const jobId = await startJob({
        workspace_id: ws.id,
        agent_name: "recurring_invoices",
        trigger_type: "scheduled",
        input: { workspace_id: ws.id },
      });

      try {
        const today = new Date().toISOString().split("T")[0] ?? "";

        const { data: invoices } = await supabase
          .from("nodes")
          .select("id, workspace_id, data")
          .eq("workspace_id", ws.id)
          .eq("object_type", "invoice")
          .eq("data->>is_recurring", "true")
          .neq("data->>status", "cancelled") as { data: RecurringInvoiceNode[] | null };

        if (!invoices?.length) {
          await completeJob(jobId, { generated: 0, message: "no recurring invoices" }, []);
          continue;
        }

        let generated = 0;
        const steps: unknown[] = [];

        for (const invoice of invoices) {
          const nextDue = invoice.data.next_due_date;
          if (!nextDue) continue;
          if (today < nextDue) continue;

          // Clone invoice as new draft
          const newNumber = await nextInvoiceNumber(ws.id);
          const newInvoiceData = {
            number: newNumber,
            client_name: invoice.data.client_name ?? "",
            client_email: invoice.data.client_email ?? null,
            client_address: invoice.data.client_address ?? null,
            line_items: invoice.data.line_items ?? [],
            currency: invoice.data.currency ?? "GBP",
            subtotal: invoice.data.subtotal ?? 0,
            tax_total: invoice.data.tax_total ?? 0,
            total: invoice.data.total ?? 0,
            notes: invoice.data.notes ?? null,
            status: "draft",
            sent_at: null,
            paid_at: null,
            chase_count: 0,
            ...(invoice.data.linked_record_id ? { linked_record_id: invoice.data.linked_record_id } : {}),
          };

          const { data: newInvoice, error: insertErr } = await supabase
            .from("nodes")
            .insert({
              workspace_id: ws.id,
              vertical: "finance",
              object_type: "invoice",
              data: newInvoiceData,
              created_by: "agent:recurring_invoices",
            })
            .select("id")
            .single();

          if (insertErr) {
            steps.push({ error: insertErr.message, original_id: invoice.id });
            continue;
          }

          // Update next_due_date on original
          const frequency = invoice.data.recurring_frequency ?? "monthly";
          const updatedNextDue = nextDueDateAfter(nextDue, frequency);

          await supabase
            .from("nodes")
            .update({
              data: { ...invoice.data, next_due_date: updatedNextDue },
            })
            .eq("id", invoice.id);

          // Workspace notification
          await supabase.from("notifications").insert({
            workspace_id: ws.id,
            type: "agent",
            title: `Recurring invoice generated: ${newNumber}`,
            body: `Cloned from ${invoice.data.number ?? invoice.id} · Next due: ${updatedNextDue}`,
            metadata: {
              original_invoice_id: invoice.id,
              new_invoice_id: newInvoice.id,
            },
          });

          steps.push({ generated: newNumber, original_id: invoice.id, new_id: newInvoice.id });
          generated++;
          totalGenerated++;
        }

        await completeJob(jobId, { generated }, steps);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await failJob(jobId, msg);
      }
    }

    return { generated: totalGenerated };
  },
);
