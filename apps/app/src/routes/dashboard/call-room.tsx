import { useEffect, useReducer, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Room, Participant, Track as TrackNS } from "livekit-client";
import { Loader2, Mic, MicOff, Video, VideoOff, PhoneOff, Users, CalendarDays, ArrowLeft, ShieldAlert, VideoOff as NoCall, MonitorUp, Settings2, Brain, Sparkles, FileText, ListChecks, Link2, UserPlus, UserX, Check, X, MessageSquare, Maximize2, LayoutGrid, Send, Captions } from "lucide-react";
import { apiClient, apiFetch, BASE_URL } from "../../lib/api-client";
import { useCaptionCapture } from "./use-caption-capture";
import { FieldSelect } from "../../components/ui/controls";
import { useLanguage } from "../../hooks/useLanguage";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { CallDetailPage } from "./call-detail";
import { ParticipantTile, ScreenTile, ToolBtn, initialsOf, CaptionsPanel } from "./call-tiles";
import { MEETING_TYPE_META, type MeetingType } from "@mondaily/shared/meeting-types";
import { parseCaptionPacket, type CaptionPacket } from "@mondaily/shared/captions";

interface Member { id: string; name?: string; email: string }

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
  meeting_type?: MeetingType; live_captions_available?: boolean;
}
type LKModule = typeof import("livekit-client");

export function CallRoomDispatch() {
  const { id } = useParams();
  const q = useQuery<CalEvent>({ queryKey: ["calendar-event", id], queryFn: () => apiClient.get(`/calendar/events/${id}`), retry: false });

  if (q.isLoading) return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin" style={{ color: "var(--text-muted)" }} /></div>;
  if (q.data) {
    // A calendar event: if it already happened → Meeting Memory detail; if it's upcoming/ongoing → the
    // live call room. Live /calls/:eventId links keep working for current meetings.
    const e = q.data;
    const end = new Date(e.end_at || e.start_at);
    const past = e.status === "completed" || (e.status !== "cancelled" && !Number.isNaN(end.getTime()) && end < new Date());
    return past ? <MeetingMemoryDetail event={e} /> : <CallRoom event={e} />;
  }
  const msg = (q.error as Error)?.message ?? "";
  if (/not allowed/i.test(msg)) return <NotAllowed />;
  // Not a calendar event (or genuinely not found) → the id is a call record; show its detail page.
  return <CallDetailPage />;
}

interface PrepResult { agenda_summary: string | null; talking_points: string[]; follow_ups: string[]; ai_available: boolean; sources: { object_type: string; node_id: string; title: string }[] }

/**
 * Meeting Memory detail — the after-the-fact view of a PAST calendar meeting. Honest about what exists:
 * no recording is captured yet, so the transcript is always shown as unavailable; the AI summary can be
 * generated ONLY from the agenda (via /prepare) and otherwise says "Not enough recorded content yet".
 * Agenda, attendees, related records and follow-up creation are real. No fabricated transcript/summary.
 */
