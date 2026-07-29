/**
 * Human-readable "exactly what happens if approved" — mirrors executeApprovedAction's dispatch so
 * the cockpit can show the real consequence up front and gate bulk-approve on side effects. Pure +
 * tested. `side_effect: true` means approving fires an outward action (email/record) — those must
 * NOT be bulk-approved silently; `false` means advisory-only (approving just records the decision).
 */
export interface ExecutionPreview { text: string; side_effect: boolean }

export function describeExecution(d: {
  agent_name?: string | null;
  source_type?: string | null;
  evidence?: unknown;
}): ExecutionPreview {
  const agent = d.agent_name ?? "";
  const st = d.source_type ?? "";
  const ev0 = (Array.isArray(d.evidence) ? d.evidence[0] : null) as Record<string, unknown> | null;

  if (agent === "prospecting" && st === "prospecting_candidate") {
    const c = (ev0?.candidate ?? {}) as Record<string, unknown>;
    const list = ev0?.destination_list_id ? " and add it to the destination list" : "";
    return { text: `Create a ${c.object_type ?? "record"}${c.name ? ` for “${c.name}”` : ""}${list}.`, side_effect: true };
  }
  if (agent === "discovery" && st === "discovered_lead") {
    const l = (ev0?.lead ?? {}) as Record<string, unknown>;
    const who = l.name ? ` for “${l.name}”` : l.email ? ` for ${l.email}` : "";
    return { text: `Create a person record${who}.`, side_effect: true };
  }
  if (agent === "invoice_chaser" && st === "invoice") {
    return { text: "Send the invoice chase email to the client (or create a send-it task if no inbox is connected), then mark the invoice chased.", side_effect: true };
  }
  if (agent === "workflow") {
    return { text: "Send the workflow email to the linked record's contact (or create a send-it task if there's no clear recipient).", side_effect: true };
  }
  // Meeting action items really DO create a task (see executeApprovedAction's meeting_action
  // branch). This used to fall through to "advisory only / side_effect: false", so the cockpit
  // told the user no automated action would run AND "Approve all safe" mass-created tasks —
  // exactly what that gate exists to prevent.
  if (st === "meeting_action") {
    return { text: "Create a task for this meeting action item, assigned to the meeting's owner and linked to the call.", side_effect: true };
  }
  return { text: "Advisory only — approving records your decision; no automated action runs.", side_effect: false };
}
