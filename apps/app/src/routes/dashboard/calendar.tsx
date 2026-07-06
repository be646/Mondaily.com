import { useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Plus, X, Loader2, Video, MapPin, Users, Sparkles, Check, AlertTriangle, FileText, Link2, ArrowRight, Wand2, ListChecks, Send, StickyNote, Circle, CalendarClock } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useLanguage } from "../../hooks/useLanguage";
import { useCurrentUser } from "../../hooks/useCurrentUser";

/**
 * Mondaily Smart Calendar — an AI-native meeting command center (native + workspace-scoped). A Today
 * intelligence strip (real counts / next meeting / overlaps / gaps), Today · Week · Upcoming views over
 * a calm timeline, and a Meeting Brief panel with source-backed AI preparation (grounded only on real
 * workspace records — never fabricated). Titles/descriptions are never translated. All data from
 * /calendar; participant-scoped by the backend.
 */
interface Person { user_id: string; name: string; email: string | null }
interface CalEvent {
  id: string; title: string; description: string; start_at: string; end_at: string; timezone: string;
  location: string; status: "scheduled" | "cancelled" | "completed"; call_url: string | null;
  organizer: Person; attendees: Person[];
}
interface MemberRow { id: string; name?: string; email: string }
type ViewMode = "today" | "week" | "upcoming";

const fmtTime = (iso: string, loc: string) => { try { return new Date(iso).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const dayKey = (iso: string) => new Date(iso).toDateString();
const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

// ── Time-grid geometry (real calendar rendering) ──────────────────────────────────────────────────
const HOUR_PX = 48;                                   // vertical scale: 48px per hour
const minOfDay = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };

/** The visible hour window for a set of events — a sensible 8–18 default that expands to fit outliers. */
function hourWindow(evs: CalEvent[]): { startH: number; endH: number } {
  let startH = 8, endH = 18;
  for (const e of evs) {
    const s = new Date(e.start_at), en = new Date(e.end_at || e.start_at);
    startH = Math.min(startH, s.getHours());
    endH = Math.max(endH, en.getHours() + (en.getMinutes() > 0 || en.getHours() === s.getHours() ? 1 : 0));
  }
  startH = Math.max(0, Math.min(startH, 22));
  endH = Math.min(24, Math.max(endH, startH + 2));
  return { startH, endH };
}

interface Placed { e: CalEvent; top: number; height: number; leftPct: number; widthPct: number }
/** Position a day's events by time, laying overlapping ones side-by-side (standard calendar columns). */
function layoutDay(evs: CalEvent[], startH: number, endH: number): Placed[] {
  const lo = startH * 60, hi = endH * 60;
  const items = evs
    .map(e => ({ e, s: Math.max(lo, Math.min(minOfDay(e.start_at), hi)), en: Math.max(lo, Math.min(minOfDay(e.end_at || e.start_at), hi)) }))
    .map(it => ({ ...it, en: Math.max(it.en, it.s + 20) }))   // enforce a minimum readable height
    .sort((a, b) => a.s - b.s || a.en - b.en);
  const out: Placed[] = [];
  let cluster: (typeof items[number] & { col?: number })[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const colEnds: number[] = [];
    for (const it of cluster) {
      let c = colEnds.findIndex(end => end <= it.s);
      if (c === -1) { c = colEnds.length; colEnds.push(it.en); } else colEnds[c] = it.en;
      it.col = c;
    }
    const n = colEnds.length || 1;
    for (const it of cluster) out.push({ e: it.e, top: (it.s - lo) / 60 * HOUR_PX, height: Math.max(18, (it.en - it.s) / 60 * HOUR_PX), leftPct: ((it.col ?? 0) / n) * 100, widthPct: (1 / n) * 100 });
    cluster = []; clusterEnd = -1;
  };
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) flush();
    cluster.push(it); clusterEnd = Math.max(clusterEnd, it.en);
  }
  flush();
  return out;
}

