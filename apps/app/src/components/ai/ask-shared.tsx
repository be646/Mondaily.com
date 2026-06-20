import { Network, ShieldAlert, Workflow, Receipt, Users, Sparkles } from "lucide-react";
import {
  CheckSquare, FileSignature, UserRound, Box, GitBranch, BarChart2,
  FileText, Mail, Bell, Wallet,
} from "lucide-react";

/**
 * Shared primitives for the "Ask the Workspace Graph" experience — used by
 * the full Ask Mondaily page, the inline Ask AI widget, and (in future) any
 * other surface that talks to /api/v1/ask.
 *
 * Important: the backend /api/v1/ask endpoint currently returns only
 * { reply, suggestions, thread_id } — no sources, no confidence, no agent
 * metadata. Everything here is built to degrade honestly when that data
 * isn't present, rather than inventing it. Agent attribution is inferred
 * client-side from the prompt text, kept modest, and never presented as
 * something the backend confirmed.
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

/** Modest, keyword-based inference — falls back to the general Graph Agent. */
export function inferAgentHandoff(promptText: string): AgentHandoff {
  for (const rule of AGENT_RULES) {
    if (rule.test.test(promptText)) return rule.agent;
  }
  return { name: "Graph Agent", icon: Network };
}

// ── Source cards ──────────────────────────────────────────────────────────
export type SourceType =
  | "task" | "invoice" | "contact" | "asset" | "workflow"
  | "report" | "note" | "email" | "notification" | "finance";

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
};

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
