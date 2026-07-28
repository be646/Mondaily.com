import { useEffect, useReducer, useRef, useState } from "react";
import type { Room, Participant } from "livekit-client";
import { Loader2, Mic, MicOff, Video, VideoOff, PhoneOff, Users, MonitorUp, ShieldAlert, CalendarClock, Check, Captions } from "lucide-react";
import { parseCaptionPacket, type CaptionPacket } from "@mondaily/shared/captions";
import { BASE_URL } from "../lib/api-client";
import { LogoMark } from "@/components/logo";
import { ParticipantTile, ScreenTile, ToolBtn, CaptionsPanel } from "./dashboard/call-tiles";
import { useCaptionCapture } from "./dashboard/use-caption-capture";

// SAFE pre-join metadata (whitelist from POST /public/calls/meta). No workspace internals.
interface GuestMeta {
  event_title: string | null; start_time: string | null;
  host_display_name: string | null; workspace_display_name: string | null;
  recording_may_occur: boolean; calls_enabled: boolean; waiting_room: boolean; live_captions_available?: boolean;
  meeting_type_label?: string;   // guest-SAFE label only (sensitive types collapse to "Meeting")
  status: "ok" | "expired" | "revoked" | "cancelled" | "ended" | "not_configured";
}
const STATUS_COPY: Record<string, string> = {
  expired: "This guest link is invalid or has expired.",
  revoked: "This guest link has been revoked by the host.",
  cancelled: "This meeting was cancelled.",
  ended: "This meeting has ended or is no longer available.",
  not_configured: "Calls aren't available on this workspace right now.",
};

/**
 * PUBLIC guest call page at /join/:eventId#g=<token> — for people WITHOUT a Mondaily account. It reads
 * the signed guest token from the URL fragment (never sent to the server), redeems it at the public
 * /public/calls/token endpoint for a room-scoped LiveKit join token, and drops the guest straight into
 * the same meeting room as members. Standalone (no dashboard chrome / no auth). Guests can talk, share,
 * and leave — they have no host controls and see nothing else in the workspace.
 */
type LKModule = typeof import("livekit-client");

