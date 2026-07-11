/**
 * Phase 2A — source-backed workspace memory RECALL (shadow mode).
 *
 * A pure, READ-ONLY retrieval layer over data that ALREADY exists (graph nodes, tasks, decisions,
 * support tickets, and — only for the asking user — their own messages). It stores nothing, injects
 * nothing into any prompt, and changes no answer. It simply answers: "what recorded facts in THIS
 * workspace look relevant to this query, and where does each come from?"
 *
 * Guarantees:
 *  - Workspace-scoped: every query filters by workspace_id. Messages are additionally participant-
 *    scoped to the asking user (never another pair's DMs).
 *  - Source-backed: every candidate carries a resolvable {type,id} ref to a real row.
 *  - Untrusted: snippets are DATA (redacted), never instructions — callers must treat them as such.
 *  - Default OFF: gated by the per-workspace flag + an env kill-switch.
 */

import { supabase } from "@mondaily/db/client";
import { redactSecrets } from "./ai-gateway";

export interface MemoryCandidate {
  kind: "record" | "task" | "decision" | "ticket" | "message";
  title: string;
  snippet: string;                       // short, redacted — DATA, not instructions
  source: { type: string; id: string };  // resolvable in-workspace ref
  as_of: string | null;                  // created/updated timestamp (staleness visible)
  score: number;                         // keyword-overlap relevance (transparent, not an LLM score)
}

export interface RecallResult {
  enabled: boolean;
  candidates: MemoryCandidate[];
  candidate_count: number;
  source_count: number;   // distinct source refs
  latency_ms: number;
  scanned: number;        // rows read across all sources (cost transparency)
}

export interface RecallScope {
  userId?: string;                                    // enables participant-scoped message recall
  include?: Array<"record" | "task" | "decision" | "ticket" | "message">;
}

/** Per-workspace flag + env kill-switch. Default OFF — memory recall does nothing until enabled. */
export async function memoryEnabled(workspaceId: string): Promise<boolean> {
  if (process.env.MEMORY_RECALL_DISABLED === "1") return false;   // hard kill-switch
  const { data } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle();
  return (data?.settings as { memory_enabled?: boolean } | null)?.memory_enabled === true;
}

const keywordsOf = (q: string): string[] =>
  [...new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))].slice(0, 8);

const textBlob = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" ");
const scoreOf = (blob: string, kws: string[]): number => {
  const b = blob.toLowerCase();
  return kws.reduce((s, k) => (b.includes(k) ? s + 1 : s), 0);
};
const snippet = (s: string) => redactSecrets(s.replace(/\s+/g, " ").trim()).slice(0, 160);
const PER_SOURCE = 5;
const TOTAL_CAP = 25;
const FETCH = 60;   // bounded scan per source

/**
 * Assemble source-backed recall candidates for a query. Returns {enabled:false} + empties when the
 * workspace flag is off — so callers can run it unconditionally and it stays a no-op until enabled.
 */
export async function recallContext(workspaceId: string, query: string, scope: RecallScope = {}): Promise<RecallResult> {
  const t0 = Date.now();
  const enabled = await memoryEnabled(workspaceId);
  const empty: RecallResult = { enabled, candidates: [], candidate_count: 0, source_count: 0, latency_ms: Date.now() - t0, scanned: 0 };
  const kws = keywordsOf(query);
  if (!enabled || kws.length === 0) return { ...empty, latency_ms: Date.now() - t0 };

  const want = (k: NonNullable<RecallScope["include"]>[number]) => !scope.include || scope.include.includes(k);
  const out: MemoryCandidate[] = [];
  let scanned = 0;
  const top = (rows: MemoryCandidate[]) => rows.filter((c) => c.score > 0).sort((a, b) => b.score - a.score).slice(0, PER_SOURCE);

  // ── Graph records (nodes) — exclude system object types; label the rest as records ──
  if (want("record") || want("ticket")) {
    const { data: nodes } = await supabase
      .from("nodes").select("id, object_type, data, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }).limit(FETCH * 2);
    scanned += (nodes ?? []).length;
    const records: MemoryCandidate[] = [];
    const tickets: MemoryCandidate[] = [];
    for (const n of nodes ?? []) {
      const d = (n.data ?? {}) as Record<string, unknown>;
      const isTicket = n.object_type === "support_ticket";
      const blob = textBlob(String(d.name ?? ""), String(d.title ?? ""), String(d.subject ?? ""), String(d.summary ?? ""), String(d.client_name ?? ""), String(d.message ?? ""), String(d.notes ?? ""));
      const score = scoreOf(blob, kws);
      if (score === 0) continue;
      const cand: MemoryCandidate = {
        kind: isTicket ? "ticket" : "record",
        title: String(d.name ?? d.title ?? d.subject ?? n.object_type ?? "record"),
        snippet: snippet(blob),
        source: { type: isTicket ? "support_ticket" : String(n.object_type ?? "node"), id: String(n.id) },
        as_of: (n.updated_at ?? n.created_at) as string | null,
        score,
      };
      (isTicket ? tickets : records).push(cand);
    }
    if (want("record")) out.push(...top(records));
    if (want("ticket")) out.push(...top(tickets));
  }

  // ── Tasks (open/recent) ──
  if (want("task")) {
    const { data: tasks } = await supabase
      .from("tasks").select("id, title, description, status, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }).limit(FETCH);
    scanned += (tasks ?? []).length;
    out.push(...top((tasks ?? []).map((t) => {
      const blob = textBlob(t.title as string, t.description as string, t.status as string);
      return { kind: "task" as const, title: String(t.title ?? "task"), snippet: snippet(blob), source: { type: "task", id: String(t.id) }, as_of: (t.updated_at ?? t.created_at) as string | null, score: scoreOf(blob, kws) };
    })));
  }

  // ── Related decisions ──
  if (want("decision")) {
    const { data: decisions } = await supabase
      .from("decision_queue").select("id, title, summary, status, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }).limit(FETCH);
    scanned += (decisions ?? []).length;
    out.push(...top((decisions ?? []).map((dq) => {
      const blob = textBlob(dq.title as string, dq.summary as string);
      return { kind: "decision" as const, title: String(dq.title ?? "decision"), snippet: snippet(blob), source: { type: "decision", id: String(dq.id) }, as_of: dq.created_at as string | null, score: scoreOf(blob, kws) };
    })));
  }

  // ── Recent messages — ONLY the asking user's own conversations (participant-scoped) ──
  if (want("message") && scope.userId) {
    const { data: msgs } = await supabase
      .from("internal_messages").select("id, body, sender_id, recipient_id, created_at")
      .eq("workspace_id", workspaceId)
      .or(`sender_id.eq.${scope.userId},recipient_id.eq.${scope.userId}`)
      .order("created_at", { ascending: false }).limit(FETCH);
    scanned += (msgs ?? []).length;
    out.push(...top((msgs ?? []).map((m) => {
      const blob = textBlob(m.body as string);
      return { kind: "message" as const, title: "message", snippet: snippet(blob), source: { type: "message", id: String(m.id) }, as_of: m.created_at as string | null, score: scoreOf(blob, kws) };
    })));
  }

  const candidates = out.sort((a, b) => b.score - a.score).slice(0, TOTAL_CAP);
  const source_count = new Set(candidates.map((c) => `${c.source.type}:${c.source.id}`)).size;
  return { enabled: true, candidates, candidate_count: candidates.length, source_count, latency_ms: Date.now() - t0, scanned };
}
