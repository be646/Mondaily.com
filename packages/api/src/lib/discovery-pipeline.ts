/**
 * Discovery v2 golden-pipeline helpers — pure + tested. Wiring a discovered lead into the Graph,
 * a task, or a decision must be deterministic and never fabricate data, so the row-shaping logic
 * lives here (the route just runs the DB writes with these payloads).
 */

/** Domain-or-name dedupe key — the SAME key used to detect a lead already in the Graph. Lowercased
 *  host (preferred) or normalized name. Mirrors the existing save-batch logic so single + batch
 *  save dedupe identically. */
export function graphDedupeKey(name?: string | null, website?: string | null, source_url?: string | null): string {
  const domainOf = (w?: string | null, s?: string | null): string => {
    const u = (w || s || "").trim();
    if (!u) return "";
    try { return new URL(u.startsWith("http") ? u : `https://${u}`).host.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
  };
  return domainOf(website, source_url) || (name ?? "").trim().toLowerCase();
}

export interface LeadTaskInput {
  workspaceId: string; userId: string; name: string;
  node_id?: string | null; title?: string; assignee_id?: string | null; due_date?: string | null;
  priority?: "low" | "medium" | "high" | "urgent"; source_url?: string | null;
}

/** Build the tasks-insert row for a "follow up on this lead" task. Assignee defaults to the creator. */
export function buildLeadTask(o: LeadTaskInput): Record<string, unknown> {
  return {
    workspace_id: o.workspaceId,
    title: (o.title && o.title.trim()) || `Follow up on ${o.name}`,
    assignee_id: o.assignee_id ?? o.userId,
    completed: false,
    due_date: o.due_date ?? null,
    record_id: o.node_id ?? null,
    priority: o.priority ?? "medium",
    status: "todo",
    created_by: o.userId,
    notes: o.source_url ? `From Discovery · ${o.source_url}` : "From Discovery",
  };
}

export interface LeadDecisionInput {
  workspaceId: string; name: string;
  node_id?: string | null; title?: string; summary?: string | null; recommended_action?: string | null;
  risk_level?: "low" | "medium" | "high"; email?: string | null; phone?: string | null; source_url?: string | null;
}

/** Build the decision_queue-insert row for a discovered lead (agent = discovery). */
export function buildLeadDecision(o: LeadDecisionInput): Record<string, unknown> {
  return {
    workspace_id: o.workspaceId,
    source_type: "discovered_lead",
    source_id: o.node_id ?? null,
    agent_name: "discovery",
    title: (o.title && o.title.trim()) || `Review lead: ${o.name}`,
    summary: o.summary ?? null,
    recommended_action: o.recommended_action ?? "Save this lead to the graph and follow up",
    risk_level: o.risk_level ?? "low",
    evidence: [{
      type: "discovered_lead",
      title: o.name,
      node_id: o.node_id ?? undefined,
      match_reason: o.summary ?? undefined,
      lead: { name: o.name, email: o.email ?? null, phone: o.phone ?? null, source_url: o.source_url ?? null },
    }],
  };
}
