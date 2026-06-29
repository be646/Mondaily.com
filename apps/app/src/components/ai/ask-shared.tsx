import React from "react";
import { Network, ShieldAlert, Workflow, Receipt, Users } from "lucide-react";
import { LogoMark } from "@/components/logo";
import {
  CheckSquare, FileSignature, UserRound, Box, GitBranch, BarChart2,
  FileText, Mail, Bell, Wallet, Database, ArrowUpRight,
} from "lucide-react";

/**
 * Lightweight, zero-dependency Markdown renderer for assistant replies.
 * The model returns Markdown (**bold**, `code`, ## headings, -/1. lists,
 * [links](url)); rendering it as plain whitespace-pre text showed the raw
 * symbols and looked messy. This handles the common subset cleanly without
 * pulling in react-markdown.
 */
export type EntityLink = { title: string; href: string };

/** Wrap occurrences of known record titles inside a plain-text segment with a
 *  clickable deep-link — so records mentioned in the answer (and in table cells)
 *  are clickable inline, not just in the footer list. Longest titles match first
 *  so "Acme Corp" isn't shadowed by "Acme". */
function linkifyPlain(seg: string, links: EntityLink[] | undefined, keyBase: string): React.ReactNode[] {
  if (!seg || !links || links.length === 0) return [seg];
  const cands = links.filter(l => l.href && l.title && l.title.trim().length >= 3)
    .sort((a, b) => b.title.length - a.title.length);
  if (cands.length === 0) return [seg];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${cands.map(l => esc(l.title)).join("|")})`, "g");
  const parts: React.ReactNode[] = [];
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(seg)) !== null) {
    if (m.index > last) parts.push(seg.slice(last, m.index));
    const matched = m[0];
    const link = cands.find(l => l.title === matched);
    if (link) parts.push(
      <a key={`${keyBase}-el-${i}`} href={link.href} target="_blank" rel="noreferrer"
        onClick={e => { e.preventDefault(); window.open(link.href, "_blank", "noopener"); }}
        className="underline decoration-dotted underline-offset-2 transition-colors hover:decoration-solid"
        style={{ color: "var(--accent)" }} title="Open record in new tab">{matched}</a>
    );
    else parts.push(matched);
    last = m.index + matched.length; i++;
  }
  if (last < seg.length) parts.push(seg.slice(last));
  return parts;
}

function renderInline(text: string, keyBase: string, links?: EntityLink[]): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Split on **bold**, *italic*, `code`, and [text](url) while keeping delimiters.
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(...linkifyPlain(text.slice(last, m.index), links, `${keyBase}-${i}`));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={`${keyBase}-${i}`}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={`${keyBase}-${i}`} className="rounded px-1 py-0.5 text-[0.92em]" style={{ background: "var(--surface-hover)" }}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const lm = tok.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (lm) out.push(<a key={`${keyBase}-${i}`} href={lm[2]} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--accent)" }}>{lm[1]}</a>);
    } else out.push(<em key={`${keyBase}-${i}`}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length; i++;
  }
  if (last < text.length) out.push(...linkifyPlain(text.slice(last), links, `${keyBase}-end`));
  return out;
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (l: string) => l.includes("-") && /^\s*\|?[\s:|-]+\|?\s*$/.test(l);
const tableCells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());

export function Markdown({ text, links }: { text: string; links?: EntityLink[] }) {
  const lines = (text ?? "").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`l-${blocks.length}`} className={list.ordered ? "list-decimal pl-5 space-y-0.5" : "list-disc pl-5 space-y-0.5"}>
        {list.items.map((it, j) => <li key={j}>{renderInline(it, `li-${blocks.length}-${j}`, links)}</li>)}
      </Tag>
    );
    list = null;
  };
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx] ?? "";
    const line = raw.trimEnd();

    // ── Tables: header row + separator + body → a clean, horizontally-scrollable
    //    bordered container (never raw pipe text). ──
    if (isTableRow(line) && isTableSep(lines[idx + 1] ?? "")) {
      flush();
      const header = tableCells(line);
      const rows: string[][] = [];
      let j = idx + 2;
      while (j < lines.length && isTableRow(lines[j] ?? "")) { rows.push(tableCells(lines[j] ?? "")); j++; }
      // Per-column numeric detection: if most body cells in a column are numeric
      // (currency/percent/counts), right-align it — premium dashboard convention.
      const isNumeric = (s: string) => /^[$€£]?\s*[-+]?[\d,]+(\.\d+)?\s*%?$/.test(s.trim());
      const numericCol = header.map((_h, ci) => {
        const vals = rows.map(r => (r[ci] ?? "").trim()).filter(Boolean);
        return vals.length > 0 && vals.filter(isNumeric).length >= Math.ceil(vals.length / 2);
      });
      blocks.push(
        <div key={`t-${idx}`} className="my-2 overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border-soft)" }}>
          <table className="w-full border-collapse text-left text-[12.5px]">
            <thead>
              <tr style={{ background: "var(--surface-card-2)" }}>
                {header.map((hc, i) => (
                  <th key={i} className={`whitespace-nowrap px-3 py-2 font-medium ${numericCol[i] ? "text-right tabular-nums" : ""}`} style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border-soft)" }}>{renderInline(hc, `th-${idx}-${i}`, links)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {header.map((_h, ci) => (
                    <td key={ci} className={`px-3 py-1.5 ${numericCol[ci] ? "whitespace-nowrap text-right tabular-nums" : "break-words"}`} style={{ borderTop: "1px solid var(--border-soft)", color: "var(--text-secondary)" }}>{renderInline(r[ci] ?? "", `td-${idx}-${ri}-${ci}`, links)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      idx = j - 1;
      continue;
    }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const num = line.match(/^\s*\d+\.\s+(.*)$/);
    if (h) { flush(); const lvl = (h[1] ?? "#").length; blocks.push(<p key={idx} className="font-semibold mt-2 mb-0.5" style={{ fontSize: lvl === 1 ? "1.05em" : "1em" }}>{renderInline(h[2] ?? "", `h-${idx}`, links)}</p>); }
    else if (bullet) { if (!list || list.ordered) { flush(); list = { ordered: false, items: [] }; } list.items.push(bullet[1] ?? ""); }
    else if (num) { if (!list || !list.ordered) { flush(); list = { ordered: true, items: [] }; } list.items.push(num[1] ?? ""); }
    else if (line === "") { flush(); }
    else { flush(); blocks.push(<p key={idx} className="my-0.5">{renderInline(line, `p-${idx}`, links)}</p>); }
  }
  flush();
  return <div className="space-y-0.5">{blocks}</div>;
}

/**
 * Split-token telemetry footer — faint monospace ledger of the real Cerebras
 * usage frame: Thinking (reasoning) · Generation · Total. Renders nothing if no
 * usage was reported.
 */
export function TokenLedger({ usage }: { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; reasoning_tokens?: number } | null }) {
  if (!usage) return null;
  const total = usage.total_tokens ?? 0;
  if (total === 0) return null;
  const thinking = usage.reasoning_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  const generation = Math.max(0, completion - thinking);
  const input = usage.prompt_tokens ?? Math.max(0, total - completion);
  return (
    <div className="mt-1.5 font-mono text-[10.5px] tracking-tight" style={{ color: "var(--text-faint)" }} title="Input = system prompt + your message + tool data the model reads; Total = Input + Thinking + Generation">
      Input: {input.toLocaleString()} · Thinking: {thinking.toLocaleString()} · Generation: {generation.toLocaleString()} · Total: {total.toLocaleString()} tokens
    </div>
  );
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
  // Deep-link straight to the focused task (matches resolveNotificationLink) rather
  // than the broad list view.
  if (type === "task") return s.node_id ? `/tasks?id=${s.node_id}` : `/tasks`;
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

/** A single clean clickable LIST ROW for a referenced record (not a boxed card).
 *  Icon · name · type · → — full width, divider between rows, subtle hover. */
export function SourceCard({ source, divider }: { source: SourceCardData; divider?: boolean }) {
  // Defensive fallback — an unrecognized source.type must never crash the tree.
  const Icon = SOURCE_ICON[source.type] ?? Database;
  const clickable = Boolean(source.href);
  // Open in a NEW TAB so the chat thread is preserved.
  const open = () => { if (source.href) window.open(source.href, "_blank", "noopener"); };
  return (
    <div
      onClick={clickable ? open : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter") open(); } : undefined}
      className={`group flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${clickable ? "cursor-pointer hover:bg-[var(--surface-hover)]" : ""}`}
      style={divider ? { borderTop: "1px solid var(--border-soft)" } : undefined}
      title={clickable ? "Open record in new tab" : undefined}
    >
      <Icon size={14} className="shrink-0" style={{ color: "var(--accent)" }}/>
      <span className="truncate text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{source.title}</span>
      <span className="shrink-0 rounded px-1.5 py-px text-[9px] font-medium uppercase tracking-wide" style={{ background: "var(--surface-hover)", color: "var(--text-muted)" }}>{source.type}</span>
      {(source.relevance || source.timestamp) && (
        <span className="ml-auto hidden truncate text-[10px] sm:inline" style={{ color: "var(--text-faint)" }}>{[source.relevance, source.timestamp].filter(Boolean).join(" · ")}</span>
      )}
      {clickable && (
        <ArrowUpRight size={13} className={`${(source.relevance || source.timestamp) ? "" : "ml-auto"} shrink-0 opacity-40 transition-opacity group-hover:opacity-100`} style={{ color: "var(--accent)" }}/>
      )}
    </div>
  );
}

/** Build the inline entity-link map from a response's sources (title → deep-link),
 *  so record names mentioned in the answer/tables become clickable. */
export function sourcesToLinks(sources: SourceCardData[] | undefined): EntityLink[] {
  if (!sources) return [];
  const seen = new Set<string>();
  const out: EntityLink[] = [];
  for (const s of sources) {
    if (s.href && s.title && !seen.has(s.title)) { seen.add(s.title); out.push({ title: s.title, href: s.href }); }
  }
  return out;
}

/** Wraps referenced records into ONE clean bordered list (not scattered boxes). */
export function SourceList({ sources }: { sources: SourceCardData[] }) {
  if (!sources.length) return null;
  return (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      {sources.map((s, i) => <SourceCard key={i} source={s} divider={i > 0}/>)}
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
