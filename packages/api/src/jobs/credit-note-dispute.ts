import { inngest } from "../lib/inngest";
import { supabase } from "@mondaily/db/client";
import { aiGateway } from "../lib/ai-gateway";

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

    // Step 1: Classify dispute via the AI gateway (model chosen by AI_PROVIDER_MODEL env var)
    const aiResult = await step.run("classify-dispute", async () => {
      // Cerebras gateway must be configured; otherwise fall back to a safe
      // default rather than calling an unconfigured provider.
      if (!process.env.AI_GATEWAY_BASE_URL || !process.env.AI_GATEWAY_API_KEY) {
        return { amount_cents: suggestedAmountCents ?? 0, reason: "billing_error", summary: disputeBody.slice(0, 200) };
      }

      // Local fail-safe (matches workflow-engine.ts): a gateway timeout / network
      // glitch degrades to empty text → the JSON.parse catch below returns the
      // safe default. The Inngest step never throws on a provider hiccup, so the
      // retry framework stays clean instead of churning on a transient stall.
      const { text } = await aiGateway({
        system: `You are a billing analyst. Extract from the dispute email:
- reason: one of "refund", "billing_error", "goodwill", "contract_discount"
- amount_cents: integer (disputed amount in cents, 0 if unclear)
- summary: 1-sentence professional summary

Reply ONLY with valid JSON: {"reason":"...","amount_cents":0,"summary":"..."}`,
        prompt: disputeBody,
        maxTokens: 256,
        workspaceId, feature: "credit_note_dispute",
      }).catch((err: any) => {
        console.error("[credit-note-dispute] classify-dispute gateway call failed (non-fatal):", err?.message ?? err);
        return { text: "" };
      });

      try {
        return JSON.parse(text) as { reason: string; amount_cents: number; summary: string };
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

    const amount = ((aiResult.amount_cents || 0) / 100).toLocaleString("en-GB", { style: "currency", currency: currency ?? "GBP" });

    // Step 4: Notify all admins
    await step.run("notify-admins", async () => {
      const { data: admins } = await supabase
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .in("role", ["admin", "owner"]);

      if (!admins?.length) return;
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

    // Step 5: Add to the real Decision Queue so it shows up alongside every
    // other agent recommendation, not just as a notification.
    await step.run("queue-decision", async () => {
      await supabase.from("decision_queue").insert({
        workspace_id: workspaceId,
        source_type: "credit_note",
        source_id: node.id,
        agent_name: "finance",
        title: `Review credit note for ${clientName ?? "client"} — ${amount}`,
        summary: aiResult.summary,
        recommended_action: "Approve or reject this credit note",
        risk_level: (aiResult.amount_cents ?? 0) > 50000 ? "high" : "medium",
        evidence: [{ type: "note", title: "Dispute email", match_reason: disputeBody.slice(0, 200) }],
      }).then(() => {}, () => {}); // best-effort — never block credit note creation on this
    });

    return { nodeId: node.id, status: "pending_review" };
  }
);
