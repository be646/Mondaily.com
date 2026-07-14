import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowUp, Check, ChevronDown, ExternalLink, Globe2, Loader2, MessageSquare,
  Plus, Radar, Sparkles, Star, ThumbsDown, ThumbsUp, Minus, Users, Trash2, Bell, Send, Copy,
  CheckSquare, ShieldCheck, ArrowRight,
} from "lucide-react";
import { apiClient, apiFetch, BASE_URL } from "../../lib/api-client";
import { MenuSelect, ActionMenu, CommandPageHeader, ProofOfWorkStrip } from "../../components/ui/controls";
import { EmptyState, ErrorState, DelayedLoading, PageSkeletonCards } from "../../components/ui/page-state";
import { useWorkspaceSuggestions } from "../../hooks/useWorkspaceSuggestions";
import { useLanguage } from "../../hooks/useLanguage";
import { requestAsk } from "../../lib/ask-bus";

/**
 * Discovery — an AI research surface that finds REAL leads and REAL reviews on the open web.
 * Built as an advanced AI chat: you ask in natural language, the agent streams what it's doing
 * (classify → search → read pages → extract → summarize) and answers with source-backed result
 * cards. Nothing is fabricated: every lead/review is bound to the page it came from.
 *
 * Engine: POST /discovery/search/stream (SSE) → the sovereign SearXNG + scraper + per-page
 * extraction pipeline. Leads can be saved into the graph (POST /discovery/save) and added to
 * lists; reviews show Brand24-style sentiment + source. If the search appliance isn't reachable,
 * the connection banner says exactly why instead of failing silently.
 */
type Kind = "INTENT_LEADS" | "REVIEWS";
type Sentiment = "positive" | "negative" | "neutral" | "mixed" | null;

interface ResultRow {
  source_url: string;
  platform: string;
  author_name: string;
  intent_type: "BUY_SIGNAL" | "REVIEW" | "COMPLAINT";
  sentiment: Sentiment;
  confidence_score: number;
  priority?: "hot" | "warm" | "cold";
  region?: string | null;
  target_subject?: string | null;
  snippet: string;
  email: string | null;
  phone: string | null;
  handle: string | null;
}

interface Turn {
  id: string;
  query: string;
  deep: boolean;
  kind?: Kind;
  subject?: string | null;
  steps: string[];
  overview?: string;
  results: ResultRow[];
  discovered?: number;
  scanned?: number;
  status: "streaming" | "done" | "error" | "coach";
  error?: string;
  coach?: { message: string; suggestions: string[] };
  usage?: { tokens: number; ai_calls: number; pages_skipped: number };
}

interface ListRow { id: string; name: string; object_type: string; entry_count?: number }
interface DiscoveryStatus { status: "HEALTHY" | "DEGRADED"; services: { searxng_reachable: boolean; scraper_reachable: boolean }; diagnostic?: string }

// Neutral generic fallback shown while the workspace profile loads, or when it has no signal.
const FALLBACK_EXAMPLES = [
  { icon: Users, label: "Find companies matching your ideal customer", q: "companies matching my ideal customer profile" },
  { icon: Star, label: "Reviews about a competitor", q: "reviews and complaints about a competitor" },
  { icon: Users, label: "Find prospects in your region", q: "prospects in my region" },
  { icon: Star, label: "What people say about a business", q: "what do people say about a business" },
];

const hostOf = (url?: string | null) => {
  if (!url) return "";
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return String(url).replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? ""; }
};
const uid = () => `t_${Math.random().toString(36).slice(2)}_${performance.now().toString(36)}`;

const PRIORITY: Record<"hot" | "warm" | "cold", { label: string; tone: string }> = {
  hot:  { label: "Hot",  tone: "#9c6b72" },
  warm: { label: "Warm", tone: "#97824f" },
  cold: { label: "Cold", tone: "#737373" },
};

const SENTIMENT: Record<Exclude<Sentiment, null>, { label: string; tone: string; Icon: typeof ThumbsUp }> = {
  positive: { label: "Positive", tone: "#5f8169", Icon: ThumbsUp },
  negative: { label: "Negative", tone: "#9c6b72", Icon: ThumbsDown },
  neutral:  { label: "Neutral",  tone: "#737373", Icon: Minus },
  mixed:    { label: "Mixed",    tone: "#97824f", Icon: Minus },
};

// A citation anchor id ties a Sources-rail pill to its result card (jump-to-source, Perplexity-style).
const citeId = (turnId: string, n: number) => `cite-${turnId}-${n}`;
/** Scroll to a cited result card and briefly ring it, so a citation number jumps to its source. */
function jumpToCite(turnId: string, n: number) {
  const el = document.getElementById(citeId(turnId, n));
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.style.transition = "box-shadow .2s ease";
  el.style.boxShadow = "0 0 0 2px var(--section-accent)";
  setTimeout(() => { el.style.boxShadow = ""; }, 1300);
}

/** Sources rail — numbered pills of the REAL pages the answer/results came from (Perplexity-style).
 *  In result order so the number matches each card's [n]. Click the pill to JUMP to that card; the ↗
 *  opens the real page in a new tab. */
function SourcesRail({ results, turnId }: { results: ResultRow[]; turnId: string }) {
  const sources = results.slice(0, 12).map((r, i) => ({ n: i + 1, url: r.source_url, host: hostOf(r.source_url) || r.platform })).filter((s) => s.url);
  if (sources.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t pt-2.5" style={{ borderColor: "var(--section-accent-line)" }}>
      <span className="text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>Sources</span>
      {sources.map((s) => (
        <span key={s.n} className="inline-flex items-center gap-1 rounded-sm border pl-1.5 pr-1 py-0.5 text-[10.5px] transition-colors hover:border-[color:var(--section-accent)]"
          style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-muted)" }}>
          <button onClick={() => jumpToCite(turnId, s.n)} title="Jump to this result" className="inline-flex items-center gap-1">
            <span className="font-semibold tabular-nums" style={{ color: "var(--section-accent)" }}>{s.n}</span>
            <span className="max-w-[140px] truncate">{s.host}</span>
          </button>
          <a href={s.url} target="_blank" rel="noreferrer" title={s.url} className="shrink-0" style={{ color: "var(--text-faint)" }}><ExternalLink size={9} /></a>
        </span>
      ))}
    </div>
  );
}

