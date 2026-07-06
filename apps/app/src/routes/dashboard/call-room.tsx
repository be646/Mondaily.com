import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Room } from "livekit-client";
import { Loader2, Mic, MicOff, Video, VideoOff, PhoneOff, Users, CalendarDays, ArrowLeft, ShieldAlert, VideoOff as NoCall } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useLanguage } from "../../hooks/useLanguage";
import { CallDetailPage } from "./call-detail";

/**
 * Mondaily call room at /calls/:eventId — the native meeting experience. Loads the calendar event,
 * shows a premium pre-join lobby (title/time/attendees/agenda), and — when the real-time engine is
 * configured — lets participants join with camera/mic. No engine branding is shown; the public URL is
 * /calls/:eventId while the room uses the internal call_room_id (minted server-side). Access is
 * organizer/attendee/admin (enforced by the backend); non-participants get a clear not-allowed state.
 *
 * `/calls/:id` is shared with the older call-RECORD detail page — this dispatcher renders the meeting
 * room when the id is a calendar event, otherwise falls back to the record detail (non-breaking).
 */
interface Person { user_id: string; name: string; email: string | null }
interface CalEvent {
  id: string; title: string; description: string; start_at: string; end_at: string; timezone: string;
  location: string; status: string; call_url: string | null; organizer: Person; attendees: Person[]; calls_enabled: boolean;
}

export function CallRoomDispatch() {
  const { id } = useParams();
  const q = useQuery<CalEvent>({ queryKey: ["calendar-event", id], queryFn: () => apiClient.get(`/calendar/events/${id}`), retry: false });

  if (q.isLoading) return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin" style={{ color: "var(--text-muted)" }} /></div>;
  if (q.data) return <CallRoom event={q.data} />;
  const msg = (q.error as Error)?.message ?? "";
  if (/not allowed/i.test(msg)) return <NotAllowed />;
  // Not a calendar event (or genuinely not found) → the id is a call record; show its detail page.
  return <CallDetailPage />;
}

function NotAllowed() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
      <ShieldAlert size={24} style={{ color: "var(--text-faint)" }} />
      <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>You're not on this meeting</p>
      <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>Only the organizer, invited attendees, or a workspace admin can open this call room.</p>
      <Link to="/calendar" className="mt-1 text-[13px] font-medium" style={{ color: "var(--section-accent)" }}>Back to calendar</Link>
    </div>
  );
}

