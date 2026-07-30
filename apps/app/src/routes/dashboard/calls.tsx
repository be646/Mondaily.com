import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Phone, Search, FileText, Sparkles, ListChecks, Users, Brain, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "../../lib/api-client";
import { UploadRecordingModal } from "../../components/calls/upload-recording-modal";
import { CommandPageHeader } from "../../components/ui/controls";
import { SegmentedControl } from "../../components/ui/segmented";
import { EmptyState, DelayedLoading, PageSkeleton, ErrorState } from "../../components/ui/page-state";

/**
 * Meeting Memory — Mondaily's after-the-fact call/meeting intelligence. Calendar owns planning + live
 * rooms; this page is the HISTORY: past meetings + recorded calls with honest transcript / summary /
 * action-item status. It combines completed calendar events and legacy call records via
 * GET /calls/memory. Nothing is fabricated — a status only reads "generated"/"available" when the real
 * field exists; otherwise it says "unavailable" / "pending".
 */
type TranscriptStatus = "available" | "unavailable";
type SummaryStatus = "generated" | "pending" | "none";
interface MemoryRow {
  id: string; source: "calendar" | "call_record"; title: string; contact_name?: string; company_name?: string;
  occurred_at: string; participant_count: number; has_agenda: boolean;
  transcript_status: TranscriptStatus; summary_status: SummaryStatus; can_summarize: boolean;
  action_item_count: number; href: string;
  transcript_kind?: "live" | "recording";
}
type Tab = "all" | "meetings" | "calls" | "needs_summary" | "action_items";

const MUTED = { green: "#5f8a6a", amber: "#a2854f", faint: "var(--text-faint)" };
const fmtWhen = (iso: string) => { try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return iso; } };

function Dot({ color }: { color: string }) { return <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />; }

