import { useEffect, useMemo, useRef, useState } from "react";
import type { Participant, Track as TrackNS } from "livekit-client";
import { Mic, MicOff, MonitorUp, Captions, Languages } from "lucide-react";
import type { CaptionPacket } from "@mondaily/shared/captions";
import { SUPPORTED_LANGUAGES } from "@mondaily/shared/i18n";

/**
 * Phase C.1 — per-viewer translation of the Transcript tab. `onTranslate` is supplied ONLY by the authenticated
 * member call room (never the guest page), so translation stays member-only. It sends the ALREADY-FETCHED
 * original lines to the sovereign gateway and returns per-line results; the original transcript is never
 * mutated and is always shown alongside. Returns results aligned to the input `items` by id.
 */
export type TranslateResult = { id: string; state: "translated" | "original" | "unavailable"; translated?: string };
export type TranslateFn = (items: { id: string; text: string; source_lang?: string }[], target: string) => Promise<TranslateResult[]>;

const clockOf = (ts: number): string => {
  if (!ts) return "";
  try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  catch { return ""; }
};

/**
 * Live captions panel — HONEST states only, NEVER fabricates captions, NEVER persists them.
 * Two views over the SAME ephemeral room-scoped packets:
 *   • "Live"       — the rolling caption experience (interim + final lines, newest at the bottom).
 *   • "Transcript" — Phase A: an accumulating, ordered timeline built from FINAL packets only
 *                    (speaker · clock time · original text · detected-language chip). Still ephemeral —
 *                    no persistence, no translation, no network. The saved transcript comes in Phase B.
 */
