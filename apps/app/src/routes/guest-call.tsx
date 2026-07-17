import { useEffect, useReducer, useRef, useState } from "react";
import type { Room, Participant } from "livekit-client";
import { Loader2, Mic, MicOff, Video, VideoOff, PhoneOff, Users, MonitorUp, ShieldAlert } from "lucide-react";
import { BASE_URL } from "../lib/api-client";
import { ParticipantTile, ScreenTile, ToolBtn } from "./dashboard/call-room";

/**
 * PUBLIC guest call page at /join/:eventId#g=<token> — for people WITHOUT a Mondaily account. It reads
 * the signed guest token from the URL fragment (never sent to the server), redeems it at the public
 * /public/calls/token endpoint for a room-scoped LiveKit join token, and drops the guest straight into
 * the same meeting room as members. Standalone (no dashboard chrome / no auth). Guests can talk, share,
 * and leave — they have no host controls and see nothing else in the workspace.
 */
type LKModule = typeof import("livekit-client");

export function GuestCallPage() {
  const [phase, setPhase] = useState<"lobby" | "connecting" | "live" | "ended" | "error" | "invalid">("lobby");
  const [name, setName] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [title, setTitle] = useState("Meeting");
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const roomRef = useRef<Room | null>(null);
  const lkRef = useRef<LKModule | null>(null);

  // The guest token lives in the URL fragment (#g=…) so it never reaches the server in logs/referrers.
  const token = (() => { const h = window.location.hash || ""; const m = h.match(/[#&]g=([^&]+)/); return m ? decodeURIComponent(m[1]!) : ""; })();

  useEffect(() => { if (!token) setPhase("invalid"); }, [token]);

  async function join() {
    if (!token) { setPhase("invalid"); return; }
    setPhase("connecting"); setErrMsg("");
    try {
      const res = await fetch(`${BASE_URL}/api/v1/public/calls/token`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: name.trim() || "Guest" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token || !data.url) { setErrMsg(data.error || "Couldn't join this call."); setPhase(res.status === 401 || res.status === 410 || res.status === 404 ? "invalid" : "error"); return; }
      setTitle(data.event_title || "Meeting");
      const lk = await import("livekit-client");
      lkRef.current = lk;
      const { Room, RoomEvent } = lk;
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      room
        .on(RoomEvent.ParticipantConnected, bump).on(RoomEvent.ParticipantDisconnected, bump)
        .on(RoomEvent.TrackSubscribed, bump).on(RoomEvent.TrackUnsubscribed, bump)
        .on(RoomEvent.TrackMuted, bump).on(RoomEvent.TrackUnmuted, bump)
        .on(RoomEvent.LocalTrackPublished, bump).on(RoomEvent.LocalTrackUnpublished, bump)
        .on(RoomEvent.ActiveSpeakersChanged, (s: Participant[]) => setSpeaking(new Set(s.map(x => x.identity))))
        .on(RoomEvent.Reconnecting, () => setReconnecting(true)).on(RoomEvent.Reconnected, () => setReconnecting(false))
        .on(RoomEvent.Disconnected, () => setPhase("ended"));
      await room.connect(data.url, data.token);
      await room.localParticipant.setMicrophoneEnabled(micOn);
      await room.localParticipant.setCameraEnabled(camOn);
      setPhase("live");
    } catch { setPhase("error"); setErrMsg("Couldn't connect to the call."); }
  }

  async function leave() { try { await roomRef.current?.disconnect(); } catch { /* ignore */ } setPhase("ended"); }
  async function toggleMic() { const r = roomRef.current; if (!r) return; const n = !micOn; setMicOn(n); await r.localParticipant.setMicrophoneEnabled(n); bump(); }
  async function toggleCam() { const r = roomRef.current; if (!r) return; const n = !camOn; setCamOn(n); await r.localParticipant.setCameraEnabled(n); bump(); }
  async function toggleShare() { const r = roomRef.current; if (!r) return; try { const n = !sharing; await r.localParticipant.setScreenShareEnabled(n); setSharing(n); bump(); } catch { /* cancelled */ } }

  useEffect(() => () => { roomRef.current?.disconnect().catch(() => {}); }, []);

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="flex min-h-screen flex-col" style={{ background: "#0b0b0d" }}>{children}</div>
  );

  if (phase === "invalid") {
    return <Shell><div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <ShieldAlert size={26} className="text-white/50" />
      <p className="text-[15px] font-medium text-white">This guest link isn't valid</p>
      <p className="text-[13px] text-white/60">{errMsg || "The link may have expired or the meeting was cancelled. Ask the host for a fresh invite link."}</p>
    </div></Shell>;
  }

  if (phase === "live" || phase === "connecting") {
    const room = roomRef.current; const lk = lkRef.current; const local = room?.localParticipant;
    const remotes = room ? [...room.remoteParticipants.values()] : [];
    const everyone: { p: Participant; isLocal: boolean }[] = local ? [{ p: local, isLocal: true }, ...remotes.map(p => ({ p, isLocal: false }))] : [];
    const screenSharer = lk ? everyone.find(({ p }) => !!p.getTrackPublication(lk.Track.Source.ScreenShare)?.track) : undefined;
    return (
      <Shell>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <span className="block truncate text-[14px] font-semibold text-white">{title}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-white/50"><Users size={11} /> {everyone.length} {everyone.length === 1 ? "person" : "people"} · you're a guest</span>
          </div>
          {(phase === "connecting" || reconnecting) && <span className="flex items-center gap-2 text-[12px] text-white/70"><Loader2 size={13} className="animate-spin" /> {reconnecting ? "Reconnecting…" : "Connecting…"}</span>}
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-2">
          {lk && screenSharer && <ScreenTile p={screenSharer.p} source={lk.Track.Source.ScreenShare} />}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {lk && everyone.map(({ p, isLocal }) => (
              <ParticipantTile key={p.sid || p.identity} p={p} source={lk.Track.Source.Camera} isLocal={isLocal}
                speaking={speaking.has(p.identity)} youLabel="You"
                muted={isLocal ? !micOn : !!p.getTrackPublication(lk.Track.Source.Microphone)?.isMuted} />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-center gap-3 py-4">
          <ToolBtn on={micOn} onClick={toggleMic} label="Microphone" onIcon={<Mic size={18} className="text-white" />} offIcon={<MicOff size={18} className="text-white" />} />
          <ToolBtn on={camOn} onClick={toggleCam} label="Camera" onIcon={<Video size={18} className="text-white" />} offIcon={<VideoOff size={18} className="text-white" />} />
          <ToolBtn on={!sharing} neutral onClick={toggleShare} label={sharing ? "Stop sharing" : "Share screen"} onIcon={<MonitorUp size={18} className={sharing ? "text-[color:var(--section-accent)]" : "text-white"} />} offIcon={<MonitorUp size={18} className="text-white" />} />
          <button onClick={leave} title="Leave" className="flex h-11 items-center gap-2 rounded-full bg-[#d1524a] px-5"><PhoneOff size={18} className="text-white" /><span className="text-[13px] font-medium text-white">Leave</span></button>
        </div>
      </Shell>
    );
  }

  if (phase === "ended") {
    return <Shell><div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <PhoneOff size={22} className="text-white/50" />
      <p className="text-[15px] font-medium text-white">You left the call</p>
      <button onClick={() => { setReconnecting(false); setPhase("lobby"); }} className="rounded-lg px-4 py-2 text-[13px] font-medium text-white" style={{ background: "var(--section-accent)" }}>Rejoin</button>
    </div></Shell>;
  }

  // Lobby
  return (
    <Shell>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6">
        <div className="rounded-2xl border p-6" style={{ borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" }}>
          <h1 className="text-[20px] font-semibold text-white">Join the meeting</h1>
          <p className="mt-1 text-[13px] text-white/55">You've been invited as a guest. Enter your name to join.</p>
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && name.trim() && join()}
            placeholder="Your name" autoFocus maxLength={40}
            className="mt-4 w-full rounded-lg border bg-black/30 px-3 py-2.5 text-[14px] text-white placeholder-white/30 outline-none focus:border-[color:var(--section-accent)]"
            style={{ borderColor: "rgba(255,255,255,0.12)" }} />
          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => setMicOn(m => !m)} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] text-white/80" style={{ borderColor: "rgba(255,255,255,0.12)" }}>{micOn ? <Mic size={13} /> : <MicOff size={13} />} Mic</button>
            <button onClick={() => setCamOn(c => !c)} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] text-white/80" style={{ borderColor: "rgba(255,255,255,0.12)" }}>{camOn ? <Video size={13} /> : <VideoOff size={13} />} Camera</button>
          </div>
          <button onClick={join} disabled={!name.trim()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-[14px] font-semibold text-white disabled:opacity-50" style={{ background: "var(--section-accent)" }}>
            <Video size={15} /> Join call
          </button>
          {phase === "error" && <p className="mt-2 text-center text-[12px]" style={{ color: "#e8837b" }}>{errMsg || "Couldn't join — try again."}</p>}
          <p className="mt-4 text-center text-[10.5px] text-white/35">Guests can talk, video, and share screen. You won't have access to anything else in the workspace.</p>
        </div>
      </div>
    </Shell>
  );
}