export function CallsPage() {
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Debounce the search: /calls/memory does 3 DB round-trips plus a transcript-line scan per
  // request, and the key included the raw input — typing "acme" fired four of them.
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  const query = useQuery({
    queryKey: ["meeting-memory", debouncedSearch],
    queryFn: () => apiClient.get<{ memories: MemoryRow[] }>(`/calls/memory?search=${encodeURIComponent(debouncedSearch)}`),
    placeholderData: (prev) => prev,   // keep the last list on screen while the next one loads
  });
  const all = query.data?.memories ?? [];
  const [justUploaded, setJustUploaded] = useState(false);

  const counts = useMemo(() => ({
    all: all.length,
    meetings: all.filter(m => m.source === "calendar").length,
    calls: all.filter(m => m.source === "call_record").length,
    needs_summary: all.filter(m => m.can_summarize && m.summary_status !== "generated").length,
    action_items: all.filter(m => m.action_item_count > 0).length,
  }), [all]);

  const rows = useMemo(() => all.filter(m =>
    tab === "all" ? true
    : tab === "meetings" ? m.source === "calendar"
    : tab === "calls" ? m.source === "call_record"
    : tab === "needs_summary" ? (m.can_summarize && m.summary_status !== "generated")
    : m.action_item_count > 0
  ), [all, tab]);

  const tabs: { k: Tab; label: string }[] = [
    { k: "all", label: "All" }, { k: "meetings", label: "Meetings" }, { k: "calls", label: "Calls" },
    { k: "needs_summary", label: "Needs summary" }, { k: "action_items", label: "Action items" },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 pt-2 pb-8 sm:px-6">
      {/* Shared command header — same rhythm as Calendar/Decisions/Discovery. Honest status:
          real counts from the loaded memory list only; nothing implied to be running. */}
      <CommandPageHeader
        variant="bar"
        icon={Brain}
        callsign="RECALL"
        title="Meeting Memory"
        subtitle="After-call intelligence — past meetings, recorded calls, summaries & action items."
        status={all.length > 0 ? [
          { label: `${counts.all} in memory`, dot: false },
          ...(counts.needs_summary > 0 ? [{ label: `${counts.needs_summary} can be summarized`, kind: "monitoring" as const }] : []),
        ] : []}
        primaryAction={
          <button onClick={() => setUploadOpen(true)} className="btn-primary text-[12px] font-semibold">
            <UploadCloud size={13} /> Import recording
          </button>
        }
      />

      {uploadOpen && <UploadRecordingModal onClose={() => setUploadOpen(false)}
        onDone={() => {
          // The upload returns a call_sessions id, but the Meeting-Memory record is a
          // separate `nodes` row created asynchronously by the transcription job — and
          // /calls/upload/complete answers 202 "queued". Navigating to /calls/<sessionId>
          // therefore always landed on "Couldn't load this call". Stay on the list, say
          // it's processing, and let the invalidation surface it when it lands.
          setUploadOpen(false);
          qc.invalidateQueries({ queryKey: ["meeting-memory"] });
          setJustUploaded(true);
        }} />}

      {/* Control bar: tabs + search (flat, monochrome). */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b pb-3" style={{ borderColor: "var(--border-soft)" }}>
        {/* Shared hairline SegmentedControl — was the last hand-rolled boxed pill track. Counts
            follow the segment contract: rendered whenever known, INCLUDING zero. */}
        <SegmentedControl
          segments={tabs.map(t => ({ key: t.k, label: t.label, count: counts[t.k] }))}
          active={tab}
          onChange={(k) => setTab(k as Tab)}
        />
        <label className="relative block sm:w-64">
          <Search className="absolute left-2.5 top-2 text-[var(--text-faint)]" size={14} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, people, transcript…"
            className="key-input h-8 w-full pl-8 pr-3 text-[13px]" />
        </label>
      </div>

      {/* A queued upload has no record yet — say so instead of leaving the user on an
          unchanged list wondering whether it worked. */}
      {justUploaded && (
        <div className="mb-3 rounded-sm border px-4 py-3 text-[13px]" style={{ borderColor: "var(--section-accent-line)", background: "var(--section-accent-soft)", color: "var(--text-secondary)" }}>
          Recording uploaded — transcription is running. It will appear here when it finishes.
        </div>
      )}

      {query.isLoading ? (
        <DelayedLoading onRetry={() => query.refetch()}><PageSkeleton rows={5} label="Loading meeting memory…" /></DelayedLoading>
      ) : query.isError ? (
        /* A failed fetch used to fall through to "No meeting memories yet" — a load failure
           looked identical to an empty workspace, complete with onboarding steps. */
        <ErrorState error={query.error as Error} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        // Guided empty state — every step is a real action; readiness lives in Settings → Calls
        // (booleans only). Nothing here pretends a transcript or meeting exists.
        <EmptyState
          icon={Brain}
          title={all.length === 0 ? "No meeting memories yet" : "Nothing matches this filter"}
          description={all.length === 0
            ? "Completed calendar meetings and recorded calls land here with their transcript, AI summary, and action items."
            : "Switch tabs or clear the search to see the rest of your meeting history."}
          steps={all.length === 0 ? [
            { icon: UploadCloud, label: "Import a recording", hint: "Upload an audio file from any past call — transcription runs when speech-to-text is configured.", onClick: () => setUploadOpen(true) },
            { icon: CalendarClock, label: "Schedule a meeting", hint: "Completed calendar meetings appear here automatically.", onClick: () => navigate("/calendar") },
            { icon: ListChecks, label: "Check recording readiness", hint: "See exactly what's configured (recording, transcription, playback) — status only, fail-closed.", onClick: () => navigate("/settings/calls") },
          ] : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
          {rows.map((m, i) => (
            <Link key={`${m.source}-${m.id}`} to={m.href}
              className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--surface-hover)]"
              style={i > 0 ? { borderTop: "1px solid var(--border-soft)" } : undefined}>
              <span className="shrink-0" style={{ color: "var(--text-faint)" }}>{m.source === "calendar" ? <CalendarClock size={15} /> : <Phone size={15} />}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{m.title}</span>
                  <span className="shrink-0 rounded-sm px-1.5 py-px text-[10px] font-medium" style={{ background: "var(--surface-hover)", color: "var(--text-muted)" }}>{m.source === "calendar" ? "Calendar meeting" : "Call record"}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]" style={{ color: "var(--text-faint)" }}>
                  <span>{fmtWhen(m.occurred_at)}</span>
                  {m.company_name && <span className="truncate">{m.company_name}</span>}
                  <span className="flex items-center gap-1"><Users size={10} /> {m.participant_count}</span>
                </div>
              </div>
              {/* Right-aligned meeting-intelligence status cluster — transcript / summary / action items. */}
              <div className="hidden shrink-0 items-center gap-3 text-[11px] sm:flex" style={{ color: "var(--text-faint)" }}>
                <span className="flex items-center gap-1" title={m.transcript_kind === "live" ? "Saved live-caption transcript" : "Transcript"}><Dot color={m.transcript_status === "available" ? MUTED.green : MUTED.faint} /><FileText size={10} /> {m.transcript_status === "available" ? (m.transcript_kind === "live" ? "Live transcript" : "Transcript") : "No transcript"}</span>
                <span className="flex items-center gap-1" title="AI summary"><Dot color={m.summary_status === "generated" ? MUTED.green : m.summary_status === "pending" ? MUTED.amber : MUTED.faint} /><Sparkles size={10} /> {m.summary_status === "generated" ? "Summary" : m.summary_status === "pending" ? "Summary pending" : "No summary"}</span>
                {m.action_item_count > 0 && <span className="flex items-center gap-1"><ListChecks size={10} /> {m.action_item_count}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
