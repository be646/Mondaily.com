import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Radar, ExternalLink, Search, Loader2, TrendingUp, Star, AlertTriangle, Mail, Phone, Check, UserPlus, Download, Send, X, Inbox, ArrowUpRight, Sparkles, Eye, Pickaxe, Bell } from "lucide-react";
import { apiClient, apiFetch, getAuthHeaders } from "../../lib/api-client";
import { enrichPerson } from "../../lib/ai-enrichment";
import { PageHeader, PageSkeleton } from "../../components/ui/page-state";

interface DiscoveredLead {
  id: string;
  source_url: string | null;
  platform: string | null;
  author_name: string | null;
  raw_content: string | null;
  intent_type: "BUY_SIGNAL" | "REVIEW" | "COMPLAINT";
  target_subject: string | null;
  region: string | null;
  confidence_score: number | null;
  created_at: string;
  contact?: { email?: string | null; phone?: string | null; handle?: string | null; summary?: string | null } | null;
}

type SearchType = "INTENT_LEADS" | "REVIEWS";

const INTENT: Record<string, { label: string; c: string; b: string; icon: typeof Star }> = {
  BUY_SIGNAL: { label: "Buy signal", c: "#15803d", b: "#ecfdf3", icon: TrendingUp },
  REVIEW:     { label: "Review",     c: "#1d4ed8", b: "#eff4ff", icon: Star },
  COMPLAINT:  { label: "Complaint",  c: "#b91c1c", b: "#fef2f2", icon: AlertTriangle },
};

const FILTERS = [["all", "All"], ["BUY_SIGNAL", "Buy signals"], ["REVIEW", "Reviews"], ["COMPLAINT", "Complaints"]] as const;