function CallRoom({ event }: { event: CalEvent }) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"lobby" | "connecting" | "live" | "ended" | "error">("lobby");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLDivElement>(null);

  const when = (() => { try { return new Date(event.start_at).toLocaleString(lang, { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return event.start_at; } })();

  async function join() {
    setPhase("connecting");
    try {
      const { token, url } = await apiClient.post<{ token?: string; url?: string; error?: string }>(`/calendar/events/${event.id}/call-token`, {});
      if (!token || !url) { setPhase("error"); return; }
      const { Room, RoomEvent, Track } = await import("livekit-client");
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      // Attach each subscribed remote track (video → a tile, audio → hidden element).
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Video && remoteRef.current) {
          const el = track.attach(); el.className = "h-full w-full rounded-lg object-cover"; el.dataset.sid = track.sid;
          const tile = document.createElement("div"); tile.className = "aspect-video overflow-hidden rounded-lg bg-black"; tile.dataset.sid = track.sid;
          tile.appendChild(el); remoteRef.current.appendChild(tile);
        } else if (track.kind === Track.Kind.Audio) { track.attach(); }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => { remoteRef.current?.querySelector(`[data-sid="${track.sid}"]`)?.remove(); });
      room.on(RoomEvent.Disconnected, () => setPhase("ended"));
      await room.connect(url, token);
      await room.localParticipant.enableCameraAndMicrophone();
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (pub?.track && localVideoRef.current) pub.track.attach(localVideoRef.current);
      setPhase("live");
    } catch { setPhase("error"); }
  }

  async function leave() { try { await roomRef.current?.disconnect(); } catch { /* ignore */ } setPhase("ended"); }

  async function toggleMic() { const r = roomRef.current; if (!r) return; const next = !micOn; setMicOn(next); await r.localParticipant.setMicrophoneEnabled(next); }
  async function toggleCam() {
    const r = roomRef.current; if (!r) return; const next = !camOn; setCamOn(next);
    await r.localParticipant.setCameraEnabled(next);
    if (next) { const { Track } = await import("livekit-client"); const pub = r.localParticipant.getTrackPublication(Track.Source.Camera); if (pub?.track && localVideoRef.current) pub.track.attach(localVideoRef.current); }
  }

  useEffect(() => () => { roomRef.current?.disconnect().catch(() => {}); }, []);

  // ── Live (in-call) ──
  if (phase === "live" || phase === "connecting") {
    return (
      <div className="flex h-full flex-col bg-black">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="truncate text-[14px] font-semibold text-white">{event.title}</span>
          {phase === "connecting" && <span className="flex items-center gap-2 text-[12px] text-white/70"><Loader2 size={13} className="animate-spin" /> Connecting…</span>}
        </div>
        <div className="relative flex-1 overflow-hidden px-4">
          <div ref={remoteRef} className="grid h-full grid-cols-1 content-start gap-2 sm:grid-cols-2" />
          <video ref={localVideoRef} autoPlay muted playsInline className="absolute bottom-3 right-6 h-28 w-40 rounded-lg border border-white/15 object-cover shadow-lg" />
        </div>
        <div className="flex items-center justify-center gap-3 py-4">
          <button onClick={toggleMic} className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: micOn ? "rgba(255,255,255,0.12)" : "#ef4444" }}>{micOn ? <Mic size={18} className="text-white" /> : <MicOff size={18} className="text-white" />}</button>
          <button onClick={toggleCam} className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: camOn ? "rgba(255,255,255,0.12)" : "#ef4444" }}>{camOn ? <Video size={18} className="text-white" /> : <VideoOff size={18} className="text-white" />}</button>
          <button onClick={leave} className="flex h-11 w-11 items-center justify-center rounded-full bg-[#ef4444]"><PhoneOff size={18} className="text-white" /></button>
        </div>
      </div>
    );
  }

  // ── Ended / left ──
  if (phase === "ended") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
        <PhoneOff size={22} style={{ color: "var(--text-faint)" }} />
        <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>You left the call</p>
        <div className="flex gap-2">
          <button onClick={() => setPhase("lobby")} className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-white" style={{ background: "var(--section-accent)" }}>{t("cal.join_call")}</button>
          <button onClick={() => navigate("/calendar")} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>Back to calendar</button>
        </div>
      </div>
    );
  }

  // ── Pre-join lobby ──
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <button onClick={() => navigate("/calendar")} className="mb-4 flex items-center gap-1.5 text-[12px]" style={{ color: "var(--text-muted)" }}><ArrowLeft size={13} /> {t("cal.title")}</button>
      <div className="rounded-2xl border p-6" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
        <h1 className="text-[20px] font-semibold" style={{ color: "var(--text-primary)" }}>{event.title}</h1>
        <p className="mt-1 flex items-center gap-1.5 text-[13px]" style={{ color: "var(--text-muted)" }}><CalendarDays size={13} /> {when}{event.timezone ? ` · ${event.timezone}` : ""}</p>

        {event.description && <div className="mt-4 whitespace-pre-wrap rounded-lg border p-3 text-[13px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>{event.description}</div>}

        <div className="mt-4">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}><Users size={12} /> {t("cal.attendees")} · {event.attendees.length + 1}</p>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full px-2.5 py-1 text-[12px]" style={{ background: "var(--surface-selected)", color: "var(--text-primary)" }}>{event.organizer.name} · organizer</span>
            {event.attendees.map(a => <span key={a.user_id} className="rounded-full px-2.5 py-1 text-[12px]" style={{ background: "var(--surface-hover)", color: "var(--text-secondary)" }}>{a.name}</span>)}
          </div>
        </div>

        <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--border-soft)" }}>
          {!event.calls_enabled ? (
            <div className="flex items-center gap-2.5 rounded-lg border p-3 text-[13px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
              <NoCall size={16} style={{ color: "var(--text-faint)" }} /> {t("cal.calls_off")}
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
                <button onClick={() => setMicOn(m => !m)} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5" style={{ borderColor: "var(--border-soft)" }}>{micOn ? <Mic size={13} /> : <MicOff size={13} />} Mic {micOn ? "on" : "off"}</button>
                <button onClick={() => setCamOn(c => !c)} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5" style={{ borderColor: "var(--border-soft)" }}>{camOn ? <Video size={13} /> : <VideoOff size={13} />} Camera {camOn ? "on" : "off"}</button>
              </div>
              <button onClick={join} disabled={event.status === "cancelled"}
                className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-[14px] font-semibold text-white disabled:opacity-50" style={{ background: "var(--section-accent)" }}>
                <Video size={15} /> {t("cal.join_call")}
              </button>
              {phase === "error" && <p className="mt-2 text-center text-[12px]" style={{ color: "#ef4444" }}>Couldn't connect. Please try again.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