/** Result controls — sort + contact-only + CSV export, a view over the real streamed rows. */
function ResultsToolbar({ sortBy, setSortBy, onlyContact, setOnlyContact, shownCount, total, onExport, reviews }: {
  sortBy: "relevance" | "priority" | "confidence"; setSortBy: (v: "relevance" | "priority" | "confidence") => void;
  onlyContact: boolean; setOnlyContact: (v: boolean) => void; shownCount: number; total: number; onExport: () => void; reviews: boolean;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
      <span style={{ color: "var(--text-faint)" }}>{shownCount === total ? `${total} results` : `${shownCount} of ${total}`}</span>
      <span className="ml-auto flex items-center gap-1.5">
        <MenuSelect value={sortBy} onChange={(v) => setSortBy((v as "relevance" | "priority" | "confidence") || "relevance")} maxWidth={130}
          options={[{ value: "relevance", label: "Sort: relevance" }, { value: "priority", label: "Sort: priority" }, { value: "confidence", label: "Sort: confidence" }]} />
        {!reviews && (
          <button onClick={() => setOnlyContact(!onlyContact)} className="inline-flex items-center gap-1 rounded-sm border px-2 py-1 font-medium transition-colors"
            style={onlyContact ? { borderColor: "var(--section-accent)", color: "var(--section-accent)", background: "color-mix(in srgb, var(--section-accent) 8%, transparent)" } : { borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
            <Check size={11} /> Has contact
          </button>
        )}
        <button onClick={onExport} title="Export these results to CSV" className="inline-flex items-center gap-1 rounded-sm border px-2 py-1 font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
          <ArrowUp size={11} className="rotate-45" /> CSV
        </button>
      </span>
    </div>
  );
}

/** Export the shown rows to a CSV file — pure client-side over the real result data (no backend). */
function exportLeadsCsv(rows: ResultRow[], query: string) {
  const cols = ["name", "source_url", "host", "region", "priority", "confidence_score", "email", "phone", "handle", "snippet"];
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const line = (r: ResultRow) => [
    r.author_name && r.author_name !== "Anonymous" ? r.author_name : hostOf(r.source_url), r.source_url, hostOf(r.source_url),
    r.region ?? "", r.priority ?? "", r.confidence_score, r.email ?? "", r.phone ?? "", r.handle ?? "", r.snippet ?? "",
  ].map(esc).join(",");
  const csv = [cols.join(","), ...rows.map(line)].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `discovery-${query.slice(0, 40).replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "results"}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function DiscoveryPage() {
  const qc = useQueryClient();
  const { data: suggestions } = useWorkspaceSuggestions();  // profile-aware placeholder/examples
  const { t } = useLanguage();
  const [view, setView] = useState<"chat" | "saved">("chat");
  const [input, setInput] = useState("");
  const [deep, setDeep] = useState(false);
  const [exhaustive, setExhaustive] = useState(false);
  // Search history persists in localStorage per workspace, so searches + their results survive a
  // refresh/navigation instead of disappearing.
  const HISTORY_KEY = `mondaily_discovery_history_${localStorage.getItem("mondaily_workspace_id") ?? "default"}`;
  const [turns, setTurns] = useState<Turn[]>(() => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; } });
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const keep = turns.filter((t) => t.status !== "streaming").slice(-25);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(keep)); } catch { /* quota — ignore */ }
  }, [turns, HISTORY_KEY]);
  const clearHistory = () => { setTurns([]); try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ } };

  const statusQ = useQuery({ queryKey: ["discovery-status"], queryFn: () => apiClient.get<DiscoveryStatus>("/discovery/status"), staleTime: 60_000 });
  const listsQ = useQuery({ queryKey: ["lists"], queryFn: () => apiClient.get<ListRow[]>("/lists"), staleTime: 30_000 });
  const connectorsQ = useQuery<{ places: { provider: string; ok: boolean; detail: string }; reddit: { enabled: boolean; ok: boolean; detail: string } }>({
    queryKey: ["discovery-connectors"], queryFn: () => apiClient.get("/discovery/connectors"), staleTime: 120_000, retry: false,
  });
  const degraded = statusQ.data?.status === "DEGRADED";

  // Ideal Customer Profile — one saved description that biases scoring + coach suggestions.
  const icpQ = useQuery({ queryKey: ["discovery-icp"], queryFn: () => apiClient.get<{ description: string }>("/discovery/icp"), staleTime: 300_000, retry: false });
  const [icpOpen, setIcpOpen] = useState(false);
  const [icpText, setIcpText] = useState("");
  useEffect(() => { if (icpQ.data) setIcpText(icpQ.data.description); }, [icpQ.data]);
  const saveIcp = useMutation({
    mutationFn: () => apiClient.post("/discovery/icp", { description: icpText }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["discovery-icp"] }); setIcpOpen(false); },
  });

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [turns]);

  // Coach preflight: a fast, cheap check BEFORE the expensive sweep. Vague queries get a coaching
  // turn with clickable refinements; specific queries run straight through. Never blocks (fails open).
  async function onSubmit(q: string, force = false) {
    const query = q.trim();
    if (!query || busy) return;
    setInput("");
    if (force) { runSearch(query); return; }
    setBusy(true);
    let coach: { specific?: boolean; coach_message?: string; suggestions?: string[] } | null = null;
    try { coach = await apiClient.post("/discovery/coach", { query }); } catch { coach = null; }
    setBusy(false);
    // Decide vagueness client-side too, so the coach appears even if /coach is slow or errors.
    const w = query.split(/\s+/).filter(Boolean);
    const clientVague = (/^(leads?|companies|company|businesses|business|prospects?|clients?|contacts?|people|customers?|firms?)$/i.test(w[0] ?? "") && w.length <= 4) || w.length <= 1;
    const vague = coach?.specific === false || clientVague;
    if (!vague) { runSearch(query); return; }
    // Suggestions: server's if any, else derive from the place in the query.
    const place = (query.match(/\b(?:in|near|around|from)\s+(.+)$/i)?.[1] ?? "").trim();
    const fallback = place ? [`restaurants in ${place}`, `law firms in ${place}`, `dentists in ${place}`, `marketing agencies in ${place}`, `real estate agencies in ${place}`] : [];
    const suggestions = ((coach?.suggestions && coach.suggestions.length ? coach.suggestions : fallback)).slice(0, 5);
    const message = coach?.coach_message || `“${query}” is a bit broad — pick an industry to get sharper results, or search anyway:`;
    setTurns((t) => [...t, { id: uid(), query, deep, steps: [], results: [], status: "coach", coach: { message, suggestions } }]);
  }

  async function runSearch(q: string) {
    const query = q.trim();
    if (!query || busy) return;
    setInput("");
    setBusy(true);
    const id = uid();
    const turn: Turn = { id, query, deep, steps: [], results: [], status: "streaming" };
    setTurns((t) => [...t, turn]);
    const patch = (fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));

    try {
      const res = await apiFetch(`${BASE_URL}/api/v1/discovery/search/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, deep, exhaustive }),
      });
      if (!res.ok || !res.body) throw new Error(`Search failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // Parse the SSE stream: frames are separated by a blank line; each `data:` line is JSON.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let ev: any;
          try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (ev.type === "progress" && ev.message) patch((t) => ({ ...t, steps: [...t.steps, String(ev.message)] }));
          else if (ev.type === "overview" && ev.text) patch((t) => ({ ...t, overview: String(ev.text) }));
          else if (ev.type === "usage") patch((t) => ({ ...t, usage: { tokens: Number(ev.tokens ?? 0), ai_calls: Number(ev.ai_calls ?? 0), pages_skipped: Number(ev.pages_skipped ?? 0) } }));
          else if (ev.type === "error") patch((t) => ({ ...t, status: "error", error: String(ev.error || "Search failed") }));
          else if (ev.type === "results") {
            // Results are streamed BEFORE the overview/done, so they render even if the tail is cut short.
            patch((t) => ({
              ...t,
              kind: ev.kind === "REVIEWS" ? "REVIEWS" : "INTENT_LEADS",
              results: Array.isArray(ev.results) ? ev.results : t.results,
              discovered: ev.discovered ?? t.discovered,
              scanned: ev.scanned ?? t.scanned,
            }));
          }
          else if (ev.type === "done") {
            patch((t) => ({
              ...t,
              status: "done",
              kind: ev.classified?.searchType === "REVIEWS" ? "REVIEWS" : t.kind,
              subject: ev.classified?.targetSubject ?? t.subject,
              overview: ev.overview ?? t.overview,
              results: Array.isArray(ev.results) && ev.results.length ? ev.results : t.results,
              discovered: ev.discovered ?? t.discovered,
              scanned: ev.scanned ?? t.scanned,
              error: ev.reason && !(t.results && t.results.length) && !(Array.isArray(ev.results) && ev.results.length) ? String(ev.reason) : undefined,
            }));
            qc.invalidateQueries({ queryKey: ["nodes"] });
          }
        }
      }
      // Stream ended without a done frame (e.g. dropped) → mark done so the UI isn't stuck.
      patch((t) => (t.status === "streaming" ? { ...t, status: "done" } : t));
    } catch (e) {
      patch((t) => ({ ...t, status: "error", error: e instanceof Error ? e.message : "Search failed" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-4xl flex-col px-4 sm:px-6">
      {/* Shared command header — same pattern as Decisions / Team Oversight / Home cockpit.
          All controls + handlers preserved (ICP, clear, Discover/Saved view). */}
      <div className="py-4">
        <CommandPageHeader
          icon={Radar}
          callsign="SWEEP"
          title={t("discovery.heading")}
          status={[
            { label: degraded ? "Search engine offline" : "Web search online", tone: degraded ? "#97824f" : "#5f8169" },
            ...(connectorsQ.data ? [
              { node: <Source label={connectorsQ.data.places.provider === "google" ? "Google Maps" : "OpenStreetMap"} ok={connectorsQ.data.places.ok} detail={connectorsQ.data.places.detail} /> },
              { node: <Source label="Reddit" ok={connectorsQ.data.reddit.ok} detail={connectorsQ.data.reddit.detail} muted={!connectorsQ.data.reddit.enabled} /> },
            ] : []),
          ]}
          secondaryActions={<>
            {view === "chat" && (
              <button onClick={() => setIcpOpen((o) => !o)} title="Set your ideal customer — biases lead scoring + coach suggestions" className="inline-flex items-center gap-1 rounded-sm border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: icpQ.data?.description ? "var(--section-accent)" : "var(--border-soft)", color: icpQ.data?.description ? "var(--section-accent)" : "var(--text-muted)" }}>
                <Star size={12} /> Ideal customer{icpQ.data?.description ? " ✓" : ""}
              </button>
            )}
            {view === "chat" && turns.length > 0 && (
              <button onClick={clearHistory} title="Clear search history" className="inline-flex items-center gap-1 rounded-sm border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
                <Trash2 size={12} /> Clear
              </button>
            )}
          </>}
          primaryAction={
            <div className="flex overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
              {(["chat", "saved"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className="px-3 py-1.5 text-[12px] font-medium capitalize transition-colors"
                  style={{ background: view === v ? "var(--surface-selected)" : "transparent", color: view === v ? "var(--text-primary)" : "var(--text-muted)" }}>
                  {v === "chat" ? "Discover" : t("discovery.saved")}
                </button>
              ))}
            </div>
          }
        />
      </div>

      {/* "How Discovery works" now renders only inside the first-run empty view (below the Try
          examples) — during and after real runs the per-turn proof strip carries the story. */}
      {icpOpen && view === "chat" && (
        <div className="mb-3 rounded-sm border px-3 py-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
          <p className="mb-1.5 text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>Your ideal customer</p>
          <p className="mb-2 text-[11px]" style={{ color: "var(--text-muted)" }}>One line describing who you sell to — leads matching it rank higher (Hot) and the coach tailors suggestions to it.</p>
          <textarea value={icpText} onChange={(e) => setIcpText(e.target.value)} rows={2}
            placeholder="e.g. Independent aesthetic clinics in Poland with 5-30 staff and an active social presence"
            className="w-full resize-none rounded-sm border bg-transparent px-2.5 py-2 text-[13px] outline-none focus:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }} />
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => saveIcp.mutate()} disabled={saveIcp.isPending} className="inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50" style={{ background: "var(--section-accent)" }}>
              {saveIcp.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
            </button>
            <button onClick={() => setIcpOpen(false)} className="text-[12px]" style={{ color: "var(--text-muted)" }}>Cancel</button>
          </div>
        </div>
      )}

      {(degraded || statusQ.isError) && (
        <div className="mb-3 flex items-start gap-2 rounded-sm border px-3 py-2.5 text-[12px]" style={{ borderColor: "#97824f33", background: "#97824f0f", color: "#97824f" }}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {statusQ.isError
              ? "Couldn't reach Discovery status. "
              : (statusQ.data?.diagnostic ?? "The search appliance isn't reachable, so Discovery can't return live results yet.")}
            {statusQ.isError && <button onClick={() => statusQ.refetch()} className="underline">Retry</button>}
          </span>
        </div>
      )}

      {view === "saved" ? (
        <SavedLeads lists={listsQ.data ?? []} />
      ) : (() => {
        // One composer, two positions: WORKBENCH (no searches yet → input sits right under the
        // header, suggestions tight beneath it) vs CONVERSATION (results above, input pinned below).
        const composer = (
          // AI command surface — a leading command glyph + the query line, with a quiet divider to a
          // "Mode" options row (Deep / Exhaustive). Reads as a prospecting command bar, not a textarea.
          <div className="rounded-sm border transition-colors focus-within:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
            <div className="flex items-start gap-2 px-3 pt-2.5">
              <Radar size={15} className="mt-[3px] shrink-0" style={{ color: "var(--section-accent)" }} />
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(input); } }}
                rows={1}
                autoFocus={turns.length === 0}
                placeholder={suggestions?.discovery_placeholder ?? "Find leads or reviews…"}
                className="max-h-32 w-full resize-none bg-transparent text-[14px] outline-none"
                style={{ color: "var(--text-primary)" }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between border-t px-3 py-2" style={{ borderColor: "var(--border-soft)" }}>
              <div className="flex items-center gap-1.5">
                <span className="mr-0.5 text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>Mode</span>
                <button onClick={() => setDeep((d) => !d)} title="Deep mode visits each business's own site to harvest emails & phones"
                  className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11.5px] font-medium transition-colors"
                  style={deep ? { borderColor: "var(--section-accent)", color: "var(--section-accent)", background: "color-mix(in srgb, var(--section-accent) 8%, transparent)" } : { borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
                  <Sparkles size={12} /> Deep
                </button>
                <button onClick={() => setExhaustive((e) => !e)} title="Exhaustive sweep loops the city's districts for full coverage (uses more Google Places credits)"
                  className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11.5px] font-medium transition-colors"
                  style={exhaustive ? { borderColor: "var(--section-accent)", color: "var(--section-accent)", background: "color-mix(in srgb, var(--section-accent) 8%, transparent)" } : { borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
                  <Globe2 size={12} /> Exhaustive
                </button>
              </div>
              <button onClick={() => onSubmit(input)} disabled={!input.trim() || busy}
                className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-white transition-opacity disabled:opacity-40" style={{ background: "var(--section-accent)" }}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} />}
              </button>
            </div>
          </div>
        );

        return turns.length === 0 ? (
          /* WORKBENCH — search-first: composer at the top, compact suggestions right below. */
          <div className="min-h-0 flex-1 overflow-y-auto pt-3">
            {composer}
            <Empty onPick={onSubmit} />
          </div>
        ) : (
          <>
            {/* conversation */}
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-4">
              <div className="space-y-6">
                {turns.map((t) => <TurnView key={t.id} turn={t} lists={listsQ.data ?? []} onRun={onSubmit} />)}
              </div>
            </div>
            <div className="border-t py-3" style={{ borderColor: "var(--border-soft)" }}>{composer}</div>
          </>
        );
      })()}
    </div>
  );
}

/** Tiny data-source status chip in the header — hover shows the live diagnostic detail. */
function Source({ label, ok, detail, muted }: { label: string; ok: boolean; detail: string; muted?: boolean }) {
  const color = muted ? "var(--text-faint)" : ok ? "#5f8169" : "#97824f";
  return (
    <span className="inline-flex items-center gap-1" title={detail} style={{ color: "var(--text-faint)" }}>
      <span aria-hidden>·</span>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}

function Empty({ onPick }: { onPick: (q: string) => void }) {
  // Industry-aware examples from the workspace profile; fall back to neutral generic ones while
  // loading or when the profile has no signal. Free-form search is always available regardless.
  const { data: suggestions } = useWorkspaceSuggestions();
  const examples = suggestions?.discovery?.length
    ? suggestions.discovery.map((q, i) => ({ icon: i % 2 === 0 ? Users : Star, label: q, q }))
    : FALLBACK_EXAMPLES;
  return (
    // Compact suggestion chips directly under the composer — a workbench, not a hero. Industry-aware
    // when the workspace profile has signal; small, left-aligned, no icon tile / heading / sub-line.
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10.5px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>Try</span>
        {examples.map((ex) => (
          <button key={ex.q} onClick={() => onPick(ex.q)}
            className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[12px] transition-colors hover:bg-[var(--surface-hover)]"
            style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
            <ex.icon size={12} style={{ color: "var(--text-faint)" }} /> {ex.label}
          </button>
        ))}
      </div>
      {/* One quiet honesty line instead of pre-run cards — proof of work belongs AFTER a real run
          (the per-turn ProofOfWorkStrip), not as marketing before it. */}
      <p className="mt-4 text-[11px]" style={{ color: "var(--text-faint)" }}>
        Every result links to the real page it came from — each run shows the pages checked and leads found.
      </p>
      {/* Reference disclosure lives quietly below the examples, not above the composer. */}
      <div className="mt-4"><ModuleStrip /></div>
    </div>
  );
}

function TurnView({ turn, lists, onRun }: { turn: Turn; lists: ListRow[]; onRun: (q: string, force?: boolean) => void }) {
  const reviews = turn.kind === "REVIEWS";
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Record<string, LeadStatus>>({});
  const [drawerKey, setDrawerKey] = useState<string | null>(null);
  // Result view controls (client-side over the real streamed rows) — sort, contact-only, follow-up.
  const [sortBy, setSortBy] = useState<"relevance" | "priority" | "confidence">("relevance");
  const [onlyContact, setOnlyContact] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const PRI_RANK: Record<string, number> = { hot: 0, warm: 1, cold: 2 };
  const shown = useMemo(() => {
    let arr = turn.results.map((r, i) => ({ r, i }));
    if (onlyContact) arr = arr.filter((e) => e.r.email || e.r.phone);
    if (sortBy === "priority") arr = [...arr].sort((a, b) => (PRI_RANK[a.r.priority ?? "cold"]! - PRI_RANK[b.r.priority ?? "cold"]!) || (b.r.confidence_score - a.r.confidence_score));
    else if (sortBy === "confidence") arr = [...arr].sort((a, b) => b.r.confidence_score - a.r.confidence_score);
    return arr;
  }, [turn.results, onlyContact, sortBy]);
  const { data: members } = useQuery({ queryKey: ["members"], queryFn: () => apiClient.get<Member[]>("/members"), staleTime: 300_000 });
  const keyOf = (r: ResultRow, i: number) => `${i}:${r.source_url}`;
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const applyStatus = (updates: Record<string, LeadStatus>) => setStatus((p) => { const n = { ...p }; for (const [k, v] of Object.entries(updates)) n[k] = { ...n[k], ...v }; return n; });
  const drawerRow = drawerKey ? (() => { const r = turn.results.find((row, i) => keyOf(row, i) === drawerKey); return r ? { r, k: drawerKey } : null; })() : null;
  return (
    <div>
      {/* Query headline — reads like a search you ran (an answer document), not a chat bubble. */}
      <div className="flex items-start gap-2.5 border-b pb-2.5" style={{ borderColor: "var(--border-soft)" }}>
        <Radar size={18} className="mt-0.5 shrink-0" style={{ color: "var(--section-accent)" }} />
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-[18px] font-semibold leading-snug" style={{ color: "var(--text-primary)" }}>{turn.query}</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]" style={{ color: "var(--text-faint)" }}>
            <span>{turn.kind === "REVIEWS" ? "Reviews & mentions" : "Lead search"}</span>
            {turn.deep && <span>· deep</span>}
            {typeof turn.scanned === "number" && turn.scanned > 0 && <span>· {turn.scanned} sources checked</span>}
            {turn.results.length > 0 && <span>· {turn.results.length} {turn.kind === "REVIEWS" ? "found" : "leads"}</span>}
          </div>
        </div>
      </div>

      {/* Coach turn — vague query: guide instead of running a poor sweep. */}
      {turn.status === "coach" && turn.coach && (
        <div className="mt-3">
          <div className="flex items-start gap-2 rounded-sm border px-3 py-2.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
            <Sparkles size={14} className="mt-0.5 shrink-0" style={{ color: "var(--section-accent)" }} />
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{turn.coach.message}</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {turn.coach.suggestions.map((s) => (
              <button key={s} onClick={() => onRun(s)} className="rounded-sm border px-2.5 py-1 text-[12px] transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>{s}</button>
            ))}
            <button onClick={() => onRun(turn.query, true)} className="rounded-sm px-2.5 py-1 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>Search “{turn.query}” anyway →</button>
          </div>
        </div>
      )}

      {/* assistant response */}
      {turn.status !== "coach" && (
      <div className="mt-3">
        <StepTrace steps={turn.steps} status={turn.status} />

        {turn.status === "error" && (
          <div className="mt-2 flex items-start gap-2 rounded-sm border px-3 py-2 text-[12.5px]" style={{ borderColor: "#9c6b7233", background: "#9c6b720d", color: "#9c6b72" }}>
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {turn.error}
          </div>
        )}

        {/* Answer hero — the AI overview is the headline answer (search-engine style), with a Sources
            rail of the REAL pages the answer is built from directly beneath it. */}
        {turn.overview && (
          <div className="mt-2 rounded-sm border px-3.5 py-3" style={{ borderColor: "var(--section-accent-line)", background: "color-mix(in srgb, var(--section-accent) 4%, transparent)" }}>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--section-accent)" }}>
              <Sparkles size={11} /> Answer
            </div>
            <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--text-primary)" }}>{turn.overview}</p>
            <SourcesRail results={turn.results} turnId={turn.id} />
          </div>
        )}

        {/* Results render as soon as they stream in — independent of the final done event. */}
        {turn.results.length > 0 ? (
          <>
            {/* Discovery Agent proof-of-work via the SHARED ProofOfWorkStrip — real streamed counts
                only (sources scanned, leads found, AI calls, pre-filter skips). Nothing invented. */}
            <ProofOfWorkStrip
              className="mt-3 mb-2"
              agent="Discovery Agent"
              status="complete"
              counters={[
                { value: turn.scanned ?? 0, label: "sources checked" },
                { value: turn.results.length, label: reviews ? "reviews / mentions" : "leads found" },
                ...(turn.usage && turn.usage.ai_calls > 0 ? [{ value: turn.usage.ai_calls, label: "AI calls" }] : []),
                ...(turn.usage && turn.usage.pages_skipped > 0 ? [{ value: turn.usage.pages_skipped, label: "skipped by pre-filter" }] : []),
              ]}
              action={reviews ? <SentimentSummary results={turn.results} /> : <SaveAllLeads results={turn.results} query={turn.query} />}
            />
            {!reviews && sel.size > 0 && (
              <BulkBar entries={turn.results.map((r, i) => ({ key: keyOf(r, i), r })).filter((e) => sel.has(e.key))} query={turn.query} lists={lists} members={members ?? []}
                onApplied={applyStatus} onClear={() => setSel(new Set())} />
            )}
            {/* Result controls — sort, contact-only filter, CSV export. Purely a view over real rows. */}
            {turn.results.length > 3 && (
              <ResultsToolbar sortBy={sortBy} setSortBy={setSortBy} onlyContact={onlyContact} setOnlyContact={setOnlyContact}
                shownCount={shown.length} total={turn.results.length} onExport={() => exportLeadsCsv(shown.map((e) => e.r), turn.query)} reviews={reviews} />
            )}
            <div className="space-y-2">
              {shown.map(({ r, i }) => {
                const k = keyOf(r, i);
                // Anchor each card to its citation number so a Sources-rail pill can jump to it.
                return (
                  <div key={k} id={citeId(turn.id, i + 1)} className="scroll-mt-20 rounded-sm">
                    {reviews
                      ? <ReviewCard r={r} n={i + 1} />
                      : <LeadCard r={r} n={i + 1} query={turn.query} lists={lists}
                          selected={sel.has(k)} onToggle={() => toggle(k)} bulkStatus={status[k]} onDetails={() => setDrawerKey(k)} />}
                  </div>
                );
              })}
            </div>
            {drawerRow && <LeadDrawer r={drawerRow.r} query={turn.query} lists={lists} members={members ?? []}
              status={status[drawerRow.k]} onStatus={(s) => applyStatus({ [drawerRow.k]: s })} onClose={() => setDrawerKey(null)} />}
            <WatchButton query={turn.query} />
            {/* Follow-up — refine the search in place (search-engine style), not a new chat turn. */}
            <form onSubmit={(e) => { e.preventDefault(); const q = followUp.trim(); if (q) { onRun(q); setFollowUp(""); } }}
              className="mt-3 flex items-center gap-2 rounded-sm border px-3 py-1.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
              <ArrowRight size={13} className="shrink-0" style={{ color: "var(--text-faint)" }} />
              <input value={followUp} onChange={(e) => setFollowUp(e.target.value)} placeholder="Refine or ask a follow-up search…"
                className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none" style={{ color: "var(--text-primary)" }} />
              {followUp.trim() && <button type="submit" className="shrink-0 text-[11.5px] font-medium" style={{ color: "var(--section-accent)" }}>Search →</button>}
            </form>
          </>
        ) : turn.status === "done" && !turn.error ? (
          <NoResults reviews={reviews} scanned={turn.scanned} query={turn.query} onRun={onRun} />
        ) : null}

        {/* Next-move suggestions after a completed search. */}
        {turn.status === "done" && <NextMoves turn={turn} onRun={onRun} />}

        {/* Per-search cost — real tokens + AI calls, with pages the pre-filter saved. */}
        {turn.usage && turn.usage.tokens > 0 && (
          <p className="mt-2 text-[10.5px]" style={{ color: "var(--text-faint)" }}>
            ~{turn.usage.tokens.toLocaleString()} credits · {turn.usage.ai_calls} AI calls{turn.usage.pages_skipped > 0 ? ` · saved ${turn.usage.pages_skipped} page${turn.usage.pages_skipped === 1 ? "" : "s"}` : ""}
          </p>
        )}
      </div>
      )}
    </div>
  );
}

/** "What next" chips after a search — result heuristics + profile-aware follow-ons. */
function NextMoves({ turn, onRun }: { turn: Turn; onRun: (q: string, force?: boolean) => void }) {
  const { data: suggestions } = useWorkspaceSuggestions();
  const chips: string[] = [];
  const reviews = turn.kind === "REVIEWS";
  const thin = turn.results.length > 0 && turn.results.length < 10;
  if (!reviews && turn.results[0]) {
    const top = turn.results[0].author_name;
    if (top && top !== "Anonymous" && !top.startsWith("u/")) chips.push(`reviews about ${top}`);
  }
  if (thin) chips.push(`${turn.query} — deep`);
  // Profile-aware follow-ons ("what to search next"), deduped against the heuristic chips.
  for (const s of suggestions?.discovery_next ?? []) { if (chips.length >= 4) break; if (!chips.includes(s)) chips.push(s); }
  if (!chips.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>Next:</span>
      {chips.map((c) => (
        <button key={c} onClick={() => onRun(c)} className="rounded-sm border px-2.5 py-0.5 text-[11.5px] transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>{c}</button>
      ))}
    </div>
  );
}

/** "Watch this search" — saves it as a monitor; the daily job re-runs it and notifies on new hits.
 *  This is how you get alerted to fresh buyer-intent posts ("looking for a lawyer in Warsaw"). */
function WatchButton({ query }: { query: string }) {
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const save = async () => {
    setState("saving");
    try { await apiClient.post("/discovery/monitors", { query }); setState("done"); }
    catch { setState("error"); }
  };
  if (state === "done") return <p className="mt-2 inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: "#5f8169" }}><Check size={12} /> Watching — you'll be notified of new results</p>;
  return (
    <button onClick={save} disabled={state === "saving"}
      className="mt-2 inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:border-[color:var(--section-accent)]"
      style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
      {state === "saving" ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} style={{ color: "var(--section-accent)" }} />}
      {state === "error" ? "Couldn't watch — retry" : "Watch this search — alert me to new results"}
    </button>
  );
}

function StepTrace({ steps, status }: { steps: string[]; status: Turn["status"] }) {
  const [open, setOpen] = useState(true);
  useEffect(() => { if (status === "done") setOpen(false); }, [status]);
  if (steps.length === 0 && status === "streaming") {
    return <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--text-muted)" }}><Loader2 size={13} className="animate-spin" /> Thinking…</div>;
  }
  if (steps.length === 0) return null;
  const last = steps[steps.length - 1];
  return (
    <div className="rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px]" style={{ color: "var(--text-muted)" }}>
        {status === "streaming" ? <Loader2 size={13} className="animate-spin shrink-0" style={{ color: "var(--section-accent)" }} /> : <Check size={13} className="shrink-0" style={{ color: "#5f8169" }} />}
        <span className="min-w-0 flex-1 truncate">{status === "streaming" ? last : `Searched the web · ${steps.length} steps`}</span>
        <ChevronDown size={13} className="shrink-0 transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && (
        <div className="space-y-1.5 border-t px-3 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-[11.5px]" style={{ color: i === steps.length - 1 && status === "streaming" ? "var(--text-secondary)" : "var(--text-faint)" }}>
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--text-faint)" }} /> {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Save all leads" — one call promotes the whole result set into the graph. */
function SaveAllLeads({ results, query }: { results: ResultRow[]; query: string }) {
  const qc = useQueryClient();
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [result, setResult] = useState<{ saved: number; skipped: number; already_existed?: unknown[]; failed?: unknown[] } | null>(null);
  const save = async () => {
    setState("saving");
    try {
      const leads = results.map((r) => ({
        name: r.author_name && r.author_name !== "Anonymous" ? r.author_name : (hostOf(r.source_url) || "Discovered lead"),
        object_type: "company",
        source_url: r.source_url,
        discovery_query: query,
        email: r.email ?? undefined,
        phone: r.phone ?? undefined,
        handle: r.handle ?? undefined,
        region: r.region ?? undefined,
        summary: r.snippet || undefined,
      }));
      const res = await apiClient.post<{ saved: number; skipped: number; already_existed?: unknown[]; failed?: unknown[] }>("/discovery/save-batch", { leads });
      setResult(res);
      setState("done");
      qc.invalidateQueries({ queryKey: ["nodes"] });
    } catch { setState("error"); }
  };
  if (state === "done") {
    // Honest, non-conflated counts: saved / already-in-graph / skipped / failed — never a fake "saved".
    const existed = result?.already_existed?.length ?? 0;
    const failed = result?.failed?.length ?? 0;
    const parts = [`${result?.saved ?? 0} saved`];
    if (existed) parts.push(`${existed} already in graph`);
    if (result?.skipped) parts.push(`${result.skipped} skipped`);
    if (failed) parts.push(`${failed} failed`);
    return <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: failed ? "#9c6b72" : "#5f8169" }}><Check size={12} /> {parts.join(" · ")}</span>;
  }
  return (
    <button onClick={save} disabled={state === "saving"} className="inline-flex items-center gap-1 rounded-sm px-2.5 py-0.5 text-[11px] font-medium text-white disabled:opacity-50" style={{ background: "var(--section-accent)" }}>
      {state === "saving" ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} {state === "error" ? "Retry save all" : `Save all ${results.length}`}
    </button>
  );
}

function SentimentSummary({ results }: { results: ResultRow[] }) {
  const counts = results.reduce((acc, r) => { if (r.sentiment) acc[r.sentiment] = (acc[r.sentiment] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  const order: Exclude<Sentiment, null>[] = ["positive", "negative", "neutral", "mixed"];
  const shown = order.filter((k) => counts[k]);
  if (!shown.length) return null;
  return (
    <>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-2">
        {shown.map((k) => <span key={k} style={{ color: SENTIMENT[k].tone }}>{counts[k]} {SENTIMENT[k].label.toLowerCase()}</span>)}
      </span>
    </>
  );
}

function ReviewCard({ r, n }: { r: ResultRow; n?: number }) {
  const s = r.sentiment ? SENTIMENT[r.sentiment] : null;
  return (
    <div className="rounded-sm border px-3.5 py-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[11.5px]" style={{ color: "var(--text-faint)" }}>
          {n != null && <span className="shrink-0 font-semibold tabular-nums" style={{ color: "var(--section-accent)" }}>{n}</span>}
          <Globe2 size={11} className="shrink-0" /> <span className="truncate">{r.platform || hostOf(r.source_url)}</span>
          {r.author_name && r.author_name !== "Anonymous" && <><span aria-hidden>·</span><span className="truncate" style={{ color: "var(--text-muted)" }}>{r.author_name}</span></>}
        </div>
        {s && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ color: s.tone, background: `${s.tone}14` }}>
            <s.Icon size={10} /> {s.label}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{r.snippet || "—"}</p>
      <div className="mt-2 flex items-center gap-3">
        <a href={r.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] font-medium hover:underline" style={{ color: "var(--section-accent)" }}>
          View source <ExternalLink size={11} />
        </a>
        <button onClick={() => requestAsk(`Summarise what this review from ${hostOf(r.source_url)} says about ${r.target_subject ?? "the business"}, using only its text: "${r.snippet}". Source: ${r.source_url}`)}
          className="inline-flex items-center gap-1 text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
          <MessageSquare size={11} /> Ask AI
        </button>
      </div>
    </div>
  );
}

type CiteVia = "scrape" | "ai" | "places" | "graph";
interface CitedValue { value: string; source: string; via: CiteVia }
interface Dossier {
  name: string; domain: string | null;
  summary: CitedValue | null; category: CitedValue | null; location: CitedValue | null;
  emails: CitedValue[]; phones: CitedValue[];
  people: { name: string; role?: string | null; email?: string | null; source: string; via: CiteVia }[];
  reviews: { rating: number | null; count: number | null; source: string } | null;
  graph_match: { node_id: string; name: string } | null;
  sources: { url: string; scanned: boolean }[];
  missing: string[]; scanned: number;
}
interface Enrichment { dossier?: Dossier; emails: string[]; phones: string[]; people: { name: string; role?: string; email?: string }[]; company: string | null }

// Per-lead pipeline state — reflected as status chips (all real; set only after a real action).
interface LeadStatus { saved?: boolean; existed?: boolean; listed?: boolean; tasked?: boolean; queued?: boolean; failed?: boolean; failReason?: string; node_id?: string; owner?: string }
interface Member { user_id: string; name?: string | null; email?: string | null }
// Product-structure framing for Discovery — a light labeling layer over the EXISTING features
// (no new logic). Each module names where its real capabilities live on this page.
const DISCOVERY_MODULES: { key: string; label: string; Icon: typeof Globe2; hint: string }[] = [
  { key: "search", label: "Search", Icon: Globe2, hint: "Web · Places · Graph — run a query, stream results." },
  { key: "enrich", label: "Enrich", Icon: Sparkles, hint: "Open a lead's Details for the cited dossier, reviews, evidence, and graph match." },
  { key: "capture", label: "Capture", Icon: Plus, hint: "Save (deduped) · assign owner · add to list · create task · send to Decision Queue — per lead or in bulk." },
  { key: "monitor", label: "Monitor", Icon: Bell, hint: "Watch a search — saved monitors re-run and alert you to new results." },
  { key: "research", label: "Research", Icon: MessageSquare, hint: "Ask AI over a lead or the whole result set (grounded, source-backed)." },
];
function ModuleStrip() {
  // Collapsed-by-default disclosure (was an always-visible pipeline row → competed with the
  // composer for attention). The composer is the primary surface; this is reference-only. It
  // describes what a search *does*, never implies any step has actually run.
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide transition-colors"
        style={{ color: "var(--text-faint)" }}
      >
        How Discovery works
        <ChevronDown size={11} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .12s ease" }} />
      </button>
      {open && (
        <div
          className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border px-3 py-2.5 text-[10.5px]"
          style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-muted)" }}
        >
          {DISCOVERY_MODULES.map((m, i) => (
            <span key={m.key} className="inline-flex items-center gap-2">
              <span title={m.hint} className="inline-flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                <m.Icon size={10} style={{ color: "var(--text-faint)" }} /> {m.label}
              </span>
              {i < DISCOVERY_MODULES.length - 1 && <ArrowRight size={9} />}
            </span>
          ))}
          <p className="mt-1.5 w-full text-[10px]" style={{ color: "var(--text-faint)" }}>
            Stages only run when you search — the proof strip under each result shows exactly what ran.
          </p>
        </div>
      )}
    </div>
  );
}

// "Why this lead matched" — honest signals derived ONLY from real row fields (never fabricated).
function matchReasons(r: ResultRow): string[] {
  const out: string[] = [];
  if (r.priority) out.push(`${PRIORITY[r.priority].label.toLowerCase()} priority`);
  if (r.confidence_score > 0) out.push(`${r.confidence_score}% match`);
  if (r.email || r.phone) out.push("has contact");
  else out.push("no contact yet");
  if (r.region) out.push(r.region);
  return out;
}

// Map a display row → the save/batch lead payload (one place, reused by single + bulk).
function toLeadPayload(r: ResultRow, query: string) {
  return {
    name: r.author_name && r.author_name !== "Anonymous" ? r.author_name : (hostOf(r.source_url) || "Discovered lead"),
    object_type: "company", source_url: r.source_url, discovery_query: query,
    email: r.email ?? undefined, phone: r.phone ?? undefined, handle: r.handle ?? undefined, region: r.region ?? undefined, summary: r.snippet || undefined,
  };
}

// How a field was obtained — an honest provenance chip, never a fabricated confidence number.
const VIA_LABEL: Record<CiteVia, string> = { scrape: "on page", ai: "AI-read", places: "Google Places", graph: "in your graph" };
function ViaChip({ via, source }: { via: CiteVia; source: string }) {
  const isUrl = /^https?:\/\//.test(source);
  return (
    <span className="ml-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[9px]" style={{ background: "var(--surface-hover)", color: "var(--text-faint)" }} title={source}>
      {VIA_LABEL[via]}{isUrl && <a href={source} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "var(--section-accent)" }}>↗</a>}
    </span>
  );
}

/** The cited enrichment dossier — every field shows where it came from; missing fields are honest. */
/** Honest no-results state — distinguishes "appliance returned nothing" from "no on-topic matches",
 *  and suggests concrete query / coverage expansions (never pretends there were results). */
function NoResults({ reviews, scanned, query, onRun }: { reviews: boolean; scanned?: number; query: string; onRun: (q: string, force?: boolean) => void }) {
  const { t } = useLanguage();
  const { data: wsSug } = useWorkspaceSuggestions();
  const noPages = !scanned || scanned === 0;
  // Profile-aware refinements (already localized by the backend) instead of a hardcoded "in London".
  const refinements = (wsSug?.discovery_next?.length
    ? wsSug.discovery_next
    : reviews ? [`${query} reviews`, `${query} complaints`] : [`${query} email contact`, `${query} directory`]).slice(0, 3);
  return (
    <div className="mt-2 rounded-sm border px-3.5 py-3 text-[12.5px]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)" }}>
      <p style={{ color: "var(--text-secondary)" }}>{t("discovery.no_results")}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {refinements.map((s) => (
          <button key={s} onClick={() => onRun(s)} className="rounded-sm border px-2.5 py-1 text-[11.5px] transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>{s}</button>
        ))}
        <button onClick={() => onRun(query, true)} className="rounded-sm px-2.5 py-1 text-[11.5px] font-medium" style={{ color: "var(--section-accent)" }}>{t("discovery.search_deeper")} →</button>
      </div>
    </div>
  );
}

/** The cited enrichment dossier — every field shows where it came from; missing fields are honest. */
function DossierPanel({ d }: { d: Dossier }) {
  const anything = d.summary || d.category || d.location || d.reviews || d.emails.length || d.phones.length || d.people.length || d.graph_match;
  if (!anything) {
    return <p className="mt-2 text-[11px]" style={{ color: "var(--text-faint)" }}>Read {d.scanned} page(s) — no contact details, category, or reviews found. Missing: {d.missing.join(", ")}.</p>;
  }
  return (
    <div className="mt-2 space-y-2 rounded-sm border px-3 py-2.5 text-[11.5px]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)" }}>
      {d.graph_match && (
        <div className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={{ background: "var(--surface-card)", color: "var(--text-muted)" }}>
          <Check size={10} /> Already in your graph as “{d.graph_match.name}”
        </div>
      )}
      {d.summary && <p style={{ color: "var(--text-secondary)" }}>{d.summary.value}<ViaChip via={d.summary.via} source={d.summary.source} /></p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1" style={{ color: "var(--text-muted)" }}>
        {d.category && <span>🏷 <span style={{ color: "var(--text-secondary)" }}>{d.category.value}</span><ViaChip via={d.category.via} source={d.category.source} /></span>}
        {d.location && <span>📍 <span style={{ color: "var(--text-secondary)" }}>{d.location.value}</span><ViaChip via={d.location.via} source={d.location.source} /></span>}
        {d.reviews && <span>⭐ <span style={{ color: "var(--text-secondary)" }}>{d.reviews.rating}{d.reviews.count != null ? ` (${d.reviews.count})` : ""}</span><ViaChip via="places" source={d.reviews.source} /></span>}
      </div>
      {d.emails.map((e) => <div key={e.value} style={{ color: "var(--text-muted)" }}>✉ <span style={{ color: "var(--text-secondary)" }}>{e.value}</span><ViaChip via={e.via} source={e.source} /></div>)}
      {d.phones.map((p) => <div key={p.value} style={{ color: "var(--text-muted)" }}>☎ <span style={{ color: "var(--text-secondary)" }}>{p.value}</span><ViaChip via={p.via} source={p.source} /></div>)}
      {d.people.length > 0 && (
        <div style={{ color: "var(--text-muted)" }}>
          {d.people.map((p, i) => <div key={i}>👤 <span style={{ color: "var(--text-secondary)" }}>{p.name}{p.role ? ` (${p.role})` : ""}{p.email ? ` · ${p.email}` : ""}</span><ViaChip via={p.via} source={p.source} /></div>)}
        </div>
      )}
      {d.sources.length > 0 && (
        <div className="pt-1 text-[10px]" style={{ color: "var(--text-faint)" }}>
          Web evidence: {d.sources.map((s, i) => <a key={i} href={s.url} target="_blank" rel="noreferrer" className="mr-2 hover:underline" style={{ color: "var(--section-accent)" }}>{hostOf(s.url)}</a>)}
        </div>
      )}
      {d.missing.length > 0 && <div className="text-[10px]" style={{ color: "var(--text-faint)" }}>Not found: {d.missing.join(", ")}</div>}
    </div>
  );
}

/** Secondary pipeline chips (owner / list / task / decision) — saved/in-graph lives on the action row. */
function PipelineChips({ st }: { st: LeadStatus }) {
  const chips = [
    st.owner ? { l: `Owner set`, tone: "#717784" } : null,
    st.listed ? { l: "In list", tone: "#0d9488" } : null,
    st.tasked ? { l: "Task created", tone: "#2563eb" } : null,
    st.queued ? { l: "In Decision Queue", tone: "#7c3aed" } : null,
    // Failed action — surfaced honestly (never alongside a success chip; bulk handlers set only this).
    st.failed ? { l: "Failed", tone: "#9c6b72", title: st.failReason || "no reason returned" } : null,
  ].filter(Boolean) as { l: string; tone: string; title?: string }[];
  if (chips.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {chips.map((c) => <span key={c.l} title={c.title} className="rounded-full px-1.5 py-0.5 text-[9.5px] font-medium" style={{ color: c.tone, background: `color-mix(in srgb, ${c.tone} 14%, transparent)` }}>{c.l}</span>)}
    </div>
  );
}

interface BatchResp { created: { name: string; node_id: string }[]; already_existed: { name: string; node_id: string }[]; failed?: { name: string; reason: string }[]; skipped_details?: { name: string; reason: string }[]; saved: number; skipped: number }
interface BulkPerLead { created: number; failed: number; results: { name: string; ok: boolean; id?: string; error?: string }[] }
// Honest per-run ledger — every selected lead lands in exactly one bucket; failures carry a reason.
interface BulkLedger { verb: string; total: number; created: number; existed: number; skipped: number; failed: number; failures: { name: string; reason: string }[] }
/** Operational bulk action bar — runs real bulk endpoints, maps per-lead results back to status
 *  chips, and reports partial failures honestly (no blanket success). */
function BulkBar({ entries, query, lists, members, onApplied, onClear }: {
  entries: { key: string; r: ResultRow }[]; query: string; lists: ListRow[]; members: Member[];
  onApplied: (u: Record<string, LeadStatus>) => void; onClear: () => void;
}) {
  const qc = useQueryClient();
  const [listId, setListId] = useState<string>("");
  const [ownerId, setOwnerId] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [ledger, setLedger] = useState<BulkLedger | null>(null);
  const nameToKeys = () => { const m = new Map<string, string[]>(); for (const e of entries) { const n = toLeadPayload(e.r, query).name; (m.get(n) ?? m.set(n, []).get(n)!).push(e.key); } return m; };
  // Build an "everything failed" ledger from a thrown request (network/500) — honest, never silent.
  const allFailed = (verb: string, reason: string): BulkLedger => ({
    verb, total: entries.length, created: 0, existed: 0, skipped: 0, failed: entries.length,
    failures: entries.map((e) => ({ name: toLeadPayload(e.r, query).name, reason: reason || "no reason returned" })),
  });

  async function save(withList: boolean, withOwner: boolean) {
    setBusy("save"); setLedger(null);
    try {
      const body: Record<string, unknown> = { leads: entries.map((e) => toLeadPayload(e.r, query)) };
      if (withList && listId) body.list_id = listId;
      if (withOwner && ownerId) body.owner_id = ownerId;
      const res = await apiClient.post<BatchResp>("/discovery/save-batch", body);
      const byName = nameToKeys(); const updates: Record<string, LeadStatus> = {};
      for (const cr of res.created) for (const k of byName.get(cr.name) ?? []) updates[k] = { saved: true, node_id: cr.node_id, listed: withList && !!listId, owner: withOwner && ownerId ? ownerId : undefined };
      for (const ex of res.already_existed) for (const k of byName.get(ex.name) ?? []) updates[k] = { existed: true, node_id: ex.node_id, listed: withList && !!listId };
      // Failed leads get a FAILED chip + reason — never a success chip.
      const failures = res.failed ?? [];
      for (const f of failures) for (const k of byName.get(f.name) ?? []) updates[k] = { failed: true, failReason: f.reason };
      onApplied(updates);
      setLedger({ verb: "saved", total: entries.length, created: res.created.length, existed: res.already_existed.length, skipped: res.skipped ?? 0, failed: failures.length, failures });
      qc.invalidateQueries({ queryKey: ["nodes"] }); qc.invalidateQueries({ queryKey: ["lists"] });
    } catch (e) { setLedger(allFailed("saved", (e as Error)?.message ?? "")); }
    finally { setBusy(null); }
  }
  async function bulk(kind: "task" | "decision") {
    setBusy(kind); setLedger(null);
    try {
      const leads = entries.map((e) => { const p = toLeadPayload(e.r, query); return { name: p.name, source_url: e.r.source_url, email: e.r.email ?? undefined, phone: e.r.phone ?? undefined, summary: e.r.snippet || undefined }; });
      const res = await apiClient.post<BulkPerLead>(`/discovery/bulk-${kind}`, kind === "task" ? { leads, assignee_id: ownerId || undefined } : { leads });
      const updates: Record<string, LeadStatus> = {};
      // Results are returned in the SAME order as leads sent, so index maps back to the selected entry.
      res.results.forEach((r, i) => {
        const key = entries[i]?.key; if (!key) return;
        updates[key] = r.ok ? (kind === "task" ? { tasked: true } : { queued: true }) : { failed: true, failReason: r.error || "no reason returned" };
      });
      onApplied(updates);
      const failures = res.results.filter((r) => !r.ok).map((r) => ({ name: r.name, reason: r.error || "no reason returned" }));
      setLedger({ verb: kind === "task" ? "task(s)" : "decision(s)", total: entries.length, created: res.created, existed: 0, skipped: 0, failed: res.failed, failures });
      qc.invalidateQueries({ queryKey: [kind === "task" ? "tasks" : "decisions"] });
    } catch (e) { setLedger(allFailed(kind === "task" ? "task(s)" : "decision(s)", (e as Error)?.message ?? "")); }
    finally { setBusy(null); }
  }
  const B = ({ id, onClick, children }: { id: string; onClick: () => void; children: React.ReactNode }) => (
    <button onClick={onClick} disabled={!!busy} className="inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:border-[color:var(--section-accent)] disabled:opacity-50" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
      {busy === id ? <Loader2 size={11} className="animate-spin" /> : children}
    </button>
  );
  return (
    <div className="sticky top-2 z-10 mb-2 flex flex-wrap items-center gap-2 rounded-sm border px-3 py-2 shadow-sm" style={{ borderColor: "var(--section-accent)", background: "var(--surface-card)" }}>
      <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>{entries.length} selected</span>
      <B id="save" onClick={() => save(false, !!ownerId)}><Plus size={11} /> Save</B>
      <MenuSelect value={listId} onChange={setListId} allLabel="List…" maxWidth={130} options={lists.map((l) => ({ value: l.id, label: l.name }))} />
      <B id="save" onClick={() => save(true, !!ownerId)}>Add to list</B>
      <MenuSelect value={ownerId} onChange={setOwnerId} allLabel="Owner…" maxWidth={140} options={members.map((m) => ({ value: m.user_id, label: m.name || m.email || m.user_id }))} />
      <B id="save" onClick={() => save(false, true)}>Assign owner</B>
      <B id="task" onClick={() => bulk("task")}><CheckSquare size={11} /> Tasks</B>
      <B id="decision" onClick={() => bulk("decision")}><ShieldCheck size={11} /> To Decisions</B>
      <button onClick={onClear} className="text-[11px]" style={{ color: "var(--text-faint)" }}>Clear</button>
      {ledger && (() => {
        // Every selected lead is accounted for: created / already-in-graph / skipped / failed. No
        // blanket "success" — failed leads are named with their reason (or "no reason returned").
        const summary = [
          `${ledger.created} ${ledger.verb}`,
          ledger.existed ? `${ledger.existed} already in graph` : "",
          ledger.skipped ? `${ledger.skipped} skipped` : "",
          ledger.failed ? `${ledger.failed} failed` : "",
        ].filter(Boolean).join(" · ");
        return (
          <div className="w-full text-[11px]" style={{ color: "var(--text-muted)" }}>
            <span>{ledger.total} selected → {summary}</span>
            {ledger.failures.length > 0 && (
              <ul className="mt-1 space-y-0.5" style={{ color: "#9c6b72" }}>
                {ledger.failures.slice(0, 8).map((f, i) => (
                  <li key={`${f.name}-${i}`} className="truncate">✕ {f.name || "Unnamed lead"} — {f.reason || "no reason returned"}</li>
                ))}
                {ledger.failures.length > 8 && <li>…and {ledger.failures.length - 8} more</li>}
              </ul>
            )}
          </div>
        );
      })()}
    </div>
  );
}

/** Full-intelligence detail drawer — dossier with citations + the lead's pipeline actions. */
function LeadDrawer({ r, query, lists, members, status, onStatus, onClose }: {
  r: ResultRow; query: string; lists: ListRow[]; members: Member[]; status?: LeadStatus;
  onStatus: (s: LeadStatus) => void; onClose: () => void;
}) {
  const qc = useQueryClient();
  const name = r.author_name && r.author_name !== "Anonymous" ? r.author_name : (hostOf(r.source_url) || "Lead");
  const enrich = useQuery({ queryKey: ["enrich", r.source_url], queryFn: () => apiClient.post<Enrichment>("/discovery/enrich", { url: r.source_url, name: r.author_name, region: r.region ?? undefined }), retry: false, staleTime: 300_000 });
  const p = toLeadPayload(r, query);
  const save = useMutation({ mutationFn: () => apiClient.post<{ id: string; existed?: boolean }>("/discovery/save", p), onSuccess: (d) => { onStatus({ saved: !d.existed, existed: d.existed, node_id: d.id }); qc.invalidateQueries({ queryKey: ["nodes"] }); } });
  const task = useMutation({ mutationFn: () => apiClient.post("/discovery/lead-task", { name, node_id: status?.node_id, source_url: r.source_url }), onSuccess: () => onStatus({ tasked: true }) });
  const decision = useMutation({ mutationFn: () => apiClient.post("/discovery/lead-decision", { name, node_id: status?.node_id, summary: r.snippet || undefined, email: r.email ?? undefined, phone: r.phone ?? undefined, source_url: r.source_url }), onSuccess: () => onStatus({ queued: true }) });
  const addList = useMutation({ mutationFn: (listId: string) => apiClient.post(`/lists/${listId}/entries`, { node_id: status?.node_id }), onSuccess: () => onStatus({ listed: true }) });
  // Assign owner — updates a saved node's owner, or saves-with-owner if not saved yet.
  const assign = useMutation({
    mutationFn: async (ownerId: string) => {
      if (status?.node_id) { await apiClient.post("/discovery/assign-owner", { node_id: status.node_id, owner_id: ownerId }); return; }
      const d = await apiClient.post<{ id: string; existed?: boolean }>("/discovery/save", { ...p, owner_id: ownerId });
      onStatus({ saved: !d.existed, existed: d.existed, node_id: d.id });
    },
    onSuccess: (_r, ownerId) => { onStatus({ owner: ownerId }); qc.invalidateQueries({ queryKey: ["nodes"] }); },
  });
  // Draft first-touch outreach grounded ONLY in the lead's real signal (surfaced here as a first-class action).
  const outreach = useMutation({ mutationFn: () => apiClient.post<{ subject: string | null; message: string }>("/discovery/outreach", { name: r.author_name || hostOf(r.source_url), context: r.snippet, sector: r.target_subject ?? query, kind: "lead" }) });
  const askPrompt = `Assess this discovered lead as a prospect, using ONLY this info — name: ${name}; site: ${hostOf(r.source_url)}; what it is: ${r.snippet || "(no summary)"}; contact: ${r.email || r.phone || "none found"}. Source: ${r.source_url}. Say if it's worth pursuing and why, and do not invent details.`;
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.35)" }} onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l shadow-2xl" style={{ borderColor: "var(--border-soft)", background: "var(--surface-page)" }}>
        <div className="flex items-start justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <div className="min-w-0">
            <div className="text-[11px]" style={{ color: "var(--text-faint)" }}>{hostOf(r.source_url) || r.platform}{r.region ? ` · ${r.region}` : ""}</div>
            <a href={r.source_url} target="_blank" rel="noreferrer" className="truncate text-[15px] font-semibold hover:underline" style={{ color: "var(--section-accent)" }}>{name}</a>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-sm p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><Minus size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <PipelineChips st={{ ...(status ?? {}) }} />
          <div className="mt-1 text-[10.5px]" style={{ color: "var(--text-faint)" }}>Why it matched: {matchReasons(r).join(" · ")}</div>
          {r.snippet && <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{r.snippet}</p>}
          {enrich.isLoading ? <div className="mt-3 flex items-center gap-2 text-[12px]" style={{ color: "var(--text-muted)" }}><Loader2 size={13} className="animate-spin" /> Building dossier…</div>
            : enrich.data?.dossier ? <DossierPanel d={enrich.data.dossier} />
            : <p className="mt-3 text-[11.5px]" style={{ color: "var(--text-faint)" }}>No dossier could be built from this site.</p>}
          {/* Drafted outreach — grounded in the lead's real signal; copy to send. */}
          {outreach.isError && <p className="mt-3 text-[11px]" style={{ color: "var(--text-faint)" }}>Couldn't draft a message right now — try again.</p>}
          {outreach.data?.message && (
            <div className="mt-3 rounded-sm border px-3 py-2.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)" }}>
              {outreach.data.subject && <p className="mb-1 text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{outreach.data.subject}</p>}
              <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{outreach.data.message}</p>
              <button onClick={() => navigator.clipboard?.writeText(`${outreach.data?.subject ? outreach.data.subject + "\n\n" : ""}${outreach.data?.message ?? ""}`)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: "var(--section-accent)" }}><Copy size={11} /> Copy</button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 border-t px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          {(status?.saved || status?.existed) ? <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ color: status.existed ? "var(--text-muted)" : "#5f8169", background: status.existed ? "var(--surface-hover)" : "#5f816914" }}><Check size={11} /> {status.existed ? "In graph" : "Saved"}</span>
            : <button onClick={() => save.mutate()} disabled={save.isPending} className="inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50" style={{ background: "var(--section-accent)" }}>{save.isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Save</button>}
          {lists.length > 0 && (
            <MenuSelect value="" onChange={(v) => v && addList.mutate(v)} disabled={!status?.node_id} title={status?.node_id ? undefined : "Save the lead first"} allLabel="Add to list…" maxWidth={130} options={lists.map((l) => ({ value: l.id, label: l.name }))} />
          )}
          {members.length > 0 && (
            <MenuSelect value={status?.owner ?? ""} onChange={(v) => v && assign.mutate(v)} allLabel="Assign owner…" maxWidth={140} options={members.map((m) => ({ value: m.user_id, label: m.name || m.email || m.user_id }))} />
          )}
          <button onClick={() => task.mutate()} disabled={task.isPending} className="inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-[11px] font-medium disabled:opacity-50" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>{task.isPending ? <Loader2 size={11} className="animate-spin" /> : <CheckSquare size={11} />} Task</button>
          <button onClick={() => decision.mutate()} disabled={decision.isPending} className="inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-[11px] font-medium disabled:opacity-50" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>{decision.isPending ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />} Decision</button>
          <button onClick={() => outreach.mutate()} disabled={outreach.isPending} className="inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-[11px] font-medium disabled:opacity-50" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>{outreach.isPending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Draft outreach</button>
          <button onClick={() => { requestAsk(askPrompt); onClose(); }} className="inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-[11px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}><MessageSquare size={11} /> Ask AI</button>
        </div>
      </div>
    </>
  );
}

