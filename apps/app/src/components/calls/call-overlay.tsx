import { useEffect, useRef, useState } from "react";
import type { Room } from "livekit-client";
import { Loader2, Mic, MicOff, Video, VideoOff, PhoneOff, User as UserIcon, Circle, Square } from "lucide-react";
import { apiClient } from "../../lib/api-client";

/**
 * Live call overlay — connects to a self-hosted LiveKit room and renders the call.
 * The livekit-client SDK is imported LAZILY (dynamic import) so it ships as its own chunk and
 * never weighs on users who don't call. All media stays peer↔SFU; our server only minted the
 * token. On close we POST /live-calls/rooms/:id/end so the session record reflects reality.
 */
export interface ActiveCall { sessionId: string; room: string; token: string; url: string; kind: "audio" | "video"; otherName: string; recording?: boolean }

export function CallOverlay({ call, onClose }: { call: ActiveCall; onClose: () => void }) {
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(call.kind === "video");
  const [remoteJoined, setRemoteJoined] = useState(false);
  // Live recording state (native). Polled from the session; fail-closed — `configured:false` means
  // recording isn't available on this deployment, and we NEVER show a fake recording state.
  const [rec, setRec] = useState<{ recording_status: string | null; configured: boolean; can_control: boolean } | null>(null);
  const [recBusy, setRecBusy] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { Room, RoomEvent, Track } = await import("livekit-client");
        if (cancelled) return;
        const room = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === Track.Kind.Video && remoteVideoRef.current) track.attach(remoteVideoRef.current);
          if (track.kind === Track.Kind.Audio && remoteAudioRef.current) track.attach(remoteAudioRef.current);
          setRemoteJoined(true);
        });
        room.on(RoomEvent.ParticipantConnected, () => setRemoteJoined(true));
        room.on(RoomEvent.Disconnected, () => { if (!cancelled) onClose(); });

        await room.connect(call.url, call.token);
        if (cancelled) { await room.disconnect(); return; }
        await room.localParticipant.setMicrophoneEnabled(true);
        if (call.kind === "video") {
          await room.localParticipant.setCameraEnabled(true);
          const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
          if (pub?.track && localVideoRef.current) pub.track.attach(localVideoRef.current);
        }
        setStatus("live");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; roomRef.current?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hangup = async () => {
    try { await roomRef.current?.disconnect(); } catch { /* ignore */ }
    apiClient.post(`/live-calls/rooms/${call.sessionId}/end`, { status: "ended" }).catch(() => {});
    onClose();
  };
  // Poll recording status while connected (all participants see it; only the organizer can control).
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try { const r = await apiClient.get<{ recording_status: string | null; configured: boolean; can_control: boolean }>(`/live-calls/rooms/${call.sessionId}/recording/status`); if (!stop) setRec(r); } catch { /* keep last */ }
    };
    tick();
    const iv = setInterval(tick, 4000);
    return () => { stop = true; clearInterval(iv); };
  }, [call.sessionId]);

  const toggleRecording = async (action: "start" | "stop") => {
    if (recBusy || !rec?.can_control) return;
    setRecBusy(true);
    try { const r = await apiClient.post<{ recording_status?: string }>(`/live-calls/rooms/${call.sessionId}/recording/${action}`, {}); setRec((p) => p ? { ...p, recording_status: r.recording_status ?? p.recording_status } : p); }
    catch { /* status poll will reconcile; never fake a state */ }
    finally { setRecBusy(false); }
  };

  const recActive = rec?.recording_status === "recording";
  const recProcessing = rec?.recording_status === "processing";

  const toggleMic = async () => { const r = roomRef.current; if (!r) return; const on = !micOn; await r.localParticipant.setMicrophoneEnabled(on); setMicOn(on); };
  const toggleCam = async () => {
    const r = roomRef.current; if (!r) return;
    const { Track } = await import("livekit-client");
    const on = !camOn; await r.localParticipant.setCameraEnabled(on);
    const pub = r.localParticipant.getTrackPublication(Track.Source.Camera);
    if (on && pub?.track && localVideoRef.current) pub.track.attach(localVideoRef.current);
    setCamOn(on);
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center" style={{ background: "rgba(0,0,0,0.88)" }} role="dialog" aria-label={`Call with ${call.otherName}`}>
      {/* Honest recording notice — driven by the LIVE session state (never a fake state). Shown to
          ALL participants whenever recording is active or finalizing, so consent is always visible. */}
      {(recActive || recProcessing) && (
        <div className="absolute left-1/2 top-6 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-medium text-white" style={{ background: recActive ? "rgba(225,29,72,0.9)" : "rgba(120,120,120,0.9)" }}>
          <span className={`h-1.5 w-1.5 rounded-full bg-white ${recActive ? "animate-pulse" : ""}`} />
          {recActive ? "Recording — this call is being transcribed to Meeting Memory" : "Finalizing recording…"}
        </div>
      )}
      <div className="relative flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-6">
        {/* remote */}
        <div className="flex flex-col items-center">
          {call.kind === "video" ? (
            <video ref={remoteVideoRef} autoPlay playsInline className="max-h-[60vh] w-full rounded-lg bg-black object-contain" />
          ) : (
            <span className="flex h-28 w-28 items-center justify-center rounded-full text-3xl font-semibold text-white" style={{ background: "rgba(255,255,255,0.1)" }}>
              {call.otherName?.trim()?.[0]?.toUpperCase() || <UserIcon size={40} />}
            </span>
          )}
          <audio ref={remoteAudioRef} autoPlay />
          <p className="mt-4 text-[15px] font-medium text-white">{call.otherName}</p>
          <p className="mt-1 text-[12px]" style={{ color: "rgba(255,255,255,0.6)" }}>
            {status === "connecting" ? "Connecting…" : status === "error" ? "Couldn't connect" : remoteJoined ? "Connected" : "Ringing…"}
          </p>
          {status === "connecting" && <Loader2 size={18} className="mt-2 animate-spin text-white" />}
        </div>

        {/* local preview (video) */}
        {call.kind === "video" && camOn && (
          <video ref={localVideoRef} autoPlay playsInline muted className="absolute bottom-4 right-6 h-28 w-40 rounded-md border object-cover" style={{ borderColor: "rgba(255,255,255,0.2)" }} />
        )}
      </div>

      {/* controls */}
      <div className="flex items-center gap-4 pb-10 pt-6">
        <button onClick={toggleMic} className="flex h-12 w-12 items-center justify-center rounded-full text-white" style={{ background: micOn ? "rgba(255,255,255,0.15)" : "#d1524a" }} aria-label={micOn ? "Mute" : "Unmute"}>
          {micOn ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        {call.kind === "video" && (
          <button onClick={toggleCam} className="flex h-12 w-12 items-center justify-center rounded-full text-white" style={{ background: camOn ? "rgba(255,255,255,0.15)" : "#d1524a" }} aria-label={camOn ? "Stop video" : "Start video"}>
            {camOn ? <Video size={18} /> : <VideoOff size={18} />}
          </button>
        )}
        {/* Recording control — organizer only, when egress is configured. Others just see the notice
            above (passive indicator). Fail-closed: unconfigured deployments show no control at all. */}
        {rec?.can_control && rec.configured && (
          <button onClick={() => toggleRecording(recActive ? "stop" : "start")} disabled={recBusy || recProcessing}
            title={recActive ? "Stop recording" : "Start recording"}
            className="flex h-12 w-12 items-center justify-center rounded-full text-white disabled:opacity-60"
            style={{ background: recActive ? "#d1524a" : "rgba(255,255,255,0.15)" }}
            aria-label={recActive ? "Stop recording" : "Start recording"}>
            {recBusy || recProcessing ? <Loader2 size={18} className="animate-spin" /> : recActive ? <Square size={16} /> : <Circle size={18} />}
          </button>
        )}
        <button onClick={hangup} className="flex h-12 w-12 items-center justify-center rounded-full text-white" style={{ background: "#d1524a" }} aria-label="Hang up">
          <PhoneOff size={18} />
        </button>
      </div>
    </div>
  );
}
