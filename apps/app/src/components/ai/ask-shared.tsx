import { Network, ShieldAlert, Workflow, Receipt, Users, Sparkles } from "lucide-react";
import {
  CheckSquare, FileSignature, UserRound, Box, GitBranch, BarChart2,
  FileText, Mail, Bell, Wallet, Database,
} from "lucide-react";

/**
 * Shared primitives for the "Ask the Workspace Graph" experience — used by
 * the full Ask Mondaily page, the inline Ask AI widget, and (in future) any
 * other surface that talks to /api/v1/ask.
 *
 * The backend /api/v1/ask endpoint now returns real `sources` whenever a
 * tool call touched workspace data (search_records, list_records,
 * list_tasks, find_related_objects) — see mapBackendSources() below. When a
 * response truly had no tool calls (a pure conversational reply), sources
 * is an empty array and the UI shows an honest "No sources returned" state
 * rather than inventing one. Agent attribution is still inferred
 * client-side from the prompt text — modest, never presented as something
 * the backend confirmed.
 */

// ── Reasoning steps — shown while waiting on a response ─────────────────────
export const GRAPH_REASONING_STEPS = [
  "Reading workspace graph",
  "Finding related objects",
  "Checking recent signals",
  "Preparing answer",
];

// ── Agent handoff — inferred lightly from prompt keywords, never fabricated
// as a backend-confirmed fact ──────────────────────────────────────────────
export interface AgentHandoff {
  name: string;
  icon: React.ElementType;
}

const AGENT_RULES: { test: RegExp; agent: AgentHandoff }[] = [
  { test: /\b(invoice|payment|finance|revenue|expense|quote|credit note|cash|overdue)\b/i,
    agent: { name: "Finance Agent", icon: Receipt } },
  { test: /\b(contact|person|people|relationship|company|client|lead)\b/i,
    agent: { name: "Relationship Agent", icon: Users } },
  { test: /\b(workflow|automation|sequence|trigger|blocked)\b/i,
    agent: { name: "Workflow Agent", icon: Workflow } },
  { test: /\b(report|dashboard|chart|metric|forecast|trend)\b/i,
    agent: { name: "Insights Agent", icon: BarChart2 } },
  { test: /\b(task|follow.?up|to.?do|review|decision)\b/i,
    agent: { name: "Operations Agent", icon: CheckSquare } },
  { test: /\b(risk|alert|stale|overdue|signal)\b/i,
    agent: { name: "Signal Agent", icon: ShieldAlert } },
];

const NAMED_AGENTS: Record<string, AgentHandoff> = {
  operations: { name: "Operations Agent", icon: CheckSquare },
  relationship: { name: "Relationship Agent", icon: Users },
  finance: { name: "Finance Agent", icon: Receipt },
  signal: { name: "Signal Agent", icon: ShieldAlert },
  workflow: { name: "Workflow Agent", icon: Workflow },
  insights: { name: "Insights Agent", icon: BarChart2 },
};

/** Modest, keyword-based inference — falls back to the general Graph Agent.
 * If the prompt explicitly names an agent ("Ask Operations Agent: ..."),
 * that takes priority over keyword guessing — otherwise a prompt like
 * "Ask Operations Agent: what's overdue?" gets mislabeled Finance Agent
 * just because "overdue" matches the Finance keyword rule first. */
export function inferAgentHandoff(promptText: string): AgentHandoff {
  const named = promptText.match(/\bAsk (\w+) Agent\b/i);
  if (named) {
    const match = NAMED_AGENTS[named[1]!.toLowerCase()];
    if (match) return match;
  }
  for (const rule of AGENT_RULES) {
    if (rule.test.test(promptText)) return rule.agent;
  }
  return { name: "Graph Agent", icon: Network };
}

// ── Source cards ──────────────────────────────────────────────────────────
export type SourceType =
  | "task" | "invoice" | "contact" | "asset" | "workflow"
  | "report" | "note" | "email" | "notification" | "finance" | "record" | "decision";

export interface SourceCardData {
  type: SourceType;
  title: string;
  timestamp?: string;
  relevance?: string;
  href?: string;
}

export const SOURCE_ICON: Record<SourceType, React.ElementType> = {
  task: CheckSquare,
  invoice: FileSignature,
  contact: UserRound,
  asset: Box,
  workflow: GitBranch,
  report: BarChart2,
  note: FileText,
  email: Mail,
  notification: Bell,
  finance: Wallet,
  record: Database,
  decision: ShieldAlert,
};

/** Raw source shape returned by POST /api/v1/ask (see SourceMeta in ask.ts). */
export interface BackendSourceMeta {
  type: string;
  title: string;
  node_id?: string;
  object_type?: string;
  relationship?: string;
  match_reason?: string;
  timestamp?: string;
}

/** Maps the backend's real tool-call sources into frontend SourceCardData.
 * Never fabricates a source — only called with what the backend actually
 * returned for this specific response. */
export function mapBackendSources(raw: BackendSourceMeta[] | undefined): SourceCardData[] {
  if (!raw?.length) return [];
  return raw.map(s => ({
    type: (s.type === "related_object" ? "record" : s.type) as SourceType,
    title: s.title,
    timestamp: s.timestamp,
    relevance: s.relationship ?? s.match_reason,
    href: s.object_type && s.node_id ? `/objects/${s.object_type}/${s.node_id}` : undefined,
  }));
}

export function SourceCard({ source }: { source: SourceCardData }) {
  const Icon = SOURCE_ICON[source.type];
  const Tag = source.href ? "a" : "div";
  return (
    <Tag
      {...(source.href ? { href: source.href } : {})}
      className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors"
      style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}
    >
      <Icon size={12} className="shrink-0 text-cyan-600 dark:text-cyan-400"/>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[11.5px] font-medium" style={{ color: "var(--text-primary)" }}>{source.title}</span>
          <span className="shrink-0 rounded-full px-1.5 py-px text-[9px] uppercase tracking-wide" style={{ background: "var(--surface-hover)", color: "var(--text-faint)" }}>
            {source.type}
          </span>
        </div>
        {(source.timestamp || source.relevance) && (
          <div className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            {[source.relevance, source.timestamp].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
    </Tag>
  );
}

/** Evidence strip — sources checked / confidence / scope. Never fabricates
 * a confidence value: shows "Source-backed" only when sources exist,
 * otherwise an honest "No sources returned". */
export function EvidenceStrip({ sources }: { sources: SourceCardData[] }) {
  const hasSources = sources.length > 0;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px]" style={{ color: "var(--text-faint)" }}>
      <span className="flex items-center gap-1">
        <Sparkles size={10} className={hasSources ? "text-cyan-600 dark:text-cyan-400" : ""}/>
        {hasSources ? "Source-backed" : "No sources returned"}
      </span>
      <span>·</span>
      <span>Scope: this workspace only</span>
    </div>
  );
}

// ── Friendly error mapping ───────────────────────────────────────────────
export function friendlyAskError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("load failed")) {
    return "Ask Mondaily could not reach the workspace graph. Check your connection and try again.";
  }
  if (lower.includes("no workspace") || lower.includes("workspace not found") || lower.includes("workspaceid")) {
    return "No workspace was found. Finish onboarding or select a workspace.";
  }
  if (lower.includes("api key") || lower.includes("503") || lower.includes("unavailable") || lower.includes("ai error")) {
    return "The AI service is unavailable right now. Please try again shortly.";
  }
  if (import.meta.env.DEV) return message;
  return "Something went wrong reaching the workspace graph. Please try again.";
}
