import React from "react";
import { Network, ShieldAlert, Workflow, Receipt, Users } from "lucide-react";
import { LogoMark } from "@/components/logo";
import {
  CheckSquare, FileSignature, UserRound, Box, GitBranch, BarChart2,
  FileText, Mail, Bell, Wallet, Database,
} from "lucide-react";

/**
 * Lightweight, zero-dependency Markdown renderer for assistant replies.
 * The model returns Markdown (**bold**, `code`, ## headings, -/1. lists,
 * [links](url)); rendering it as plain whitespace-pre text showed the raw
 * symbols and looked messy. This handles the common subset cleanly without
 * pulling in react-markdown.
 */
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Split on **bold**, *italic*, `code`, and [text](url) while keeping delimiters.
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={`${keyBase}-${i}`}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={`${keyBase}-${i}`} className="rounded px-1 py-0.5 text-[0.92em]" style={{ background: "var(--surface-hover)" }}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const lm = tok.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (lm) out.push(<a key={`${keyBase}-${i}`} href={lm[2]} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--accent)" }}>{lm[1]}</a>);
    } else out.push(<em key={`${keyBase}-${i}`}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length; i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = (text ?? "").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`l-${blocks.length}`} className={list.ordered ? "list-decimal pl-5 space-y-0.5" : "list-disc pl-5 space-y-0.5"}>
        {list.items.map((it, j) => <li key={j}>{renderInline(it, `li-${blocks.length}-${j}`)}</li>)}
      </Tag>
    );
    list = null;
  };
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const num = line.match(/^\s*\d+\.\s+(.*)$/);
    if (h) { flush(); const lvl = (h[1] ?? "#").length; blocks.push(<p key={idx} className="font-semibold mt-2 mb-0.5" style={{ fontSize: lvl === 1 ? "1.05em" : "1em" }}>{renderInline(h[2] ?? "", `h-${idx}`)}</p>); }
    else if (bullet) { if (!list || list.ordered) { flush(); list = { ordered: false, items: [] }; } list.items.push(bullet[1] ?? ""); }
    else if (num) { if (!list || !list.ordered) { flush(); list = { ordered: true, items: [] }; } list.items.push(num[1] ?? ""); }
    else if (line === "") { flush(); }
    else { flush(); blocks.push(<p key={idx} className="my-0.5">{renderInline(line, `p-${idx}`)}</p>); }
  });
  flush();
  return <div className="space-y-0.5">{blocks}</div>;
}

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
/** Resolve a real in-app route for a source so its card is clickable. Routes
 *  match App.tsx: records → /objects/:type/:id, reports → /reports/:id,
 *  invoices → /finance/invoices/:id, tasks → /tasks (no per-task route). */
function hrefForSource(s: BackendSourceMeta): string | undefined {
  const type = s.type === "related_object" ? "record" : s.type;
  if (type === "report" && s.node_id) return `/reports/${s.node_id}`;
  if ((type === "invoice" || type === "finance") && s.node_id) return `/finance/invoices/${s.node_id}`;
  if (type === "task") return `/tasks`;
  // Decisions live in the dedicated Decision Queue page — not the node graph
  // (/objects/decision/<id> is empty) and not /approvals (that's finance
  // credit-note approvals).
  if (type === "decision" || s.object_type === "decision") return `/decisions`;
  // Workflows live in the real Automations builder, not the raw graph view.
  if ((type === "workflow" || s.object_type === "automation") && s.node_id) return `/automations/workflows/${s.node_id}`;
  if (s.object_type && s.node_id) return `/objects/${s.object_type}/${s.node_id}`;
  return undefined;
}

export function mapBackendSources(raw: BackendSourceMeta[] | undefined): SourceCardData[] {
  if (!raw?.length) return [];
  return raw.map(s => ({
    type: (s.type === "related_object" ? "record" : s.type) as SourceType,
    title: s.title,
    timestamp: s.timestamp,
    relevance: s.relationship ?? s.match_reason,
    href: hrefForSource(s),
  }));
}

export function SourceCard({ source }: { source: SourceCardData }) {
  // Defensive fallback — an unrecognized source.type (e.g. a new evidence
  // kind added on the backend before the frontend's SourceType union is
  // updated) must never crash the render tree. Database is a neutral
  // generic-record icon, used only when the real type isn't mapped yet.
  const Icon = SOURCE_ICON[source.type] ?? Database;
  const clickable = Boolean(source.href);
  // Open the record in a NEW TAB so the chat thread is preserved — the user
  // just closes the tab to return to the exact same conversation.
  const open = () => { if (source.href) window.open(source.href, "_blank", "noopener"); };
  return (
    <div
      onClick={clickable ? open : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter") open(); } : undefined}
      className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${clickable ? "cursor-pointer hover:bg-[var(--surface-hover)]" : ""}`}
      style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}
      onMouseEnter={clickable ? e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; } : undefined}
      onMouseLeave={clickable ? e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-soft)"; } : undefined}
      title={clickable ? "Open record in new tab" : undefined}
    >
      <Icon size={12} className="shrink-0" style={{ color: "var(--accent)" }}/>
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
    </div>
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
        <LogoMark size={10} style={hasSources ? { color: "var(--accent)" } : undefined}/>
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
