import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowUp, Check, ChevronDown, ExternalLink, Globe2, Loader2, MessageSquare,
  Plus, Radar, Sparkles, Star, ThumbsDown, ThumbsUp, Minus, Users, Trash2, Bell,
} from "lucide-react";
import { apiClient, apiFetch, BASE_URL } from "../../lib/api-client";
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

const EXAMPLES = [
  { icon: Users, label: "Aesthetic clinics in London", q: "aesthetic clinics in London" },
  { icon: Star, label: "Reviews about Trustpilot", q: "what do people say about Trustpilot" },
  { icon: Users, label: "Solar installers in Texas", q: "commercial solar installers in Texas" },
  { icon: Star, label: "Reviews about Acme Corp", q: "reviews and complaints about Acme Corp" },
];

const hostOf = (url?: string | null) => {
  if (!url) return "";
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return String(url).replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? ""; }
};
const uid = () => `t_${Math.random().toString(36).slice(2)}_${performance.now().toString(36)}`;

const SENTIMENT: Record<Exclude<Sentiment, null>, { label: string; tone: string; Icon: typeof ThumbsUp }> = {
  positive: { label: "Positive", tone: "#15803d", Icon: ThumbsUp },
  negative: { label: "Negative", tone: "#be123c", Icon: ThumbsDown },
  neutral:  { label: "Neutral",  tone: "#737373", Icon: Minus },
  mixed:    { label: "Mixed",    tone: "#a9782a", Icon: Minus },
};