function MeetingMemoryDetail({ event: e }: { event: CalEvent }) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const hasAgenda = !!(e.description ?? "").trim();
  const prepare = useMutation<PrepResult>({ mutationFn: () => apiClient.post(`/calendar/events/${e.id}/prepare`, {}) });
  const createTask = useMutation({ mutationFn: (title: string) => apiClient.post("/tasks", { title }) });
  const when = (() => { try { return new Date(e.start_at).toLocaleString(lang, { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return e.start_at; } })();
  const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="border-t px-5 py-4" style={{ borderColor: "var(--border-soft)" }}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</p>
      {children}
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <button onClick={() => navigate("/calls")} className="mb-4 flex items-center gap-1.5 text-[12px]" style={{ color: "var(--text-muted)" }}><ArrowLeft size={13} /> Meeting Memory</button>
      <div className="overflow-hidden rounded-md border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-page)" }}>
        <div className="px-5 py-4">
          <p className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}><Brain size={12} style={{ color: "var(--text-muted)" }} /> Meeting Memory</p>
          <h1 className="mt-1 text-[18px] font-semibold" style={{ color: "var(--text-primary)" }}>{e.title}</h1>
          <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>{when}</p>
          {/* Honest status row — no recording captured yet. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]" style={{ color: "var(--text-faint)" }}>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--text-faint)" }} /><FileText size={11} /> Transcript unavailable</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: prepare.data?.agenda_summary ? "#5f8a6a" : hasAgenda ? "#a2854f" : "var(--text-faint)" }} /><Sparkles size={11} /> {prepare.data?.agenda_summary ? "Summary generated" : hasAgenda ? "Summary pending" : "No summary"}</span>
          </div>
        </div>

        {/* AI summary — generated from the agenda only, and only when there is content. */}
        <Section label="AI summary">
          {!hasAgenda ? (
            <p className="text-[12.5px]" style={{ color: "var(--text-faint)" }}>Not enough recorded content yet. Add an agenda in Calendar, or capture notes, to summarize this meeting.</p>
          ) : prepare.data ? (
            prepare.data.agenda_summary
              ? <p className="text-[12.5px]" style={{ color: "var(--text-secondary)" }}>{prepare.data.agenda_summary}</p>
              : <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>{prepare.data.ai_available ? "No summary was produced." : "AI summary isn't available right now."}</p>
          ) : (
            <button onClick={() => prepare.mutate()} disabled={prepare.isPending} className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
              {prepare.isPending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Generate summary
            </button>
          )}
          {prepare.data && prepare.data.follow_ups.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>Suggested follow-ups</p>
              <ul className="list-disc space-y-0.5 pl-4 text-[12.5px]" style={{ color: "var(--text-secondary)" }}>{prepare.data.follow_ups.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </div>
          )}
        </Section>

        {/* Agenda */}
        <Section label="Agenda">
          {hasAgenda ? <div className="whitespace-pre-wrap text-[12.5px]" style={{ color: "var(--text-secondary)" }}>{e.description}</div> : <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>No agenda was set.</p>}
        </Section>

        {/* Attendees */}
        <Section label={t("cal.attendees")}>
          <div className="space-y-1 text-[12.5px]">
            <div style={{ color: "var(--text-primary)" }}>{e.organizer.name} <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>· organizer</span></div>
            {e.attendees.map(a => <div key={a.user_id} style={{ color: "var(--text-secondary)" }}>{a.name}</div>)}
          </div>
        </Section>

        {/* Related records — only if the summary run surfaced real ones. */}
        {prepare.data && prepare.data.sources.length > 0 && (
          <Section label="Related records">
            <div className="space-y-1">
              {prepare.data.sources.map(s => (
                <button key={s.node_id} onClick={() => navigate(`/objects/${s.object_type}/${s.node_id}`)} className="block w-full truncate rounded-sm border px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }}>{s.title}</button>
              ))}
            </div>
          </Section>
        )}

        {/* Follow-ups / exports */}
        <Section label="Follow-ups">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => createTask.mutate(`Follow up on ${e.title}`)} disabled={createTask.isPending} className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
              {createTask.isPending ? <Loader2 size={12} className="animate-spin" /> : <ListChecks size={12} />} {createTask.isSuccess ? "Task created" : "Create follow-up task"}
            </button>
            <button onClick={() => navigate("/tasks")} className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>All tasks</button>
            <button onClick={() => navigate(`/calendar?event=${e.id}`)} className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}><CalendarDays size={12} /> Open in Calendar</button>
          </div>
        </Section>
      </div>
    </div>
  );
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
/** Host-only waiting-guests panel — polls the event's waiting list and admits/denies each guest. Quiet:
 *  renders nothing when no one is waiting. Never shows fake participants or AI. */
