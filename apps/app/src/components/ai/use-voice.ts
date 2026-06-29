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

export function useVoiceDictation(onText: (text: string) => void) {
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
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res) continue;
        const t = res[0]?.transcript ?? "";
        if (res.isFinal) finalText += t; else interim += t;
      }
      onText((finalText + interim).trim());
    };
    rec.onend = () => { setListening(false); recRef.current = null; };
    rec.onerror = () => { setListening(false); recRef.current = null; };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }, [Ctor, onText]);

  return { listening, supported, toggle };
}
