import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { type SourceCardData, type SourceType } from "./ask-shared";

/**
 * Decision Queue data layer — the real "agents recommend, humans approve"
 * surface. Every row is a real backend record (packages/api/src/routes/
 * decisions.ts, table `decision_queue`) created by a real signal (overdue
 * invoice, credit note dispute, etc.) — nothing here is fabricated, and
 * confidence is only shown when the backend actually set one. Rendering
 * lives in command-center.tsx's NeedsYouPanel, merged with risk signals
 * and recent activity into one "needs you" zone rather than a separate
 * standalone panel.
 */

export interface DecisionEvidence { type: string; title: string; node_id?: string; object_type?: string; relationship?: string; match_reason?: string; timestamp?: string; }
export interface ExecutionPreview { text: string; side_effect: boolean }
export interface Decision {
  id: string; source_type: string; source_id: string | null; agent_name: string;
  title: string; summary: string | null; recommended_action: string | null;
  risk_level: "low" | "medium" | "high"; confidence: number | null;
  evidence: DecisionEvidence[]; status: string; created_at: string;
  resolved_at?: string | null; resolved_by?: string | null; snoozed_until?: string | null;
  assignee_id?: string | null; assignee_email?: string | null;
  execution_preview?: ExecutionPreview;
  generation_context?: { system_prompt?: string; user_prompt?: string; model_output?: unknown } | null;
}

export const RISK_STYLE: Record<Decision["risk_level"], string> = {
  low: "text-[#5f8169] dark:text-[#5f8169]",
  medium: "text-[#97824f] dark:text-[#97824f]",
  high: "text-[#9c6b72] dark:text-[#9c6b72]",
};

// Every real SourceType the rest of the app knows how to render. Anything
// outside this set (e.g. "prospecting_candidate", a decision-queue-only
// evidence kind) is normalized to "record" below — this is what crashed
// the page before: an unmapped type reached SourceCard with no icon for it.
const KNOWN_SOURCE_TYPES = new Set<SourceType>([
  "task", "invoice", "contact", "asset", "workflow",
  "report", "note", "email", "notification", "finance", "record", "decision",
]);

export function mapEvidence(raw: DecisionEvidence[]): SourceCardData[] {
  return raw.map(e => {
    const normalized = e.type === "related_object" ? "record" : e.type;
    return {
      type: (KNOWN_SOURCE_TYPES.has(normalized as SourceType) ? normalized : "record") as SourceType,
      title: e.title,
      timestamp: e.timestamp,
      relevance: e.relationship ?? e.match_reason,
      href: e.object_type && e.node_id ? `/objects/${e.object_type}/${e.node_id}` : undefined,
    };
  });
}

export function useDecisionQueue() {
  return useQuery({
    queryKey: ["decisions", "pending"],
    queryFn: () => apiClient.get<Decision[]>("/decisions?status=pending"),
    staleTime: 30_000,
    refetchInterval: 20_000, // live: new agent decisions surface without a manual refresh
    // The decision_queue table only exists once migration 0016 has been
    // applied — if it 404s/500s on a workspace that hasn't run it yet,
    // treat that as "no decisions" rather than breaking the page.
    retry: false,
  });
}

/** Cockpit feed — open lanes (pending + snoozed) plus a bounded window of recently resolved. */
export function useCockpitDecisions() {
  return useQuery({
    queryKey: ["decisions", "cockpit"],
    queryFn: () => apiClient.get<Decision[]>("/decisions?view=cockpit"),
    staleTime: 20_000,
    refetchInterval: 20_000,
    // One retry so a single transient blip recovers instead of dropping straight to an error state;
    // the api-client 45s timeout still guarantees a hung request eventually rejects (no infinite skeleton).
    retry: 1,
    retryDelay: 800,
  });
}

