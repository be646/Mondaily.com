import { useEffect, useReducer, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Room, Participant, Track as TrackNS } from "livekit-client";
import { Loader2, Mic, MicOff, Video, VideoOff, PhoneOff, Users, CalendarDays, ArrowLeft, ShieldAlert, VideoOff as NoCall, MonitorUp, Settings2, Wifi } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useLanguage } from "../../hooks/useLanguage";
import { CallDetailPage } from "./call-detail";

/**
 * Mondaily call room at /calls/:eventId — the native meeting experience. Loads the calendar event,
 * shows a premium pre-join lobby (title/time/agenda/attendees + status + mic/camera), and — when the
 * real-time engine is configured — a full in-call view: named participant tiles with initials
 * placeholders, a clearly-marked local tile, active-speaker highlight, screen share, device pickers,
 * and a clean toolbar. No engine branding is ever shown; the public URL is /calls/:eventId while the
 * room uses the internal call_room_id (minted server-side). Access is organizer/attendee/admin
 * (enforced by the backend); non-participants get a clear not-allowed state.
 *
 * `/calls/:id` is shared with the older call-RECORD detail page — this dispatcher renders the meeting
 * room when the id is a calendar event, otherwise falls back to the record detail (non-breaking).
 */
interface Person { user_id: string; name: string; email: string | null }
interface CalEvent {
  id: string; title: string; description: string; start_at: string; end_at: string; timezone: string;
  location: string; status: string; call_url: string | null; organizer: Person; attendees: Person[]; calls_enabled: boolean;
}
type LKModule = typeof import("livekit-client");

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
  const { t } = useLanguage();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
      <ShieldAlert size={24} style={{ color: "var(--text-faint)" }} />
      <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>You're not on this meeting</p>
      <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>Only the organizer, invited attendees, or a workspace admin can open this call room.</p>
      <Link to="/calendar" className="mt-1 text-[13px] font-medium" style={{ color: "var(--section-accent)" }}>{t("cal.back_to_calendar")}</Link>
    </div>
  );
}