export function CaptionsPanel({ available, captions, onClose, onTranslate, preferenceKey }: { available: boolean; captions: CaptionPacket[]; onClose?: () => void; onTranslate?: TranslateFn; preferenceKey?: string }) {
  const [view, setView] = useState<"live" | "transcript">("live");
  // Phase C.4 — restore the viewer's LAST chosen caption language (per-viewer, client-side only). Validated
  // against the known languages so junk/removed codes fall back to "off" (Original). Default is always "off".
  const [target, setTargetState] = useState<string>(() => {
    try {
      const saved = preferenceKey ? localStorage.getItem(preferenceKey) : null;
      if (saved === "off" || (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved))) return saved;
    } catch { /* storage blocked → default */ }
    return "off";
  });
  // Persist on change (viewer-only; never leaves the browser, never touches transcript/STT/AI).
  const setTarget = (v: string) => { setTargetState(v); try { if (preferenceKey) localStorage.setItem(preferenceKey, v); } catch { /* ignore */ } };
  // Per-(line,target) translation state, keyed `${id}:${target}` so switching languages reuses prior results.
  const [tmap, setTmap] = useState<Map<string, TranslateResult>>(new Map());
  const endRef = useRef<HTMLDivElement>(null);
  // Transcript = FINAL packets only, de-duplicated by id, ordered oldest→newest by timestamp.
  const timeline = useMemo(() => [...new Map(captions.filter((c) => c.final).map((c) => [c.id, c])).values()].sort((a, b) => a.ts - b.ts), [captions]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [captions.length, view]);

  // Phase C.1/C.2 — debounced, batched translation of FINAL lines into the chosen target. Drives off
  // `timeline` (finals only) so it serves BOTH the Transcript and Live tabs from one cache (`tmap`) — the
  // active tab is irrelevant. Only lines whose source language differs from the target and that don't already
  // have a result are sent (req 13/15). The caption array is read-only here; results live in `tmap`, never
  // mutating the lines, and translation is always async so it can never block the live caption render.
  useEffect(() => {
    if (!onTranslate || target === "off") return;
    const pending = timeline.filter((c) => c.lang !== target && !tmap.has(`${c.id}:${target}`)).slice(0, 50);
    if (pending.length === 0) return;
    const timer = setTimeout(async () => {
      const items = pending.map((c) => ({ id: c.id, text: c.text, source_lang: c.lang }));
      let res: TranslateResult[] = [];
      try { res = await onTranslate(items, target); }
      catch { res = items.map((it) => ({ id: it.id, state: "unavailable" as const })); }
      setTmap((prev) => {
        const next = new Map(prev);
        for (const r of res) next.set(`${r.id}:${target}`, r);
        // any line we asked for but got no row back → unavailable (honest, never left spinning forever)
        for (const it of items) if (!next.has(`${it.id}:${target}`)) next.set(`${it.id}:${target}`, { id: it.id, state: "unavailable" });
        return next;
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [onTranslate, target, timeline, tmap]);

  const languages = SUPPORTED_LANGUAGES;
  const codeName = (code?: string) => languages.find((l) => l.code === code)?.name ?? (code ? code.toUpperCase() : "");

  // Shared per-line translation state for BOTH tabs. Only FINAL lines translate (interim captions change, so
  // they always render as the original); same-language lines never translate (req 15). `tr` is the cached
  // result from the debounced effect above — undefined while pending.
  const translationFor = (c: CaptionPacket) => {
    const translating = target !== "off" && !!onTranslate && !!c.final;
    const sameLang = !!c.lang && c.lang === target;
    const tr = translating && !sameLang ? tmap.get(`${c.id}:${target}`) : undefined;
    const showTranslated = tr?.state === "translated" && !!tr.translated;
    const pending = translating && !sameLang && !tr;
    return { tr, showTranslated, pending };
  };

  return (
    <div className="flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border" style={{ borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" }}>
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-white"><Captions size={13} /> Live captions</span>
        {onClose && <button onClick={onClose} className="text-white/50 hover:text-white text-[13px]">✕</button>}
      </div>
      {available && (
        <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <div className="flex gap-1">
            {(["live", "transcript"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className="rounded-md px-2 py-0.5 text-[11px] font-medium capitalize"
                style={{ background: view === v ? "rgba(255,255,255,0.12)" : "transparent", color: view === v ? "#fff" : "rgba(255,255,255,0.5)" }}>{v}</button>
            ))}
          </div>
          {/* Translation selector — member-only (onTranslate present); affects BOTH the Live and Transcript tabs. */}
          {onTranslate && (
            <label className="flex items-center gap-1 text-[10px] text-white/50" title="Translate captions for you only">
              <Languages size={11} />
              <select value={target} onChange={(e) => setTarget(e.target.value)}
                className="rounded-md bg-white/10 px-1 py-0.5 text-[10px] text-white outline-none" style={{ maxWidth: 96 }}>
                <option value="off" className="text-black">Original</option>
                {languages.map((l) => <option key={l.code} value={l.code} className="text-black">{l.name}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {!available ? (
          <div className="py-6 text-center">
            <p className="text-[12px] font-medium text-white/70">Live captions unavailable</p>
            <p className="mt-1 text-[11px] text-white/40">Live captions need a streaming speech service, which isn’t enabled yet. The full transcript is available after the call.</p>
          </div>
        ) : view === "live" ? (
          captions.length === 0 ? (
            <p className="pt-6 text-center text-[11px] text-white/40">Waiting for speech…</p>
          ) : captions.map((c) => {
            // Phase C.2 — the ORIGINAL caption always renders immediately (interim italic/dim, final solid);
            // a translation, when ready, is layered on top with the original kept beneath. Interim lines never
            // translate, so live captions are never blocked or delayed by translation.
            const { tr, showTranslated, pending } = translationFor(c);
            return (
              <div key={c.id}>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium text-white/45">{c.name}</span>
                  {c.lang ? <span className="rounded-sm bg-white/10 px-1 text-[8px] uppercase tracking-wide text-white/50">{c.lang}</span> : null}
                  {showTranslated ? <span className="rounded-sm bg-emerald-400/15 px-1 text-[8px] uppercase tracking-wide text-emerald-300/80">→ {target}</span> : null}
                </div>
                {showTranslated ? (
                  <>
                    <p className="text-[12.5px] leading-snug text-white/90">{tr!.translated}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-white/40">{c.text}<span className="ml-1 text-[9px] text-white/30">· original{c.lang ? ` (${codeName(c.lang)})` : ""}</span></p>
                  </>
                ) : (
                  <>
                    <p className="text-[12.5px] leading-snug text-white/90" style={{ opacity: c.final ? 1 : 0.6, fontStyle: c.final ? "normal" : "italic" }}>{c.text}</p>
                    {pending ? <p className="mt-0.5 text-[10px] italic text-white/35">translating…</p>
                      : tr?.state === "unavailable" ? <p className="mt-0.5 text-[10px] text-white/35">translation unavailable — showing original</p>
                      : null}
                  </>
                )}
              </div>
            );
          })
        ) : timeline.length === 0 ? (
          <p className="pt-6 text-center text-[11px] text-white/40">Transcript appears here as people speak.</p>
        ) : timeline.map((c) => {
          const { tr, showTranslated, pending } = translationFor(c);
          return (
            <div key={c.id}>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium text-white/45">{c.name}</span>
                {c.ts ? <span className="text-[9px] tabular-nums text-white/30">{clockOf(c.ts)}</span> : null}
                {c.lang ? <span className="rounded-sm bg-white/10 px-1 text-[8px] uppercase tracking-wide text-white/50">{c.lang}</span> : null}
                {showTranslated ? <span className="rounded-sm bg-emerald-400/15 px-1 text-[8px] uppercase tracking-wide text-emerald-300/80">→ {target}</span> : null}
              </div>
              {showTranslated ? (
                <>
                  <p className="text-[12.5px] leading-snug text-white/90">{tr!.translated}</p>
                  {/* Original is always kept and visible beneath the translation (never overwritten). */}
                  <p className="mt-0.5 text-[11px] leading-snug text-white/40">{c.text}<span className="ml-1 text-[9px] text-white/30">· original{c.lang ? ` (${codeName(c.lang)})` : ""}</span></p>
                </>
              ) : (
                <>
                  <p className="text-[12.5px] leading-snug text-white/90">{c.text}</p>
                  {pending ? <p className="mt-0.5 text-[10px] italic text-white/35">translating…</p>
                    : tr?.state === "unavailable" ? <p className="mt-0.5 text-[10px] text-white/35">translation unavailable — showing original</p>
                    : null}
                </>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {available && (
        <div className="border-t px-3 py-1.5 text-[10px] leading-snug text-white/40" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          Transcribes only your microphone while captions are on. Not saved.{onTranslate && target !== "off" ? " Translation is for you only." : ""}
        </div>
      )}
    </div>
  );
}

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

  // Deps matter here: call-room bumps state on EVERY LiveKit event (mute, subscribe,
  // participant join…). With no dependency array this effect detached and re-attached every
  // video element on every one of those events — visible flicker/black frames mid-call.
  // Re-attach only when the actual track or its muted state changes.
  const pubForDeps = p.getTrackPublication(source);
  const trackSid = pubForDeps?.trackSid;
  const trackMuted = pubForDeps?.isMuted;
  useEffect(() => {
    const pub = p.getTrackPublication(source);
    const track = pub?.track;
    const live = !!track && !pub?.isMuted;
    if (live && ref.current) { track!.attach(ref.current); setHasVideo(true); }
    else { setHasVideo(false); }
    return () => { try { if (track && ref.current) track.detach(ref.current); } catch { /* ignore */ } };
  }, [p, source, trackSid, trackMuted]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg" style={{ background: "#17171b", outline: speaking ? "2px solid var(--section-accent)" : "1px solid rgba(255,255,255,0.06)", outlineOffset: -1 }}>
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
  const screenSid = p.getTrackPublication(source)?.trackSid;
  useEffect(() => {
    const track = p.getTrackPublication(source)?.track;
    if (track && ref.current) track.attach(ref.current);
    return () => { try { if (track && ref.current) track.detach(ref.current); } catch { /* ignore */ } };
  }, [p, source, screenSid]);
  return (
    <div className="relative overflow-hidden rounded-lg bg-black" style={{ aspectRatio: "16 / 9" }}>
      <video ref={ref} autoPlay playsInline className="h-full w-full object-contain" />
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/50 px-2 py-1 text-[11px] font-medium text-white"><MonitorUp size={11} /> {p.name || p.identity}</div>
    </div>
  );
}
