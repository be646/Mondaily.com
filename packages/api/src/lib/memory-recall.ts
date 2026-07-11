/**
 * Phase 2A/2B/2B.5 — source-backed workspace memory RECALL (shadow-capable, Ask-only injection).
 *
 * READ-ONLY retrieval over data that ALREADY exists (graph nodes, tasks, decisions, support
 * tickets, and — only for the asking user — their own messages). Stores nothing, adds no vectors,
 * no GPU, no durable summaries. It ranks recorded facts by relevance to a query.
 *
 * 2B.5 ranking = keyword-overlap × type-weight(intent) × gentle-recency, then title-dedup +
 * category-diversity so the top-N aren't near-duplicates or a pile of low-signal emails. All
 * transparent (per-candidate breakdown surfaced in the admin shadow preview only).
 *
 * Guarantees unchanged: workspace-scoped every query; messages participant-scoped; every candidate
 * carries a resolvable source ref; snippets redacted + treated as untrusted data; default OFF.
 */

import { supabase } from "@mondaily/db/client";
import { redactSecrets } from "./ai-gateway";

export interface ScoreBreakdown { keyword: number; type_weight: number; recency: number; final: number }
export interface MemoryCandidate {
  kind: "record" | "task" | "decision" | "ticket" | "message";
  category: string;                       // ranking category: record|task|decision|ticket|email|message
  title: string;
  snippet: string;                        // short, redacted — DATA, not instructions
  source: { type: string; id: string };   // resolvable in-workspace ref
  as_of: string | null;                   // created/updated timestamp (staleness visible)
  score: number;                          // final composite score
  breakdown: ScoreBreakdown;              // transparent scoring (admin shadow preview only)
  injected: boolean;                      // whether this candidate is actually injected into Ask
  reject_reason?: string;                 // why NOT injected (shown in shadow preview; still listed)
}

export interface RecallResult {
  enabled: boolean;
  candidates: MemoryCandidate[];
  candidate_count: number;
  injected_count: number;                 // how many of the top would be injected (≤ INJECT_CAP)
  source_count: number;                   // distinct source refs
  by_kind: Record<string, number>;        // category distribution across candidates
  intent: string[];                       // detected query intents
  latency_ms: number;
  scanned: number;                        // rows read across all sources (cost transparency)
}

export interface RecallScope {
  userId?: string;
  include?: Array<"record" | "task" | "decision" | "ticket" | "message">;
}

/** The hard injection cap Ask uses (top eligible candidates, ≤ INJECT_CAP). */
export const INJECT_CAP = 3;
/** Min composite score to be eligible for INJECTION (candidates below still show in shadow). */
export const MIN_INJECT_SCORE = 0.8;
/** Query explicitly about email/messages/conversation — the only case low-signal emails may inject. */
const EMAIL_INTENT_RE = /\b(e-?mails?|messages?|conversations?|sent|reply|replied|replies|wrote|writing|inbox|outbox|correspond(?:ence)?|dms?|threads?)\b/i;

/** Per-workspace flag + env kill-switch. Default OFF — recall does nothing until enabled. */
export async function memoryEnabled(workspaceId: string): Promise<boolean> {
  if (process.env.MEMORY_RECALL_DISABLED === "1") return false;   // hard kill-switch
  const { data } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle();
  return (data?.settings as { memory_enabled?: boolean } | null)?.memory_enabled === true;
}

// ── Query-intent detection ─────────────────────────────────────────────────────
const ISSUE_RE = /\b(issue|issues|error|errors|not\s+working|doesn'?t\s+work|connectivity|connection|bug|bugs|problem|problems|fail(?:ed|ing|ure)?|slow|down|broken|outage|crash(?:ed)?|timeout|timing\s+out|can'?t|cannot|unable|502|500|503)\b/i;
const FOLLOWUP_RE = /\b(follow.?up|task|tasks|due|overdue|deadline|remind(?:er)?|assign(?:ed)?|to.?do|pending|next\s+step)\b/i;
const ENTITY_RE = /\b(client|clients|company|companies|contact|contacts|deal|deals|account|accounts|customer|customers|person|people|organi[sz]ation|vendor|supplier)\b/i;
function detectIntent(q: string): string[] {
  const i: string[] = [];
  if (ISSUE_RE.test(q)) i.push("issue");
  if (FOLLOWUP_RE.test(q)) i.push("followup");
  if (ENTITY_RE.test(q)) i.push("entity");
  return i;
}

// ── Category + weighting ───────────────────────────────────────────────────────
// email_outbox / notifications are lower-signal than authoritative records/decisions/tickets.
const EMAILISH = new Set(["email_outbox", "email_thread", "email", "outbound_email", "notification"]);
function categoryOf(kind: MemoryCandidate["kind"], sourceType: string): string {
  if (kind === "decision") return "decision";
  if (kind === "ticket") return "ticket";
  if (kind === "task") return "task";
  if (kind === "message") return "message";
  return EMAILISH.has(sourceType) ? "email" : "record";
}