export function DiscoveryPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<"chat" | "saved">("chat");
  const [input, setInput] = useState("");
  const [deep, setDeep] = useState(false);
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
    try { coach = await apiClient.post("/discovery/coach", { query }); } catch { coach = { specific: true }; }
    setBusy(false);
    if (!coach || coach.specific !== false) { runSearch(query); return; }
    setTurns((t) => [...t, { id: uid(), query, deep, steps: [], results: [], status: "coach", coach: { message: coach!.coach_message || "That's a bit broad — pick one to get sharper results:", suggestions: (coach!.suggestions || []).slice(0, 5) } }]);
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
        body: JSON.stringify({ query, deep }),
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
      {/* header */}
      <div className="flex items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "var(--surface-hover)" }}>
            <Radar size={16} style={{ color: "var(--section-accent)" }} />
          </span>
          <div>
            <h1 className="text-[16px] font-semibold leading-none" style={{ color: "var(--text-primary)" }}>Discovery</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]" style={{ color: "var(--text-faint)" }}>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: degraded ? "#d97706" : "#15803d" }} />
                {degraded ? "Search engine offline" : "Web search online"}
              </span>
              {connectorsQ.data && (
                <>
                  <Source label={connectorsQ.data.places.provider === "google" ? "Google Maps" : "OpenStreetMap"} ok={connectorsQ.data.places.ok} detail={connectorsQ.data.places.detail} />
                  <Source label="Reddit" ok={connectorsQ.data.reddit.ok} detail={connectorsQ.data.reddit.detail} muted={!connectorsQ.data.reddit.enabled} />
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {view === "chat" && turns.length > 0 && (
            <button onClick={clearHistory} title="Clear search history" className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
              <Trash2 size={12} /> Clear
            </button>
          )}
          <div className="flex overflow-hidden rounded-md border" style={{ borderColor: "var(--border-soft)" }}>
            {(["chat", "saved"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className="px-3 py-1.5 text-[12px] font-medium capitalize transition-colors"
                style={{ background: view === v ? "var(--surface-selected)" : "transparent", color: view === v ? "var(--text-primary)" : "var(--text-muted)" }}>
                {v === "chat" ? "Discover" : "Saved leads"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {degraded && (
        <div className="mb-3 flex items-start gap-2 rounded-md border px-3 py-2.5 text-[12px]" style={{ borderColor: "#d9770633", background: "#d977060f", color: "#92400e" }}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{statusQ.data?.diagnostic ?? "The search appliance isn't reachable, so Discovery can't return live results yet."}</span>
        </div>
      )}

      {view === "saved" ? (
        <SavedLeads lists={listsQ.data ?? []} />
      ) : (
        <>
          {/* conversation */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-4">
            {turns.length === 0 ? (
              <Empty onPick={onSubmit} />
            ) : (
              <div className="space-y-6">
                {turns.map((t) => <TurnView key={t.id} turn={t} lists={listsQ.data ?? []} onRun={onSubmit} />)}
              </div>
            )}
          </div>

          {/* composer */}
          <div className="border-t py-3" style={{ borderColor: "var(--border-soft)" }}>
            <div className="rounded-2xl border px-3 py-2.5 transition-colors focus-within:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(input); } }}
                rows={1}
                placeholder="Find leads or reviews — e.g. “aesthetic clinics in London” or “reviews about Acme Corp”"
                className="max-h-32 w-full resize-none bg-transparent text-[14px] outline-none"
                style={{ color: "var(--text-primary)" }}
              />
              <div className="mt-2 flex items-center justify-between">
                <button onClick={() => setDeep((d) => !d)} title="Deep mode visits each business's own site to harvest emails & phones"
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors"
                  style={{ borderColor: deep ? "var(--section-accent)" : "var(--border-soft)", color: deep ? "var(--section-accent)" : "var(--text-muted)" }}>
                  <Sparkles size={12} /> Deep mode {deep ? "on" : "off"}
                </button>
                <button onClick={() => onSubmit(input)} disabled={!input.trim() || busy}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40" style={{ background: "var(--section-accent)" }}>
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} />}
                </button>
              </div>
            </div>
            <p className="mt-1.5 text-center text-[10.5px]" style={{ color: "var(--text-faint)" }}>
              Every result is bound to a real source page — Discovery never invents leads or reviews.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/** Tiny data-source status chip in the header — hover shows the live diagnostic detail. */
function Source({ label, ok, detail, muted }: { label: string; ok: boolean; detail: string; muted?: boolean }) {
  const color = muted ? "var(--text-faint)" : ok ? "#15803d" : "#d97706";
  return (
    <span className="inline-flex items-center gap-1" title={detail} style={{ color: "var(--text-faint)" }}>
      <span aria-hidden>·</span>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}

function Empty({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: "var(--surface-hover)" }}>
        <Radar size={22} style={{ color: "var(--section-accent)" }} />
      </span>
      <h2 className="mt-4 text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>Find real leads & reviews online</h2>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
        Ask in plain language. Discovery searches the open web, reads the pages, and brings back
        source-backed prospects — or what people are really saying about a business.
      </p>
      <div className="mt-6 grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
        {EXAMPLES.map((ex) => (
          <button key={ex.q} onClick={() => onPick(ex.q)}
            className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-[12.5px] transition-colors hover:border-[color:var(--section-accent)]"
            style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
            <ex.icon size={14} style={{ color: "var(--section-accent)" }} /> {ex.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TurnView({ turn, lists, onRun }: { turn: Turn; lists: ListRow[]; onRun: (q: string, force?: boolean) => void }) {
  const reviews = turn.kind === "REVIEWS";
  return (
    <div>
      {/* user query bubble */}
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm px-3.5 py-2 text-[13.5px]" style={{ background: "var(--section-accent)", color: "#fff" }}>
          {turn.query}
          {turn.deep && <span className="ml-2 text-[10px] opacity-80">· deep</span>}
        </div>
      </div>

      {/* Coach turn — vague query: guide instead of running a poor sweep. */}
      {turn.status === "coach" && turn.coach && (
        <div className="mt-3">
          <div className="flex items-start gap-2 rounded-lg border px-3 py-2.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
            <Sparkles size={14} className="mt-0.5 shrink-0" style={{ color: "var(--section-accent)" }} />
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{turn.coach.message}</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {turn.coach.suggestions.map((s) => (
              <button key={s} onClick={() => onRun(s)} className="rounded-full border px-2.5 py-1 text-[12px] transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>{s}</button>
            ))}
            <button onClick={() => onRun(turn.query, true)} className="rounded-full px-2.5 py-1 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>Search “{turn.query}” anyway →</button>
          </div>
        </div>
      )}

      {/* assistant response */}
      {turn.status !== "coach" && (
      <div className="mt-3">
        <StepTrace steps={turn.steps} status={turn.status} />

        {turn.status === "error" && (
          <div className="mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-[12.5px]" style={{ borderColor: "#be123c33", background: "#be123c0d", color: "#be123c" }}>
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {turn.error}
          </div>
        )}

        {/* Overview (shows once available). */}
        {turn.overview && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border px-3 py-2.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
            <Sparkles size={14} className="mt-0.5 shrink-0" style={{ color: "var(--section-accent)" }} />
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{turn.overview}</p>
          </div>
        )}

        {/* Results render as soon as they stream in — independent of the final done event. */}
        {turn.results.length > 0 ? (
          <>
            <div className="mt-3 mb-2 flex flex-wrap items-center gap-2 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
              <strong style={{ color: "var(--text-primary)" }}>{turn.results.length}</strong> {reviews ? "reviews / mentions" : "leads"}
              <span aria-hidden>·</span> from {turn.scanned ?? 0} sources
              {reviews && <SentimentSummary results={turn.results} />}
              {!reviews && <SaveAllLeads results={turn.results} query={turn.query} />}
            </div>
            <div className="space-y-2">
              {turn.results.map((r, i) =>
                reviews
                  ? <ReviewCard key={`${r.source_url}-${i}`} r={r} />
                  : <LeadCard key={`${r.source_url}-${i}`} r={r} query={turn.query} lists={lists} />,
              )}
            </div>
            <WatchButton query={turn.query} />
          </>
        ) : turn.status === "done" && !turn.error ? (
          <p className="mt-2 text-[12.5px]" style={{ color: "var(--text-faint)" }}>No on-topic {reviews ? "reviews" : "leads"} found in the pages read. Try a clearer name or sector.</p>
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

/** Heuristic "what next" chips after a search — client-side, no extra AI call. */
function NextMoves({ turn, onRun }: { turn: Turn; onRun: (q: string, force?: boolean) => void }) {
  const chips: string[] = [];
  const reviews = turn.kind === "REVIEWS";
  const thin = turn.results.length > 0 && turn.results.length < 10;
  if (!reviews && turn.results[0]) {
    const top = turn.results[0].author_name;
    if (top && top !== "Anonymous" && !top.startsWith("u/")) chips.push(`reviews about ${top}`);
  }
  if (thin) chips.push(`${turn.query} — deep`);
  if (!chips.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>Next:</span>
      {chips.map((c) => (
        <button key={c} onClick={() => onRun(c)} className="rounded-full border px-2.5 py-0.5 text-[11.5px] transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>{c}</button>
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
  if (state === "done") return <p className="mt-2 inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: "#15803d" }}><Check size={12} /> Watching — you'll be notified of new results</p>;
  return (
    <button onClick={save} disabled={state === "saving"}
      className="mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:border-[color:var(--section-accent)]"
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
    <div className="rounded-lg border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px]" style={{ color: "var(--text-muted)" }}>
        {status === "streaming" ? <Loader2 size={13} className="animate-spin shrink-0" style={{ color: "var(--section-accent)" }} /> : <Check size={13} className="shrink-0" style={{ color: "#15803d" }} />}
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
      await apiClient.post("/discovery/save-batch", { leads });
      setState("done");
      qc.invalidateQueries({ queryKey: ["nodes"] });
    } catch { setState("error"); }
  };
  if (state === "done") return <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: "#15803d" }}><Check size={12} /> All {results.length} saved</span>;
  return (
    <button onClick={save} disabled={state === "saving"} className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium text-white disabled:opacity-50" style={{ background: "var(--section-accent)" }}>
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

function ReviewCard({ r }: { r: ResultRow }) {
  const s = r.sentiment ? SENTIMENT[r.sentiment] : null;
  return (
    <div className="rounded-lg border px-3.5 py-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[11.5px]" style={{ color: "var(--text-faint)" }}>
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

function LeadCard({ r, query, lists }: { r: ResultRow; query: string; lists: ListRow[] }) {
  const qc = useQueryClient();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => apiClient.post<{ id: string }>("/discovery/save", {
      name: r.author_name && r.author_name !== "Anonymous" ? r.author_name : (hostOf(r.source_url) || "Discovered lead"),
      object_type: "company",
      source_url: r.source_url,
      discovery_query: query,
      email: r.email ?? undefined,
      phone: r.phone ?? undefined,
      handle: r.handle ?? undefined,
      region: r.region ?? undefined,
      summary: r.snippet || undefined,
    }),
    onSuccess: (d) => { setSavedId(d.id); setMsg("Saved to graph"); qc.invalidateQueries({ queryKey: ["nodes"] }); },
    onError: (e) => setMsg((e as Error)?.message ?? "Couldn't save"),
  });
  const addToList = useMutation({
    mutationFn: (listId: string) => apiClient.post(`/lists/${listId}/entries`, { node_id: savedId }),
    onSuccess: () => { setListOpen(false); setMsg("Added to list"); qc.invalidateQueries({ queryKey: ["lists"] }); },
    onError: (e) => setMsg((e as Error)?.message ?? "Couldn't add"),
  });

  const name = r.author_name && r.author_name !== "Anonymous" ? r.author_name : hostOf(r.source_url);
  return (
    <div className="rounded-lg border px-3.5 py-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-faint)" }}>
            <Globe2 size={11} className="shrink-0" /> <span className="truncate">{hostOf(r.source_url) || r.platform}</span>
            {r.region && <><span aria-hidden>·</span><span>{r.region}</span></>}
            {r.confidence_score > 0 && <span className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold" style={{ color: r.confidence_score >= 70 ? "#15803d" : "var(--text-muted)", background: r.confidence_score >= 70 ? "#15803d14" : "var(--surface-hover)" }}>{r.confidence_score}% match</span>}
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
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {savedId ? (
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ color: "#15803d", background: "#15803d14" }}><Check size={11} /> Saved</span>
        ) : (
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50" style={{ background: "var(--section-accent)" }}>
            {save.isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Save as lead
          </button>
        )}
        {savedId && (
          <div className="relative">
            <button onClick={() => setListOpen((o) => !o)} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
              Add to list <ChevronDown size={11} />
            </button>
            {listOpen && (
              <>
                <button className="fixed inset-0 z-20 cursor-default" onClick={() => setListOpen(false)} aria-label="Close" />
                <div className="absolute left-0 z-30 mt-1 w-56 overflow-hidden rounded-md border shadow-lg" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
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
        <button onClick={() => requestAsk(`Research this Discovery lead using only source-backed info: ${name}. Source: ${r.source_url}. Why do they match "${query}", what evidence exists, red flags, and best next action. If no reviews are found, say "No review source found".`)}
          className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
          <MessageSquare size={11} /> Ask AI
        </button>
        {msg && <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{msg}</span>}
      </div>
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

  if (q.isLoading) return <div className="flex items-center gap-2 py-16 text-[13px]" style={{ color: "var(--text-muted)" }}><Loader2 size={14} className="animate-spin" /> Loading saved leads…</div>;
  const rows = q.data ?? [];
  if (rows.length === 0) return (
    <div className="grid flex-1 place-items-center py-20 text-center">
      <div>
        <Users size={22} className="mx-auto mb-2" style={{ color: "var(--text-faint)" }} />
        <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>No saved leads yet</p>
        <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-muted)" }}>Run a search and “Save as lead” to build your list here.</p>
      </div>
    </div>
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      <div className="space-y-2">
        {rows.map((r) => {
          const d = r.data ?? {};
          const name = String(d.name ?? d.company ?? d.title ?? "Untitled");
          return (
            <div key={r.id} className="flex items-start justify-between gap-3 rounded-lg border px-3.5 py-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
              <div className="min-w-0">
                <div className="text-[11px]" style={{ color: "var(--text-faint)" }}>{hostOf(String(d.source_url ?? d.website ?? "")) || "no source"}</div>
                <Link to={`/objects/${r.object_type}/${r.id}`} className="mt-0.5 inline-block max-w-full truncate text-[14px] font-semibold hover:underline" style={{ color: "var(--section-accent)" }}>{name}</Link>
                <p className="mt-0.5 line-clamp-2 text-[12px]" style={{ color: "var(--text-muted)" }}>{String(d.description ?? d.email ?? d.phone ?? "")}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Link to={`/objects/${r.object_type}/${r.id}`} className="rounded-full border px-2.5 py-1 text-[11px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>Open</Link>
                <button onClick={() => remove.mutate(r.id)} disabled={remove.isPending && remove.variables === r.id} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ color: "#be123c", background: "#be123c0d" }}>
                  {remove.isPending && remove.variables === r.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
