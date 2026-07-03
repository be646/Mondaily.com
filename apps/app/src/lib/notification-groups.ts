// Shared notification grouping — the ONE source of truth for the five bell/page groups, the actor
// (who caused it) and action (what you can do). Both the NotificationsBell and the full
// NotificationsPage import this so they always group identically. Category + source come from the
// API (derived server-side in GET /notifications); this module only presents them.
import { Sparkles, ShieldCheck, MessageSquare, CheckSquare, Settings2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { agentByRaw } from "./agents";

export type NotifCategory = "agent" | "decisions" | "messages" | "tasks" | "system";

export interface NotifSource {
  source_agent?: string; agent_job_id?: string; decision_id?: string;
  task_id?: string; node_id?: string; object_type?: string; route?: string;
}

export interface GroupableNotification {
  id: string; title: string; body?: string; type: string;
  task_id?: string; is_read: boolean; created_at: string;
  metadata?: Record<string, unknown> | null;
  category?: NotifCategory;
  source?: NotifSource;
}

// Display order + heading + icon for each group.
export const CATEGORY_META: { key: NotifCategory; label: string; Icon: LucideIcon }[] = [
  { key: "decisions", label: "Decisions waiting", Icon: ShieldCheck },
  { key: "agent",     label: "Agent findings",    Icon: Sparkles },
  { key: "messages",  label: "Messages",          Icon: MessageSquare },
  { key: "tasks",     label: "Tasks",             Icon: CheckSquare },
  { key: "system",    label: "System & readiness", Icon: Settings2 },
];

/** The action a notification offers — derived from its category (source-backed, never invented). */
export function actionLabel(n: GroupableNotification): string {
  switch (n.category) {
    case "decisions": return "Review in Decision Deck";
    case "tasks":     return "Open task";
    case "messages":  return "Open message";
    case "agent":     return n.source?.node_id ? "View record" : "View";
    default:          return "Open";
  }
}

/** "who caused it" — a real agent name via the canonical registry, when a source_agent is known. */
export function actorLabel(n: GroupableNotification): string | null {
  const slug = n.source?.source_agent;
  if (!slug) return null;
  try { return agentByRaw(slug).name; } catch { return null; }
}

/** Group a flat list into the five categories, in display order, dropping empty groups. */
export function groupByCategory<T extends GroupableNotification>(list: T[]): { key: NotifCategory; label: string; Icon: LucideIcon; items: T[] }[] {
  return CATEGORY_META
    .map(cat => ({ ...cat, items: list.filter(n => (n.category ?? "system") === cat.key) }))
    .filter(g => g.items.length > 0);
}