export function GuestCallPage() {
  const [phase, setPhase] = useState<"lobby" | "waiting" | "denied" | "connecting" | "live" | "ended" | "error" | "invalid">("lobby");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [title, setTitle] = useState("Meeting");
  const [meta, setMeta] = useState<GuestMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [consent, setConsent] = useState(false);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [captions, setCaptions] = useState<CaptionPacket[]>([]);
  const [showCaptions, setShowCaptions] = useState(false);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const roomRef = useRef<Room | null>(null);
  const lkRef = useRef<LKModule | null>(null);

  // The guest token lives in the URL fragment (#g=…) so it never reaches the server in logs/referrers.
  const token = (() => { const h = window.location.hash || ""; const m = h.match(/[#&]g=([^&]+)/); return m ? decodeURIComponent(m[1]!) : ""; })();

  // Fetch the SAFE pre-join preview (title, host, time, recording-consent requirement). Public endpoint
  // only — the guest page NEVER calls an authenticated workspace API. Token stays in the body, never a URL.
  useEffect(() => {
    if (!token) { setPhase("invalid"); setMetaLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/v1/public/calls/meta`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
        });
        const m = (await res.json().catch(() => null)) as GuestMeta | null;
        if (cancelled) return;
        setMeta(m);
        if (m?.event_title) setTitle(m.event_title);
        if (m && m.status !== "ok") { setErrMsg(STATUS_COPY[m.status] ?? ""); setPhase("invalid"); }
      } catch { /* preview is best-effort — join() still enforces validity server-side */ }
      finally { if (!cancelled) setMetaLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const recordingMayOccur = !!meta?.recording_may_occur;
  const waitingRoom = !!meta?.waiting_room;
  const canJoin = !!name.trim() && (!recordingMayOccur || consent);

  // Ask to join. With a waiting room ON, this records a request and the guest waits for the host to admit
  // (no token yet). With it OFF, it connects straight away (Phase 1 behaviour).
  async function requestJoin() {
    if (!token) { setPhase("invalid"); return; }
    if (!canJoin) return;
    setErrMsg("");
    if (!waitingRoom) { await connectWithToken(); return; }
    setPhase("connecting");
    try {
      const res = await fetch(`${BASE_URL}/api/v1/public/calls/request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: name.trim() || "Guest", consent: recordingMayOccur ? consent : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErrMsg(data.error || "Couldn't request entry."); setPhase(res.status === 401 || res.status === 410 ? "invalid" : "error"); return; }
      if (data.waiting === false) { await connectWithToken(); return; }   // waiting room turned off meanwhile
      setRequestId(data.request_id); setPhase("waiting");
    } catch { setPhase("error"); setErrMsg("Couldn't reach the meeting."); }
  }

  // Poll the host's admission decision while waiting. Admitted → connect; denied → denied screen.
  useEffect(() => {
    if (phase !== "waiting" || !requestId || !token) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/v1/public/calls/wait-status`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, request_id: requestId }),
        });
        const { status } = await res.json().catch(() => ({ status: "waiting" }));
        if (stop) return;
        if (status === "admitted") { connectWithToken(requestId); return; }
        if (status === "denied") { setPhase("denied"); return; }
        if (status === "expired") { setErrMsg("This request expired — ask the host for a fresh link."); setPhase("invalid"); return; }
      } catch { /* keep polling */ }
    };
    const iv = setInterval(tick, 3000); tick();
    return () => { stop = true; clearInterval(iv); };
  }, [phase, requestId, token]);

  async function connectWithToken(reqId?: string) {
    if (!token) { setPhase("invalid"); return; }
    setPhase("connecting"); setErrMsg("");
    try {
      const res = await fetch(`${BASE_URL}/api/v1/public/calls/token`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: name.trim() || "Guest", consent: recordingMayOccur ? consent : undefined, request_id: reqId ?? requestId ?? undefined }),
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
        .on(RoomEvent.DataReceived, (payload: Uint8Array) => { const cap = parseCaptionPacket(payload); if (cap) setCaptions(cs => [...cs.filter(x => x.id !== cap.id), cap].slice(-60)); })
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

  // Live Captions Phase 2 (guest) — same LOCAL-mic-only capture as members, but posts to the PUBLIC
  // caption endpoint with the guest token + explicit consent. Turning CC on (with the "transcribes only
  // your mic, not saved" notice visible) is the consent action. Stays on /public/calls/* — never an
  // authenticated API. No audio/transcript stored; STT key/appliance URL never reach the browser.
  useCaptionCapture({
    active: !!meta?.live_captions_available && showCaptions && micOn && phase === "live",
    getMicTrack: () => {
      const lk = lkRef.current, r = roomRef.current;
      if (!lk || !r) return null;
      return r.localParticipant.getTrackPublication(lk.Track.Source.Microphone)?.track?.mediaStreamTrack ?? null;
    },
    sendChunk: async (pcm, seq, signal) => {
      // Raw PCM body + query metadata; guest token in a header (never multipart, never in the URL).
      const qs = new URLSearchParams({ consent: "true", format: "pcm_s16le", sample_rate: "16000", session: roomRef.current?.localParticipant.identity ?? "guest", seq: String(seq) });
      try {
        const res = await fetch(`${BASE_URL}/api/v1/public/calls/caption-chunk?${qs.toString()}`, { method: "POST", body: pcm, headers: { "Content-Type": "application/octet-stream", "X-Guest-Token": token }, signal });
        const body = await res.json().catch(() => ({} as Record<string, unknown>));
        return { ok: res.ok, status: res.status, text: typeof body.text === "string" ? body.text : "", noSpeech: body.no_speech === true, language: typeof body.language === "string" ? body.language : null };
      } catch { return { ok: false, status: 0, text: "", noSpeech: false, language: null }; }
    },
    onCaption: (text, language, seq) => {
      const lp = roomRef.current?.localParticipant; if (!lp) return;
      const pkt = { t: "caption" as const, id: `${lp.identity}-${seq}`, participantId: lp.identity, name: lp.name || name || "Guest", text, final: true, ts: Date.now(), ...(language ? { lang: language } : {}) };
      setCaptions(cs => [...cs.filter(x => x.id !== pkt.id), pkt].slice(-400));   // keep enough history for the transcript timeline
      try { lp.publishData(new TextEncoder().encode(JSON.stringify(pkt)), { reliable: true }); } catch { /* ignore */ }
      // Phase B.1 — persist this FINAL guest line (write-only; token + consent scoped server-side).
      // Fire-and-forget: a save failure never disrupts the guest's live captions. Idempotent server-side.
      void fetch(`${BASE_URL}/api/v1/public/calls/transcript?consent=true`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Guest-Token": token },
        body: JSON.stringify({ lines: [{ id: pkt.id, participantId: pkt.participantId, name: pkt.name, text: pkt.text, ts: pkt.ts, final: true, ...(pkt.lang ? { lang: pkt.lang } : {}) }] }),
      }).catch(() => {});
    },
    onStop: () => setShowCaptions(false),
  });

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
        <div className="flex flex-1 gap-2 overflow-hidden px-3 pb-2">
          <div className="flex-1 space-y-2 overflow-y-auto">
            {lk && screenSharer && <ScreenTile p={screenSharer.p} source={lk.Track.Source.ScreenShare} />}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {lk && everyone.map(({ p, isLocal }) => (
                <ParticipantTile key={p.sid || p.identity} p={p} source={lk.Track.Source.Camera} isLocal={isLocal}
                  speaking={speaking.has(p.identity)} youLabel="You"
                  muted={isLocal ? !micOn : !!p.getTrackPublication(lk.Track.Source.Microphone)?.isMuted} />
              ))}
            </div>
          </div>
          {showCaptions && <CaptionsPanel available={!!meta?.live_captions_available} captions={captions} onClose={() => setShowCaptions(false)}
            preferenceKey="mondaily_caption_lang_guest"
            onTranslate={async (items, target) => {
              // Phase C.3 — per-viewer guest translation. Sends only the guest's OWN caption text + a target to
              // the public token+consent-gated endpoint; never mutates the transcript, never reads member data.
              try {
                const res = await fetch(`${BASE_URL}/api/v1/public/calls/translate?consent=true`, {
                  method: "POST", headers: { "Content-Type": "application/json", "X-Guest-Token": token },
                  body: JSON.stringify({ target, lines: items.map((it) => ({ text: it.text, source_lang: it.source_lang })) }),
                });
                const body = await res.json().catch(() => ({ results: [] as unknown[] }));
                const results = Array.isArray(body.results) ? body.results : [];
                return items.map((it, i) => {
                  const rr = (results[i] ?? {}) as { state?: string; translated?: string };
                  const state = rr.state === "translated" ? "translated" : rr.state === "original" ? "original" : "unavailable";
                  return { id: it.id, state, translated: rr.translated };
                });
              } catch { return items.map((it) => ({ id: it.id, state: "unavailable" as const })); }
            }} />}
        </div>
        <div className="flex items-center justify-center gap-3 py-4">
          <ToolBtn on={micOn} onClick={toggleMic} label="Microphone" onIcon={<Mic size={18} className="text-white" />} offIcon={<MicOff size={18} className="text-white" />} />
          <ToolBtn on={camOn} onClick={toggleCam} label="Camera" onIcon={<Video size={18} className="text-white" />} offIcon={<VideoOff size={18} className="text-white" />} />
          <ToolBtn on={!sharing} neutral onClick={toggleShare} label={sharing ? "Stop sharing" : "Share screen"} onIcon={<MonitorUp size={18} className={sharing ? "text-[color:var(--section-accent)]" : "text-white"} />} offIcon={<MonitorUp size={18} className="text-white" />} />
          <ToolBtn on={!showCaptions} neutral onClick={() => setShowCaptions(s => !s)} label="Live captions" onIcon={<Captions size={18} className="text-white" />} offIcon={<Captions size={18} className="text-white" />} />
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

  if (phase === "waiting") {
    return <Shell><div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="mb-1 flex items-center gap-2"><LogoMark className="h-5 w-5" /><span className="text-[12px] font-semibold text-white/70">Mondaily</span></div>
      <Loader2 size={22} className="animate-spin text-white/60" />
      <p className="text-[15px] font-medium text-white">Waiting for the host to admit you…</p>
      <p className="text-[12.5px] text-white/50">{meta?.event_title ? `“${meta.event_title}”` : "You're in the waiting room."} The host will let you in shortly.</p>
    </div></Shell>;
  }

  if (phase === "denied") {
    return <Shell><div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <ShieldAlert size={24} className="text-white/50" />
      <p className="text-[15px] font-medium text-white">The host didn't admit you</p>
      <p className="text-[12.5px] text-white/55">You weren't admitted to this meeting. If you think this is a mistake, contact the host.</p>
    </div></Shell>;
  }

  // Lobby — branded pre-join preview + name + device toggles + (conditional) recording consent.
  const startLabel = (() => {
    if (!meta?.start_time) return null;
    const d = new Date(meta.start_time);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  })();
  return (
    <Shell>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6">
        {/* Brand */}
        <div className="mb-4 flex items-center justify-center gap-2">
          <LogoMark className="h-6 w-6" />
          <span className="text-[13px] font-semibold tracking-tight text-white/80">Mondaily</span>
        </div>
        <div className="rounded-2xl border p-6" style={{ borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" }}>
          {metaLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-[13px] text-white/60"><Loader2 size={14} className="animate-spin" /> Loading meeting…</div>
          ) : (
            <>
              <h1 className="text-[20px] font-semibold leading-tight text-white">{meta?.event_title || "Join the meeting"}</h1>
              <div className="mt-1.5 space-y-0.5 text-[12.5px] text-white/55">
                {meta?.meeting_type_label && meta.meeting_type_label !== "Meeting" && <p className="inline-block rounded-sm bg-white/10 px-1.5 py-0.5 text-[11px] text-white/70">{meta.meeting_type_label}</p>}
                {meta?.host_display_name && <p>Hosted by {meta.host_display_name}{meta?.workspace_display_name ? ` · ${meta.workspace_display_name}` : ""}</p>}
                {startLabel && <p className="flex items-center gap-1.5"><CalendarClock size={12} /> {startLabel}</p>}
                <p className="pt-1 text-white/40">You've been invited as a guest — enter your name to join.</p>
              </div>
              {waitingRoom && <p className="mt-2 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] text-white/60" style={{ borderColor: "rgba(255,255,255,0.12)" }}><Users size={12} /> The host admits guests — you'll wait briefly after asking to join.</p>}
              <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && canJoin && requestJoin()}
                placeholder="Your name" autoFocus maxLength={40}
                className="mt-4 w-full rounded-lg border bg-black/30 px-3 py-2.5 text-[14px] text-white placeholder-white/30 outline-none focus:border-[color:var(--section-accent)]"
                style={{ borderColor: "rgba(255,255,255,0.12)" }} />
              <div className="mt-3 flex items-center gap-2">
                <button onClick={() => setMicOn(m => !m)} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] text-white/80" style={{ borderColor: "rgba(255,255,255,0.12)" }}>{micOn ? <Mic size={13} /> : <MicOff size={13} />} Mic</button>
                <button onClick={() => setCamOn(c => !c)} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] text-white/80" style={{ borderColor: "rgba(255,255,255,0.12)" }}>{camOn ? <Video size={13} /> : <VideoOff size={13} />} Camera</button>
              </div>
              {/* Recording/transcription consent — only when the platform may record this call. */}
              {recordingMayOccur && (
                <button type="button" onClick={() => setConsent(v => !v)} className="mt-3 flex w-full items-start gap-2 rounded-lg border px-3 py-2.5 text-left" style={{ borderColor: consent ? "var(--section-accent)" : "rgba(255,255,255,0.12)", background: consent ? "color-mix(in srgb, var(--section-accent) 12%, transparent)" : "transparent" }}>
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border" style={{ borderColor: consent ? "var(--section-accent)" : "rgba(255,255,255,0.3)", background: consent ? "var(--section-accent)" : "transparent" }}>{consent && <Check size={11} className="text-white" />}</span>
                  <span className="text-[11.5px] leading-snug text-white/70">This meeting may be recorded and transcribed. By joining, I consent to being recorded.</span>
                </button>
              )}
              <button onClick={requestJoin} disabled={!canJoin}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-[14px] font-semibold text-white disabled:opacity-50" style={{ background: "var(--section-accent)" }}>
                <Video size={15} /> {waitingRoom ? "Ask to join" : "Join call"}
              </button>
              {phase === "error" && <p className="mt-2 text-center text-[12px]" style={{ color: "#e8837b" }}>{errMsg || "Couldn't join — try again."}</p>}
              <p className="mt-4 text-center text-[10.5px] text-white/35">Guests can talk, video, and share screen. You won't have access to anything else in the workspace.</p>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