export function DiscoveryPage() {
  const qc = useQueryClient();
  // Single Google-style search box — one free-text query. The AI classifies it into leads-vs-
  // reviews + sector/region/subject server-side, instead of the user filling out a form.
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("all");

  const leadsQ = useQuery({
    queryKey: ["discovery"],
    queryFn: () => apiClient.get<DiscoveredLead[]>("/discovery"),
    refetchInterval: 12_000,
  });
  const statusQ = useQuery({
    queryKey: ["discovery-status"],
    queryFn: () => apiClient.get<{ status: "HEALTHY" | "DEGRADED"; services: { searxng_reachable: boolean; scraper_reachable: boolean } }>("/discovery/status"),
    staleTime: 60_000,
  });
  // The strongest leads (confidence >=70 + real contact) auto-queue in the Decision Queue for
  // one-click approval — surface that count here so it's obvious where they went.
  const queuedQ = useQuery({
    queryKey: ["decisions", "pending"],
    queryFn: () => apiClient.get<{ agent_name: string; status: string }[]>("/decisions?status=pending"),
    staleTime: 20_000,
  });
  const queuedCount = (queuedQ.data ?? []).filter((d) => d.agent_name === "discovery").length;

  // ── Streaming search — watch the agent work live instead of a spinner ──
  type SweepResult = {
    ok?: boolean; discovered?: number; scanned?: number; queued?: number; error?: string; reason?: string; status?: string; overview?: string | null;
    classified?: { searchType: SearchType; sector?: string; region?: string; targetSubject?: string };
    diag?: { queries: number; hits: number; unique: number; scraped?: number; pages_analyzed?: number; gateway: boolean; extracted: number; matched: number };
  };
  const [deep, setDeep] = useState(false);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [overview, setOverview] = useState<string | null>(null);
  const [result, setResult] = useState<SweepResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function runSearch() {
    if (searching || !query.trim()) return;
    setSearching(true); setProgress([]); setOverview(null); setResult(null); setSearchError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 180_000); // hard ceiling
    try {
      const apiUrl = (import.meta.env.VITE_API_URL as string) || "";
      const headers = await getAuthHeaders();
      const res = await apiFetch(`${apiUrl}/api/v1/discovery/search/stream`, {
        method: "POST", headers, signal: controller.signal,
        body: JSON.stringify({ query: query.trim(), deep }),
      });
      if (!res.ok || !res.body) throw new Error((await res.text().catch(() => "")) || `Search error: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          let ev: any;
          try { ev = JSON.parse(t.slice(5).trim()); } catch { continue; }
          if (ev.type === "progress") setProgress((p) => [...p.slice(-11), ev.message as string]);
          else if (ev.type === "overview") setOverview(ev.text as string);
          else if (ev.type === "done") { setResult(ev as SweepResult); if (ev.overview) setOverview(ev.overview as string); }
          else if (ev.type === "error") setSearchError(ev.error as string);
        }
      }
      qc.invalidateQueries({ queryKey: ["discovery"] });
      qc.invalidateQueries({ queryKey: ["decisions", "pending"] });
    } catch (e) {
      // Fall back to the non-streaming endpoint (older API deploys / proxies that buffer SSE).
      try {
        const r = await apiClient.post<SweepResult>("/discovery/search", { query: query.trim(), deep });
        setResult(r); if (r.overview) setOverview(r.overview);
        qc.invalidateQueries({ queryKey: ["discovery"] });
      } catch (e2) {
        setSearchError(e2 instanceof Error ? e2.message : e instanceof Error ? e.message : "Search failed");
      }
    } finally {
      clearTimeout(timer);
      setSearching(false);
    }
  }

  // ── Saved-search monitors — "watch this search", re-run daily by the agent ──
  const monitorsQ = useQuery({
    queryKey: ["discovery-monitors"],
    queryFn: () => apiClient.get<{ id: string; query: string; last_run_at?: string | null; last_new?: number }[]>("/discovery/monitors"),
    staleTime: 60_000,
  });
  const addMonitor = useMutation({
    mutationFn: (q: string) => apiClient.post("/discovery/monitors", { query: q }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["discovery-monitors"] }),
  });
  const removeMonitor = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/discovery/monitors/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["discovery-monitors"] }),
  });
  const monitors = monitorsQ.data ?? [];
  const isWatched = monitors.some((m) => m.query.toLowerCase() === query.trim().toLowerCase());

  // Promote a discovered lead into a real People record (name + email + phone + note + source),
  // then AUTO-ENRICH it: the enrichment agent immediately fills company/role/site from a real web
  // pass (never fabricated — empty when nothing is found).
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const addLead = useMutation({
    mutationFn: async (r: DiscoveredLead) => {
      const baseData: Record<string, unknown> = {
        name: r.author_name && r.author_name !== "Anonymous" ? r.author_name : (r.contact?.handle || r.target_subject || "Discovered lead"),
        email: r.contact?.email || undefined,
        phone: r.contact?.phone || undefined,
        handle: r.contact?.handle || undefined,
        notes: [r.contact?.summary, r.raw_content && `“${r.raw_content}”`, r.source_url && `Source: ${r.source_url}`].filter(Boolean).join("\n\n"),
        source: "discovery",
        lead_type: r.intent_type,
      };
      const node = await apiClient.post<{ id: string }>("/nodes", { vertical: "shared", object_type: "people", data: baseData });
      // Fire-and-forget enrichment — merge real, non-empty fields ONTO the base data (the nodes
      // PATCH replaces `data` wholesale, so we must send the full merged object; the lead's own
      // fields always win over enrichment).
      if (r.contact?.email && node?.id) {
        void enrichPerson(r.contact.email).then((enr) => {
          const fields = Object.fromEntries(Object.entries(enr.fields ?? {}).filter(([, v]) => v != null && v !== ""));
          if (Object.keys(fields).length) {
            return apiClient.patch(`/nodes/${node.id}`, { data: { ...fields, ...baseData } }).then(() => {
              qc.invalidateQueries({ queryKey: ["records", "people"] });
            });
          }
        }).catch(() => {});
      }
      return node;
    },
    onSuccess: (_d, r) => setAdded((m) => ({ ...m, [r.id]: true })),
  });

  const all = leadsQ.data ?? [];
  const rows = filter === "all" ? all : all.filter((r) => r.intent_type === filter);
  const counts = {
    all: all.length,
    BUY_SIGNAL: all.filter((r) => r.intent_type === "BUY_SIGNAL").length,
    REVIEW: all.filter((r) => r.intent_type === "REVIEW").length,
    COMPLAINT: all.filter((r) => r.intent_type === "COMPLAINT").length,
  } as Record<string, number>;
  const withContact = all.filter((r) => r.contact?.email || r.contact?.phone).length;
  const avgConf = all.length ? Math.round(all.reduce((s, r) => s + (r.confidence_score ?? 0), 0) / all.length) : 0;

  // ── Bulk selection + CSV export ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const bulkAdd = useMutation({
    mutationFn: async (list: DiscoveredLead[]) => {
      for (const r of list) if (!added[r.id]) { try { await addLead.mutateAsync(r); } catch { /* skip failures */ } }
    },
    onSuccess: () => setSelected(new Set()),
  });
  // Clear stale results — the whole feed (fresh start) or one lead.
  const clearAll = useMutation({
    mutationFn: () => apiClient.delete("/discovery/all"),
    onSuccess: () => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ["discovery"] }); },
  });
  const removeLead = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/discovery/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["discovery"] }),
  });
  // Compose + send an email to a lead — through our own system (Gmail/Resend), not mailto.
  const [compose, setCompose] = useState<{ lead: DiscoveredLead; subject: string; body: string } | null>(null);
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const sendEmail = useMutation({
    mutationFn: (c: { to: string; subject: string; body: string; name?: string }) =>
      apiClient.post("/emails/compose", { to: c.to, subject: c.subject, body: c.body.replace(/\n/g, "<br>"), name: c.name }),
    onSuccess: () => { setSendMsg("Sent ✓"); setTimeout(() => { setCompose(null); setSendMsg(null); }, 1200); },
    onError: (e) => setSendMsg(e instanceof Error ? e.message : "Couldn't send."),
  });

  function exportCSV(list: DiscoveredLead[]) {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\n/g, " ")}"`;
    const header = ["name", "type", "email", "phone", "handle", "note", "review", "subject", "region", "confidence", "source_url", "found_at"];
    const lines = list.map((r) => [r.author_name, r.intent_type, r.contact?.email, r.contact?.phone, r.contact?.handle, r.contact?.summary, r.raw_content, r.target_subject, r.region, r.confidence_score, r.source_url, r.created_at].map(esc).join(","));
    const blob = new Blob(["﻿" + [header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `discovery-leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Discovery"
        description="Search anything — the agent scans the open web and finds real, source-backed leads and reviews."
      />

      {/* Strong leads already routed to the Decision Queue for one-click approval */}
      {queuedCount > 0 && (
        <Link
          to="/decisions"
          className="flex items-center justify-between gap-3 rounded-sm border px-4 py-3 transition-colors hover:border-[color:var(--section-accent)]"
          style={{ borderColor: "var(--section-accent-line)", background: "var(--section-accent-soft)" }}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--section-accent)", color: "#000" }}>
              <Inbox size={15} />
            </span>
            <div>
              <div className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                {queuedCount} strong lead{queuedCount === 1 ? "" : "s"} queued for your approval
              </div>
              <div className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>High confidence + a real contact — the Discovery Agent already found these, review in the Decision Deck.</div>
            </div>
          </div>
          <ArrowUpRight size={16} className="shrink-0" style={{ color: "var(--section-accent)" }} />
        </Link>
      )}

      {/* Health banner — only when the self-hosted search stack is degraded */}
      {statusQ.data && statusQ.data.status === "DEGRADED" && (
        <div className="flex items-start gap-3 rounded-sm border px-4 py-3" style={{ borderColor: "#e9d8a6", background: "#fdfaf0" }}>
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="text-[12.5px] leading-relaxed text-amber-900">
            <span className="font-medium">Search stack is degraded.</span>{" "}
            {(statusQ.data as { diagnostic?: string }).diagnostic
              ?? "Sweeps will return nothing until the self-hosted appliance is reachable."}
          </div>
        </div>
      )}

      {/* ── Single Google-style search — one box, AI classifies intent + extracts sector/region/subject ── */}
      <section>
        <div
          className="discovery-search-bar flex items-center gap-2.5 rounded-full border px-3 py-2 transition-all sm:px-4"
          style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 18px 40px -28px rgba(0,0,0,0.16)" }}
        >
          <Search size={17} className="shrink-0" style={{ color: "var(--text-faint)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && query.trim() && !searching) void runSearch(); }}
            placeholder="Search anything — real estate agents in London, reviews for Vivacy, SaaS companies that raised a seed round…"
            className="flex-1 min-w-0 bg-transparent px-1 py-1.5 text-[15px] leading-6 outline-none"
            style={{ color: "var(--text-primary)" }}
          />
          {/* Deep mode — second-pass contact harvest from the businesses' own sites */}
          <button
            onClick={() => setDeep((d) => !d)}
            title={deep ? "Deep mode ON — also visits business sites for emails/phones (slower, more contacts)" : "Deep mode — also visit business sites for emails/phones"}
            className="shrink-0 flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors"
            style={deep
              ? { borderColor: "var(--section-accent)", color: "var(--section-accent)", background: "var(--section-accent-soft)" }
              : { borderColor: "var(--border-soft)", color: "var(--text-muted)" }}
          >
            <Pickaxe size={13} /> Deep
          </button>
          <button
            onClick={() => void runSearch()}
            disabled={searching || !query.trim()}
            title="Search"
            className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full text-white transition-all disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "#18181b" }}
          >
            {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          </button>
        </div>

        {/* Live agent feed — each pipeline stage streams in as the agent works */}
        {(searching || progress.length > 0) && (
          <div className="mx-1 mt-2.5 rounded-sm border px-4 py-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
            <div className="space-y-1">
              {progress.map((line, i) => (
                <div key={i} className="flex items-start gap-2 text-[12px]" style={{ color: i === progress.length - 1 && searching ? "var(--text-secondary)" : "var(--text-faint)" }}>
                  {i === progress.length - 1 && searching
                    ? <Loader2 size={11} className="mt-0.5 shrink-0 animate-spin" style={{ color: "var(--section-accent)" }} />
                    : <Check size={11} className="mt-0.5 shrink-0" style={{ color: "var(--section-accent)" }} />}
                  <span className="min-w-0 break-words">{line}</span>
                </div>
              ))}
              {searching && progress.length === 0 && (
                <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text-secondary)" }}>
                  <Loader2 size={11} className="animate-spin" style={{ color: "var(--section-accent)" }} /> Starting the agent…
                </div>
              )}
            </div>
          </div>
        )}

        {/* Result / error line — mirrors how a search engine reports back */}
        {(searchError || result) && !searching && (
          <div className="px-4 pt-2.5 text-[12.5px]">
            {searchError && <span style={{ color: "#be123c" }}>Search failed: {searchError}</span>}
            {!searchError && result && (() => {
              const d = result;
              const kind = d.classified?.searchType === "REVIEWS" ? "reviews" : "leads";
              if (d.error) return <span style={{ color: "#be123c" }}>Search error: {d.error}</span>;
              if (d.status === "SKIPPED_INFRASTRUCTURE_TIMEOUT") return <span style={{ color: "#be123c" }}>Search appliance was unreachable — check the health banner above.</span>;
              if ((d.discovered ?? 0) > 0) return (
                <span className="inline-flex items-center gap-1.5" style={{ color: "#15803d" }}>
                  <Check size={12} />Found {d.discovered} {kind === "reviews" ? "review" + (d.discovered === 1 ? "" : "s") : "lead" + (d.discovered === 1 ? "" : "s")} from {d.scanned ?? "?"} sources{(d.queued ?? 0) > 0 ? ` · ${d.queued} queued for approval` : ""}.
                </span>
              );
              return (
                <span style={{ color: "var(--text-muted)" }}>
                  Scanned {d.scanned ?? 0} sources — no on-topic {kind} matched. {d.reason ? <span style={{ color: "var(--text-faint)" }}>({d.reason})</span> : null} Try being more specific, or a different subject.
                  {d.diag && (
                    <span className="mt-1 block font-mono text-[10px]" style={{ color: "var(--text-faint)" }}>
                      pipeline: {d.diag.queries} queries → {d.diag.hits} hits → {d.diag.scraped ?? 0} scraped → {d.diag.pages_analyzed ?? 0} analyzed → gateway {d.diag.gateway ? "ok" : "FAILED"} → {d.diag.extracted} extracted
                    </span>
                  )}
                </span>
              );
            })()}
          </div>
        )}

        {/* AI overview — the "Google AI mode" panel: a grounded read of what was found */}
        {overview && !searching && (
          <div className="mx-1 mt-3 rounded-sm border p-4" style={{ borderColor: "var(--section-accent-line)", background: "var(--section-accent-soft)" }}>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color: "var(--section-accent)" }}>
              <Sparkles size={13} /> AI overview
            </div>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{overview}</p>
          </div>
        )}

        {/* Watch this search — the agent re-runs it daily and notifies you about NEW results only */}
        {query.trim().length > 2 && !searching && (
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
            <button
              onClick={() => !isWatched && addMonitor.mutate(query.trim())}
              disabled={addMonitor.isPending || isWatched}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-70"
              style={isWatched
                ? { borderColor: "var(--section-accent)", color: "var(--section-accent)", background: "var(--section-accent-soft)" }
                : { borderColor: "var(--border-soft)", color: "var(--text-muted)" }}
            >
              {addMonitor.isPending ? <Loader2 size={12} className="animate-spin" /> : isWatched ? <Check size={12} /> : <Eye size={12} />}
              {isWatched ? "Watching daily" : "Watch this search"}
            </button>
          </div>
        )}

        {/* Active monitors — the searches the agent re-runs every day */}
        {monitors.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
            <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: "var(--text-faint)" }}><Bell size={11} /> Watched:</span>
            {monitors.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                <button onClick={() => setQuery(m.query)} className="max-w-[220px] truncate hover:underline" title={m.query}>{m.query}</button>
                {typeof m.last_new === "number" && m.last_new > 0 && <span className="rounded-full px-1.5 text-[10px] font-semibold" style={{ background: "var(--section-accent-soft)", color: "var(--section-accent)" }}>+{m.last_new}</span>}
                <button onClick={() => removeMonitor.mutate(m.id)} title="Stop watching" className="transition-colors hover:text-rose-400" style={{ color: "var(--text-faint)" }}><X size={11} /></button>
              </span>
            ))}
          </div>
        )}

        {/* Quick example chips — click to fill the box, same pattern as the home Ask bar's quick prompts */}
        {!query && !result && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {["Real estate agents in London", "Reviews for Vivacy", "SaaS companies that raised a seed round"].map((ex) => (
              <button
                key={ex}
                onClick={() => setQuery(ex)}
                className="rounded-full border px-3 py-1.5 text-[12px] transition-colors"
                style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}
              >
                {ex}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── Google-style results summary — one quiet line, not KPI cards ── */}
      {all.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 text-[12.5px]" style={{ color: "var(--text-muted)" }}>
          <span>About <strong className="font-medium" style={{ color: "var(--text-secondary)" }}>{all.length}</strong> result{all.length === 1 ? "" : "s"}</span>
          <span aria-hidden>·</span>
          <span><strong className="font-medium" style={{ color: "var(--text-secondary)" }}>{withContact}</strong> with contact details</span>
          <span aria-hidden>·</span>
          <span>avg confidence <strong className="font-medium" style={{ color: "var(--text-secondary)" }}>{avgConf}</strong></span>
          <button
            onClick={() => clearAll.mutate()}
            disabled={clearAll.isPending}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] transition-colors hover:text-rose-400 disabled:opacity-60"
            style={{ color: "var(--text-faint)" }}
            title="Clear all results"
          >
            {clearAll.isPending ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />} Clear results
          </button>
        </div>
      )}

      {/* ── Results — Google-style: no table box, each result sits directly on the app background ── */}
      <section>
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-1">
          {FILTERS.map(([k, l]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                filter === k ? "bg-[var(--surface-selected)] text-[var(--section-accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {l}
              <span className={`tabular-nums ${filter === k ? "text-[var(--section-accent)]/70" : "text-[var(--text-faint)]"}`}>{counts[k] ?? 0}</span>
            </button>
          ))}
          {/* Bulk actions — right aligned */}
          {rows.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              {selected.size > 0 && (
                <button onClick={() => bulkAdd.mutate(selectedRows)} disabled={bulkAdd.isPending}
                  className="inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[var(--section-accent)] disabled:opacity-60"
                  style={{ borderColor: "var(--border-strong)", color: "var(--text-primary)" }}>
                  {bulkAdd.isPending ? <Loader2 size={11} className="animate-spin" /> : <UserPlus size={11} />} Add {selected.size} as leads
                </button>
              )}
              <button onClick={() => bulkAdd.mutate(rows)} disabled={bulkAdd.isPending}
                className="inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[var(--section-accent)] disabled:opacity-60"
                style={{ borderColor: "var(--border-strong)", color: "var(--text-secondary)" }}>
                <UserPlus size={11} /> Add all
              </button>
              <button onClick={() => exportCSV(selected.size ? selectedRows : rows)}
                className="inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--section-accent)]"
                style={{ borderColor: "var(--border-strong)" }}>
                <Download size={11} /> Export CSV
              </button>
            </div>
          )}
        </div>

        {leadsQ.isLoading ? (
          <div className="p-5"><PageSkeleton rows={4} /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-sm" style={{ background: "#6f80681a" }}>
              <Radar size={20} className="text-[#6f8068]" />
            </span>
            <p className="text-[14px] font-medium text-[var(--text-primary)]">No discovered leads yet</p>
            <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-[var(--text-muted)]">
              Run a sweep above — grounded, on-topic buyer signals and reviews land here, each with a real source link.
            </p>
          </div>
        ) : (
          <div className="space-y-6 px-4 pt-4">
            {rows.map((r) => {
              const s = INTENT[r.intent_type] ?? { label: r.intent_type, c: "#71717a", b: "#f4f4f5", icon: Star };
              const conf = r.confidence_score ?? 0;
              const confColor = conf >= 70 ? "#15803d" : conf >= 40 ? "#c99a3c" : "#8a8a8a"; // green · gold · gray
              const domain = (() => { try { return new URL(r.source_url ?? "").host.replace(/^www\./, ""); } catch { return r.platform ?? "web"; } })();
              const title = r.author_name && r.author_name !== "Anonymous" ? r.author_name : (r.target_subject || r.contact?.handle || domain);
              return (
                <article key={r.id} className="group flex items-start gap-3">
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)}
                    className="mt-1.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-[color:var(--section-accent)] opacity-40 transition-opacity group-hover:opacity-100 checked:opacity-100" />
                  <div className="min-w-0 flex-1">
                    {/* Source line — like Google's URL breadcrumb */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]" style={{ color: "var(--text-faint)" }}>
                      <span className="font-medium" style={{ color: "var(--text-muted)" }}>{r.platform ?? "web"}</span>
                      <span aria-hidden>·</span>
                      <span className="truncate">{domain}</span>
                      {r.region && <><span aria-hidden>·</span><span>{r.region}</span></>}
                      <span className="rounded-full px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide" style={{ color: s.c, background: s.b }}>{s.label}</span>
                    </div>
                    {/* Title — the person/business, linked to the real source */}
                    <a href={r.source_url ?? "#"} target="_blank" rel="noreferrer"
                      className="mt-0.5 inline-block max-w-full truncate text-[15.5px] font-medium leading-snug hover:underline"
                      style={{ color: "var(--section-accent)" }}>
                      {title}
                    </a>
                    {r.contact?.summary && <p className="mt-0.5 text-[12px] italic leading-relaxed" style={{ color: "var(--text-muted)" }}>{r.contact.summary}</p>}
                    {r.raw_content && <p className="mt-0.5 line-clamp-3 text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{r.raw_content}</p>}
                    {/* Contact chips + actions — one quiet row, no boxes */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
                      {r.contact?.email && <a href={`mailto:${r.contact.email}`} className="inline-flex items-center gap-1 hover:underline" style={{ color: "var(--text-secondary)" }}><Mail size={11} />{r.contact.email}</a>}
                      {r.contact?.phone && <a href={`tel:${r.contact.phone}`} className="inline-flex items-center gap-1 hover:underline" style={{ color: "var(--text-secondary)" }}><Phone size={11} />{r.contact.phone}</a>}
                      {r.contact?.handle && <span className="inline-flex items-center gap-1" style={{ color: "var(--text-muted)" }}>{r.contact.handle}</span>}
                      <button
                        onClick={() => !added[r.id] && addLead.mutate(r)}
                        disabled={added[r.id] || (addLead.isPending && addLead.variables?.id === r.id)}
                        className="inline-flex items-center gap-1 font-medium transition-colors hover:underline disabled:opacity-70"
                        style={{ color: added[r.id] ? "#15803d" : "var(--section-accent)" }}>
                        {added[r.id] ? <><Check size={11} /> Added to People</> : <><UserPlus size={11} /> Add as lead</>}
                      </button>
                      {r.contact?.email && (
                        <button
                          onClick={() => { setSendMsg(null); setCompose({ lead: r, subject: r.target_subject ? `Regarding ${r.target_subject}` : "Hello from Mondaily", body: `Hi ${r.author_name && r.author_name !== "Anonymous" ? r.author_name : "there"},\n\n` }); }}
                          className="inline-flex items-center gap-1 font-medium transition-colors hover:underline"
                          style={{ color: "var(--section-accent)" }}>
                          <Send size={11} /> Message
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Confidence — the golden bar */}
                  <div className="flex shrink-0 flex-col items-end gap-1 pt-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11.5px] font-semibold tabular-nums" style={{ color: confColor }}>{conf}</span>
                      <button
                        onClick={() => removeLead.mutate(r.id)}
                        title="Remove this result"
                        className="rounded-md p-0.5 opacity-0 transition-all hover:text-rose-400 group-hover:opacity-100"
                        style={{ color: "var(--text-faint)" }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <div className="h-1 w-14 overflow-hidden rounded-full" style={{ background: "var(--surface-hover)" }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(conf, 4)}%`, background: confColor }} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Compose modal — sends through our own system (Gmail/Resend), not mailto */}
      {compose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCompose(null)}>
          <div className="w-full max-w-lg rounded-sm border shadow-2xl" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
              <span className="text-sm font-semibold text-[var(--text-primary)]">Message {compose.lead.author_name && compose.lead.author_name !== "Anonymous" ? compose.lead.author_name : "lead"}</span>
              <button onClick={() => setCompose(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={15} /></button>
            </div>
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-2 text-[12px]"><span className="text-[var(--text-muted)]">To</span><span className="font-mono text-[var(--text-primary)]">{compose.lead.contact?.email}</span></div>
              <input value={compose.subject} onChange={(e) => setCompose({ ...compose, subject: e.target.value })} placeholder="Subject" className="key-input h-9 w-full px-3 text-sm" />
              <textarea value={compose.body} onChange={(e) => setCompose({ ...compose, body: e.target.value })} rows={7} placeholder="Write your message…" className="key-input w-full resize-none px-3 py-2 text-sm" />
              {sendMsg && <p className="text-[12px]" style={{ color: sendMsg.includes("✓") ? "#15803d" : "#be123c" }}>{sendMsg}</p>}
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setCompose(null)} className="rounded-sm px-3 py-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">Cancel</button>
                <button
                  onClick={() => compose.lead.contact?.email && sendEmail.mutate({ to: compose.lead.contact.email, subject: compose.subject, body: compose.body, name: compose.lead.author_name ?? undefined })}
                  disabled={sendEmail.isPending || !compose.subject.trim() || !compose.body.trim()}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-stone-500/30 bg-stone-700 px-4 py-1.5 text-[12px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-stone-600 disabled:opacity-60">
                  {sendEmail.isPending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

