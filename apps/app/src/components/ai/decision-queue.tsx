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
export interface Decision {
  id: string; source_type: string; source_id: string | null; agent_name: string;
  title: string; summary: string | null; recommended_action: string | null;
  risk_level: "low" | "medium" | "high"; confidence: number | null;
  evidence: DecisionEvidence[]; status: string; created_at: string;
}

export const RISK_STYLE: Record<Decision["risk_level"], string> = {
  low: "text-emerald-600 dark:text-emerald-400",
  medium: "text-amber-600 dark:text-amber-400",
  high: "text-rose-600 dark:text-rose-400",
};

export function mapEvidence(raw: DecisionEvidence[]): SourceCardData[] {
  return raw.map(e => ({
    type: (e.type === "related_object" ? "record" : e.type) as SourceType,
    title: e.title,
    timestamp: e.timestamp,
    relevance: e.relationship ?? e.match_reason,
    href: e.object_type && e.node_id ? `/objects/${e.object_type}/${e.node_id}` : undefined,
  }));
}

export function useDecisionQueue() {
  return useQuery({
    queryKey: ["decisions", "pending"],
    queryFn: () => apiClient.get<Decision[]>("/decisions?status=pending"),
    staleTime: 30_000,
    // The decision_queue table only exists once migration 0016 has been
    // applied — if it 404s/500s on a workspace that hasn't run it yet,
    // treat that as "no decisions" rather than breaking the page.
    retry: false,
  });
}

