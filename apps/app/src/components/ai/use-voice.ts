import { useCallback, useRef, useState } from "react";

/**
 * Browser speech-to-text dictation for the chat inputs (Web Speech API —
 * SpeechRecognition). No backend, no dependency. onText receives the live
 * transcript (interim + final) so the input fills as the user speaks.
 */
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

/** `onText` is a React state setter, so dictation can read the text already in the box
 *  (via the updater form) and APPEND to it. It used to overwrite the whole input, which
 *  silently destroyed whatever the user had typed before hitting the mic. */
export function useVoiceDictation(onText: (value: string | ((prev: string) => string)) => void) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const w = typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : undefined;
  const Ctor = (w?.SpeechRecognition ?? w?.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | undefined;
  const supported = !!Ctor;

  const toggle = useCallback(() => {
    if (!Ctor) return;
    if (recRef.current) { recRef.current.stop(); return; }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    // Snapshot whatever is already typed, so the transcript is appended to it rather
    // than replacing it. Read via the updater form without mutating the value.
    let base = "";
    onText(prev => { base = prev; return prev; });
    const prefix = base.trim() ? `${base.trimEnd()} ` : "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res) continue;
        const t = res[0]?.transcript ?? "";
        if (res.isFinal) finalText += t; else interim += t;
      }
      onText(prefix + (finalText + interim).trim());
    };
    rec.onend = () => { setListening(false); recRef.current = null; };
    rec.onerror = () => { setListening(false); recRef.current = null; };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }, [Ctor, onText]);

  return { listening, supported, toggle };
}