function LeadCard({ r, n, query, lists, selected, onToggle, bulkStatus, onDetails }: { r: ResultRow; n?: number; query: string; lists: ListRow[]; selected?: boolean; onToggle?: () => void; bulkStatus?: LeadStatus; onDetails?: () => void }) {
  const qc = useQueryClient();
  const [savedId, setSavedId] = useState<string | null>(bulkStatus?.node_id ?? null);
  const [existed, setExisted] = useState(Boolean(bulkStatus?.existed));
  const [listOpen, setListOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const leadName = r.author_name && r.author_name !== "Anonymous" ? r.author_name : (hostOf(r.source_url) || "Discovered lead");

  const enrich = useMutation({
    mutationFn: () => apiClient.post<Enrichment>("/discovery/enrich", { url: r.source_url, name: r.author_name, region: r.region ?? undefined }),
  });
  const outreach = useMutation({
    mutationFn: () => apiClient.post<{ subject: string | null; message: string }>("/discovery/outreach", { name: r.author_name || hostOf(r.source_url), context: r.snippet, sector: r.target_subject ?? query, kind: "lead" }),
  });

  const save = useMutation({
    mutationFn: () => apiClient.post<{ id: string; existed?: boolean }>("/discovery/save", {
      name: leadName,
      object_type: "company",
      source_url: r.source_url,
      discovery_query: query,
      email: r.email ?? undefined,
      phone: r.phone ?? undefined,
      handle: r.handle ?? undefined,
      region: r.region ?? undefined,
      summary: r.snippet || undefined,
    }),
    onSuccess: (d) => { setSavedId(d.id); setExisted(Boolean(d.existed)); setMsg(d.existed ? "Already in your graph" : "Saved to graph"); qc.invalidateQueries({ queryKey: ["nodes"] }); },
    onError: (e) => setMsg((e as Error)?.message ?? "Couldn't save"),
  });
  // Lead → task / decision (golden pipeline). Both work whether or not the lead is saved yet
  // (they link to the saved node when there is one).
  const leadTask = useMutation({
    mutationFn: () => apiClient.post<{ id: string }>("/discovery/lead-task", { name: leadName, node_id: savedId ?? undefined, source_url: r.source_url }),
    onSuccess: () => { setMsg("Task created"); qc.invalidateQueries({ queryKey: ["tasks"] }); },
    onError: (e) => setMsg((e as Error)?.message ?? "Couldn't create task"),
  });
  const leadDecision = useMutation({
    mutationFn: () => apiClient.post<{ id: string }>("/discovery/lead-decision", { name: leadName, node_id: savedId ?? undefined, summary: r.snippet || undefined, email: r.email ?? undefined, phone: r.phone ?? undefined, source_url: r.source_url }),
    onSuccess: () => { setMsg("Sent to Decision Queue"); qc.invalidateQueries({ queryKey: ["decisions"] }); },
    onError: (e) => setMsg((e as Error)?.message ?? "Couldn't queue"),
  });
  const addToList = useMutation({
    mutationFn: (listId: string) => apiClient.post(`/lists/${listId}/entries`, { node_id: savedId }),
    onSuccess: () => { setListOpen(false); setMsg("Added to list"); qc.invalidateQueries({ queryKey: ["lists"] }); },
    onError: (e) => setMsg((e as Error)?.message ?? "Couldn't add"),
  });

  const name = r.author_name && r.author_name !== "Anonymous" ? r.author_name : hostOf(r.source_url);
  const st: LeadStatus = { ...(bulkStatus ?? {}), saved: (bulkStatus?.saved ?? Boolean(savedId)), existed: (bulkStatus?.existed ?? existed) };
  return (
    <div className="rounded-sm border px-3.5 py-3" style={{ borderColor: selected ? "var(--section-accent)" : "var(--border-soft)", background: "var(--surface-card)" }}>
      <div className="flex items-start justify-between gap-3">
        {onToggle && (
          <input type="checkbox" checked={Boolean(selected)} onChange={onToggle} className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--section-accent)]" aria-label="Select lead" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-faint)" }}>
            {n != null && <span className="shrink-0 font-semibold tabular-nums" style={{ color: "var(--section-accent)" }}>{n}</span>}
            <Globe2 size={11} className="shrink-0" /> <span className="truncate">{hostOf(r.source_url) || r.platform}</span>
            {r.region && <><span aria-hidden>·</span><span>{r.region}</span></>}
            {r.priority && <span className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold" style={{ color: PRIORITY[r.priority].tone, background: `${PRIORITY[r.priority].tone}14` }}>{PRIORITY[r.priority].label}</span>}
            {r.confidence_score > 0 && <span className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold" style={{ color: r.confidence_score >= 70 ? "#5f8169" : "var(--text-muted)", background: r.confidence_score >= 70 ? "#5f816914" : "var(--surface-hover)" }}>{r.confidence_score}% match</span>}
          </div>
          <a href={r.source_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-[14.5px] font-semibold hover:underline" style={{ color: "var(--section-accent)" }}>
            {name} <ExternalLink size={12} className="shrink-0" style={{ color: "var(--text-faint)" }} />
          </a>
          {r.snippet && <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>{r.snippet}</p>}
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
            {r.email && <span>✉ <span style={{ color: "var(--text-secondary)" }}>{r.email}</span></span>}
            {r.phone && <span>☎ <span style={{ color: "var(--text-secondary)" }}>{r.phone}</span></span>}
            {r.handle && <span style={{ color: "var(--text-secondary)" }}>{r.handle}</span>}
          </div>
          <div className="mt-1 text-[10.5px]" style={{ color: "var(--text-faint)" }}>Why matched: {matchReasons(r).join(" · ")}</div>
        </div>
      </div>

      <PipelineChips st={st} />

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {(st.saved || st.existed) ? (
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ color: st.existed ? "var(--text-muted)" : "#5f8169", background: st.existed ? "var(--surface-hover)" : "#5f816914" }}><Check size={11} /> {st.existed ? "In graph" : "Saved"}</span>
        ) : (
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50" style={{ background: "var(--section-accent)" }}>
            {save.isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Save as lead
          </button>
        )}
        {savedId && (
          <div className="relative">
            <button onClick={() => setListOpen((o) => !o)} className="inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-[11px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
              Add to list <ChevronDown size={11} />
            </button>
            {listOpen && (
              <>
                <button className="fixed inset-0 z-20 cursor-default" onClick={() => setListOpen(false)} aria-label="Close" />
                <div className="absolute left-0 z-30 mt-1 w-56 overflow-hidden rounded-sm border shadow-lg" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
                  {lists.length === 0 ? <div className="px-3 py-2.5 text-[12px]" style={{ color: "var(--text-faint)" }}>No lists yet.</div>
                    : lists.map((l) => (
                      <button key={l.id} onClick={() => addToList.mutate(l.id)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] hover:bg-[var(--surface-hover)]" style={{ color: "var(--text-secondary)" }}>
                        <span className="truncate">{l.name}</span>
                        {addToList.isPending && addToList.variables === l.id ? <Loader2 size={11} className="animate-spin" /> : <span style={{ color: "var(--text-faint)" }}>{l.entry_count ?? 0}</span>}
                      </button>
                    ))}
                </div>
              </>
            )}
          </div>
        )}
        {/* Secondary lead actions collapsed into a squared overflow menu — every action preserved,
            same handlers, just fewer visible buttons. Save + Add-to-list stay primary above. */}
        <ActionMenu align="left" triggerLabel="More" ariaLabel="More lead actions" items={[
          ...(onDetails ? [{ key: "details", label: "Details", icon: ExternalLink, onClick: onDetails }] : []),
          { key: "enrich", label: enrich.isPending ? "Enriching…" : "Enrich", icon: Sparkles, disabled: enrich.isPending, onClick: () => enrich.mutate() },
          { key: "draft", label: outreach.isPending ? "Drafting…" : "Draft message", icon: Send, disabled: outreach.isPending, onClick: () => outreach.mutate() },
          { key: "task", label: leadTask.isPending ? "Creating…" : "Create task", icon: CheckSquare, disabled: leadTask.isPending, onClick: () => leadTask.mutate() },
          { key: "decision", label: leadDecision.isPending ? "Queuing…" : "To Decision Queue", icon: ShieldCheck, disabled: leadDecision.isPending, onClick: () => leadDecision.mutate() },
          { key: "ask", label: "Ask AI", icon: MessageSquare, onClick: () => requestAsk(`Research this Discovery lead using only source-backed info: ${name}. Source: ${r.source_url}. Why do they match "${query}", what evidence exists, red flags, and best next action. If no reviews are found, say "No review source found".`) },
        ]} />
        {msg && <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{msg}</span>}
      </div>

      {/* Enrichment results — real contacts + decision-makers pulled from the lead's own site. */}
      {enrich.isError && <p className="mt-2 text-[11px]" style={{ color: "var(--text-faint)" }}>Couldn't enrich (site unreachable).</p>}
      {enrich.data && (enrich.data.dossier ? <DossierPanel d={enrich.data.dossier} /> : (
        <p className="mt-2 text-[11px]" style={{ color: "var(--text-faint)" }}>No extra contacts found on their site.</p>
      ))}

      {/* Drafted outreach — grounded in the lead's real signal; copy to send. */}
      {(outreach.isError || (outreach.data && !outreach.data.message)) && (
        <p className="mt-2 text-[11px]" style={{ color: "var(--text-faint)" }}>Couldn't draft a message right now — try again.</p>
      )}
      {outreach.data?.message && (
        <div className="mt-2 rounded-sm border px-3 py-2.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)" }}>
          {outreach.data.subject && <p className="mb-1 text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{outreach.data.subject}</p>}
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{outreach.data.message}</p>
          <button onClick={() => navigator.clipboard?.writeText(`${outreach.data?.subject ? outreach.data.subject + "\n\n" : ""}${outreach.data?.message ?? ""}`)}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: "var(--section-accent)" }}>
            <Copy size={11} /> Copy
          </button>
        </div>
      )}
    </div>
  );
}