/** First-letters of a name → up to two initials for the no-video placeholder. */
function initialsOf(name: string): string {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function CallRoom({ event }: { event: CalEvent }) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"lobby" | "connecting" | "live" | "ended" | "error">("lobby");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [devices, setDevices] = useState<{ audio: MediaDeviceInfo[]; video: MediaDeviceInfo[] }>({ audio: [], video: [] });
  const [, bump] = useReducer((x: number) => x + 1, 0);   // re-render on room/participant events

  const roomRef = useRef<Room | null>(null);
  const lkRef = useRef<LKModule | null>(null);

  const when = (() => { try { return new Date(event.start_at).toLocaleString(lang, { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return event.start_at; } })();

  async function refreshDevices() {
    try {
      const list = await navigator.mediaDevices?.enumerateDevices?.();
      if (!list) return;
      setDevices({ audio: list.filter(d => d.kind === "audioinput"), video: list.filter(d => d.kind === "videoinput") });
    } catch { /* ignore — device list is a nicety, never blocks the call */ }
  }

  async function join() {
    setPhase("connecting");
    try {
      const { token, url } = await apiClient.post<{ token?: string; url?: string; error?: string }>(`/calendar/events/${event.id}/call-token`, {});
      if (!token || !url) { setPhase("error"); return; }
      const lk = await import("livekit-client");
      lkRef.current = lk;
      const { Room, RoomEvent } = lk;
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      // React-managed: every track/participant/speaker change just re-renders from the live room state.
      room
        .on(RoomEvent.ParticipantConnected, bump)
        .on(RoomEvent.ParticipantDisconnected, bump)
        .on(RoomEvent.TrackSubscribed, bump)
        .on(RoomEvent.TrackUnsubscribed, bump)
        .on(RoomEvent.TrackMuted, bump)
        .on(RoomEvent.TrackUnmuted, bump)
        .on(RoomEvent.LocalTrackPublished, bump)
        .on(RoomEvent.LocalTrackUnpublished, bump)
        .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => setSpeaking(new Set(speakers.map(s => s.identity))))
        .on(RoomEvent.Reconnecting, () => setReconnecting(true))
        .on(RoomEvent.Reconnected, () => setReconnecting(false))
        .on(RoomEvent.Disconnected, () => setPhase("ended"));
      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(micOn);
      await room.localParticipant.setCameraEnabled(camOn);
      setPhase("live");
      refreshDevices();
    } catch { setPhase("error"); }
  }

  async function leave() { try { await roomRef.current?.disconnect(); } catch { /* ignore */ } setPhase("ended"); }

  async function toggleMic() { const r = roomRef.current; if (!r) return; const next = !micOn; setMicOn(next); await r.localParticipant.setMicrophoneEnabled(next); bump(); }
  async function toggleCam() { const r = roomRef.current; if (!r) return; const next = !camOn; setCamOn(next); await r.localParticipant.setCameraEnabled(next); bump(); }
  async function toggleShare() {
    const r = roomRef.current; if (!r) return;
    try { const next = !sharing; await r.localParticipant.setScreenShareEnabled(next); setSharing(next); bump(); }
    catch { /* user cancelled the picker — no-op */ }
  }
  async function switchDevice(kind: "audioinput" | "videoinput", deviceId: string) {
    try { await roomRef.current?.switchActiveDevice(kind, deviceId); } catch { /* ignore */ }
  }

  useEffect(() => () => { roomRef.current?.disconnect().catch(() => {}); }, []);

  // ── Live (in-call) ──
  if (phase === "live" || phase === "connecting") {
    const room = roomRef.current;
    const lk = lkRef.current;
    const local = room?.localParticipant;
    const remotes = room ? [...room.remoteParticipants.values()] : [];
    const everyone: { p: Participant; isLocal: boolean }[] = local ? [{ p: local, isLocal: true }, ...remotes.map(p => ({ p, isLocal: false }))] : [];
    // A prominent screen-share stage if anyone is sharing.
    const screenSharer = lk ? everyone.find(({ p }) => !!p.getTrackPublication(lk.Track.Source.ScreenShare)?.track) : undefined;

    return (
      <div className="flex h-full flex-col" style={{ background: "#0b0b0d" }}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <span className="block truncate text-[14px] font-semibold text-white">{event.title}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-white/50"><Users size={11} /> {everyone.length}</span>
          </div>
          {(phase === "connecting" || reconnecting) && <span className="flex items-center gap-2 text-[12px] text-white/70"><Loader2 size={13} className="animate-spin" /> {reconnecting ? t("cal.reconnecting") : t("cal.connecting")}</span>}
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-2">
          {lk && screenSharer && <ScreenTile p={screenSharer.p} source={lk.Track.Source.ScreenShare} />}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {lk && everyone.map(({ p, isLocal }) => (
              <ParticipantTile key={p.sid || p.identity} p={p} source={lk.Track.Source.Camera}
                isLocal={isLocal} speaking={speaking.has(p.identity)} youLabel={t("cal.you")}
                muted={isLocal ? !micOn : !!p.getTrackPublication(lk.Track.Source.Microphone)?.isMuted} />
            ))}
          </div>
        </div>

        {/* Device pickers (optional, safe) */}
        {showDevices && (
          <div className="mx-auto mb-1 flex w-full max-w-md flex-col gap-2 px-4">
            {(["audio", "video"] as const).map(kind => {
              const list = kind === "audio" ? devices.audio : devices.video;
              return (
                <label key={kind} className="flex items-center gap-2 text-[11px] text-white/60">
                  <span className="w-20 shrink-0">{kind === "audio" ? t("cal.microphone") : t("cal.camera")}</span>
                  <select onChange={e => switchDevice(kind === "audio" ? "audioinput" : "videoinput", e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-white/80">
                    {list.length === 0 && <option>—</option>}
                    {list.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `${kind} device`}</option>)}
                  </select>
                </label>
              );
            })}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center justify-center gap-3 py-4">
          <ToolBtn on={micOn} onClick={toggleMic} label={t("cal.microphone")} onIcon={<Mic size={18} className="text-white" />} offIcon={<MicOff size={18} className="text-white" />} />
          <ToolBtn on={camOn} onClick={toggleCam} label={t("cal.camera")} onIcon={<Video size={18} className="text-white" />} offIcon={<VideoOff size={18} className="text-white" />} />
          <ToolBtn on={!sharing} neutral onClick={toggleShare} label={sharing ? t("cal.stop_share") : t("cal.share_screen")} onIcon={<MonitorUp size={18} className={sharing ? "text-[color:var(--section-accent)]" : "text-white"} />} offIcon={<MonitorUp size={18} className="text-white" />} />
          <ToolBtn on={!showDevices} neutral onClick={() => { setShowDevices(s => !s); refreshDevices(); }} label={t("cal.devices")} onIcon={<Settings2 size={18} className="text-white" />} offIcon={<Settings2 size={18} className="text-white" />} />
          <button onClick={leave} aria-label={t("cal.leave")} title={t("cal.leave")} className="flex h-11 items-center gap-2 rounded-full bg-[#ef4444] px-5"><PhoneOff size={18} className="text-white" /><span className="text-[13px] font-medium text-white">{t("cal.leave")}</span></button>
        </div>
      </div>
    );
  }

  // ── Ended / left ──
  if (phase === "ended") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
        <PhoneOff size={22} style={{ color: "var(--text-faint)" }} />
        <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>{t("cal.left_call")}</p>
        <div className="flex gap-2">
          <button onClick={() => { setReconnecting(false); setPhase("lobby"); }} className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-white" style={{ background: "var(--section-accent)" }}>{t("cal.join_call")}</button>
          <button onClick={() => navigate("/calendar")} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>{t("cal.back_to_calendar")}</button>
        </div>
      </div>
    );
  }

  // ── Pre-join lobby ──
  const cancelled = event.status === "cancelled";
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <button onClick={() => navigate("/calendar")} className="mb-4 flex items-center gap-1.5 text-[12px]" style={{ color: "var(--text-muted)" }}><ArrowLeft size={13} /> {t("cal.title")}</button>
      <div className="rounded-2xl border p-6" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold" style={{ color: "var(--text-primary)" }}>{event.title}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-[13px]" style={{ color: "var(--text-muted)" }}><CalendarDays size={13} /> {when}{event.timezone ? ` · ${event.timezone}` : ""}</p>
          </div>
          {/* Clear call status pill */}
          <StatusPill cancelled={cancelled} enabled={event.calls_enabled} readyLabel={t("cal.call_ready")} offLabel={t("cal.calls_off")} cancelledLabel={t("cal.cancelled")} />
        </div>

        {event.description && <div className="mt-4 whitespace-pre-wrap rounded-lg border p-3 text-[13px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>{event.description}</div>}

        <div className="mt-4">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}><Users size={12} /> {t("cal.attendees")} · {event.attendees.length + 1}</p>
          <div className="flex flex-wrap gap-1.5">
            <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]" style={{ background: "var(--surface-selected)", color: "var(--text-primary)" }}><Avatar name={event.organizer.name} size={16} /> {event.organizer.name} · organizer</span>
            {event.attendees.map(a => <span key={a.user_id} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]" style={{ background: "var(--surface-hover)", color: "var(--text-secondary)" }}><Avatar name={a.name} size={16} /> {a.name}</span>)}
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
                <button onClick={() => setMicOn(m => !m)} aria-label={t("cal.microphone")} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5" style={{ borderColor: "var(--border-soft)" }}>{micOn ? <Mic size={13} /> : <MicOff size={13} />} {t("cal.microphone")}</button>
                <button onClick={() => setCamOn(c => !c)} aria-label={t("cal.camera")} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5" style={{ borderColor: "var(--border-soft)" }}>{camOn ? <Video size={13} /> : <VideoOff size={13} />} {t("cal.camera")}</button>
              </div>
              <button onClick={join} disabled={cancelled}
                className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-[14px] font-semibold text-white disabled:opacity-50" style={{ background: "var(--section-accent)" }}>
                <Video size={15} /> {t("cal.join_call")}
              </button>
              {phase === "error" && <p className="mt-2 text-center text-[12px]" style={{ color: "#ef4444" }}>{t("cal.connect_failed")}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ cancelled, enabled, readyLabel, offLabel, cancelledLabel }: { cancelled: boolean; enabled: boolean; readyLabel: string; offLabel: string; cancelledLabel: string }) {
  const [label, dot, color] = cancelled ? [cancelledLabel, "#ef4444", "#ef4444"] : !enabled ? [offLabel, "var(--text-faint)", "var(--text-muted)"] : [readyLabel, "#22c55e", "#22c55e"];
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium" style={{ borderColor: "var(--border-soft)", color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} /> {label}
    </span>
  );
}

