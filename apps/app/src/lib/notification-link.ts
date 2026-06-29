// Resolve a notification into a context-aware deep link that lands the user on
// the exact record/decision/invoice it's about — not a generic page. Best-effort:
// uses whatever IDs the notification carries (task_id + metadata), falling back to
// the most specific page available.

export interface NotificationLike {
  type?: string;
  task_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function resolveNotificationLink(n: NotificationLike): string {
  const m = (n.metadata ?? {}) as Record<string, unknown>;
  const nodeId = str(m.nodeId) ?? str(m.node_id) ?? str(m.record_id);
  const objectType = str(m.object_type) ?? str(m.objectType);
  const decisionId = str(m.decision_id) ?? str(m.decisionId);
  const invoiceId = str(m.invoice_id) ?? str(m.invoiceId) ?? str(m.invoice);
  const creditNoteId = str(m.credit_note_id) ?? str(m.creditNoteId);

  // Most specific first.
  if (n.task_id) return `/tasks?id=${n.task_id}`;
  if (creditNoteId) return `/finance/credit-notes/${creditNoteId}`;
  if (invoiceId) return `/finance/invoices/${invoiceId}`;
  if (decisionId || n.type === "decision") return decisionId ? `/decisions?id=${decisionId}` : "/decisions";
  if (objectType && nodeId) return `/objects/${encodeURIComponent(objectType)}/${nodeId}`;
  const route = str(m.route);
  if (route && route.startsWith("/")) return route;

  // Type-based fallbacks when no specific id is present.
  switch (n.type) {
    case "daily_brief": return "/home";
    case "alert": return "/decisions";
    case "agent": return nodeId ? `/search?focus=${nodeId}` : "/decisions";
    default: return "/notifications";
  }
}
