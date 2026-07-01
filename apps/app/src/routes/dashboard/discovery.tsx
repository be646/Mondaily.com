import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radar, ExternalLink, Search, Loader2, TrendingUp, Star, AlertTriangle, Mail, Phone, Check, UserPlus } from "lucide-react";
import { apiClient } from "../../lib/api-client";
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
  const [searchType, setSearchType] = useState<SearchType>("INTENT_LEADS");
  const [sector, setSector] = useState("");
  const [region, setRegion] = useState("");
  const [targetSubject, setTargetSubject] = useState("");
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

  const run = useMutation({
    mutationFn: () =>
      apiClient.post("/discovery/run", {
        searchType,
        sector: sector.trim() || undefined,
        region: region.trim() || undefined,
        targetSubject: targetSubject.trim() || undefined,
      }),
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ["discovery"] }), 4000),
  });

  // Promote a discovered lead into a real People record (name + email + phone + note + source).
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const addLead = useMutation({
    mutationFn: (r: DiscoveredLead) => apiClient.post("/nodes", {
      vertical: "shared",
      object_type: "people",
      data: {
        name: r.author_name && r.author_name !== "Anonymous" ? r.author_name : (r.contact?.handle || r.target_subject || "Discovered lead"),
        email: r.contact?.email || undefined,
        phone: r.contact?.phone || undefined,
        handle: r.contact?.handle || undefined,
        notes: [r.contact?.summary, r.raw_content && `“${r.raw_content}”`, r.source_url && `Source: ${r.source_url}`].filter(Boolean).join("\n\n"),
        source: "discovery",
        lead_type: r.intent_type,
      },
    }),
    onSuccess: (_d, r) => setAdded((m) => ({ ...m, [r.id]: true })),
  });

  const reviewsMissingSubject = searchType === "REVIEWS" && !targetSubject.trim();
  const all = leadsQ.data ?? [];
  const rows = filter === "all" ? all : all.filter((r) => r.intent_type === filter);
  const counts = {
    all: all.length,
    BUY_SIGNAL: all.filter((r) => r.intent_type === "BUY_SIGNAL").length,
    REVIEW: all.filter((r) => r.intent_type === "REVIEW").length,
    COMPLAINT: all.filter((r) => r.intent_type === "COMPLAINT").length,
  } as Record<string, number>;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <PageHeader
        title="Discovery"
        description="Sweep the open web for buyer-intent signals and reviews — grounded, source-backed, and deduplicated."
      />

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

      {/* ── Run a sweep ── */}
      <section
        className="overflow-hidden rounded-sm border bg-[var(--surface-card)]"
        style={{ borderColor: "var(--border-soft)", boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 18px 40px -28px rgba(0,0,0,0.16)" }}
      >
        <div className="flex items-center gap-2.5 border-b px-5 py-3.5" style={{ borderColor: "var(--border-soft)" }}>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "#6f80681a" }}>
            <Radar size={15} className="text-[#6f8068]" />
          </span>
          <div>
            <div className="text-[13px] font-semibold text-[var(--text-primary)]">Run a web sweep</div>
            <div className="text-[11px] text-[var(--text-muted)]">Live search across Reddit, X, and public forums</div>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div className="inline-flex rounded-sm border p-1" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card-2)" }}>
            {(["INTENT_LEADS", "REVIEWS"] as SearchType[]).map((t) => (
              <button
                key={t}
                onClick={() => setSearchType(t)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[12.5px] font-medium transition-all ${
                  searchType === t ? "bg-[var(--surface-card)] text-[var(--text-primary)] shadow-sm ring-1 ring-black/[.06]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: searchType === t ? "#6f8068" : "#d4d4d8" }} />
                {t === "INTENT_LEADS" ? "Intent leads" : "Reviews"}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={searchType === "REVIEWS" ? "Sector (optional)" : "Sector"} value={sector} onChange={setSector} placeholder="real estate, solar, SaaS" />
            <Field label="Region (optional)" value={region} onChange={setRegion} placeholder="London, Austin TX" />
            {searchType === "REVIEWS" && <Field label="Subject" value={targetSubject} onChange={setTargetSubject} placeholder="Person or company" />}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              onClick={() => run.mutate()}
              disabled={run.isPending || reviewsMissingSubject}
              className="inline-flex items-center gap-2 rounded-sm border px-4 py-2 text-[12.5px] font-medium text-white transition-colors disabled:opacity-50"
              style={{ background: "#18181b", borderColor: "var(--border-strong)" }}
              onMouseEnter={e => { if (!run.isPending) e.currentTarget.style.borderColor = "var(--section-accent)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-strong)"; }}
            >
              {run.isPending ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {run.isPending ? <span className="font-mono text-[11px] tracking-wider">[ EXECUTING WEB SOURCE SNEAK SWEEP... ]</span> : "Run sweep"}
            </button>
            {reviewsMissingSubject && <span className="text-[12px] text-[var(--text-muted)]">Add a subject to run a reviews sweep.</span>}
            {run.isSuccess && !run.isPending && <span className="inline-flex items-center gap-1.5 text-[12px] text-[#6f8068]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#6f8068]" />Sweep queued — results appear below as they land.</span>}
          </div>
        </div>
      </section>

      {/* ── Results ── */}
      <section className="overflow-hidden rounded-sm border bg-[var(--surface-card)]" style={{ borderColor: "var(--border-soft)" }}>
        <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
          {FILTERS.map(([k, l]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                filter === k ? "bg-[var(--surface-card)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {l}
              <span className={`tabular-nums ${filter === k ? "text-white/70" : "text-[var(--text-faint)]"}`}>{counts[k] ?? 0}</span>
            </button>
          ))}
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
          <ul className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
            {rows.map((r) => {
              const s = INTENT[r.intent_type] ?? { label: r.intent_type, c: "#71717a", b: "#f4f4f5", icon: Star };
              const Icon = s.icon;
              const conf = r.confidence_score ?? 0;
              return (
                <li key={r.id} className="px-5 py-3.5 transition-colors hover:bg-[var(--surface-hover)]">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: s.b, color: s.c }}>
                      <Icon size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ color: s.c, background: s.b }}>{s.label}</span>
                        {r.author_name && r.author_name !== "Anonymous" && <span className="text-[12px] font-medium text-[var(--text-primary)]">{r.author_name}</span>}
                        {r.platform && <span className="rounded bg-[var(--surface-card-2)] px-1.5 py-0.5 text-[10.5px] text-[var(--text-muted)]">{r.platform}</span>}
                        {r.region && <span className="text-[11px] text-[var(--text-muted)]">· {r.region}</span>}
                        {r.target_subject && <span className="text-[11px] text-[var(--text-muted)]">· re: {r.target_subject}</span>}
                      </div>
                      {r.contact?.summary && <p className="mt-1.5 text-[12px] italic leading-relaxed text-[var(--text-muted)]">{r.contact.summary}</p>}
                      {r.raw_content && <p className="mt-1 line-clamp-3 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">{r.raw_content}</p>}
                      {/* Contact chips — only what was actually found in the source */}
                      {(r.contact?.email || r.contact?.phone || r.contact?.handle) && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {r.contact?.email && <a href={`mailto:${r.contact.email}`} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--section-accent)]" style={{ borderColor: "var(--border-soft)" }}><Mail size={10} />{r.contact.email}</a>}
                          {r.contact?.phone && <a href={`tel:${r.contact.phone}`} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--section-accent)]" style={{ borderColor: "var(--border-soft)" }}><Phone size={10} />{r.contact.phone}</a>}
                          {r.contact?.handle && <span className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]" style={{ borderColor: "var(--border-soft)" }}>{r.contact.handle}</span>}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        {r.source_url && (
                          <a href={r.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-[#6f8068] hover:underline">
                            <ExternalLink size={10} /> View source
                          </a>
                        )}
                        <button
                          onClick={() => !added[r.id] && addLead.mutate(r)}
                          disabled={added[r.id] || (addLead.isPending && addLead.variables?.id === r.id)}
                          className="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] font-medium transition-colors hover:border-[var(--section-accent)] disabled:opacity-60"
                          style={{ borderColor: "var(--border-strong)", color: added[r.id] ? "#15803d" : "var(--text-secondary)" }}>
                          {added[r.id] ? <><Check size={11} /> Added to People</> : <><UserPlus size={11} /> Add as lead</>}
                        </button>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span
                        className="rounded-md px-2 py-0.5 text-[12px] font-semibold tabular-nums"
                        style={{ color: conf >= 70 ? "#15803d" : conf >= 40 ? "#b45309" : "#71717a", background: "var(--surface-card-2)" }}
                      >
                        {conf}
                      </span>
                      <span className="text-[9.5px] uppercase tracking-wide text-[var(--text-faint)]">confidence</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-faint)] focus:border-[#6f8068]"
        style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}
      />
    </label>
  );
}
