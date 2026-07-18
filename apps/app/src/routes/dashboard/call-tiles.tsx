import { useEffect, useRef, useState } from "react";
import type { Participant, Track as TrackNS } from "livekit-client";
import { Mic, MicOff, MonitorUp } from "lucide-react";

/**
 * Shared, presentational call-UI primitives used by BOTH the in-app call room (call-room.tsx) and the
 * lightweight guest join page (guest-call.tsx). Extracted here so guest-call no longer has to statically
 * import call-room — that static edge was forcing call-room into guest-call's chunk and defeating its
 * lazy() split in App.tsx. These pieces are pure UI: React + lucide + livekit *type-only* imports, no
 * network, no side effects beyond attaching a LiveKit track to a <video> element the caller owns.
 */

// Initials for an avatar placeholder — deterministic, no dependencies.
export function initialsOf(name: string): string {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// A round call-control toggle button (mic/cam/share). Icons are passed in by the caller.
export function ToolBtn({ on, neutral, onClick, label, onIcon, offIcon }: { on: boolean; neutral?: boolean; onClick: () => void; label: string; onIcon: React.ReactNode; offIcon: React.ReactNode }) {
  const bg = neutral ? "rgba(255,255,255,0.12)" : on ? "rgba(255,255,255,0.12)" : "#d1524a";
  return <button onClick={onClick} aria-label={label} title={label} className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: bg }}>{on ? onIcon : offIcon}</button>;
}

/** One participant camera tile: live video when available, initials placeholder otherwise. */
export function ParticipantTile({ p, source, isLocal, speaking, youLabel, muted, handRaised }: { p: Participant; source: TrackNS.Source; isLocal: boolean; speaking: boolean; youLabel: string; muted: boolean; handRaised?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const name = p.name || p.identity || "Member";
  const isGuest = (p.identity || "").startsWith("guest_");

  useEffect(() => {
    const pub = p.getTrackPublication(source);
    const track = pub?.track;
    const live = !!track && !pub?.isMuted;
    if (live && ref.current) { track!.attach(ref.current); setHasVideo(true); }
    else { setHasVideo(false); }
    return () => { try { if (track && ref.current) track.detach(ref.current); } catch { /* ignore */ } };
  });

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl" style={{ background: "#17171b", outline: speaking ? "2px solid var(--section-accent)" : "1px solid rgba(255,255,255,0.06)", outlineOffset: -1 }}>
      <video ref={ref} autoPlay playsInline muted={isLocal} className="h-full w-full object-cover" style={{ display: hasVideo ? "block" : "none" }} />
      {!hasVideo && (
        <div className="flex h-full w-full items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full text-[18px] font-semibold text-white" style={{ background: "var(--section-accent)" }}>{initialsOf(name)}</span>
        </div>
      )}
      {handRaised && (
        <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#c6892e] text-[13px] shadow" title="Hand raised">✋</div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/50 px-2 py-1 text-[11px] font-medium text-white">
        {muted ? <MicOff size={11} className="text-white/70" /> : <Mic size={11} className="text-white/70" />}
        <span className="max-w-[140px] truncate">{name}</span>
        {isLocal && <span className="rounded-sm bg-white/20 px-1 text-[9px] uppercase tracking-wide">{youLabel}</span>}
        {isGuest && <span className="rounded-sm bg-[#c6892e]/30 px-1 text-[9px] uppercase tracking-wide text-[#e6be7e]">guest</span>}
      </div>
    </div>
  );
}

/** Prominent stage for an active screen share. */
export function ScreenTile({ p, source }: { p: Participant; source: TrackNS.Source }) {
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
