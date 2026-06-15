import { inngest } from "../lib/inngest";
import { supabase } from "@mondaily/db/client";

/**
 * Inngest function: auto-provision a credit_note from a client dispute email.
 * Triggered by `finance/dispute.email.received` — fired from the email webhook
 * handler when the AI classifies an inbound email as a billing dispute.
 *
 * The credit note is created in `pending_review` so an admin must approve
 * before it can be executed. An AI reasoning summary is attached.
 */
export const creditNoteDisputeHandler = inngest.createFunction(
  { id: "credit-note-dispute", name: "Provision credit note from dispute email" },
  { event: "finance/dispute.email.received" },
  async ({ event, step }) => {
    const { workspaceId, clientName, disputeBody, invoiceId, suggestedAmountCents, currency } = event.data;

    // Step 1: Ask OpenAI to extract amount + reason + generate summary
    const aiResult = await step.run("classify-dispute", async () => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return { amount_cents: suggestedAmountCents ?? 0, reason: "billing_error", summary: disputeBody };

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 256,
          messages: [
            { role: "system", content: "You are a billing analyst. Extract from the dispute email: the credit reason (one of: refund, billing_error, goodwill, contract_discount), the disputed amount in cents as an integer, and write a 1-sentence professional summary. Reply as JSON: {\"reason\":\"...\",\"amount_cents\":0,\"summary\":\"...\"}" },
            { role: "user", content: disputeBody },
          ],
        }),
      });
      const json = await res.json() as { choices: { message: { content: string } }[] };
      try {
        return JSON.parse(json.choices[0]!.message.content) as { reason: string; amount_cents: number; summary: string };
      } catch {
        return { amount_cents: suggestedAmountCents ?? 0, reason: "billing_error", summary: disputeBody.slice(0, 200) };
      }
    });

    // Step 2: Insert the credit_note node
    const node = await step.run("create-credit-note-node", async () => {
      const validReasons = ["refund", "billing_error", "goodwill", "contract_discount"];
      const reason = validReasons.includes(aiResult.reason) ? aiResult.reason : "billing_error";

      const { data, error } = await supabase
        .from("nodes")
        .insert({
          workspace_id: workspaceId,
          vertical: "finance",
          object_type: "credit_note",
          data: {
            amount_cents:  aiResult.amount_cents || (suggestedAmountCents ?? 0),
            currency:      currency ?? "GBP",
            credit_reason: reason,
            status:        "pending_review",
            client_name:   clientName ?? null,
            ai_summary:    aiResult.summary,
            notes:         `Auto-provisioned from client dispute email. Original message:\n\n${disputeBody.slice(0, 500)}`,
            created_at:    new Date().toISOString(),
          },
          created_by: "system",
        })
        .select("id")
        .single();

      if (error) throw new Error(`Failed to create credit note: ${error.message}`);
      return data;
    });

    // Step 3: Link to invoice if provided
    if (invoiceId) {
      await step.run("link-to-invoice", async () => {
        await supabase.from("edges").upsert({
          workspace_id: workspaceId,
          from_node_id: node.id,
          to_node_id: invoiceId,
          relationship: "APPLIED_TO",
        });
      });
    }

    // Step 4: Notify all admins
    await step.run("notify-admins", async () => {
      const { data: admins } = await supabase
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .in("role", ["admin", "owner"]);

      if (!admins?.length) return;
      const amount = ((aiResult.amount_cents || 0) / 100).toLocaleString("en-GB", { style: "currency", currency: currency ?? "GBP" });
      await supabase.from("notifications").insert(
        admins.map(a => ({
          workspace_id: workspaceId,
          user_id: a.user_id,
          title: "AI: Credit note requires review",
          body: `A dispute from ${clientName ?? "a client"} was processed. Credit note for ${amount} is pending your approval.`,
          type: "credit_note",
          is_read: false,
        }))
      );
    });

    return { nodeId: node.id, status: "pending_review" };
  }
);