const BASE_WEIGHT: Record<string, number> = { decision: 1, ticket: 1, record: 1, task: 0.9, email: 0.55, message: 0.55 };
function typeWeight(category: string, intent: string[]): number {
  let w = BASE_WEIGHT[category] ?? 0.8;
  if (intent.includes("issue"))    { if (category === "ticket") w *= 1.7; if (category === "decision") w *= 1.4; }
  if (intent.includes("followup")) { if (category === "task")   w *= 1.6; if (category === "decision") w *= 1.2; }
  if (intent.includes("entity"))   { if (category === "record") w *= 1.4; }
  return w;
}

// Gentle recency: fresh items get up to +35%, decaying to ~0 over ~months. NEVER hard-drops old
// items — a strongly-keyword-relevant old record still outranks a weak fresh one.
function recencyFactor(asOf: string | null): number {
  if (!asOf) return 1;
  const t = new Date(asOf).getTime();
  if (isNaN(t)) return 1;
  const ageDays = Math.max(0, (Date.now() - t) / 86_400_000);
  return 1 + 0.35 * Math.exp(-ageDays / 30);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const keywordsOf = (q: string): string[] =>
  [...new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))].slice(0, 8);
const textBlob = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" ");
const scoreOf = (blob: string, kws: string[]): number => {
  const b = blob.toLowerCase();
  return kws.reduce((s, k) => (b.includes(k) ? s + 1 : s), 0);
};
const snippet = (s: string) => redactSecrets(s.replace(/\s+/g, " ").trim()).slice(0, 160);
const PER_SOURCE = 12;   // raw candidates kept per source before global re-ranking
const TOTAL_CAP = 25;
const FETCH = 60;        // bounded scan per source

interface RawCand { kind: MemoryCandidate["kind"]; title: string; snippet: string; source: { type: string; id: string }; as_of: string | null; keyword: number }

/**
 * Assemble ranked source-backed recall candidates. {enabled:false} + empties when the flag is off.
 */
