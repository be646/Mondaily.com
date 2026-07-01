import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radar, ExternalLink, Search, Loader2, TrendingUp, Star, AlertTriangle, Mail, Phone, Check, UserPlus, Download, Send, X } from "lucide-react";
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
      apiClient.post<{ ok?: boolean; discovered?: number; scanned?: number; error?: string; reason?: string; status?: string; diag?: { queries: number; hits: number; unique: number; scraped?: number; gateway: boolean; extracted: number; matched: number } }>("/discovery/run", {
        searchType,
        sector: sector.trim() || undefined,
        region: region.trim() || undefined,
        targetSubject: targetSubject.trim() || undefined,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["discovery"] }),
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
            {run.isError && <span className="text-[12px] text-[#be123c]">Sweep failed: {run.error instanceof Error ? run.error.message : "unknown error"}</span>}
            {run.isSuccess && !run.isPending && (() => {
              const d = run.data;
              if (d?.error) return <span className="text-[12px] text-[#be123c]">Sweep error: {d.error}</span>;
              if (d?.status === "SKIPPED_INFRASTRUCTURE_TIMEOUT") return <span className="text-[12px] text-[#be123c]">Search appliance was unreachable — check the health banner above.</span>;
              if ((d?.discovered ?? 0) > 0) return <span className="inline-flex items-center gap-1.5 text-[12px] text-[#15803d]"><Check size={12} />Found {d!.discovered} lead{d!.discovered === 1 ? "" : "s"} from {d?.scanned ?? "?"} sources.</span>;
              return (
                <span className="text-[12px] text-[var(--text-muted)]">
                  Scanned {d?.scanned ?? 0} sources — no on-topic {searchType === "REVIEWS" ? "reviews" : "leads"} matched. {d?.reason ? <span className="text-[var(--text-faint)]">({d.reason})</span> : null} Try a broader sector/region, or a different subject.
                  {d?.diag && (
                    <span className="mt-1 block font-mono text-[10px] text-[var(--text-faint)]">
                      pipeline: {d.diag.queries} queries → {d.diag.hits} hits → {d.diag.unique} unique → {d.diag.scraped ?? 0} scraped → gateway {d.diag.gateway ? "ok" : "FAILED"} → {d.diag.extracted} extracted → {d.diag.matched} matched
                    </span>
                  )}
                </span>
              );
            })()}
          </div>
        </div>
      </section>

      {/* ── Stats strip ── */}
      {all.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Total leads", value: all.length },
            { label: "With contact", value: withContact },
            { label: "Buy signals", value: counts.BUY_SIGNAL ?? 0 },
            { label: "Avg confidence", value: avgConf },
          ].map((s) => (
            <div key={s.label} className="rounded-sm border p-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
              <div className="font-mono text-xl font-semibold tabular-nums text-[var(--text-primary)]">{s.value}</div>
              <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Results ── */}
      <section className="overflow-hidden rounded-sm border bg-[var(--surface-card)]" style={{ borderColor: "var(--border-soft)" }}>
        <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
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
          <ul className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
            {rows.map((r) => {
              const s = INTENT[r.intent_type] ?? { label: r.intent_type, c: "#71717a", b: "#f4f4f5", icon: Star };
              const Icon = s.icon;
              const conf = r.confidence_score ?? 0;
              return (
                <li key={r.id} className="px-5 py-3.5 transition-colors hover:bg-[var(--surface-hover)]">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)}
                      className="mt-2 h-3.5 w-3.5 shrink-0 cursor-pointer accent-[color:var(--section-accent)]" />
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
                        {r.contact?.email && (
                          <button
                            onClick={() => { setSendMsg(null); setCompose({ lead: r, subject: r.target_subject ? `Regarding ${r.target_subject}` : "Hello from Mondaily", body: `Hi ${r.author_name && r.author_name !== "Anonymous" ? r.author_name : "there"},\n\n` }); }}
                            className="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--section-accent)]"
                            style={{ borderColor: "var(--border-strong)" }}>
                            <Send size={11} /> Message
                          </button>
                        )}
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

      {/* Compose modal — sends through our own system (Gmail/Resend), not mailto */}
      {compose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCompose(null)}>
          <div className="w-full max-w-lg rounded-sm border shadow-2xl" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
              <span className="text-sm font-semibold text-[var(--text-primary)]">Message {compose.lead.author_name && compose.lead.author_name !== "Anonymous" ? compose.lead.author_name : "lead"}</span>
              <button onClick={() => setCompose(null)} className="text-stone-500 hover:text-[var(--text-primary)]"><X size={15} /></button>
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