function Avatar({ name, size }: { name: string; size: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.42, background: "var(--section-accent)" }}>
      {initialsOf(name)}
    </span>
  );
}

function ToolBtn({ on, neutral, onClick, label, onIcon, offIcon }: { on: boolean; neutral?: boolean; onClick: () => void; label: string; onIcon: React.ReactNode; offIcon: React.ReactNode }) {
  const bg = neutral ? "rgba(255,255,255,0.12)" : on ? "rgba(255,255,255,0.12)" : "#ef4444";
  return <button onClick={onClick} aria-label={label} title={label} className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: bg }}>{on ? onIcon : offIcon}</button>;
}

/** One participant camera tile: live video when available, initials placeholder otherwise. */
function ParticipantTile({ p, source, isLocal, speaking, youLabel, muted }: { p: Participant; source: TrackNS.Source; isLocal: boolean; speaking: boolean; youLabel: string; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const name = p.name || p.identity || "Member";

  useEffect(() => {
    const pub = p.getTrackPublication(source);
    const track = pub?.track;
    const live = !!track && !pub?.isMuted;
    if (live && ref.current) { track!.attach(ref.current); setHasVideo(true); }
    else { setHasVideo(false); }
    return () => { try { if (track && ref.current) track.detach(ref.current); } catch { /* ignore */ } };
  });

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl" style={{ background: "#17171b", outline: speaking ? "2px solid var(--section-accent)" : "1px solid rgba(255,255,255,0.06)", outlineOffset: -1 }}>
      <video ref={ref} autoPlay playsInline muted={isLocal} className="h-full w-full object-cover" style={{ display: hasVideo ? "block" : "none" }} />
      {!hasVideo && (
        <div className="flex h-full w-full items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full text-[18px] font-semibold text-white" style={{ background: "var(--section-accent)" }}>{initialsOf(name)}</span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/50 px-2 py-1 text-[11px] font-medium text-white">
        {muted ? <MicOff size={11} className="text-white/70" /> : <Mic size={11} className="text-white/70" />}
        <span className="max-w-[140px] truncate">{name}</span>
        {isLocal && <span className="rounded-sm bg-white/20 px-1 text-[9px] uppercase tracking-wide">{youLabel}</span>}
      </div>
    </div>
  );
}

/** Prominent stage for an active screen share. */
function ScreenTile({ p, source }: { p: Participant; source: TrackNS.Source }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const track = p.getTrackPublication(source)?.track;
    if (track && ref.current) track.attach(ref.current);
    return () => { try { if (track && ref.current) track.detach(ref.current); } catch { /* ignore */ } };
  });
  return (
    <div className="relative overflow-hidden rounded-xl bg-black" style={{ aspectRatio: "16 / 9" }}>
      <video ref={ref} autoPlay playsInline className="h-full w-full object-contain" />
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/50 px-2 py-1 text-[11px] font-medium text-white"><MonitorUp size={11} /> {p.name || p.identity}</div>
    </div>
  );
}