export async function recallContext(workspaceId: string, query: string, scope: RecallScope = {}): Promise<RecallResult> {
  const t0 = Date.now();
  const enabled = await memoryEnabled(workspaceId);
  const intent = detectIntent(query);
  const base: RecallResult = { enabled, candidates: [], candidate_count: 0, injected_count: 0, source_count: 0, by_kind: {}, intent, latency_ms: 0, scanned: 0 };
  const kws = keywordsOf(query);
  if (!enabled || kws.length === 0) return { ...base, latency_ms: Date.now() - t0 };

  const want = (k: NonNullable<RecallScope["include"]>[number]) => !scope.include || scope.include.includes(k);
  const raw: RawCand[] = [];
  let scanned = 0;
  const keep = (rows: RawCand[]) => rows.filter((c) => c.keyword > 0).sort((a, b) => b.keyword - a.keyword).slice(0, PER_SOURCE);

  // ── Graph records (nodes) — support tickets vs everything else ──
  if (want("record") || want("ticket")) {
    const { data: nodes } = await supabase
      .from("nodes").select("id, object_type, data, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }).limit(FETCH * 2);
    scanned += (nodes ?? []).length;
    const records: RawCand[] = [];
    const tickets: RawCand[] = [];
    for (const n of nodes ?? []) {
      const d = (n.data ?? {}) as Record<string, unknown>;
      const isTicket = n.object_type === "support_ticket";
      const blob = textBlob(String(d.name ?? ""), String(d.title ?? ""), String(d.subject ?? ""), String(d.summary ?? ""), String(d.client_name ?? ""), String(d.message ?? ""), String(d.notes ?? ""));
      const keyword = scoreOf(blob, kws);
      if (keyword === 0) continue;
      const cand: RawCand = {
        kind: isTicket ? "ticket" : "record",
        title: String(d.name ?? d.title ?? d.subject ?? n.object_type ?? "record"),
        snippet: snippet(blob),
        source: { type: isTicket ? "support_ticket" : String(n.object_type ?? "node"), id: String(n.id) },
        as_of: (n.updated_at ?? n.created_at) as string | null,
        keyword,
      };
      (isTicket ? tickets : records).push(cand);
    }
    if (want("record")) raw.push(...keep(records));
    if (want("ticket")) raw.push(...keep(tickets));
  }

  // ── Tasks ──
  if (want("task")) {
    const { data: tasks } = await supabase
      .from("tasks").select("id, title, description, status, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }).limit(FETCH);
    scanned += (tasks ?? []).length;
    raw.push(...keep((tasks ?? []).map((t) => {
      const blob = textBlob(t.title as string, t.description as string, t.status as string);
      return { kind: "task" as const, title: String(t.title ?? "task"), snippet: snippet(blob), source: { type: "task", id: String(t.id) }, as_of: (t.updated_at ?? t.created_at) as string | null, keyword: scoreOf(blob, kws) };
    })));
  }

  // ── Related decisions ──
  if (want("decision")) {
    const { data: decisions } = await supabase
      .from("decision_queue").select("id, title, summary, status, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }).limit(FETCH);
    scanned += (decisions ?? []).length;
    raw.push(...keep((decisions ?? []).map((dq) => {
      const blob = textBlob(dq.title as string, dq.summary as string);
      return { kind: "decision" as const, title: String(dq.title ?? "decision"), snippet: snippet(blob), source: { type: "decision", id: String(dq.id) }, as_of: dq.created_at as string | null, keyword: scoreOf(blob, kws) };
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
    raw.push(...keep((msgs ?? []).map((m) => {
      const blob = textBlob(m.body as string);
      return { kind: "message" as const, title: "message", snippet: snippet(blob), source: { type: "message", id: String(m.id) }, as_of: m.created_at as string | null, keyword: scoreOf(blob, kws) };
    })));
  }

  // ── Composite scoring: keyword × type-weight(intent) × gentle-recency ──
  const scored: MemoryCandidate[] = raw.map((r) => {
    const category = categoryOf(r.kind, r.source.type);
    const tw = typeWeight(category, intent);
    const rf = recencyFactor(r.as_of);
    const final = r.keyword * tw * rf;
    return { kind: r.kind, category, title: r.title, snippet: r.snippet, source: r.source, as_of: r.as_of, score: final, breakdown: { keyword: r.keyword, type_weight: round2(tw), recency: round2(rf), final: round2(final) }, injected: false };
  });

  // ── Dedup near-duplicates WITHIN a category by normalized title (keep the highest-scoring). Keyed
  //     by category+title so the SAME event across DIFFERENT kinds (e.g. a ticket + a decision named
  //     alike) stays as distinct facts, while several same-subject emails collapse to one. ──
  const byKey = new Map<string, MemoryCandidate>();
  for (const c of [...scored].sort((a, b) => b.score - a.score)) {
    const key = `${c.category}::${c.title.trim().toLowerCase() || c.source.id}`;
    const ex = byKey.get(key);
    if (!ex || c.score > ex.score) byKey.set(key, c);
  }
  const deduped = [...byKey.values()];

  // ── Diversity-aware ordering: greedily pick the best, penalizing already-picked categories so a
  //     pile of near-duplicate kinds (e.g. several emails) can't crowd out a decision/ticket/task
  //     when scores are close. A clearly stronger same-kind item still wins. ──
  const ordered: MemoryCandidate[] = [];
  const remaining = [...deduped];
  const catCount: Record<string, number> = {};
  while (remaining.length) {
    let bestIdx = 0, bestEff = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i]!;
      const eff = c.score * Math.pow(0.55, catCount[c.category] ?? 0);
      if (eff > bestEff) { bestEff = eff; bestIdx = i; }
    }
    const [chosen] = remaining.splice(bestIdx, 1);
    ordered.push(chosen!);
    catCount[chosen!.category] = (catCount[chosen!.category] ?? 0) + 1;
  }

  const candidates = ordered.slice(0, TOTAL_CAP);

  // ── Injection selection (separate from ranking): min-relevance threshold + email/message gating.
  //     Emails/messages only inject when the query explicitly asks about email/messages, OR the
  //     email's raw keyword overlap is STRICTLY stronger than the best record/decision/task/ticket.
  //     Everything else stays VISIBLE in the shadow preview marked not-injected + a reason. ──
  const emailIntent = EMAIL_INTENT_RE.test(query);
  const nonEmailKw = candidates.filter((c) => c.category !== "email" && c.category !== "message").map((c) => c.breakdown.keyword);
  const bestNonEmailKw = nonEmailKw.length ? Math.max(...nonEmailKw) : 0;
  let injectedCount = 0;
  for (const c of candidates) {
    const isEmailish = c.category === "email" || c.category === "message";
    let reason = "";
    if (c.score < MIN_INJECT_SCORE) reason = "below relevance threshold";
    else if (isEmailish && !emailIntent && c.breakdown.keyword <= bestNonEmailKw)
      reason = "email/message not directly requested — weaker overlap than a record/decision/task/ticket";
    if (!reason && injectedCount < INJECT_CAP) { c.injected = true; injectedCount++; }
    else { c.injected = false; c.reject_reason = reason || "beyond top-3 injection cap"; }
  }

  const injectedRefs = new Set(candidates.filter((c) => c.injected).map((c) => `${c.source.type}:${c.source.id}`));
  const by_kind: Record<string, number> = {};
  for (const c of candidates) by_kind[c.category] = (by_kind[c.category] ?? 0) + 1;
  return {
    enabled: true, candidates, candidate_count: candidates.length,
    injected_count: injectedCount,
    source_count: injectedRefs.size,   // ACTUAL injected refs only (matches what Ask discloses)
    by_kind, intent, latency_ms: Date.now() - t0, scanned,
  };
}