interface Monitor { id: string; query: string; enabled?: boolean; last_run_at?: string | null; params?: { last_new?: number; last_total?: number } | Record<string, unknown>; created_at?: string }
/** Watched searches (monitors) management — lists the saved searches that re-run daily and alert you
 *  to new results, with delete. Creation happens via "Watch this search" after a run; this is where
 *  you see and manage them. Uses the real GET/DELETE /discovery/monitors endpoints. */
function MonitorsPanel() {
  const qc = useQueryClient();
  const monitorsQ = useQuery<Monitor[]>({ queryKey: ["discovery-monitors"], queryFn: () => apiClient.get<Monitor[]>("/discovery/monitors"), retry: false });
  const del = useMutation({ mutationFn: (id: string) => apiClient.delete(`/discovery/monitors/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["discovery-monitors"] }) });
  const mons = monitorsQ.data ?? [];
  const rel = (iso?: string | null) => { if (!iso) return "not run yet"; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
  return (
    <div className="mb-4 rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      <div className="flex items-center gap-1.5 border-b px-3.5 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
        <Bell size={13} style={{ color: "var(--section-accent)" }} />
        <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>Watched searches</span>
        {mons.length > 0 && <span className="text-[11px] tabular-nums" style={{ color: "var(--text-faint)" }}>{mons.length}</span>}
        <span className="ml-auto text-[10.5px]" style={{ color: "var(--text-faint)" }}>re-run daily · alerts on new results</span>
      </div>
      {monitorsQ.isLoading ? (
        <div className="flex items-center gap-2 px-3.5 py-3 text-[12px]" style={{ color: "var(--text-muted)" }}><Loader2 size={12} className="animate-spin" /> Loading…</div>
      ) : mons.length === 0 ? (
        <p className="px-3.5 py-3 text-[11.5px]" style={{ color: "var(--text-faint)" }}>No watched searches yet. After a search, use <span style={{ color: "var(--text-secondary)" }}>“Watch this search”</span> to get alerted when new results appear.</p>
      ) : (
        <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
          {mons.map((m) => {
            const lastNew = (m.params as { last_new?: number } | undefined)?.last_new;
            return (
              <div key={m.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <Radar size={12} className="shrink-0" style={{ color: "var(--text-faint)" }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px]" style={{ color: "var(--text-primary)" }}>{m.query}</div>
                  <div className="text-[10.5px]" style={{ color: "var(--text-faint)" }}>Last run {rel(m.last_run_at)}{typeof lastNew === "number" && lastNew > 0 ? ` · ${lastNew} new` : ""}</div>
                </div>
                <button onClick={() => del.mutate(m.id)} disabled={del.isPending && del.variables === m.id} title="Stop watching" className="btn-icon h-7 w-7" style={{ color: "var(--text-faint)" }}>
                  {del.isPending && del.variables === m.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Saved leads — real graph records sourced through Discovery (data.source === "discovery"). */
function SavedLeads({ lists }: { lists: ListRow[] }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["nodes", "discovery-saved-all"],
    queryFn: async () => {
      const types = ["company", "people"];
      const all = await Promise.all(types.map((t) => apiClient.get<any[]>(`/nodes?object_type=${t}&limit=300`).catch(() => [])));
      return all.flat().filter((n) => n?.data?.source === "discovery" || n?.data?.source_url || n?.data?.discovery_query);
    },
    staleTime: 20_000,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/nodes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nodes", "discovery-saved-all"] }),
  });
  void lists;

  const rows = q.data ?? [];
  // The saved view always leads with the Watched-searches (monitors) manager, then saved leads.
  const leadsSection = q.isLoading ? (
    <DelayedLoading onRetry={() => q.refetch()}><PageSkeletonCards count={4} label="Loading saved leads…" /></DelayedLoading>
  ) : q.isError ? (
    <ErrorState error={q.error as Error} onRetry={() => q.refetch()} />
  ) : rows.length === 0 ? (
    <EmptyState icon={Users} title="No saved leads yet" description={"Run a search and “Save as lead” to build your list here."} />
  ) : (
    <div className="space-y-2">
      {rows.map((r) => {
          const d = r.data ?? {};
          const name = String(d.name ?? d.company ?? d.title ?? "Untitled");
          return (
            <div key={r.id} className="flex items-start justify-between gap-3 rounded-sm border px-3.5 py-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
              <div className="min-w-0">
                <div className="text-[11px]" style={{ color: "var(--text-faint)" }}>{hostOf(String(d.source_url ?? d.website ?? "")) || "no source"}</div>
                <Link to={`/objects/${r.object_type}/${r.id}`} className="mt-0.5 inline-block max-w-full truncate text-[14px] font-semibold hover:underline" style={{ color: "var(--section-accent)" }}>{name}</Link>
                <p className="mt-0.5 line-clamp-2 text-[12px]" style={{ color: "var(--text-muted)" }}>{String(d.description ?? d.email ?? d.phone ?? "")}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Link to={`/objects/${r.object_type}/${r.id}`} className="rounded-sm border px-2.5 py-1 text-[11px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>Open</Link>
                <button onClick={() => remove.mutate(r.id)} disabled={remove.isPending && remove.variables === r.id} className="inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-[11px] font-medium" style={{ color: "#9c6b72", background: "#9c6b720d" }}>
                  {remove.isPending && remove.variables === r.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                </button>
              </div>
            </div>
          );
        })}
    </div>
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      <MonitorsPanel />
      {leadsSection}
    </div>
  );
}
