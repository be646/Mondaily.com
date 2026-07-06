import { useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Plus, X, Loader2, Video, MapPin, Users, Sparkles, Check } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useLanguage } from "../../hooks/useLanguage";
import { useCurrentUser } from "../../hooks/useCurrentUser";

/**
 * Mondaily Calendar — native, workspace-scoped meetings. Upcoming-agenda foundation (grouped by day)
 * + create modal (attendee picker, Mondaily call-link toggle, AI agenda draft) + detail panel. Real
 * data from /calendar/events; participant-scoped by the backend. Titles/descriptions are never
 * translated. Full week/month grid is a follow-up.
 */
interface Person { user_id: string; name: string; email: string | null }
interface CalEvent {
  id: string; title: string; description: string; start_at: string; end_at: string; timezone: string;
  location: string; status: "scheduled" | "cancelled" | "completed"; call_url: string | null;
  organizer: Person; attendees: Person[];
}
interface MemberRow { id: string; name?: string; email: string }

const fmtTime = (iso: string, loc: string) => { try { return new Date(iso).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const dayKey = (iso: string) => new Date(iso).toDateString();

export function CalendarPage() {
  const { t, lang } = useLanguage();
  const [params, setParams] = useSearchParams();
  const openId = params.get("event");
  const [createOpen, setCreateOpen] = useState(false);

  const eventsQ = useQuery<{ events: CalEvent[]; calls_enabled: boolean }>({
    queryKey: ["calendar-events"],
    queryFn: () => apiClient.get(`/calendar/events?from=${new Date(Date.now() - 3600_000).toISOString()}`),
    retry: false,
  });
  const events = (eventsQ.data?.events ?? []).filter(e => e.status !== "cancelled");

  // Group upcoming events by day for the agenda list.
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

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold" style={{ color: "var(--text-primary)" }}>{t("cal.title")}</h1>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--text-muted)" }}>{t("cal.subtitle")}</p>
        </div>
        <button onClick={() => setCreateOpen(true)} className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: "var(--section-accent)" }}>
          <Plus size={13} /> {t("cal.new_meeting")}
        </button>
      </div>

      {eventsQ.isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border py-12 px-4 text-[13px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}><Loader2 size={14} className="animate-spin" /> {t("state.loading")}</div>
      ) : eventsQ.isError ? (
        <div className="rounded-xl border py-12 text-center text-[13px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>Couldn't load your calendar. <button onClick={() => eventsQ.refetch()} className="underline">Retry</button></div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border py-16 text-center" style={{ borderColor: "var(--border-soft)" }}>
          <CalendarDays size={22} style={{ color: "var(--text-faint)" }} />
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>{t("cal.empty")}</p>
          <button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--section-accent)" }}>
            <Plus size={13} /> {t("cal.new_meeting")}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(([key, evs]) => (
            <div key={key}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{dayLabel(key)}</p>
              <div className="space-y-2">
                {evs.map(e => (
                  <button key={e.id} onClick={() => setParams({ event: e.id }, { replace: true })}
                    className="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
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
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {openId && <EventPanel id={openId} onClose={() => setParams({}, { replace: true })} />}
      {createOpen && <CreateModal callsEnabled={eventsQ.data?.calls_enabled ?? false} onClose={() => setCreateOpen(false)} onCreated={(id) => { setCreateOpen(false); setParams({ event: id }, { replace: true }); }} />}
    </div>
  );
}

function EventPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const me = useCurrentUser();
  const qc = useQueryClient();
  const detail = useQuery<CalEvent & { calls_enabled: boolean }>({ queryKey: ["calendar-event", id], queryFn: () => apiClient.get(`/calendar/events/${id}`) });
  const cancel = useMutation({ mutationFn: () => apiClient.delete(`/calendar/events/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["calendar-events"] }); onClose(); } });
  const addCall = useMutation({ mutationFn: () => apiClient.post(`/calendar/events/${id}/call-link`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar-event", id] }) });
  const e = detail.data;
  const isOrganizer = e?.organizer.user_id === me.userId;

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-[201] flex h-full w-full max-w-md flex-col border-l shadow-2xl" style={{ background: "var(--surface-page)", borderColor: "var(--border-soft)" }} dir="auto">
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <span className="truncate text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>{e?.title ?? "…"}</span>
          <button onClick={onClose} className="btn-icon h-7 w-7"><X size={15} /></button>
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
            {isOrganizer && e.status !== "cancelled" && (
              <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: "var(--border-soft)" }}>
                {!e.call_url && e.calls_enabled && <button onClick={() => addCall.mutate()} disabled={addCall.isPending} className="rounded-lg border px-3 py-1.5 text-[12px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--section-accent)" }}><Video size={12} className="mr-1 inline" /> {t("cal.add_call")}</button>}
                {!e.calls_enabled && !e.call_url && <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{t("cal.calls_off")}</span>}
                <button onClick={() => cancel.mutate()} disabled={cancel.isPending} className="rounded-lg border px-3 py-1.5 text-[12px] font-medium" style={{ borderColor: "#ef444455", color: "#ef4444" }}>{t("cal.cancel_meeting")}</button>
              </div>
            )}
          </div>
        )}
      </aside>
    </>
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
