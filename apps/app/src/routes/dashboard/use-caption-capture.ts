import { useEffect, useRef } from "react";

/**
 * Live Captions Phase 2 — LOCAL-MIC capture hook (sovereign, opt-in, ephemeral).
 *
 * Captures ONLY the local participant's microphone (never mixed room audio, never remote speakers),
 * converts to PCM s16le mono 16 kHz in ~2.5 s chunks, and hands each chunk to `sendChunk` (the caller
 * wires this to the authenticated member endpoint or the public guest endpoint — the server proxies to
 * the sovereign STT appliance and adds the bearer key; the browser never sees the key or appliance URL).
 * On a non-empty transcript the caller publishes a CaptionPacket over the LiveKit data channel via
 * `onCaption`. Nothing is persisted; there is NO browser Web Speech API and NO third-party STT.
 *
 * Fail-closed + quiet: silence is skipped client-side (RMS gate) and never published; transient errors
 * (5xx/network) back off exponentially; an auth failure (401/403) stops capture honestly via `onStop`.
 * Teardown (CC off, mic off, leave, disconnect, unmount) closes the AudioContext, disconnects nodes, and
 * aborts any in-flight request.
 */

const TARGET_SR = 16000;
const CHUNK_SECONDS = 2.5;
const PEAK_SILENCE = 0.006;    // peak amplitude below this = silence/ambient — not sent (appliance VAD is the final arbiter)
const BACKOFF_BASE_MS = 3000;
const BACKOFF_MAX_MS = 30000;

export interface CaptionSendResult {
  ok: boolean;
  status: number;
  text: string;
  noSpeech: boolean;
  language: string | null;
}

interface Opts {
  /** true only when: captions available + CC toggled on + mic on + connected (+ guest: consent given). */
  active: boolean;
  /** Returns the local mic MediaStreamTrack, or null if not yet published. */
  getMicTrack: () => MediaStreamTrack | null;
  /** POST one PCM chunk to the correct endpoint; resolve the mapped result (never throws for the hook).
   *  `signal` aborts the request on teardown — the caller must forward it to fetch/apiFetch. */
  sendChunk: (pcm: Blob, seq: number, signal: AbortSignal) => Promise<CaptionSendResult>;
  /** Publish a caption for non-empty transcript text (caller builds + broadcasts the CaptionPacket). */
  onCaption: (text: string, language: string | null, seq: number) => void;
  /** Called when captions must stop for a non-transient reason (e.g. auth) so the caller can flip CC off. */
  onStop?: (reason: "auth") => void;
}

const WORKLET_SRC = `
class PCMCollector extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('pcm-collector', PCMCollector);
`;

function floatTo16kPCM(frames: Float32Array[], srcRate: number): { buf: ArrayBuffer; peak: number } {
  let total = 0;
  for (const f of frames) total += f.length;
  const merged = new Float32Array(total);
  let o = 0;
  for (const f of frames) { merged.set(f, o); o += f.length; }
  // Nearest-sample downsample to 16 kHz (cheap + fine for speech).
  const ratio = srcRate / TARGET_SR;
  const outLen = Math.max(1, Math.floor(merged.length / ratio));
  const out = new Int16Array(outLen);
  let peak = 0;
  for (let i = 0; i < outLen; i++) {
    const s = merged[Math.floor(i * ratio)] || 0;
    const c = s < -1 ? -1 : s > 1 ? 1 : s;
    const a = c < 0 ? -c : c;
    if (a > peak) peak = a;
    out[i] = c < 0 ? c * 0x8000 : c * 0x7fff;
  }
  // PEAK, not mean-RMS: real speech has pauses, so a full-chunk *mean* RMS sits far below the peak and
  // was misclassifying normal speech as silence (captions never fired). Peak cleanly separates voiced
  // speech (peaks well above the floor) from true silence/ambient; the appliance VAD is the final arbiter.
  return { buf: out.buffer, peak };
}