/**
 * A real calendar time grid — a left time rail, horizontal hour lines, day columns, time-positioned
 * event blocks (overlaps laid side-by-side), today shading, and a live current-time line. Drives both
 * the Today day-timeline (single column) and the Week grid (seven columns).
 */
function TimeGrid({ days, events, selected, onOpen, lang, single }: {
  days: Date[]; events: CalEvent[]; selected: string | null; onOpen: (id: string) => void; lang: string; single?: boolean;
}) {
  const now = new Date();
  const perDay = days.map(d => events.filter(e => isSameDay(new Date(e.start_at), d)));
  const { startH, endH } = hourWindow(perDay.flat());
  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i);
  const bodyH = (endH - startH) * HOUR_PX;
  const nowTop = (now.getHours() * 60 + now.getMinutes() - startH * 60) / 60 * HOUR_PX;
  const nowVisible = now.getHours() >= startH && now.getHours() < endH;

  return (
    <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 15rem)" }}>
      <div className="flex min-w-full">
        {/* Time rail */}
        <div className="sticky left-0 z-20 w-12 shrink-0" style={{ background: "var(--surface-page)" }}>
          <div style={{ height: 28 }} />
          <div className="relative" style={{ height: bodyH }}>
            {hours.map((h, i) => (
              <div key={h} className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums" style={{ top: i * HOUR_PX, color: "var(--text-faint)" }}>{String(h).padStart(2, "0")}:00</div>
            ))}
          </div>
        </div>
        {/* Day columns */}
        <div className="flex flex-1">
          {days.map((d, di) => {
            const placed = layoutDay(perDay[di]!, startH, endH);
            const isToday = isSameDay(d, now);
            return (
              <div key={d.toISOString()} className="relative min-w-0 flex-1 border-l" style={{ borderColor: "var(--border-soft)" }}>
                {single ? <div style={{ height: 28 }} /> : (
                  <div className="sticky top-0 z-10 flex h-7 items-center justify-center gap-1 text-[11px] font-semibold" style={{ background: "var(--surface-page)", color: isToday ? "var(--section-accent)" : "var(--text-muted)" }}>
                    {d.toLocaleDateString(lang, { weekday: "short" })} <span className="tabular-nums">{d.getDate()}</span>
                  </div>
                )}
                <div className="relative" style={{ height: bodyH }}>
                  {isToday && <div className="absolute inset-0" style={{ background: "color-mix(in srgb, var(--section-accent) 4%, transparent)" }} />}
                  {/* Horizontal hour lines */}
                  {hours.map((h, i) => <div key={h} className="absolute inset-x-0 border-t" style={{ top: i * HOUR_PX, borderColor: "var(--border-soft)" }} />)}
                  {/* Current-time line (only on today, when in the visible window) */}
                  {isToday && nowVisible && (
                    <div className="absolute inset-x-0 z-30 flex items-center" style={{ top: nowTop }}>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "#ef4444" }} />
                      <span className="h-px flex-1" style={{ background: "#ef4444" }} />
                    </div>
                  )}
                  {/* Time-positioned event blocks */}
                  {placed.map(pl => {
                    const on = pl.e.id === selected;
                    return (
                      <button key={pl.e.id} onClick={() => onOpen(pl.e.id)} title={pl.e.title}
                        className="absolute z-10 overflow-hidden rounded-md px-1.5 py-0.5 text-left transition-shadow hover:shadow-md"
                        style={{ top: pl.top, height: pl.height, left: `calc(${pl.leftPct}% + 2px)`, width: `calc(${pl.widthPct}% - 4px)`,
                          background: on ? "var(--section-accent)" : "color-mix(in srgb, var(--section-accent) 13%, var(--surface-card))",
                          borderLeft: "2px solid var(--section-accent)", color: on ? "#fff" : "var(--text-primary)" }}>
                        <div className="flex items-center gap-1 truncate text-[11px] font-semibold leading-tight">{pl.e.call_url && <Video size={9} className="shrink-0" />}<span className="truncate">{pl.e.title}</span></div>
                        {pl.height > 30 && <div className="truncate text-[10px] leading-tight opacity-75">{fmtTime(pl.e.start_at, lang)}</div>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function CalendarPage() {
  const { t, lang } = useLanguage();
  const [params, setParams] = useSearchParams();
  const openId = params.get("event");
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("today");

  const eventsQ = useQuery<{ events: CalEvent[]; calls_enabled: boolean }>({
    queryKey: ["calendar-events"],
    queryFn: () => apiClient.get(`/calendar/events?from=${new Date(Date.now() - 3600_000).toISOString()}`),
    retry: false,
  });
  const events = (eventsQ.data?.events ?? []).filter(e => e.status !== "cancelled");
  const now = new Date();

  const todayStart = useMemo(() => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const todayEvents = useMemo(() => events.filter(e => isSameDay(new Date(e.start_at), now)), [events]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Week = the current Mon–Sun calendar week (a real weekly grid, not a rolling list).
  const weekDays = useMemo(() => {
    const monday = new Date(now); monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) { const k = dayKey(e.start_at); (map.get(k) ?? map.set(k, []).get(k)!).push(e); }
    return [...map.entries()];
  }, [events]);

  const dayLabel = (key: string) => {
    const d = new Date(key); const today = new Date(); const tmr = new Date(Date.now() + 86_400_000);
    if (d.toDateString() === today.toDateString()) return t("cal.today");
    if (d.toDateString() === tmr.toDateString()) return t("cal.tomorrow");
    try { return d.toLocaleDateString(lang, { weekday: "long", month: "long", day: "numeric" }); } catch { return key; }
  };

  const openEvent = (id: string) => setParams({ event: id }, { replace: true });
  const Row = ({ e, active }: { e: CalEvent; active?: boolean }) => (
    <button onClick={() => openEvent(e.id)}
      className="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: active ? "var(--section-accent)" : "var(--border-soft)", background: active ? "var(--surface-selected)" : "var(--surface-card)" }}>
      <div className="w-14 shrink-0 text-[12px] tabular-nums" style={{ color: "var(--text-secondary)" }}>{fmtTime(e.start_at, lang)}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{e.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px]" style={{ color: "var(--text-faint)" }}>
          <Users size={11} /> {e.attendees.length + 1}
          {e.call_url && <><Video size={11} /> {t("cal.join_call")}</>}
          {e.location && <><MapPin size={11} /> {e.location}</>}
        </div>
      </div>
    </button>
  );

  const tabs: { k: ViewMode; label: string }[] = [
    { k: "today", label: t("cal.view_today") }, { k: "week", label: t("cal.view_week") }, { k: "upcoming", label: t("cal.view_upcoming") },
  ];

  // The brief panel tracks the selected meeting, falling back to the next upcoming one.
  const nextEvent = useMemo(() => events.find(e => new Date(e.end_at || e.start_at) >= now), [events]);   // eslint-disable-line react-hooks/exhaustive-deps
  const briefId = openId ?? nextEvent?.id ?? null;
  const selected = openId;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold" style={{ color: "var(--text-primary)" }}>{t("cal.title")}</h1>
          {/* Visible Meeting Agent identity. Status is honest: on-demand, never a fake "running" job. */}
          <p className="mt-1 flex items-center gap-1.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
            <CalendarClock size={13} style={{ color: "var(--section-accent)" }} />
            <span className="font-medium" style={{ color: "var(--text-secondary)" }}>{t("cal.meeting_agent")}</span>
            <span style={{ color: "var(--text-faint)" }}>· {t("cal.agent_monitoring")}</span>
            <span className="ml-1 flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#22c55e" }} /> {t("cal.agent_available")}
            </span>
          </p>
        </div>
        <button onClick={() => setCreateOpen(true)} className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: "var(--section-accent)" }}>
          <Plus size={13} /> {t("cal.new_meeting")}
        </button>
      </div>

      {/* Today intelligence strip — real data only, no fabricated scores/conflicts. */}
      <TodayStrip onOpen={openEvent} />

      {/* Command-center split: agenda/timeline on the left, a persistent Meeting Brief on the right (lg+). */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="mb-4 inline-flex rounded-lg border p-0.5" style={{ borderColor: "var(--border-soft)" }}>
            {tabs.map(tab => (
              <button key={tab.k} onClick={() => setView(tab.k)}
                className="rounded-md px-3 py-1 text-[12px] font-medium transition-colors" style={view === tab.k ? { background: "var(--section-accent)", color: "#fff" } : { color: "var(--text-muted)" }}>
                {tab.label}
              </button>
            ))}
          </div>

          {eventsQ.isLoading ? (
            <div className="flex items-center gap-2 rounded-xl border py-12 px-4 text-[13px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}><Loader2 size={14} className="animate-spin" /> {t("state.loading")}</div>
          ) : eventsQ.isError ? (
            <div className="rounded-xl border py-12 text-center text-[13px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>Couldn't load your calendar. <button onClick={() => eventsQ.refetch()} className="underline">Retry</button></div>
          ) : view === "today" ? (
            todayEvents.length === 0
              ? <EmptyState label={t("cal.all_clear")} onNew={() => setCreateOpen(true)} newLabel={t("cal.new_meeting")} />
              : <div className="rounded-xl border" style={{ borderColor: "var(--border-soft)" }}><TimeGrid days={[todayStart]} events={events} selected={selected} onOpen={openEvent} lang={lang} single /></div>
          ) : view === "week" ? (
            <div className="rounded-xl border" style={{ borderColor: "var(--border-soft)" }}><TimeGrid days={weekDays} events={events} selected={selected} onOpen={openEvent} lang={lang} /></div>
          ) : groups.length === 0 ? (
            <EmptyState label={t("cal.empty")} onNew={() => setCreateOpen(true)} newLabel={t("cal.new_meeting")} />
          ) : (
            <div className="space-y-5">
              {groups.map(([key, evs]) => (
                <div key={key}>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{dayLabel(key)}</p>
                  <div className="space-y-2">{evs.map(e => <Row key={e.id} e={e} active={e.id === selected} />)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Persistent Meeting Brief (desktop). Mobile uses the drawer below. */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-page)" }}>
            {briefId ? <MeetingBriefBody id={briefId} /> : (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
                <CalendarDays size={20} style={{ color: "var(--text-faint)" }} />
                <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>{t("cal.select_meeting")}</p>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Mobile drawer — same brief body, shown only below lg. */}
      {openId && <div className="lg:hidden"><EventDrawer id={openId} onClose={() => setParams({}, { replace: true })} /></div>}
      {createOpen && <CreateModal callsEnabled={eventsQ.data?.calls_enabled ?? false} onClose={() => setCreateOpen(false)} onCreated={(id) => { setCreateOpen(false); openEvent(id); }} />}
    </div>
  );
}

function EmptyState({ label, onNew, newLabel }: { label: string; onNew: () => void; newLabel: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border py-16 text-center" style={{ borderColor: "var(--border-soft)" }}>
      <CalendarDays size={22} style={{ color: "var(--text-faint)" }} />
      <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>{label}</p>
      <button onClick={onNew} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--section-accent)" }}>
        <Plus size={13} /> {newLabel}
      </button>
    </div>
  );
}

interface TodayBrief {
  count: number;
  next: { id: string; title: string; start_at: string; call_url: string | null } | null;
  conflicts: { a: string; b: string; a_title: string; b_title: string }[];
  no_agenda: { id: string; title: string }[];
  no_call_link: { id: string; title: string }[];
  suggestions: string[];
  calls_enabled: boolean;
}

/** Today intelligence strip — deterministic brief from real events (counts, next, overlaps, gaps). */
function TodayStrip({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, lang } = useLanguage();
  const q = useQuery<TodayBrief>({ queryKey: ["calendar-brief-today"], queryFn: () => apiClient.get("/calendar/brief/today"), retry: false });
  const b = q.data;
  if (q.isLoading || !b) return <div className="h-[74px] animate-pulse rounded-2xl border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }} />;

  const Stat = ({ icon, n, label, tone }: { icon: React.ReactNode; n: number; label: string; tone?: string }) => (
    <div className="flex items-center gap-2">
      <span style={{ color: tone ?? "var(--text-faint)" }}>{icon}</span>
      <span className="text-[13px] font-semibold tabular-nums" style={{ color: tone ?? "var(--text-primary)" }}>{n}</span>
      <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{label}</span>
    </div>
  );

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <Sparkles size={15} style={{ color: "var(--section-accent)" }} />
          <span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{t("cal.brief_heading")}</span>
          {/* subtle Meeting Agent source */}
          <span className="hidden items-center gap-1 text-[10px] sm:flex" style={{ color: "var(--text-faint)" }}><CalendarClock size={10} /> {t("cal.meeting_agent")}</span>
        </div>
        <Stat icon={<CalendarDays size={14} />} n={b.count} label={t("cal.meetings_today")} />
        {b.conflicts.length > 0 && <Stat icon={<AlertTriangle size={14} />} n={b.conflicts.length} label={t("cal.overlaps")} tone="#f59e0b" />}
        {b.no_agenda.length > 0 && <Stat icon={<FileText size={14} />} n={b.no_agenda.length} label={t("cal.needs_agenda")} />}
        {b.calls_enabled && b.no_call_link.length > 0 && <Stat icon={<Link2 size={14} />} n={b.no_call_link.length} label={t("cal.needs_call")} />}
      </div>

      {(b.next || b.suggestions.length > 0 || b.count === 0) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3" style={{ borderColor: "var(--border-soft)" }}>
          {b.next ? (
            <button onClick={() => onOpen(b.next!.id)} className="flex items-center gap-2 text-left">
              <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>{t("cal.next_up")}</span>
              <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{b.next.title}</span>
              <span className="text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>{fmtTime(b.next.start_at, lang)}</span>
              <ArrowRight size={13} style={{ color: "var(--section-accent)" }} />
            </button>
          ) : <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{t("cal.all_clear")}</span>}
          {b.suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {b.suggestions.map((s, i) => <span key={i} className="rounded-full px-2.5 py-1 text-[11px]" style={{ background: "var(--surface-hover)", color: "var(--text-secondary)" }}>{s}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PrepResult {
  event: CalEvent; ai_available: boolean;
  agenda_summary: string | null; talking_points: string[]; follow_ups: string[];
  sources: { type: string; object_type: string; node_id: string; title: string; match_reason: string }[];
}

/** Mobile-only drawer wrapping the shared brief body. Desktop uses the persistent right panel. */
function EventDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-[201] flex h-full w-full max-w-md flex-col border-l shadow-2xl" style={{ background: "var(--surface-page)", borderColor: "var(--border-soft)" }} dir="auto">
        <MeetingBriefBody id={id} onClose={onClose} />
      </aside>
    </>
  );
}

/**
 * The Meeting Brief — shared by the desktop persistent panel and the mobile drawer. Self-contained
 * (own header + scroll body): meeting details, call status, attendees, source-backed AI preparation,
 * after-meeting placeholders, and organizer actions. `onClose` is passed only in the drawer.
 */
function MeetingBriefBody({ id, onClose }: { id: string; onClose?: () => void }) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const me = useCurrentUser();
  const qc = useQueryClient();
  const detail = useQuery<CalEvent & { calls_enabled: boolean }>({ queryKey: ["calendar-event", id], queryFn: () => apiClient.get(`/calendar/events/${id}`) });
  const cancel = useMutation({ mutationFn: () => apiClient.delete(`/calendar/events/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["calendar-events"] }); onClose?.(); } });
  const addCall = useMutation({ mutationFn: () => apiClient.post(`/calendar/events/${id}/call-link`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar-event", id] }) });
  const prepare = useMutation<PrepResult>({ mutationFn: () => apiClient.post(`/calendar/events/${id}/prepare`, {}) });
  const e = detail.data;
  const isOrganizer = e?.organizer.user_id === me.userId;

  return (
    <>
        {/* AI co-pilot header — Meeting Agent identity + attribution. */}
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--border-soft)", background: "color-mix(in srgb, var(--section-accent) 5%, var(--surface-page))" }}>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}><CalendarClock size={13} style={{ color: "var(--section-accent)" }} /> {t("cal.meeting_agent")}</span>
            {onClose && <button onClick={onClose} className="btn-icon h-7 w-7"><X size={15} /></button>}
          </div>
          <span className="mt-1.5 block truncate text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>{e?.title ?? "…"}</span>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>{t("cal.prepared_by")} {t("cal.meeting_agent")}</span>
        </div>
        {!e ? <div className="p-5"><Loader2 size={16} className="animate-spin" /></div> : (
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-[13px]">
            <div style={{ color: "var(--text-secondary)" }}>
              {(() => { try { return new Date(e.start_at).toLocaleString(lang, { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return e.start_at; } })()} – {fmtTime(e.end_at, lang)}
              {e.timezone && <span className="text-[11px]" style={{ color: "var(--text-faint)" }}> · {e.timezone}</span>}
            </div>
            {e.status === "cancelled" && <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: "#ef44441a", color: "#ef4444" }}>{t("cal.cancelled")}</span>}
            {e.call_url && <button onClick={() => navigate(`/calls/${e.id}`)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: "var(--section-accent)" }}><Video size={13} /> {t("cal.join_call")}</button>}
            {e.location && <div className="flex items-center gap-2" style={{ color: "var(--text-secondary)" }}><MapPin size={13} style={{ color: "var(--text-faint)" }} /> {e.location}</div>}
            {e.description && <div className="whitespace-pre-wrap rounded-lg border p-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}>{e.description}</div>}

            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{t("cal.attendees")}</p>
              <div className="space-y-1">
                <div style={{ color: "var(--text-primary)" }}>{e.organizer.name} <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>· organizer</span></div>
                {e.attendees.map(a => <div key={a.user_id} style={{ color: "var(--text-secondary)" }}>{a.name}</div>)}
              </div>
            </div>

            {/* AI preparation — source-backed, never fabricated. */}
            <div className="rounded-xl border p-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}><Wand2 size={13} style={{ color: "var(--section-accent)" }} /> {t("cal.meeting_brief")}</span>
                {!prepare.data && <button onClick={() => prepare.mutate()} disabled={prepare.isPending} className="flex items-center gap-1 text-[11px] font-medium" style={{ color: "var(--section-accent)" }}>{prepare.isPending ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} {t("cal.prepare")}</button>}
              </div>
              {prepare.data && <PrepView r={prepare.data} onOpenRecord={(oid, nid) => navigate(`/objects/${oid}/${nid}`)} />}
              {prepare.isError && <p className="mt-2 text-[11px]" style={{ color: "var(--text-faint)" }}>{t("cal.ai_unavailable")}</p>}
            </div>

            {/* After-meeting placeholders — clearly marked, not wired (no fake completion). */}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{t("cal.after_meeting")}</p>
              <div className="flex flex-wrap gap-2">
                {[{ i: <ListChecks size={12} />, l: t("cal.followup_task") }, { i: <StickyNote size={12} />, l: t("cal.draft_notes") }, { i: <Send size={12} />, l: t("cal.send_recap") }].map((a, i) => (
                  <span key={i} title={t("cal.coming_soon")} className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] opacity-60" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
                    {a.i} {a.l} <span className="ml-0.5 rounded-full px-1.5 py-px text-[9px]" style={{ background: "var(--surface-hover)", color: "var(--text-faint)" }}>{t("cal.coming_soon")}</span>
                  </span>
                ))}
              </div>
            </div>

            {isOrganizer && e.status !== "cancelled" && (
              <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: "var(--border-soft)" }}>
                {!e.call_url && e.calls_enabled && <button onClick={() => addCall.mutate()} disabled={addCall.isPending} className="rounded-lg border px-3 py-1.5 text-[12px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--section-accent)" }}><Video size={12} className="mr-1 inline" /> {t("cal.add_call")}</button>}
                {!e.calls_enabled && !e.call_url && <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{t("cal.calls_off")}</span>}
                <button onClick={() => cancel.mutate()} disabled={cancel.isPending} className="rounded-lg border px-3 py-1.5 text-[12px] font-medium" style={{ borderColor: "#ef444455", color: "#ef4444" }}>{t("cal.cancel_meeting")}</button>
              </div>
            )}
          </div>
        )}
    </>
  );
}

function PrepView({ r, onOpenRecord }: { r: PrepResult; onOpenRecord: (objectType: string, nodeId: string) => void }) {
  const { t } = useLanguage();
  const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="mt-3"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>{label}</p>{children}</div>
  );
  return (
    <div className="mt-1">
      {/* Attribution — this prep came from the Meeting Agent. */}
      <p className="mb-1 flex items-center gap-1 text-[10px]" style={{ color: "var(--text-faint)" }}><CalendarClock size={10} /> {t("cal.agent_source")}</p>
      {!r.ai_available && <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>{t("cal.ai_unavailable")}</p>}
      {r.agenda_summary && <Section label={t("cal.ai_summary")}><p className="text-[12.5px]" style={{ color: "var(--text-secondary)" }}>{r.agenda_summary}</p></Section>}
      {r.talking_points.length > 0 && <Section label={t("cal.talking_points")}><ul className="list-disc space-y-0.5 pl-4 text-[12.5px]" style={{ color: "var(--text-secondary)" }}>{r.talking_points.map((p, i) => <li key={i}>{p}</li>)}</ul></Section>}
      {r.follow_ups.length > 0 && <Section label={t("cal.follow_ups")}><ul className="list-disc space-y-0.5 pl-4 text-[12.5px]" style={{ color: "var(--text-secondary)" }}>{r.follow_ups.map((p, i) => <li key={i}>{p}</li>)}</ul></Section>}
      <Section label={t("cal.related_records")}>
        {r.sources.length === 0 ? (
          // No matched records → be explicit the suggestions rely only on the meeting details (no fabrication).
          <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>{t("cal.based_on_details")}</p>
        ) : (
          <>
            <div className="space-y-1">
              {r.sources.map(s => (
                <button key={s.node_id} onClick={() => onOpenRecord(s.object_type, s.node_id)} className="flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)" }}>
                  <Circle size={7} className="shrink-0" style={{ color: "var(--section-accent)" }} />
                  <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: "var(--text-primary)" }}>{s.title}</span>
                  <span className="shrink-0 text-[10px]" style={{ color: "var(--text-faint)" }}>{s.match_reason}</span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[10px]" style={{ color: "var(--text-faint)" }}>{t("cal.sources_note")}</p>
          </>
        )}
      </Section>
    </div>
  );
}

function CreateModal({ callsEnabled, onClose, onCreated }: { callsEnabled: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useLanguage();
  const me = useCurrentUser();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [location, setLocation] = useState("");
  const [attendees, setAttendees] = useState<string[]>([]);
  const [withCall, setWithCall] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const membersQ = useQuery<{ members: MemberRow[] }>({ queryKey: ["workspace-members-full"], queryFn: () => apiClient.get("/workspace/members-full"), staleTime: 60_000 });
  const others = (membersQ.data?.members ?? []).filter(m => m.id !== me.userId);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const create = useMutation({
    mutationFn: () => apiClient.post<{ id: string }>("/calendar/events", {
      title, description: desc || undefined, start_at: new Date(start).toISOString(), end_at: new Date(end || start).toISOString(),
      timezone: tz, attendee_ids: attendees, location: location || undefined, generate_call_link: withCall && callsEnabled,
    }),
    onSuccess: (r) => onCreated(r.id),
  });

  // AI agenda draft — fills the agenda field ONLY. Never auto-saves or creates the event.
  async function draftAgenda() {
    if (aiBusy) return; setAiBusy(true);
    try { const r = await apiClient.post<{ agenda?: string }>("/calendar/draft-agenda", { title, prompt: desc.trim() || title || "team sync" }); if (r.agenda) setDesc(r.agenda); }
    catch { /* leave as-is */ } finally { setAiBusy(false); }
  }

  const valid = title.trim() && start;
  const field = "w-full rounded-lg border bg-transparent px-3 py-2 text-[13px] outline-none";
  const style = { borderColor: "var(--border-soft)", color: "var(--text-primary)" } as const;

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[201] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border shadow-2xl" style={{ background: "var(--surface-page)", borderColor: "var(--border-soft)" }}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{t("cal.new_meeting")}</span>
          <button onClick={onClose} className="btn-icon h-7 w-7"><X size={15} /></button>
        </div>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto p-4">
          <input autoFocus className={field} style={style} placeholder={t("cal.title_field")} value={title} onChange={e => setTitle(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px]" style={{ color: "var(--text-muted)" }}>{t("cal.starts")}<input type="datetime-local" className={`${field} dark:[color-scheme:dark]`} style={style} value={start} onChange={e => setStart(e.target.value)} /></label>
            <label className="text-[11px]" style={{ color: "var(--text-muted)" }}>{t("cal.ends")}<input type="datetime-local" className={`${field} dark:[color-scheme:dark]`} style={style} value={end} onChange={e => setEnd(e.target.value)} /></label>
          </div>
          <input className={field} style={style} placeholder={t("cal.location")} value={location} onChange={e => setLocation(e.target.value)} />
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{t("cal.agenda")}</span>
              <button onClick={draftAgenda} disabled={aiBusy} className="flex items-center gap-1 text-[11px] font-medium" style={{ color: "var(--section-accent)" }}>{aiBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} {t("cal.draft_agenda")}</button>
            </div>
            <textarea className={`${field} min-h-[70px] resize-none`} style={style} placeholder={t("cal.agenda")} value={desc} onChange={e => setDesc(e.target.value)} />
          </div>
          <div>
            <p className="mb-1 text-[11px]" style={{ color: "var(--text-muted)" }}>{t("cal.attendees")}</p>
            <div className="flex max-h-32 flex-col gap-0.5 overflow-y-auto rounded-lg border p-1" style={{ borderColor: "var(--border-soft)" }}>
              {others.map(m => {
                const on = attendees.includes(m.id);
                return (
                  <button key={m.id} onClick={() => setAttendees(a => on ? a.filter(x => x !== m.id) : [...a, m.id])}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[var(--surface-hover)]" style={{ color: "var(--text-primary)" }}>
                    <span className="truncate">{m.name || m.email}</span>
                    {on && <Check size={13} style={{ color: "var(--section-accent)" }} />}
                  </button>
                );
              })}
              {others.length === 0 && <span className="px-2 py-1.5 text-[12px]" style={{ color: "var(--text-faint)" }}>{t("state.empty")}</span>}
            </div>
          </div>
          <label className="flex items-center gap-2 text-[12.5px]" style={{ color: callsEnabled ? "var(--text-primary)" : "var(--text-faint)" }}>
            <input type="checkbox" checked={withCall && callsEnabled} disabled={!callsEnabled} onChange={e => setWithCall(e.target.checked)} />
            <Video size={13} /> {t("cal.add_call")} {!callsEnabled && <span className="text-[11px]">— {t("cal.calls_off")}</span>}
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <button onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[12px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>{t("common.cancel")}</button>
          <button onClick={() => valid && create.mutate()} disabled={!valid || create.isPending} className="rounded-lg px-4 py-1.5 text-[12px] font-medium text-white disabled:opacity-50" style={{ background: "var(--section-accent)" }}>
            {create.isPending ? <Loader2 size={13} className="animate-spin" /> : t("common.save")}
          </button>
        </div>
      </div>
    </>
  );
}