function WaitingGuestsPanel({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const q = useQuery<{ waiting: { request_id: string; guest_name: string; created_at: string }[] }>({
    queryKey: ["call-waiting", eventId],
    queryFn: () => apiClient.get(`/calendar/events/${eventId}/waiting`),
    refetchInterval: 4000, retry: false,
  });
  const decide = useMutation({
    mutationFn: ({ rid, action }: { rid: string; action: "admit" | "deny" }) => apiClient.post(`/calendar/events/${eventId}/waiting/${rid}/${action}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["call-waiting", eventId] }),
  });
  const waiting = q.data?.waiting ?? [];
  if (waiting.length === 0) return null;
  return (
    <div className="absolute right-3 top-16 z-30 w-72 overflow-hidden rounded-xl border shadow-2xl" style={{ borderColor: "rgba(255,255,255,0.12)", background: "rgba(20,20,24,0.96)" }}>
      <div className="border-b px-3 py-2.5 text-[12px] font-semibold text-white" style={{ borderColor: "rgba(255,255,255,0.08)" }}>Waiting to join ({waiting.length})</div>
      <div className="max-h-64 divide-y overflow-y-auto" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        {waiting.map(g => (
          <div key={g.request_id} className="flex items-center gap-2 px-3 py-2.5">
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-white/90">{g.guest_name}</span>
            <button onClick={() => decide.mutate({ rid: g.request_id, action: "admit" })} disabled={decide.isPending}
              className="rounded-md px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50" style={{ background: "#2f9e6b" }}>Admit</button>
            <button onClick={() => decide.mutate({ rid: g.request_id, action: "deny" })} disabled={decide.isPending}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-white/80 disabled:opacity-50" style={{ background: "rgba(255,255,255,0.1)" }}>Deny</button>
          </div>
        ))}
      </div>
    </div>
  );
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

  // Host controls + invite/link.
  const me = useCurrentUser();
  const qc = useQueryClient();
  const isHost = !!me.userId && me.userId === event.organizer.user_id;
  const [copied, setCopied] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteSel, setInviteSel] = useState<Set<string>>(new Set());
  const [selAudio, setSelAudio] = useState("");
  const [selVideo, setSelVideo] = useState("");
  const [ending, setEnding] = useState(false);

  // In-call collaboration: layout, raise-hand, chat — all over the real-time data channel.
  const [viewMode, setViewMode] = useState<"grid" | "speaker">("grid");
  const [handRaised, setHandRaised] = useState(false);
  const [hands, setHands] = useState<Set<string>>(new Set());
  const [showChat, setShowChat] = useState(false);
  const [chat, setChat] = useState<{ id: string; from: string; text: string; mine: boolean }[]>([]);
  const [unread, setUnread] = useState(0);
  const [captions, setCaptions] = useState<CaptionPacket[]>([]);
  const [showCaptions, setShowCaptions] = useState(false);

  function sendData(obj: Record<string, unknown>) {
    const r = roomRef.current; if (!r) return;
    try { r.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(obj)), { reliable: true }); } catch { /* ignore */ }
  }
  // Live Captions Phase 2 (member) — capture the LOCAL mic only, transcribe via the authenticated proxy,
  // and self-publish CaptionPacket. Active ONLY when captions are available + CC on + mic on + connected;
  // flipping any of those off tears the capture down. No audio/transcript is stored; the STT key/appliance
  // URL never touch the browser (the server proxy holds them).
  useCaptionCapture({
    active: !!event.live_captions_available && showCaptions && micOn && phase === "live",
    getMicTrack: () => {
      const lk = lkRef.current, r = roomRef.current;
      if (!lk || !r) return null;
      return r.localParticipant.getTrackPublication(lk.Track.Source.Microphone)?.track?.mediaStreamTrack ?? null;
    },
    sendChunk: async (pcm, seq, signal) => {
      const fd = new FormData();
      fd.append("audio", pcm, "chunk.pcm");
      fd.append("format", "pcm_s16le");
      fd.append("sample_rate", String(16000));
      fd.append("session", `${event.id}:${roomRef.current?.localParticipant.identity ?? ""}`);
      fd.append("seq", String(seq));
      try {
        const res = await apiFetch(`${BASE_URL}/api/v1/live-calls/caption-chunk`, { method: "POST", body: fd, signal });
        const body = await res.json().catch(() => ({} as Record<string, unknown>));
        return { ok: res.ok, status: res.status, text: typeof body.text === "string" ? body.text : "", noSpeech: body.no_speech === true, language: typeof body.language === "string" ? body.language : null };
      } catch { return { ok: false, status: 0, text: "", noSpeech: false, language: null }; }
    },
    onCaption: (text, language, seq) => {
      const lp = roomRef.current?.localParticipant; if (!lp) return;
      const pkt: CaptionPacket = { t: "caption", id: `${lp.identity}-${seq}`, participantId: lp.identity, name: lp.name || "You", text, final: true, ts: Date.now() };
      setCaptions(cs => [...cs.filter(x => x.id !== pkt.id), pkt].slice(-60));   // sender renders own caption (own publishData isn't echoed back)
      sendData(pkt as unknown as Record<string, unknown>);
    },
    onStop: () => setShowCaptions(false),
  });

  function toggleHand() {
    const next = !handRaised; setHandRaised(next);
    const id = roomRef.current?.localParticipant.identity;
    if (id) setHands(s => { const n = new Set(s); next ? n.add(id) : n.delete(id); return n; });
    sendData({ t: "hand", raised: next });
  }
  function sendChat(text: string) {
    const body = text.trim(); if (!body) return;
    const from = roomRef.current?.localParticipant.name || t("cal.you");
    setChat(c => [...c, { id: `${Date.now()}-me`, from, text: body, mine: true }].slice(-200));
    sendData({ t: "chat", text: body });
  }

  const membersQ = useQuery<{ members: Member[] }>({
    queryKey: ["workspace-members-full"],
    queryFn: () => apiClient.get("/workspace/members-full"),
    staleTime: 60_000, enabled: showInvite,
  });

  function copyLink() {
    const url = `${window.location.origin}/calls/${event.id}`;
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {});
  }

  const invite = useMutation({
    mutationFn: () => {
      const attendee_ids = [...new Set([...event.attendees.map(a => a.user_id), ...[...inviteSel].filter(id => id !== event.organizer.user_id)])];
      return apiClient.patch(`/calendar/events/${event.id}`, { attendee_ids });
    },
    onSuccess: () => { setShowInvite(false); setInviteSel(new Set()); qc.invalidateQueries({ queryKey: ["calendar-event", event.id] }); },
  });

  const [guestCopied, setGuestCopied] = useState(false);
  const [guestRevoked, setGuestRevoked] = useState(false);
  const guestLink = useMutation({
    mutationFn: () => apiClient.post<{ url?: string; error?: string }>(`/calendar/events/${event.id}/guest-link`, {}),
    onSuccess: (r) => { if (r.url) navigator.clipboard?.writeText(r.url).then(() => { setGuestCopied(true); setTimeout(() => setGuestCopied(false), 2000); }).catch(() => {}); },
  });
  // Host removes ONE external guest from the live call. The server disconnects them; the room's
  // ParticipantDisconnected event drops their tile — no fake local hiding.
  const removeGuest = useMutation({
    mutationFn: (identity: string) => apiClient.post<{ removed?: boolean }>(`/calendar/events/${event.id}/remove-guest`, { identity }),
  });
  const revokeGuestLinks = useMutation({
    mutationFn: () => apiClient.post<{ ok?: boolean; error?: string }>(`/calendar/events/${event.id}/revoke-guest-links`, {}),
    onSuccess: () => { setGuestRevoked(true); setTimeout(() => setGuestRevoked(false), 2500); },
  });

  async function endForEveryone() {
    setEnding(true);
    try { await apiClient.post(`/calendar/events/${event.id}/end-call`, {}); } catch { /* fall through to leaving */ }
    try { await roomRef.current?.disconnect(); } catch { /* ignore */ }
    setEnding(false); setPhase("ended");
  }

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
        .on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: Participant) => {
          const cap = parseCaptionPacket(payload);
          if (cap) { setCaptions(cs => [...cs.filter(x => x.id !== cap.id), cap].slice(-60)); return; }
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload)) as { t?: string; text?: string; raised?: boolean };
            const from = participant?.name || participant?.identity || "Member";
            const pid = participant?.identity || "";
            if (msg.t === "chat" && msg.text) {
              setChat(c => [...c, { id: `${Date.now()}-${pid}`, from, text: String(msg.text).slice(0, 2000), mine: false }].slice(-200));
              setShowChat(open => { if (!open) setUnread(u => u + 1); return open; });
            } else if (msg.t === "hand" && pid) {
              setHands(s => { const n = new Set(s); msg.raised ? n.add(pid) : n.delete(pid); return n; });
            }
          } catch { /* ignore malformed */ }
        })
        .on(RoomEvent.ParticipantDisconnected, (p: Participant) => { setHands(s => { const n = new Set(s); n.delete(p.identity); return n; }); })
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
    if (!deviceId) return;
    try {
      await roomRef.current?.switchActiveDevice(kind, deviceId);
      if (kind === "audioinput") setSelAudio(deviceId); else setSelVideo(deviceId);
    } catch { /* ignore — device may be in use */ }
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
        <div className="relative flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="block truncate text-[14px] font-semibold text-white">{event.title}</span>
              {event.meeting_type && event.meeting_type !== "general" && (
                <span className="shrink-0 rounded-sm bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/80">{MEETING_TYPE_META[event.meeting_type].label}</span>
              )}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-white/50"><Users size={11} /> {everyone.length} {everyone.length === 1 ? "person" : "people"}</span>
          </div>
          <div className="flex items-center gap-2">
            {(phase === "connecting" || reconnecting) && <span className="flex items-center gap-2 text-[12px] text-white/70"><Loader2 size={13} className="animate-spin" /> {reconnecting ? t("cal.reconnecting") : t("cal.connecting")}</span>}
            <button onClick={copyLink} title="Copy invite link" className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-white/20">
              {copied ? <Check size={13} className="text-[#6fd08a]" /> : <Link2 size={13} />} {copied ? "Copied" : "Link"}
            </button>
            <button onClick={() => setShowInvite(s => !s)} title="Invite workspace members" className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-white/20">
              <UserPlus size={13} /> Invite
            </button>
          </div>
          {showInvite && (
            <InvitePanel members={membersQ.data?.members ?? []} loading={membersQ.isLoading}
              existing={new Set([event.organizer.user_id, ...event.attendees.map(a => a.user_id)])}
              selected={inviteSel} onToggle={id => setInviteSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })}
              onInvite={() => invite.mutate()} inviting={invite.isPending} onClose={() => setShowInvite(false)} onCopyLink={copyLink} copied={copied}
              isHost={isHost} onCopyGuestLink={() => guestLink.mutate()} guestCopied={guestCopied} guestPending={guestLink.isPending}
              onRevokeGuestLinks={() => revokeGuestLinks.mutate()} guestRevoked={guestRevoked} revokePending={revokeGuestLinks.isPending} />
          )}
          {/* Host-only waiting-room admit/deny — quiet (hidden when nobody is waiting). */}
          {isHost && <WaitingGuestsPanel eventId={event.id} />}
        </div>

        <div className="flex min-h-0 flex-1 gap-2 px-3 pb-2">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {(() => {
              if (!lk) return null;
              const tile = (p: Participant, isLocal: boolean) => {
                // Host-only Remove control, shown ONLY on external guest tiles (identity "guest_…").
                const isGuest = !isLocal && (p.identity || "").startsWith("guest_");
                const inner = (
                  <ParticipantTile key={p.sid || p.identity} p={p} source={lk.Track.Source.Camera}
                    isLocal={isLocal} speaking={speaking.has(p.identity)} youLabel={t("cal.you")}
                    handRaised={hands.has(p.identity)}
                    muted={isLocal ? !micOn : !!p.getTrackPublication(lk.Track.Source.Microphone)?.isMuted} />
                );
                if (!(isHost && isGuest)) return inner;
                return (
                  <div key={p.sid || p.identity} className="group/tile relative">
                    {inner}
                    <button
                      onClick={() => { if (window.confirm(`Remove ${p.name || "this guest"} from the call?`)) removeGuest.mutate(p.identity); }}
                      disabled={removeGuest.isPending}
                      title="Remove guest"
                      className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover/tile:opacity-100 hover:bg-[#d1524a] disabled:opacity-50">
                      <UserX size={11} /> Remove
                    </button>
                  </div>
                );
              };
              // Screen share OR speaker view → a big stage + a filmstrip of everyone else.
              const stageEntry = screenSharer
                ? undefined
                : (everyone.find(e => speaking.has(e.p.identity)) ?? everyone.find(e => !e.isLocal) ?? everyone[0]);
              if (screenSharer || (viewMode === "speaker" && everyone.length > 1)) {
                const others = everyone.filter(e => e.p.identity !== stageEntry?.p.identity);
                return (
                  <div className="flex h-full flex-col gap-2">
                    <div className="min-h-0 flex-1">
                      {screenSharer ? <ScreenTile p={screenSharer.p} source={lk.Track.Source.ScreenShare} /> : stageEntry && tile(stageEntry.p, stageEntry.isLocal)}
                    </div>
                    <div className="flex shrink-0 gap-2 overflow-x-auto pb-1">
                      {(screenSharer ? everyone : others).map(({ p, isLocal }) => <div key={p.sid || p.identity} className="w-40 shrink-0">{tile(p, isLocal)}</div>)}
                    </div>
                  </div>
                );
              }
              return <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{everyone.map(({ p, isLocal }) => tile(p, isLocal))}</div>;
            })()}
          </div>
          {showCaptions && <CaptionsPanel available={!!event.live_captions_available} captions={captions} onClose={() => setShowCaptions(false)} />}
          {showChat && <ChatPanel messages={chat} onSend={sendChat} onClose={() => setShowChat(false)} youLabel={t("cal.you")} />}
        </div>

        {/* Device pickers (optional, safe) */}
        {showDevices && (
          <div className="mx-auto mb-1 flex w-full max-w-md flex-col gap-2 px-4">
            {(["audio", "video"] as const).map(kind => {
              const list = kind === "audio" ? devices.audio : devices.video;
              return (
                <label key={kind} className="flex items-center gap-2 text-[11px] text-white/60">
                  <span className="w-20 shrink-0">{kind === "audio" ? t("cal.microphone") : t("cal.camera")}</span>
                  <FieldSelect value={kind === "audio" ? selAudio : selVideo} onChange={v => switchDevice(kind === "audio" ? "audioinput" : "videoinput", v)}
                    ariaLabel={kind === "audio" ? t("cal.microphone") : t("cal.camera")} placeholder={list.length ? "Default" : "No devices"}
                    className="min-w-0 flex-1"
                    options={list.map(d => ({ value: d.deviceId, label: d.label || `${kind === "audio" ? "Microphone" : "Camera"} ${d.deviceId.slice(0, 4)}` }))} />
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
          <ToolBtn on={!handRaised} neutral onClick={toggleHand} label={handRaised ? "Lower hand" : "Raise hand"} onIcon={<span className={`text-[17px] ${handRaised ? "" : "opacity-70"}`}>✋</span>} offIcon={<span className="text-[17px]">✋</span>} />
          <div className="relative">
            <ToolBtn on={!showChat} neutral onClick={() => { setShowChat(s => !s); setUnread(0); }} label="Chat" onIcon={<MessageSquare size={18} className="text-white" />} offIcon={<MessageSquare size={18} className="text-white" />} />
            {unread > 0 && !showChat && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#d1524a] px-1 text-[9px] font-bold text-white">{unread}</span>}
          </div>
          <ToolBtn on={!showCaptions} neutral onClick={() => setShowCaptions(s => !s)} label="Live captions" onIcon={<Captions size={18} className="text-white" />} offIcon={<Captions size={18} className="text-white" />} />
          <ToolBtn on neutral onClick={() => setViewMode(v => v === "grid" ? "speaker" : "grid")} label={viewMode === "grid" ? "Speaker view" : "Grid view"} onIcon={viewMode === "grid" ? <Maximize2 size={18} className="text-white" /> : <LayoutGrid size={18} className="text-white" />} offIcon={<LayoutGrid size={18} className="text-white" />} />
          {/* Leave = disconnect yourself (call keeps running). Host also gets End-for-everyone. */}
          <button onClick={leave} aria-label={t("cal.leave")} title={t("cal.leave")}
            className="flex h-11 items-center gap-2 rounded-full px-5" style={{ background: isHost ? "rgba(255,255,255,0.12)" : "#d1524a" }}>
            <PhoneOff size={18} className="text-white" /><span className="text-[13px] font-medium text-white">{t("cal.leave")}</span>
          </button>
          {isHost && (
            <button onClick={endForEveryone} disabled={ending} aria-label="End for everyone" title="End the call for everyone"
              className="flex h-11 items-center gap-2 rounded-full bg-[#d1524a] px-5 disabled:opacity-60">
              {ending ? <Loader2 size={18} className="animate-spin text-white" /> : <PhoneOff size={18} className="text-white" />}
              <span className="text-[13px] font-medium text-white">End for all</span>
            </button>
          )}
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

        <div className="relative mt-4">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}><Users size={12} /> {t("cal.attendees")} · {event.attendees.length + 1}</p>
            <div className="flex items-center gap-1.5">
              <button onClick={copyLink} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                {copied ? <Check size={12} className="text-[#2f9e6b]" /> : <Link2 size={12} />} {copied ? "Copied" : "Copy link"}
              </button>
              <button onClick={() => setShowInvite(s => !s)} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--section-accent-line)", color: "var(--text-primary)", background: "var(--section-accent-soft)" }}>
                <UserPlus size={12} /> Invite
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]" style={{ background: "var(--surface-selected)", color: "var(--text-primary)" }}><Avatar name={event.organizer.name} size={16} /> {event.organizer.name} · organizer</span>
            {event.attendees.map(a => <span key={a.user_id} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]" style={{ background: "var(--surface-hover)", color: "var(--text-secondary)" }}><Avatar name={a.name} size={16} /> {a.name}</span>)}
          </div>
          {showInvite && (
            <InvitePanel members={membersQ.data?.members ?? []} loading={membersQ.isLoading}
              existing={new Set([event.organizer.user_id, ...event.attendees.map(a => a.user_id)])}
              selected={inviteSel} onToggle={id => setInviteSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })}
              onInvite={() => invite.mutate()} inviting={invite.isPending} onClose={() => setShowInvite(false)} onCopyLink={copyLink} copied={copied}
              isHost={isHost} onCopyGuestLink={() => guestLink.mutate()} guestCopied={guestCopied} guestPending={guestLink.isPending}
              onRevokeGuestLinks={() => revokeGuestLinks.mutate()} guestRevoked={guestRevoked} revokePending={revokeGuestLinks.isPending} />
          )}
          {/* Host-only waiting-room admit/deny — quiet (hidden when nobody is waiting). */}
          {isHost && <WaitingGuestsPanel eventId={event.id} />}
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
              {phase === "error" && <p className="mt-2 text-center text-[12px]" style={{ color: "#d1524a" }}>{t("cal.connect_failed")}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ cancelled, enabled, readyLabel, offLabel, cancelledLabel }: { cancelled: boolean; enabled: boolean; readyLabel: string; offLabel: string; cancelledLabel: string }) {
  const [label, dot, color] = cancelled ? [cancelledLabel, "#d1524a", "#d1524a"] : !enabled ? [offLabel, "var(--text-faint)", "var(--text-muted)"] : [readyLabel, "#2f9e6b", "#2f9e6b"];
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

/**
 * Invite panel — add workspace members to this meeting (they become attendees, get notified with the
 * call link, and can then join). Also surfaces the shareable link. Anchored dropdown; works on light
 * (lobby) or dark (in-call) backgrounds via its own surface.
 */
function InvitePanel({ members, loading, existing, selected, onToggle, onInvite, inviting, onClose, onCopyLink, copied, isHost, onCopyGuestLink, guestCopied, guestPending, onRevokeGuestLinks, guestRevoked, revokePending }: {
  members: Member[]; loading: boolean; existing: Set<string>; selected: Set<string>;
  onToggle: (id: string) => void; onInvite: () => void; inviting: boolean; onClose: () => void; onCopyLink: () => void; copied: boolean;
  isHost?: boolean; onCopyGuestLink?: () => void; guestCopied?: boolean; guestPending?: boolean;
  onRevokeGuestLinks?: () => void; guestRevoked?: boolean; revokePending?: boolean;
}) {
  const [q, setQ] = useState("");
  const invitable = members.filter(m => !existing.has(m.id));
  const shown = invitable.filter(m => !q.trim() || `${m.name ?? ""} ${m.email}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="absolute right-3 top-14 z-30 w-72 overflow-hidden rounded-xl border shadow-2xl" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      <div className="flex items-center justify-between border-b px-3 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
        <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>Invite to this call</span>
        <button onClick={onClose} className="btn-icon h-6 w-6"><X size={13} /></button>
      </div>
      <button onClick={onCopyLink} className="flex w-full items-center gap-2 border-b px-3 py-2.5 text-left text-[12px] transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
        {copied ? <Check size={13} className="text-[#2f9e6b]" /> : <Link2 size={13} />} {copied ? "Link copied" : "Copy member link"}
      </button>
      {isHost && onCopyGuestLink && (
        <button onClick={onCopyGuestLink} disabled={guestPending} className="flex w-full items-center gap-2 border-b px-3 py-2.5 text-left text-[12px] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-60" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
        {guestPending ? <Loader2 size={13} className="animate-spin" /> : guestCopied ? <Check size={13} className="text-[#2f9e6b]" /> : <UserPlus size={13} />}
        <span className="flex-1">{guestCopied ? "Guest link copied" : "Copy guest link (external)"}</span>
        <span className="text-[9.5px]" style={{ color: "var(--text-faint)" }}>no account · 24h</span>
      </button>
      )}
      {isHost && onRevokeGuestLinks && (
        <button onClick={onRevokeGuestLinks} disabled={revokePending} className="flex w-full items-center gap-2 border-b px-3 py-2.5 text-left text-[12px] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-60" style={{ borderColor: "var(--border-soft)", color: guestRevoked ? "#2f9e6b" : "#d1524a" }}>
        {revokePending ? <Loader2 size={13} className="animate-spin" /> : guestRevoked ? <Check size={13} /> : <X size={13} />}
        <span className="flex-1">{guestRevoked ? "All guest links revoked" : "Revoke all guest links"}</span>
      </button>
      )}
      <div className="p-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search members…" className="key-input mb-1.5 h-8 w-full px-2.5 text-[12px]" />
        <div className="max-h-56 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-4"><Loader2 size={14} className="animate-spin" style={{ color: "var(--text-muted)" }} /></div>
          ) : shown.length === 0 ? (
            <p className="px-2 py-3 text-center text-[11.5px]" style={{ color: "var(--text-faint)" }}>{invitable.length === 0 ? "Everyone's already invited." : "No members match."}</p>
          ) : shown.map(m => {
            const on = selected.has(m.id);
            return (
              <button key={m.id} onClick={() => onToggle(m.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface-hover)]">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border" style={{ borderColor: on ? "var(--section-accent)" : "var(--border-soft)", background: on ? "var(--section-accent)" : "transparent" }}>{on && <Check size={11} className="text-white" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px]" style={{ color: "var(--text-primary)" }}>{m.name || m.email}</span>
                  {m.name && <span className="block truncate text-[10.5px]" style={{ color: "var(--text-faint)" }}>{m.email}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="border-t px-3 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
        <button onClick={onInvite} disabled={inviting || selected.size === 0}
          className="flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-[12px] font-semibold text-white transition-opacity disabled:opacity-50" style={{ background: "var(--section-accent)" }}>
          {inviting ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />} Invite {selected.size > 0 ? selected.size : ""}
        </button>
        <p className="mt-1.5 text-center text-[10px]" style={{ color: "var(--text-faint)" }}>Invited members get a notification and can join from Calendar.</p>
      </div>
    </div>
  );
}

/** In-call chat — rides the real-time data channel (ephemeral; not persisted). */
function ChatPanel({ messages, onSend, onClose, youLabel }: { messages: { id: string; from: string; text: string; mine: boolean }[]; onSend: (t: string) => void; onClose: () => void; youLabel: string }) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);
  return (
    <div className="flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border" style={{ borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" }}>
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-white"><MessageSquare size={13} /> Chat</span>
        <button onClick={onClose} className="text-white/50 hover:text-white"><X size={14} /></button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {messages.length === 0 ? (
          <p className="pt-4 text-center text-[11px] text-white/35">No messages yet. Say hello 👋</p>
        ) : messages.map(m => (
          <div key={m.id}>
            <span className="text-[10px] font-medium text-white/45">{m.mine ? youLabel : m.from}</span>
            <p className="whitespace-pre-wrap break-words text-[12.5px] text-white/90">{m.text}</p>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="flex items-center gap-1.5 border-t p-2" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && draft.trim()) { onSend(draft); setDraft(""); } }}
          placeholder="Message…" maxLength={2000}
          className="min-w-0 flex-1 rounded-lg bg-black/30 px-2.5 py-1.5 text-[12.5px] text-white placeholder-white/30 outline-none" />
        <button onClick={() => { if (draft.trim()) { onSend(draft); setDraft(""); } }} disabled={!draft.trim()} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg disabled:opacity-40" style={{ background: "var(--section-accent)" }}><Send size={14} className="text-white" /></button>
      </div>
    </div>
  );
}