export function useCaptionCapture(opts: Opts): void {
  // Keep the latest callbacks without re-running the capture effect every render.
  const ref = useRef(opts);
  ref.current = opts;

  useEffect(() => {
    if (!opts.active) return;
    let cancelled = false;
    let ctx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let node: AudioWorkletNode | ScriptProcessorNode | null = null;
    let mute: GainNode | null = null;                       // silent sink so the processor is pulled, no echo
    let inflight: AbortController | null = null;            // aborts the current chunk request on teardown
    let flushTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let frames: Float32Array[] = [];
    let frameSamples = 0;
    let seq = 0;
    let backoffUntil = 0;
    let backoffMs = BACKOFF_BASE_MS;
    let sending = false;

    const collect = (data: Float32Array) => { frames.push(data); frameSamples += data.length; };

    async function flush() {
      if (cancelled || sending) return;
      if (Date.now() < backoffUntil) { frames = []; frameSamples = 0; return; }
      if (!ctx || frameSamples === 0) return;
      const srcRate = ctx.sampleRate;
      const batch = frames; frames = []; frameSamples = 0;
      const { buf, peak } = floatTo16kPCM(batch, srcRate);
      if (peak < PEAK_SILENCE) return;                     // client-side silence gate (peak) — send nothing
      sending = true;
      const mySeq = ++seq;
      inflight = new AbortController();
      try {
        const res = await ref.current.sendChunk(new Blob([buf]), mySeq, inflight.signal);
        if (cancelled) return;
        if (res.ok) {
          backoffMs = BACKOFF_BASE_MS; backoffUntil = 0;
          if (res.text && !res.noSpeech) ref.current.onCaption(res.text, res.language, mySeq);
        } else if (res.status === 401 || res.status === 403) {
          ref.current.onStop?.("auth");                    // honest stop — captions off
          cancelled = true;
        } else {
          backoffUntil = Date.now() + backoffMs;           // 5xx/network → quiet exponential backoff
          backoffMs = Math.min(BACKOFF_MAX_MS, backoffMs * 2);
        }
      } catch {
        backoffUntil = Date.now() + backoffMs;
        backoffMs = Math.min(BACKOFF_MAX_MS, backoffMs * 2);
      } finally {
        sending = false;
      }
    }

    async function start() {
      const track = ref.current.getMicTrack();
      if (!track) { retryTimer = setTimeout(start, 500); return; }   // mic not published yet — retry
      try {
        ctx = new AudioContext();
        source = ctx.createMediaStreamSource(new MediaStream([track]));
        // A muted (gain 0) sink to the destination. Both processors must be connected THROUGH to the
        // graph's destination or some browsers (e.g. Safari) won't pull them — capturing silence. The
        // processors emit no audio of their own, and gain 0 guarantees ZERO mic echo regardless.
        mute = ctx.createGain();
        mute.gain.value = 0;
        mute.connect(ctx.destination);
        if (ctx.audioWorklet) {
          const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
          try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
          if (cancelled) return;
          const wl = new AudioWorkletNode(ctx, "pcm-collector");
          wl.port.onmessage = (e) => collect(e.data as Float32Array);
          source.connect(wl);
          wl.connect(mute);            // pull the worklet via the muted sink (no echo)
          node = wl;
        } else {
          // Fallback for browsers without AudioWorklet — ScriptProcessor on the main thread.
          const sp = ctx.createScriptProcessor(4096, 1, 1);
          sp.onaudioprocess = (e) => collect(new Float32Array(e.inputBuffer.getChannelData(0)));
          source.connect(sp);
          sp.connect(mute);            // pump ScriptProcessor via the muted sink (no echo)
          node = sp;
        }
        flushTimer = setInterval(() => { void flush(); }, CHUNK_SECONDS * 1000);
      } catch {
        // Audio capture unavailable (permissions/hardware) — fail silent, no captions, no fake text.
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (flushTimer) clearInterval(flushTimer);
      if (retryTimer) clearTimeout(retryTimer);
      try { inflight?.abort(); } catch { /* ignore */ }
      try { node?.disconnect(); } catch { /* ignore */ }
      try { source?.disconnect(); } catch { /* ignore */ }
      try { mute?.disconnect(); } catch { /* ignore */ }
      try { void ctx?.close(); } catch { /* ignore */ }
      frames = [];
    };
    // Re-run only when active flips — callbacks are read live via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.active]);
}
