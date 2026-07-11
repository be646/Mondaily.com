import { useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Plus, X, Loader2, Video, MapPin, Users, Sparkles, Check, AlertTriangle, FileText, Link2, ArrowRight, Wand2, ListChecks, Send, StickyNote, Circle, CalendarClock, ChevronLeft, ChevronRight, Repeat } from "lucide-react";
import { FieldSelect } from "../../components/ui/controls";
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
type Rsvp = "accepted" | "declined" | "tentative";
interface Person { user_id: string; name: string; email: string | null; response?: Rsvp | null }
interface CalEvent {
  id: string; title: string; description: string; start_at: string; end_at: string; timezone: string;
  location: string; status: "scheduled" | "cancelled" | "completed"; call_url: string | null;
  organizer: Person; attendees: Person[];
  // Recurrence — series master carries the rule + summary; a list occurrence also carries these.
  recurrence?: { freq: "daily" | "weekly" | "monthly"; interval: number; count?: number; until?: string } | null;
  recurrence_summary?: string | null;
  recurring?: boolean; master_id?: string; occurrence_date?: string;
  responses?: Record<string, Rsvp>;
  response_counts?: { accepted: number; declined: number; tentative: number; no_response: number };
}
interface MemberRow { id: string; name?: string; email: string }
type ViewMode = "today" | "week" | "month" | "upcoming";

