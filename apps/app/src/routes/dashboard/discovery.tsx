import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radar, ExternalLink, Search, Loader2 } from "lucide-react";
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
}

type SearchType = "INTENT_LEADS" | "REVIEWS";

const INTENT_STYLE: Record<string, { label: string; c: string; b: string }> = {
  BUY_SIGNAL: { label: "Buy signal", c: "#15803d", b: "#dcfce7" },
  REVIEW:     { label: "Review",     c: "#1d4ed8", b: "#dbeafe" },
  COMPLAINT:  { label: "Complaint",  c: "#b91c1c", b: "#fee2e2" },
};

const FILTERS = [
  ["all", "All"],
  ["BUY_SIGNAL", "Buy signals"],
  ["REVIEW", "Reviews"],
  ["COMPLAINT", "Complaints"],
] as const;

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
    refetchInterval: 15_000,
  });

  const run = useMutation({
    mutationFn: () =>
      apiClient.post("/discovery/run", {
        searchType,
        sector: sector.trim() || undefined,
        region: region.trim() || undefined,
        targetSubject: targetSubject.trim() || undefined,
      }),
    onSuccess: () => {
      // Worker is async — poll for new rows.
      setTimeout(() => qc.invalidateQueries({ queryKey: ["discovery"] }), 4000);
    },
  });

  const reviewsMissingSubject = searchType === "REVIEWS" && !targetSubject.trim();
  const all = leadsQ.data ?? [];
  const rows = filter === "all" ? all : all.filter((r) => r.intent_type === filter);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discovery"
        description="Sweep the open web for buyer-intent signals and reviews — grounded, source-backed, deduplicated."
      />

      {/* ── Run a sweep ── */}
      <section className="overflow-hidden rounded-2xl border bg-[var(--surface-card)]" style={{ borderColor: "var(--border-soft)" }}>
        <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <Radar size={15} className="text-[var(--accent)]" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">Run a web sweep</span>
        </div>
        <div className="space-y-3 p-4">
          <div className="inline-flex rounded-xl border p-1" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card-2)" }}>
            {(["INTENT_LEADS", "REVIEWS"] as SearchType[]).map((t) => (
              <button
                key={t}
                onClick={() => setSearchType(t)}
                className={`rounded-lg px-3.5 py-1.5 text-[12.5px] font-medium transition-all ${
                  searchType === t ? "bg-[var(--surface-card)] text-[var(--text-primary)] shadow-sm ring-1 ring-black/[.06]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {t === "INTENT_LEADS" ? "Intent leads" : "Reviews"}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={searchType === "REVIEWS" ? "Sector (optional)" : "Sector"} value={sector} onChange={setSector} placeholder="e.g. real estate, solar, SaaS" />
            <Field label="Region (optional)" value={region} onChange={setRegion} placeholder="e.g. London, Austin TX" />
            {searchType === "REVIEWS" && (
              <Field label="Subject" value={targetSubject} onChange={setTargetSubject} placeholder="Person or company to review" />
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => run.mutate()}
              disabled={run.isPending || reviewsMissingSubject}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[12.5px] font-medium text-white transition-opacity disabled:opacity-50"
              style={{ background: "#18181b" }}
            >
              {run.isPending ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {run.isPending ? "Queuing sweep…" : "Run sweep"}
            </button>
            {reviewsMissingSubject && <span className="text-[12px] text-[var(--text-muted)]">A subject is required for a reviews sweep.</span>}
            {run.isSuccess && !run.isPending && <span className="text-[12px] text-[var(--accent)]">Sweep queued — results appear below as they land.</span>}
          </div>
        </div>
      </section>

      {/* ── Results ── */}
      <section className="overflow-hidden rounded-2xl border bg-[var(--surface-card)]" style={{ borderColor: "var(--border-soft)" }}>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
          {FILTERS.map(([k, l]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded-md px-2.5 py-1 text-[11.5px] transition-colors ${
                filter === k ? "bg-zinc-900 text-white" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {l}
            </button>
          ))}
          <span className="ml-auto text-[11.5px] text-[var(--text-muted)]">{rows.length} result{rows.length === 1 ? "" : "s"}</span>
        </div>

        {leadsQ.isLoading ? (
          <div className="p-4"><PageSkeleton rows={4} /></div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-[13px] text-[var(--text-muted)]">
            No discovered leads yet. Run a sweep above — grounded, on-topic results land here.
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
            {rows.map((r) => {
              const s = INTENT_STYLE[r.intent_type] ?? { label: r.intent_type, c: "#71717a", b: "#f4f4f5" };
              return (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ color: s.c, background: s.b }}>{s.label}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                        {r.author_name && <span className="font-medium text-[var(--text-primary)]">{r.author_name}</span>}
                        {r.platform && <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10.5px] text-[var(--text-muted)]">{r.platform}</span>}
                        {r.region && <span className="text-[11px] text-[var(--text-muted)]">· {r.region}</span>}
                        {r.target_subject && <span className="text-[11px] text-[var(--text-muted)]">· re: {r.target_subject}</span>}
                      </div>
                      {r.raw_content && <p className="mt-1 line-clamp-3 text-[12.5px] leading-snug text-[var(--text-secondary)]">{r.raw_content}</p>}
                      {r.source_url && (
                        <a href={r.source_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline">
                          <ExternalLink size={10} /> source
                        </a>
                      )}
                    </div>
                    {typeof r.confidence_score === "number" && (
                      <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums" style={{ color: r.confidence_score >= 70 ? "#15803d" : r.confidence_score >= 40 ? "#b45309" : "#71717a", background: "var(--surface-card-2)" }}>
                        {r.confidence_score}
                      </span>
                    )}
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
        className="w-full rounded-lg border px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
        style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}
      />
    </label>
  );
}