const fmtTime = (iso: string, loc: string) => { try { return new Date(iso).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
/** A Date → "YYYY-MM-DDTHH:mm" string for <input type="datetime-local"> (local time, no seconds). */
const toLocalInput = (d: Date) => { const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
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

// Semantic, MUTED meeting tones — derived only from real event fields (never random). Missing agenda
// reads rose; finance/billing amber; client/external green; everything else a neutral slate. No cyan
// "AI-prepared" tone here because the event list carries no per-event prep signal (stays neutral).
const TONE = {
  slate: { edge: "#717784", tint: "rgba(113,119,132,0.07)" },
  green: { edge: "#5f8169", tint: "rgba(95,129,105,0.07)" },
  amber: { edge: "#97824f", tint: "rgba(151,130,79,0.07)" },
  rose:  { edge: "#9c6b72", tint: "rgba(156,107,114,0.08)" },
} as const;
const FINANCE_RE = /\b(invoice|billing|payment|finance|budget|quote|renewal|pricing)\b/i;
const EXTERNAL_RE = /\b(client|customer|external|prospect|demo|onboard\w*|kickoff|vendor|partner|intro)\b/i;
function meetingTone(e: CalEvent): { edge: string; tint: string } {
  if (!(e.description ?? "").trim()) return TONE.rose;      // missing agenda → gentle attention
  if (FINANCE_RE.test(e.title)) return TONE.amber;
  if (EXTERNAL_RE.test(e.title)) return TONE.green;
  return TONE.slate;                                        // internal / team (neutral default)
}

/**
 * A real calendar time grid — a left time rail, horizontal hour lines, day columns, time-positioned
 * event blocks (overlaps laid side-by-side), today shading, and a live current-time line. Drives both
 * the Today day-timeline (single column) and the Week grid (seven columns).
 */
function TimeGrid({ days, events, selected, onOpen, onSlot, lang, single }: {
  days: Date[]; events: CalEvent[]; selected: string | null; onOpen: (id: string) => void; onSlot?: (start: Date) => void; lang: string; single?: boolean;
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
        {/* Time rail — slimmer on phones to give day columns more room */}
        <div className="sticky left-0 z-20 w-9 shrink-0 sm:w-12" style={{ background: "var(--surface-page)" }}>
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
              <div key={d.toISOString()} className={`relative flex-1 border-l ${single ? "min-w-0" : "min-w-[6.5rem] sm:min-w-0"}`} style={{ borderColor: "var(--border-soft)" }}>
                {single ? <div style={{ height: 28 }} /> : (
                  <div className="sticky top-0 z-10 flex h-7 items-center justify-center gap-1 border-b text-[11px] font-medium" style={{ background: "var(--surface-page)", borderColor: "var(--border-soft)", color: isToday ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {d.toLocaleDateString(lang, { weekday: "short" })} <span className="tabular-nums">{d.getDate()}</span>
                  </div>
                )}
                <div className="group relative" style={{ height: bodyH, cursor: onSlot ? "pointer" : "default" }}
                  onClick={onSlot ? (ev) => {
                    // Click an empty slot → open New Meeting with the clicked time (rounded to 15m), 30m default.
                    const rect = ev.currentTarget.getBoundingClientRect();
                    let mins = Math.round((startH * 60 + ((ev.clientY - rect.top) / HOUR_PX) * 60) / 15) * 15;
                    mins = Math.max(0, Math.min(mins, 24 * 60 - 30));
                    const slot = new Date(d); slot.setHours(0, 0, 0, 0); slot.setMinutes(mins);
                    onSlot(slot);
                  } : undefined}>
                  {isToday && <div className="absolute inset-0" style={{ background: "color-mix(in srgb, var(--text-muted) 4%, transparent)" }} />}
                  {/* Subtle empty-slot hover affordance (only when slots are clickable) */}
                  {onSlot && <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100" style={{ background: "color-mix(in srgb, var(--text-muted) 3.5%, transparent)" }} />}
                  {/* Horizontal hour lines — thin + soft */}
                  {hours.map((h, i) => <div key={h} className="absolute inset-x-0 border-t" style={{ top: i * HOUR_PX, borderColor: "color-mix(in srgb, var(--border-soft) 55%, transparent)" }} />)}
                  {/* Current-time line (only on today, when in the visible window) — soft pulse on the dot */}
                  {isToday && nowVisible && (
                    <div className="absolute inset-x-0 z-30 flex items-center" style={{ top: nowTop }}>
                      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full" style={{ background: "#b45454" }} />
                      <span className="h-px flex-1" style={{ background: "color-mix(in srgb, #b45454 70%, transparent)" }} />
                    </div>
                  )}
                  {/* Time-positioned event blocks — semantic muted tone from real fields */}
                  {placed.map(pl => {
                    const on = pl.e.id === selected;
                    const tone = meetingTone(pl.e);
                    return (
                      <button key={pl.e.id} onClick={(ev) => { ev.stopPropagation(); onOpen(pl.e.id); }} title={pl.e.title}
                        className="absolute z-10 overflow-hidden rounded-[3px] px-1.5 py-0.5 text-left transition-colors"
                        style={{ top: pl.top, height: pl.height, left: `calc(${pl.leftPct}% + 1px)`, width: `calc(${pl.widthPct}% - 2px)`,
                          background: on ? tone.edge : tone.tint,
                          borderLeft: `3px solid ${tone.edge}`, color: on ? "#fff" : "var(--text-primary)" }}>
                        <div className="flex items-center gap-1 truncate text-[11px] font-medium leading-tight">
                          {/* small semantic icons: missing agenda, call link */}
                          {!(pl.e.description ?? "").trim() && <FileText size={9} className="shrink-0" style={{ opacity: 0.55 }} />}
                          {pl.e.call_url && <Video size={9} className="shrink-0" style={{ opacity: 0.6 }} />}
                          <span className="truncate">{pl.e.title}</span>
                        </div>
                        {pl.height > 30 && <div className="flex items-center gap-1 truncate text-[10px] leading-tight opacity-70">{fmtTime(pl.e.start_at, lang)}{pl.e.call_url && <span className="h-1 w-1 rounded-full" style={{ background: "#5f8a6a" }} />}</div>}
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
  const navigateTo = useNavigate();
  const [params, setParams] = useSearchParams();
  const openId = params.get("event");
  const [createOpen, setCreateOpen] = useState(false);
  const [createInit, setCreateInit] = useState<{ start: string; end: string } | null>(null);
  const [view, setView] = useState<ViewMode>("today");
  // Click an empty grid slot → open New Meeting prefilled with that time + a 30-minute default end.
  const openSlot = (start: Date) => { setCreateInit({ start: toLocalInput(start), end: toLocalInput(new Date(start.getTime() + 30 * 60_000)) }); setCreateOpen(true); };
  const openCreate = () => { setCreateInit(null); setCreateOpen(true); };
  // The date the Day/Week grid is centered on — moved by the Today / ‹ / › controls.
  const [anchor, setAnchor] = useState<Date>(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });

  const eventsQ = useQuery<{ events: CalEvent[]; calls_enabled: boolean }>({
    queryKey: ["calendar-events"],
    queryFn: () => apiClient.get(`/calendar/events?from=${new Date(Date.now() - 3600_000).toISOString()}`),
    retry: false,
  });
  const events = (eventsQ.data?.events ?? []).filter(e => e.status !== "cancelled");
  const now = new Date();

  // Drag-to-reschedule (month grid): drop a non-recurring meeting on another day → keep its
  // time-of-day, move the date. Duration is preserved server-side.
  const calQc = useQueryClient();
  const reschedule = useMutation({
    mutationFn: ({ id, start_at }: { id: string; start_at: string }) => apiClient.post(`/calendar/events/${id}/reschedule`, { start_at }),
    onSuccess: () => calQc.invalidateQueries({ queryKey: ["calendar-events"] }),
  });
  const moveEventToDay = (eventId: string, currentStart: string, targetDay: Date) => {
    const src = new Date(currentStart);
    const next = new Date(targetDay); next.setHours(src.getHours(), src.getMinutes(), 0, 0);
    reschedule.mutate({ id: eventId, start_at: toLocalInput(next) });
  };

  // Week = the Mon–Sun calendar week containing the anchor (a real weekly grid).
  const anchorWeek = useMemo(() => {
    const monday = new Date(anchor); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
  }, [anchor]);
  // Month = a full 6×7 calendar grid (Mon-first) covering the month that contains the anchor, with
  // leading/trailing days from the neighbouring months so the grid is always rectangular.
  const monthGrid = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = new Date(first); gridStart.setDate(1 - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  }, [anchor]);
  const dayCount = events.filter(e => isSameDay(new Date(e.start_at), anchor)).length;
  const weekCount = events.filter(e => anchorWeek.some(d => isSameDay(new Date(e.start_at), d))).length;
  const monthCount = events.filter(e => { const d = new Date(e.start_at); return d.getMonth() === anchor.getMonth() && d.getFullYear() === anchor.getFullYear(); }).length;
  const isAnchorToday = isSameDay(anchor, now);
  const shift = (dir: number) => setAnchor(a => {
    const d = new Date(a);
    if (view === "month") d.setMonth(d.getMonth() + dir);
    else d.setDate(d.getDate() + dir * (view === "week" ? 7 : 1));
    return d;
  });
  const goToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); setAnchor(d); };
  const rangeLabel = view === "week"
    ? `${anchorWeek[0]!.toLocaleDateString(lang, { month: "short", day: "numeric" })} – ${anchorWeek[6]!.toLocaleDateString(lang, { month: "short", day: "numeric" })}`
    : view === "month"
    ? anchor.toLocaleDateString(lang, { month: "long", year: "numeric" })
    : anchor.toLocaleDateString(lang, { weekday: "long", month: "long", day: "numeric" });

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
      className="flex w-full items-center gap-3 rounded-sm border px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
      style={{ borderColor: "var(--border-soft)", borderLeft: `3px solid ${meetingTone(e).edge}`, background: active ? "var(--surface-selected)" : "var(--surface-card)" }}>
      <div className="w-14 shrink-0 text-[12px] tabular-nums" style={{ color: "var(--text-secondary)" }}>{fmtTime(e.start_at, lang)}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{e.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px]" style={{ color: "var(--text-faint)" }}>
          <Users size={11} /> {e.attendees.length + 1}
          {e.call_url && <><Video size={11} /> {t("cal.join_call")}</>}
          {e.location && <><MapPin size={11} /> {e.location}</>}
          {(e.recurring || e.recurrence) && <><Repeat size={11} /> {e.recurrence_summary || t("cal.repeat")}</>}
        </div>
      </div>
    </button>
  );

  const tabs: { k: ViewMode; label: string }[] = [
    { k: "today", label: t("cal.view_today") }, { k: "week", label: t("cal.view_week") }, { k: "month", label: t("cal.view_month") }, { k: "upcoming", label: t("cal.view_upcoming") },
  ];

  // The brief panel shows the SELECTED meeting; when nothing is selected it shows a Today briefing.
  const selected = openId;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold" style={{ color: "var(--text-primary)" }}>{t("cal.title")}</h1>
          {/* Meeting Agent identity — one calm line, a single status dot. Honest: on-demand / available only. */}
          <p className="mt-1 flex items-center gap-1.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
            <CalendarClock size={12} style={{ color: "var(--text-muted)" }} />
            <span style={{ color: "var(--text-secondary)" }}>{t("cal.meeting_agent")}</span>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#5f8a6a" }} title={t("cal.agent_available")} />
            <span style={{ color: "var(--text-faint)" }}>{t("cal.agent_available")} · {t("cal.agent_monitoring")}</span>
          </p>
        </div>
      </div>

      {/* Today intelligence strip — real data only, no fabricated scores/conflicts. */}
      <TodayStrip onOpen={openEvent} selectedId={selected} events={events.filter(e => isSameDay(new Date(e.start_at), now))} onCreate={openCreate} onDraft={openCreate} onFollowups={() => navigateTo("/tasks")} />

      {/* One clean control bar: Today · ‹ › · range · Day/Week/Upcoming · New meeting. */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-b pb-3" style={{ borderColor: "var(--border-soft)" }}>
        <div className="flex items-center gap-2">
          <button onClick={goToday} disabled={isAnchorToday && view !== "upcoming"} className="flex h-7 items-center rounded-sm border px-2.5 text-[12px] font-medium transition-colors disabled:opacity-40" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>{t("cal.today")}</button>
          {view !== "upcoming" && (
            <div className="flex items-center gap-0.5">
              <button onClick={() => shift(-1)} aria-label={t("cal.prev")} className="btn-icon h-7 w-7"><ChevronLeft size={15} /></button>
              <button onClick={() => shift(1)} aria-label={t("cal.next")} className="btn-icon h-7 w-7"><ChevronRight size={15} /></button>
              <span className="ml-1 text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{rangeLabel}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex h-7 items-center rounded-sm border p-0.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)" }}>
            {tabs.map(tab => (
              <button key={tab.k} onClick={() => setView(tab.k)}
                className="flex h-full items-center rounded-[3px] px-2.5 text-[12px] font-medium transition-colors"
                style={view === tab.k ? { background: "var(--surface-card)", color: "var(--text-primary)" } : { color: "var(--text-muted)" }}>
                {tab.label}
              </button>
            ))}
          </div>
          <button onClick={openCreate} className="flex h-7 shrink-0 items-center gap-1.5 rounded-sm border px-3 text-[12px] font-semibold transition-colors" style={{ borderColor: "var(--border-strong)", background: "var(--surface-card-2)", color: "var(--text-primary)" }}>
            <Plus size={13} /> {t("cal.new_meeting")}
          </button>
        </div>
      </div>

      {/* Command-center split: agenda/timeline on the left, a persistent Meeting Brief on the right (lg+). */}
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">

          {eventsQ.isLoading ? (
            <div className="flex items-center gap-2 rounded-sm border py-12 px-4 text-[13px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}><Loader2 size={14} className="animate-spin" /> {t("state.loading")}</div>
          ) : eventsQ.isError ? (
            <div className="rounded-sm border py-12 text-center text-[13px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>Couldn't load your calendar. <button onClick={() => eventsQ.refetch()} className="underline">Retry</button></div>
          ) : view === "today" ? (
            // Always a real day timeline — even with zero meetings, a subtle in-grid hint + suggestions.
            <div className="relative overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
              <TimeGrid days={[anchor]} events={events} selected={selected} onOpen={openEvent} onSlot={openSlot} lang={lang} single />
              {dayCount === 0 && <GridEmpty hint={t("cal.clear_day")} onCreate={openCreate} onDraft={openCreate} onFollowups={() => navigateTo("/tasks")} t={t} />}
            </div>
          ) : view === "week" ? (
            <div className="relative overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
              <TimeGrid days={anchorWeek} events={events} selected={selected} onOpen={openEvent} onSlot={openSlot} lang={lang} />
              {weekCount === 0 && <GridEmpty hint={t("cal.clear_day")} onCreate={openCreate} onDraft={openCreate} onFollowups={() => navigateTo("/tasks")} t={t} />}
            </div>
          ) : view === "month" ? (
            <MonthGrid days={monthGrid} monthOf={anchor} events={events} selected={selected} today={now}
              onOpen={openEvent} onPickDay={(d) => { setAnchor(d); setView("today"); }}
              onCreateDay={(d) => { const s = new Date(d); s.setHours(9, 0, 0, 0); openSlot(s); }} onMove={moveEventToDay}
              lang={lang} moreLabel={(n) => t("cal.more_count").replace("{n}", String(n))} empty={monthCount === 0} emptyHint={t("cal.clear_day")} dragHint={t("cal.drag_hint")} />
          ) : groups.length === 0 ? (
            <EmptyState label={t("cal.empty")} onNew={openCreate} newLabel={t("cal.new_meeting")} />
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
          <div className="sticky top-6 flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-page)" }}>
            {openId ? <MeetingBriefBody id={openId} /> : <TodayBriefingPanel onOpen={openEvent} onFollowups={() => navigateTo("/tasks")} />}
          </div>
        </aside>
      </div>

      {/* Mobile drawer — same brief body, shown only below lg. */}
      {openId && <div className="lg:hidden"><EventDrawer id={openId} onClose={() => setParams({}, { replace: true })} /></div>}
      {createOpen && <CreateModal callsEnabled={eventsQ.data?.calls_enabled ?? false} initialStart={createInit?.start} initialEnd={createInit?.end} onClose={() => { setCreateOpen(false); setCreateInit(null); }} onCreated={(id) => { setCreateOpen(false); setCreateInit(null); openEvent(id); }} />}
    </div>
  );
}

function EmptyState({ label, onNew, newLabel }: { label: string; onNew: () => void; newLabel: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-sm border py-16 text-center" style={{ borderColor: "var(--border-soft)" }}>
      <CalendarDays size={22} style={{ color: "var(--text-faint)" }} />
      <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>{label}</p>
      <button onClick={onNew} className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-[12px] font-medium transition-colors" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
        <Plus size={13} /> {newLabel}
      </button>
    </div>
  );
}

/**
 * MonthGrid — the classic 6×7 month calendar. Each cell shows up to three time-ordered event chips
 * (colored by the same semantic meetingTone as the rest of the app) with a "+N more" overflow;
 * clicking a chip opens the meeting, clicking empty space in a day starts a 9am meeting there, and
 * clicking the day number jumps to that day's timeline. Days outside the anchored month are dimmed.
 */
function MonthGrid({ days, monthOf, events, selected, today, onOpen, onPickDay, onCreateDay, onMove, lang, moreLabel, empty, emptyHint, dragHint }: {
  days: Date[]; monthOf: Date; events: CalEvent[]; selected: string | null; today: Date;
  onOpen: (id: string) => void; onPickDay: (d: Date) => void; onCreateDay: (d: Date) => void;
  onMove?: (eventId: string, currentStart: string, targetDay: Date) => void;
  lang: string; moreLabel: (n: number) => string; empty: boolean; emptyHint: string; dragHint?: string;
}) {
  // Which day cell is currently being dragged over (for a subtle drop highlight).
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  // Bucket events by day once, each bucket sorted by start time.
  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) { const k = new Date(e.start_at).toDateString(); (map.get(k) ?? map.set(k, []).get(k)!).push(e); }
    for (const list of map.values()) list.sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at));
    return map;
  }, [events]);
  const weekdays = days.slice(0, 7);

  return (
    <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
      {/* weekday header */}
      <div className="grid grid-cols-7 border-b" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)" }}>
        {weekdays.map((d, i) => (
          <div key={i} className="px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
            {d.toLocaleDateString(lang, { weekday: "short" })}
          </div>
        ))}
      </div>
      {/* 6 weeks × 7 days */}
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const inMonth = d.getMonth() === monthOf.getMonth();
          const isToday = isSameDay(d, today);
          const dayEvents = byDay.get(d.toDateString()) ?? [];
          const shown = dayEvents.slice(0, 3);
          const overflow = dayEvents.length - shown.length;
          return (
            <div key={i} onClick={() => onCreateDay(d)}
              onDragOver={onMove ? (ev) => { ev.preventDefault(); if (dropIdx !== i) setDropIdx(i); } : undefined}
              onDragLeave={onMove ? () => setDropIdx(p => (p === i ? null : p)) : undefined}
              onDrop={onMove ? (ev) => {
                ev.preventDefault(); setDropIdx(null);
                try { const p = JSON.parse(ev.dataTransfer.getData("text/mondaily-event")); if (p?.id && p?.start && p.start.slice(0, 10) !== toLocalInput(d).slice(0, 10)) onMove(p.id, p.start, d); } catch { /* ignore */ }
              } : undefined}
              className="group relative flex min-h-[92px] cursor-pointer flex-col gap-1 p-1.5 transition-colors hover:bg-[var(--surface-hover)]"
              style={{ borderTop: i >= 7 ? "1px solid var(--border-soft)" : undefined, borderLeft: i % 7 !== 0 ? "1px solid var(--border-soft)" : undefined, background: dropIdx === i ? "var(--surface-selected)" : inMonth ? undefined : "var(--surface-hover)" }}>
              <button onClick={(ev) => { ev.stopPropagation(); onPickDay(d); }}
                className="flex h-5 w-5 items-center justify-center self-start rounded-full text-[11.5px] tabular-nums transition-colors"
                style={isToday ? { background: "var(--text-primary)", color: "var(--surface-page)", fontWeight: 600 } : { color: inMonth ? "var(--text-secondary)" : "var(--text-faint)" }}
                title={d.toLocaleDateString(lang, { weekday: "long", month: "long", day: "numeric" })}>
                {d.getDate()}
              </button>
              {shown.map(e => {
                const tone = meetingTone(e);
                // Only non-recurring meetings are draggable — moving one occurrence of a series is
                // ambiguous, so those stay put (reschedule the series from its detail instead).
                const draggable = !!onMove && !e.recurring;
                return (
                  <button key={e.id} draggable={draggable}
                    onDragStart={draggable ? (ev) => { ev.stopPropagation(); ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/mondaily-event", JSON.stringify({ id: e.id, start: e.start_at })); } : undefined}
                    onClick={(ev) => { ev.stopPropagation(); onOpen(e.id); }}
                    className={`flex items-center gap-1 truncate rounded-[3px] px-1.5 py-0.5 text-left text-[11px] transition-colors hover:brightness-[0.97] ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
                    style={{ borderLeft: `2px solid ${tone.edge}`, background: e.id === selected ? "var(--surface-selected)" : tone.tint, color: "var(--text-secondary)" }}
                    title={`${fmtTime(e.start_at, lang)} · ${e.title}${draggable && dragHint ? ` — ${dragHint}` : ""}`}>
                    <span className="shrink-0 tabular-nums" style={{ color: "var(--text-faint)" }}>{fmtTime(e.start_at, lang)}</span>
                    <span className="truncate" style={{ color: "var(--text-primary)" }}>{e.title}</span>
                  </button>
                );
              })}
              {overflow > 0 && (
                <button onClick={(ev) => { ev.stopPropagation(); onPickDay(d); }} className="px-1.5 text-left text-[10.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                  {moreLabel(overflow)}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {empty && (
        <div className="border-t px-4 py-2.5 text-center text-[11.5px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>{emptyHint}</div>
      )}
    </div>
  );
}

/** A small native-calendar placeholder inside the grid when the range is empty — not a big floating box. */
function GridEmpty({ hint, onCreate, onDraft, onFollowups, t }: { hint: string; onCreate: () => void; onDraft: () => void; onFollowups: () => void; t: (k: string) => string }) {
  const link = "text-[12px] font-medium transition-colors hover:text-[color:var(--text-primary)]";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center pt-14">
      <div className="pointer-events-auto flex flex-col items-center gap-1.5 text-center">
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>{hint}</p>
        <div className="flex flex-wrap items-center justify-center gap-1.5" style={{ color: "var(--text-faint)" }}>
          <button onClick={onCreate} className={link} style={{ color: "var(--text-secondary)" }}>{t("cal.new_meeting")}</button>
          <span>·</span>
          <button onClick={onDraft} className={link} style={{ color: "var(--text-secondary)" }}>{t("cal.draft_agenda")}</button>
          <span>·</span>
          <button onClick={onFollowups} className={link} style={{ color: "var(--text-secondary)" }}>{t("cal.suggest_followups")}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Today briefing — what the persistent panel shows when no meeting is selected. Reuses the REAL Today
 * brief (counts, next meeting, conflicts, missing agenda/call gaps, suggestions). Attributed to the
 * Meeting Agent; no fabricated numbers. Follow-ups link out to Tasks (no fake count shown).
 */
function TodayBriefingPanel({ onOpen, onFollowups }: { onOpen: (id: string) => void; onFollowups: () => void }) {
  const { t, lang } = useLanguage();
  const q = useQuery<TodayBrief>({ queryKey: ["calendar-brief-today"], queryFn: () => apiClient.get("/calendar/brief/today"), staleTime: 30_000 });
  const b = q.data;
  const AMBER = "#a2854f";
  // Meetings needing attention today (missing agenda and/or call link) — each clickable to open + fix.
  const attention = (() => {
    if (!b) return [] as { id: string; title: string; tags: string[] }[];
    const m = new Map<string, { id: string; title: string; tags: string[] }>();
    for (const x of b.no_agenda) m.set(x.id, { id: x.id, title: x.title, tags: [t("cal.needs_agenda")] });
    if (b.calls_enabled) for (const x of b.no_call_link) { const e = m.get(x.id); if (e) e.tags.push(t("cal.needs_call")); else m.set(x.id, { id: x.id, title: x.title, tags: [t("cal.needs_call")] }); }
    return [...m.values()];
  })();
  const SectionHead = ({ children }: { children: React.ReactNode }) => (
    <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>{children}</p>
  );
  return (
    <>
      <div className="border-b px-5 py-3.5" style={{ borderColor: "var(--border-soft)" }}>
        <span className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide" style={{ color: "var(--text-faint)" }}><CalendarClock size={11} style={{ color: "var(--text-faint)" }} /> {t("cal.meeting_agent")}</span>
        <span className="mt-1 block text-[14.5px] font-semibold leading-snug" style={{ color: "var(--text-primary)" }}>{t("cal.today_briefing")}</span>
      </div>
      {!b ? <div className="p-5"><Loader2 size={16} className="animate-spin" /></div> : (
        <div className="flex-1 overflow-y-auto pb-2 text-[13px]">
          {/* Next meeting — clickable */}
          <SectionHead>{t("cal.next_up")}</SectionHead>
          {b.next ? (
            <button onClick={() => onOpen(b.next!.id)} className="flex w-full items-center justify-between px-4 py-2 text-left transition-colors hover:bg-[var(--surface-hover)]">
              <span className="block min-w-0 truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{b.next.title}</span>
              <span className="flex shrink-0 items-center gap-1 text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>{fmtTime(b.next.start_at, lang)} <ArrowRight size={12} style={{ color: "var(--text-faint)" }} /></span>
            </button>
          ) : <div className="px-4 py-2 text-[12px]" style={{ color: "var(--text-muted)" }}>{t("cal.all_clear")}</div>}

          {/* Needs attention — clickable rows that open the meeting to fix agenda / call link */}
          <SectionHead>{t("cal.needs_attention")}</SectionHead>
          {attention.length === 0 ? (
            <div className="px-4 py-2 text-[12px]" style={{ color: "var(--text-faint)" }}>{t("cal.st_none_found")}</div>
          ) : attention.map(a => (
            <button key={a.id} onClick={() => onOpen(a.id)} className="flex w-full items-center justify-between gap-2 px-4 py-1.5 text-left transition-colors hover:bg-[var(--surface-hover)]">
              <span className="min-w-0 truncate text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{a.title}</span>
              <span className="flex shrink-0 items-center gap-1">{a.tags.map((tag, i) => <span key={i} className="rounded-sm px-1.5 py-px text-[10px] font-medium" style={{ background: "rgba(151,130,79,0.14)", color: AMBER }}>{tag}</span>)}</span>
            </button>
          ))}

          {/* Open follow-ups → Tasks */}
          <SectionHead>{t("cal.open_followups")}</SectionHead>
          <button onClick={onFollowups} className="flex w-full items-center justify-between px-4 py-1.5 text-left transition-colors hover:bg-[var(--surface-hover)]">
            <span className="text-[12.5px]" style={{ color: "var(--text-secondary)" }}>{t("cal.all_tasks")}</span>
            <ArrowRight size={12} style={{ color: "var(--text-faint)" }} />
          </button>

          {/* Suggested next action */}
          {b.suggestions.length > 0 && (
            <>
              <SectionHead>{t("cal.next_action")}</SectionHead>
              <div className="flex flex-wrap gap-1.5 px-4 pb-1">{b.suggestions.map((s, i) => <span key={i} className="rounded-sm px-2 py-0.5 text-[11px]" style={{ background: "var(--surface-hover)", color: "var(--text-secondary)" }}>{s}</span>)}</div>
            </>
          )}
        </div>
      )}
    </>
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

/**
 * Today's Brief — an INTERACTIVE intelligence strip. Shows the deterministic counts (real, never
 * fabricated) plus a compact clickable row per meeting today (time / title / attendees / agenda / call
 * status). Clicking a row selects the meeting and opens the AI Meeting Brief. No meetings → a calm empty
 * state with real suggested actions. AI-prep status isn't persisted per meeting, so it's shown neutrally.
 */
function TodayStrip({ onOpen, selectedId, events, onCreate, onDraft, onFollowups }: {
  onOpen: (id: string) => void; selectedId: string | null; events: CalEvent[];
  onCreate: () => void; onDraft: () => void; onFollowups: () => void;
}) {
  const { t, lang } = useLanguage();
  const q = useQuery<TodayBrief>({ queryKey: ["calendar-brief-today"], queryFn: () => apiClient.get("/calendar/brief/today"), retry: false });
  const b = q.data;
  if (q.isLoading || !b) return <div className="h-[72px] animate-pulse rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }} />;
  const AMBER = "#a2854f", GREEN = "#5f8169";
  const todays = [...events].sort((a, b2) => new Date(a.start_at).getTime() - new Date(b2.start_at).getTime());

  const Stat = ({ icon, n, label, tone }: { icon: React.ReactNode; n: number; label: string; tone?: string }) => (
    <div className="flex items-center gap-1.5">
      <span style={{ color: tone ?? "var(--text-faint)" }}>{icon}</span>
      <span className="text-[13px] font-semibold tabular-nums" style={{ color: tone ?? "var(--text-primary)" }}>{n}</span>
      <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
  const Ic = ({ on, warn, children }: { on: boolean; warn?: boolean; children: React.ReactNode }) => (
    <span title="" style={{ color: on ? GREEN : warn ? AMBER : "var(--text-faint)", opacity: on || warn ? 0.9 : 0.5 }}>{children}</span>
  );

  return (
    <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      {/* Header: Meeting Agent brief + live counts */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}><CalendarClock size={12} style={{ color: "var(--text-faint)" }} /> {t("cal.brief_heading")}</span>
        <Stat icon={<CalendarDays size={14} />} n={b.count} label={t("cal.meetings_today")} />
        {b.conflicts.length > 0 && <Stat icon={<AlertTriangle size={14} />} n={b.conflicts.length} label={t("cal.overlaps")} tone={AMBER} />}
        {b.no_agenda.length > 0 && <Stat icon={<FileText size={14} />} n={b.no_agenda.length} label={t("cal.needs_agenda")} />}
        {b.calls_enabled && b.no_call_link.length > 0 && <Stat icon={<Link2 size={14} />} n={b.no_call_link.length} label={t("cal.needs_call")} />}
      </div>

      {/* Interactive meeting rows — click to open the AI Meeting Brief. */}
      {todays.length > 0 ? (
        <div className="border-t" style={{ borderColor: "var(--border-soft)" }}>
          {todays.map((e, i) => {
            const on = e.id === selectedId; const hasAgenda = !!(e.description ?? "").trim();
            return (
              <button key={e.id} onClick={() => onOpen(e.id)}
                className="flex w-full items-center gap-3 px-4 py-1.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
                style={{ ...(i > 0 ? { borderTop: "1px solid var(--border-soft)" } : {}), ...(on ? { background: "var(--surface-selected)" } : {}) }}>
                <span className="w-12 shrink-0 text-[11px] tabular-nums" style={{ color: "var(--text-secondary)" }}>{fmtTime(e.start_at, lang)}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{e.title}</span>
                <span className="flex shrink-0 items-center gap-2.5 text-[11px]" style={{ color: "var(--text-faint)" }}>
                  <span className="flex items-center gap-1"><Users size={11} /> {e.attendees.length + 1}</span>
                  <Ic on={hasAgenda} warn={!hasAgenda}><FileText size={12} /></Ic>
                  <Ic on={!!e.call_url}><Video size={12} /></Ic>
                  <Ic on={false}><Sparkles size={12} /></Ic>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2.5 text-[12px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>
          <span style={{ color: "var(--text-muted)" }}>{t("cal.all_clear")}</span>
          <button onClick={onCreate} className="font-medium transition-colors hover:text-[color:var(--text-primary)]" style={{ color: "var(--text-secondary)" }}>{t("cal.new_meeting")}</button>
          <span>·</span>
          <button onClick={onDraft} className="font-medium transition-colors hover:text-[color:var(--text-primary)]" style={{ color: "var(--text-secondary)" }}>{t("cal.draft_agenda")}</button>
          <span>·</span>
          <button onClick={onFollowups} className="font-medium transition-colors hover:text-[color:var(--text-primary)]" style={{ color: "var(--text-secondary)" }}>{t("cal.suggest_followups")}</button>
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
interface FollowTaskLite { id: string; title: string; due_date: string | null }
interface FollowUps { overdue: FollowTaskLite[]; due_today: FollowTaskLite[]; related: FollowTaskLite[]; suggested: { title: string; draft: boolean }; total_open: number }

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
  // An occurrence id is "master::YYYY-MM-DD" — that suffix tells us which single date to cancel.
  const occurrenceDate = id.includes("::") ? id.split("::")[1]! : null;
  const cancel = useMutation({ mutationFn: () => apiClient.delete(`/calendar/events/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["calendar-events"] }); onClose?.(); } });
  const cancelOccurrence = useMutation({ mutationFn: () => apiClient.delete(`/calendar/events/${id}?occurrence=${occurrenceDate}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["calendar-events"] }); onClose?.(); } });
  const addCall = useMutation({ mutationFn: () => apiClient.post(`/calendar/events/${id}/call-link`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar-event", id] }) });
  const respond = useMutation({ mutationFn: (response: Rsvp) => apiClient.post(`/calendar/events/${id}/respond`, { response }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["calendar-event", id] }); qc.invalidateQueries({ queryKey: ["calendar-events"] }); } });
  const prepare = useMutation<PrepResult>({ mutationFn: () => apiClient.post(`/calendar/events/${id}/prepare`, {}) });
  // Reuse the (cached) Today brief only to know if THIS meeting overlaps another — real data, no fabrication.
  const briefQ = useQuery<TodayBrief>({ queryKey: ["calendar-brief-today"], queryFn: () => apiClient.get("/calendar/brief/today"), staleTime: 30_000 });
  const conflict = !!briefQ.data?.conflicts?.some(c => c.a === id || c.b === id);
  // Real open tasks grouped for this meeting (overdue / due today / related) + a suggested draft.
  const followQ = useQuery<FollowUps>({ queryKey: ["calendar-followups", id], queryFn: () => apiClient.get(`/calendar/events/${id}/followups`), staleTime: 30_000 });
  // Add/edit agenda inline (organizer) → PATCH description. Create a real follow-up task → POST /tasks.
  const [editAgenda, setEditAgenda] = useState(false);
  const [agendaDraft, setAgendaDraft] = useState("");
  const saveAgenda = useMutation({ mutationFn: () => apiClient.patch(`/calendar/events/${id}`, { description: agendaDraft }), onSuccess: () => { setEditAgenda(false); qc.invalidateQueries({ queryKey: ["calendar-event", id] }); qc.invalidateQueries({ queryKey: ["calendar-events"] }); } });
  const createTask = useMutation({ mutationFn: (title: string) => apiClient.post("/tasks", { title }), onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar-followups", id] }) });
  const e = detail.data;
  const isOrganizer = e?.organizer.user_id === me.userId;
  const followTotal = followQ.data ? followQ.data.overdue.length + followQ.data.due_today.length + followQ.data.related.length : 0;

  return (
    <>
        {/* AI Meeting Brief header — clearly framed, with Meeting Agent attribution. */}
        <div className="border-b px-5 py-3.5" style={{ borderColor: "var(--border-soft)" }}>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}><Wand2 size={11} style={{ color: "var(--text-faint)" }} /> {t("cal.ai_meeting_brief")}</span>
            {onClose && <button onClick={onClose} className="btn-icon h-7 w-7"><X size={15} /></button>}
          </div>
          <span className="mt-1 block truncate text-[14.5px] font-semibold leading-snug" style={{ color: "var(--text-primary)" }}>{e?.title ?? "…"}</span>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>{t("cal.prepared_by")} {t("cal.meeting_agent")}</span>
        </div>
        {!e ? <div className="p-5"><Loader2 size={16} className="animate-spin" /></div> : (
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-[13px]">
            <div style={{ color: "var(--text-secondary)" }}>
              {(() => { try { return new Date(e.start_at).toLocaleString(lang, { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return e.start_at; } })()} – {fmtTime(e.end_at, lang)}
              {e.timezone && <span className="text-[11px]" style={{ color: "var(--text-faint)" }}> · {e.timezone}</span>}
            </div>
            {e.recurrence_summary && <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--text-muted)" }}><Repeat size={12} style={{ color: "var(--text-faint)" }} /> {e.recurrence_summary}</div>}
            {e.status === "cancelled" && <span className="inline-block rounded-sm px-2 py-0.5 text-[11px] font-medium" style={{ background: "rgba(168,106,114,0.14)", color: "#a86a72" }}>{t("cal.cancelled")}</span>}

            {/* RSVP — attendees respond; the organizer sees the tally. Only real responses shown. */}
            {e.status !== "cancelled" && (() => {
              const mine = (me.userId ? e.responses?.[me.userId] : null) ?? null;
              const RSVP: { key: Rsvp; label: string; on: string }[] = [
                { key: "accepted", label: t("cal.rsvp_yes"), on: "#5f8a6a" },
                { key: "tentative", label: t("cal.rsvp_maybe"), on: "#a2854f" },
                { key: "declined", label: t("cal.rsvp_no"), on: "#a86a72" },
              ];
              if (!isOrganizer) return (
                <div>
                  <p className="mb-1 text-[11px]" style={{ color: "var(--text-muted)" }}>{t("cal.your_response")}</p>
                  <div className="flex gap-1.5">
                    {RSVP.map(r => {
                      const active = mine === r.key;
                      return (
                        <button key={r.key} onClick={() => respond.mutate(r.key)} disabled={respond.isPending}
                          className="rounded-sm border px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-50"
                          style={active ? { borderColor: r.on, background: `${r.on}1f`, color: r.on } : { borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                          {r.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
              const c = e.response_counts ?? { accepted: 0, declined: 0, tentative: 0, no_response: 0 };
              return (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                  <span style={{ color: "#5f8a6a" }}>{c.accepted} {t("cal.rsvp_yes").toLowerCase()}</span>
                  <span style={{ color: "#a2854f" }}>{c.tentative} {t("cal.rsvp_maybe").toLowerCase()}</span>
                  <span style={{ color: "#a86a72" }}>{c.declined} {t("cal.rsvp_no").toLowerCase()}</span>
                  {c.no_response > 0 && <span style={{ color: "var(--text-faint)" }}>{c.no_response} {t("cal.rsvp_awaiting")}</span>}
                </div>
              );
            })()}
            {e.call_url && e.calls_enabled && <button onClick={() => navigate(`/calls/${e.id}`)} className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-[12px] font-semibold transition-colors" style={{ borderColor: "var(--border-strong)", background: "var(--surface-card-2)", color: "var(--text-primary)" }}><Video size={13} /> {t("cal.join_call")}</button>}
            {e.location && <div className="flex items-center gap-2" style={{ color: "var(--text-secondary)" }}><MapPin size={13} style={{ color: "var(--text-faint)" }} /> {e.location}</div>}

            {/* Co-pilot readiness — real signals derived from this meeting's own fields (never fabricated). */}
            {(() => {
              const hasAgenda = !!(e.description ?? "").trim();
              const S = (key: string, label: string, good: boolean, value: string, neutral = false) =>
                ({ key, label, value, dot: neutral ? "var(--text-faint)" : good ? "#5f8a6a" : "#a2854f", tone: neutral ? "var(--text-faint)" : good ? "var(--text-secondary)" : "#a2854f" });
              // Every readiness row is derived from REAL fields — agenda/call/prep/conflict/related/follow-ups.
              // When nothing is found we say so ("None found"), never fabricating content.
              const relN = prepare.data?.sources.length ?? 0;
              const signals = [
                S("agenda", t("cal.agenda"), hasAgenda, hasAgenda ? t("cal.st_set") : t("cal.st_missing")),
                e.call_url ? S("call", t("cal.sig_call"), true, t("cal.st_linked")) : S("call", t("cal.sig_call"), false, t("cal.st_none"), !e.calls_enabled),
                S("prep", t("cal.sig_prep"), !!prepare.data, prepare.data ? t("cal.st_ready") : t("cal.st_pending"), !prepare.data),
                S("conflict", t("cal.overlaps"), !conflict, conflict ? t("cal.st_overlap") : t("cal.st_clear")),
                S("related", t("cal.sig_related"), relN > 0, prepare.data ? (relN ? `${relN} ${t("cal.st_found")}` : t("cal.st_none_found")) : t("cal.st_pending"), relN === 0),
                S("followups", t("cal.followups"), followTotal > 0, followQ.data ? (followTotal ? `${followTotal} ${t("cal.st_found")}` : t("cal.st_none_found")) : "…", followTotal === 0),
              ];
              const action = e.status === "cancelled" ? null
                : (!e.call_url && e.calls_enabled && isOrganizer) ? { label: t("cal.add_call"), run: () => addCall.mutate() }
                : !prepare.data ? { label: t("cal.prepare"), run: () => prepare.mutate() }
                : e.call_url ? { label: t("cal.join_call"), run: () => navigate(`/calls/${e.id}`) }
                : null;
              return <CoPilot signals={signals} action={action} label={t("cal.agent_checks")} nextLabel={t("cal.next_action")} />;
            })()}

            {/* Agenda — read-only with an inline Add/edit action (organizer). */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{t("cal.agenda")}</span>
                {isOrganizer && e.status !== "cancelled" && !editAgenda && <button onClick={() => { setAgendaDraft(e.description ?? ""); setEditAgenda(true); }} className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>{t("cal.edit_agenda")}</button>}
              </div>
              {editAgenda ? (
                <div>
                  <textarea autoFocus value={agendaDraft} onChange={ev => setAgendaDraft(ev.target.value)} className="w-full rounded-sm border bg-transparent px-2 py-1.5 text-[12.5px] outline-none" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)", minHeight: 70 }} />
                  <div className="mt-1.5 flex gap-2">
                    <button onClick={() => saveAgenda.mutate()} disabled={saveAgenda.isPending} className="rounded-sm border px-2.5 py-1 text-[11px] font-semibold" style={{ borderColor: "var(--border-strong)", background: "var(--surface-card-2)", color: "var(--text-primary)" }}>{saveAgenda.isPending ? "…" : t("common.save")}</button>
                    <button onClick={() => setEditAgenda(false)} className="rounded-sm border px-2.5 py-1 text-[11px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>{t("common.cancel")}</button>
                  </div>
                </div>
              ) : e.description ? (
                <div className="whitespace-pre-wrap border-l-2 pl-3 text-[12.5px]" style={{ borderColor: meetingTone(e).edge, color: "var(--text-secondary)" }}>{e.description}</div>
              ) : (
                <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>{t("cal.st_missing")}</p>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{t("cal.attendees")}</p>
              <div className="space-y-1">
                <div style={{ color: "var(--text-primary)" }}>{e.organizer.name} <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>· organizer</span></div>
                {e.attendees.map(a => <div key={a.user_id} style={{ color: "var(--text-secondary)" }}>{a.name}</div>)}
              </div>
            </div>

            {/* AI Meeting Brief — source-backed, never fabricated. Flat section (thin divider, no card chrome). */}
            <div className="border-t pt-4" style={{ borderColor: "var(--border-soft)" }}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: "var(--text-primary)" }}><span className="flex h-4 w-4 items-center justify-center rounded-sm" style={{ background: "var(--surface-hover)" }}><Wand2 size={11} style={{ color: "var(--text-secondary)" }} /></span> {t("cal.ai_meeting_brief")}</span>
                {!prepare.data && <button onClick={() => prepare.mutate()} disabled={prepare.isPending} className="flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>{prepare.isPending ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} {t("cal.prepare")}</button>}
              </div>
              {prepare.data && <PrepView r={prepare.data} onOpenRecord={(oid, nid) => navigate(`/objects/${oid}/${nid}`)} />}
              {prepare.isError && <p className="mt-2 text-[11px]" style={{ color: "var(--text-faint)" }}>{t("cal.ai_unavailable")}</p>}
            </div>

            {/* Organized follow-ups — REAL open tasks, grouped; suggested is a clearly-marked draft. */}
            <div className="border-t pt-4" style={{ borderColor: "var(--border-soft)" }}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}><ListChecks size={13} style={{ color: "var(--text-muted)" }} /> {t("cal.followups")}</span>
                <button onClick={() => navigate("/tasks")} className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>{t("cal.all_tasks")}</button>
              </div>
              {!followQ.data ? <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>…</p> : (
                <FollowUpGroups f={followQ.data} onOpenTask={() => navigate("/tasks")}
                  onCreateSuggested={() => createTask.mutate(followQ.data!.suggested.title)} creating={createTask.isPending} />
              )}
            </div>

            {/* After-meeting — Create follow-up task is REAL; notes/recap are honestly "Coming soon". */}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{t("cal.after_meeting")}</p>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => createTask.mutate(`Follow up on ${e.title}`)} disabled={createTask.isPending} className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                  {createTask.isPending ? <Loader2 size={12} className="animate-spin" /> : <ListChecks size={12} />} {t("cal.create_task")}
                </button>
                {[{ i: <StickyNote size={12} />, l: t("cal.draft_notes") }, { i: <Send size={12} />, l: t("cal.send_recap") }].map((a, i) => (
                  <span key={i} title={t("cal.coming_soon")} className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px] opacity-60" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
                    {a.i} {a.l} <span className="ml-0.5 rounded-sm px-1.5 py-px text-[9px]" style={{ background: "var(--surface-hover)", color: "var(--text-faint)" }}>{t("cal.coming_soon")}</span>
                  </span>
                ))}
              </div>
            </div>

            {isOrganizer && e.status !== "cancelled" && (
              <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: "var(--border-soft)" }}>
                {!e.call_url && e.calls_enabled && <button onClick={() => addCall.mutate()} disabled={addCall.isPending} className="rounded-sm border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}><Video size={12} className="mr-1 inline" /> {t("cal.add_call")}</button>}
                {!e.calls_enabled && !e.call_url && <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{t("cal.calls_off")}</span>}
                {/* Recurring series: cancel just this date, or the whole series. Non-recurring: one cancel. */}
                {occurrenceDate && e.recurrence
                  ? <>
                      <button onClick={() => cancelOccurrence.mutate()} disabled={cancelOccurrence.isPending} className="rounded-sm border px-3 py-1.5 text-[12px] font-medium transition-colors" style={{ borderColor: "rgba(168,106,114,0.4)", color: "#a86a72" }}>{t("cal.cancel_occurrence")}</button>
                      <button onClick={() => cancel.mutate()} disabled={cancel.isPending} className="rounded-sm border px-3 py-1.5 text-[12px] font-medium transition-colors" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>{t("cal.cancel_series")}</button>
                    </>
                  : <button onClick={() => cancel.mutate()} disabled={cancel.isPending} className="rounded-sm border px-3 py-1.5 text-[12px] font-medium transition-colors" style={{ borderColor: "rgba(168,106,114,0.4)", color: "#a86a72" }}>{t("cal.cancel_meeting")}</button>}
              </div>
            )}
          </div>
        )}
    </>
  );
}

interface Signal { key: string; label: string; value: string; dot: string; tone: string }
/**
 * The Meeting Agent co-pilot panel — a compact ledger of a meeting's readiness (agenda / call link /
 * prep / conflicts) plus one suggested next action. Flat rows, hairline dividers, small muted status
 * dots — no terminal styling, no neon, no fabricated signals.
 */
function CoPilot({ signals, action, label, nextLabel }: { signals: Signal[]; action: { label: string; run: () => void } | null; label: string; nextLabel: string }) {
  return (
    <div className="rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
      <div className="border-b px-3 py-1.5" style={{ borderColor: "var(--border-soft)" }}>
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>{label}</span>
      </div>
      {signals.map((s, i) => (
        <div key={s.key} className="flex items-center justify-between px-3 py-1.5" style={i > 0 ? { borderTop: "1px solid var(--border-soft)" } : undefined}>
          <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{s.label}</span>
          <span className="flex items-center gap-1.5 text-[11.5px] font-medium" style={{ color: s.tone }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />{s.value}
          </span>
        </div>
      ))}
      {action && (
        <button onClick={action.run} className="flex w-full items-center justify-between border-t px-3 py-2 text-left transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)" }}>
          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>{nextLabel}</span>
          <span className="flex items-center gap-1 text-[11.5px] font-medium" style={{ color: "var(--text-secondary)" }}>{action.label} <ArrowRight size={12} style={{ color: "var(--text-faint)" }} /></span>
        </button>
      )}
    </div>
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
                <button key={s.node_id} onClick={() => onOpenRecord(s.object_type, s.node_id)} className="flex w-full items-center gap-2 rounded-sm border px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)" }}>
                  <Circle size={7} className="shrink-0" style={{ color: "var(--text-faint)" }} />
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

/** Organized follow-ups — real open tasks grouped (overdue / due today / related), plus a clearly
 *  labelled suggested DRAFT the user can create. Only real tasks are shown; nothing is fabricated. */
function FollowUpGroups({ f, onOpenTask, onCreateSuggested, creating }: { f: FollowUps; onOpenTask: () => void; onCreateSuggested: () => void; creating: boolean }) {
  const { t } = useLanguage();
  const ROSE = "#a86a72", AMBER = "#a2854f";
  const Group = ({ label, tasks, dot }: { label: string; tasks: FollowTaskLite[]; dot?: string }) => tasks.length === 0 ? null : (
    <div className="mb-2 last:mb-0">
      <p className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>{dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />}{label} · {tasks.length}</p>
      <div className="space-y-0.5">
        {tasks.slice(0, 4).map(tk => (
          <button key={tk.id} onClick={onOpenTask} className="block w-full truncate rounded-sm px-2 py-1 text-left text-[12px] transition-colors hover:bg-[var(--surface-hover)]" style={{ color: "var(--text-secondary)" }}>{tk.title}</button>
        ))}
      </div>
    </div>
  );
  const empty = f.overdue.length + f.due_today.length + f.related.length === 0;
  return (
    <div>
      {empty && <p className="mb-2 text-[11px]" style={{ color: "var(--text-faint)" }}>{t("cal.st_none_found")}</p>}
      <Group label={t("cal.overdue")} tasks={f.overdue} dot={ROSE} />
      <Group label={t("cal.due_today")} tasks={f.due_today} dot={AMBER} />
      <Group label={t("cal.related_meeting")} tasks={f.related} />
      {/* Suggested next follow-up — a DRAFT template, clearly tagged; created only on click. */}
      <div className="mt-1 flex items-center justify-between rounded-sm border px-2 py-1.5" style={{ borderColor: "var(--border-soft)", borderStyle: "dashed" }}>
        <span className="min-w-0 flex-1">
          <span className="mr-1.5 rounded-sm px-1 py-px text-[9px] font-medium uppercase" style={{ background: "var(--surface-hover)", color: "var(--text-faint)" }}>{t("cal.draft_tag")}</span>
          <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>{f.suggested.title}</span>
        </span>
        <button onClick={onCreateSuggested} disabled={creating} className="ml-2 shrink-0 rounded-sm border px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>{creating ? "…" : t("cal.create_task")}</button>
      </div>
    </div>
  );
}

function CreateModal({ callsEnabled, initialStart, initialEnd, onClose, onCreated }: { callsEnabled: boolean; initialStart?: string; initialEnd?: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useLanguage();
  const me = useCurrentUser();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [start, setStart] = useState(initialStart ?? "");   // prefilled when opened from a grid slot
  const [end, setEnd] = useState(initialEnd ?? "");
  const [location, setLocation] = useState("");
  const [attendees, setAttendees] = useState<string[]>([]);
  const [withCall, setWithCall] = useState(false);
  const [repeat, setRepeat] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [repeatUntil, setRepeatUntil] = useState("");   // optional YYYY-MM-DD end date
  const [aiBusy, setAiBusy] = useState(false);

  const membersQ = useQuery<{ members: MemberRow[] }>({ queryKey: ["workspace-members-full"], queryFn: () => apiClient.get("/workspace/members-full"), staleTime: 60_000 });
  const others = (membersQ.data?.members ?? []).filter(m => m.id !== me.userId);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const create = useMutation({
    mutationFn: () => apiClient.post<{ id: string }>("/calendar/events", {
      title, description: desc || undefined, start_at: new Date(start).toISOString(), end_at: new Date(end || start).toISOString(),
      timezone: tz, attendee_ids: attendees, location: location || undefined, generate_call_link: withCall && callsEnabled,
      recurrence: repeat === "none" ? undefined : { freq: repeat, interval: 1, ...(repeatUntil ? { until: repeatUntil } : {}) },
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
  const field = "w-full rounded-sm border bg-transparent px-3 py-2 text-[13px] outline-none";
  const style = { borderColor: "var(--border-soft)", color: "var(--text-primary)" } as const;

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/40" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[201] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-sm border shadow-lg" style={{ background: "var(--surface-modal)", borderColor: "var(--border-strong)" }}>
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{t("cal.new_meeting")}</span>
          <button onClick={onClose} className="btn-icon h-7 w-7"><X size={15} /></button>
        </div>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto p-5">
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
            <div className="flex max-h-32 flex-col gap-0.5 overflow-y-auto rounded-sm border p-1" style={{ borderColor: "var(--border-soft)" }}>
              {others.map(m => {
                const on = attendees.includes(m.id);
                return (
                  <button key={m.id} onClick={() => setAttendees(a => on ? a.filter(x => x !== m.id) : [...a, m.id])}
                    className="flex items-center justify-between rounded-sm px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[var(--surface-hover)]" style={{ color: "var(--text-primary)" }}>
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

          {/* Recurrence — optional. Repeats from the start time; an end date is optional (open-ended otherwise). */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--text-primary)" }}><Repeat size={13} /> {t("cal.repeat")}</span>
            <FieldSelect
              value={repeat}
              onChange={v => setRepeat(v as typeof repeat)}
              ariaLabel={t("cal.repeat")}
              options={[
                { value: "none", label: t("cal.repeat_none") },
                { value: "daily", label: t("cal.repeat_daily") },
                { value: "weekly", label: t("cal.repeat_weekly") },
                { value: "monthly", label: t("cal.repeat_monthly") },
              ]}
            />
            {repeat !== "none" && (
              <label className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                {t("cal.repeat_until")}
                <input type="date" value={repeatUntil} onChange={e => setRepeatUntil(e.target.value)}
                  className="rounded-sm border bg-transparent px-2 py-1 text-[12px] outline-none dark:[color-scheme:dark]" style={style} />
              </label>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <button onClick={onClose} className="rounded-sm border px-3 py-1.5 text-[12px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>{t("common.cancel")}</button>
          <button onClick={() => valid && create.mutate()} disabled={!valid || create.isPending} className="rounded-sm border px-4 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ borderColor: "var(--border-strong)", background: "var(--surface-card-2)", color: "var(--text-primary)" }}>
            {create.isPending ? <Loader2 size={13} className="animate-spin" /> : t("common.save")}
          </button>
        </div>
      </div>
    </>
  );
}
