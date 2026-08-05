import { useCallback, useRef, useState } from "react";

/**
 * THE BACKSTAGE TRACE — what the platform is actually doing while you sign in.
 *
 * Every line here is a real event with a real measurement: a challenge that was really fetched, a
 * nonce really brute-forced (with the true attempt count and elapsed milliseconds), a request that
 * really round-tripped, a session cookie that really came back. Nothing is scripted, nothing is on
 * a timer, and no line is emitted for work that did not happen.
 *
 * That constraint is the whole point. A fake build log is a screensaver, and anyone technical
 * enough to be impressed by it is technical enough to notice the numbers never change. A real one
 * is a claim about the product — sovereign auth, our own proof-of-work, no third parties — that the
 * user can verify while they watch. If a step is skipped because the deployment lacks it, the line
 * is absent rather than invented.
 */

export type TraceLevel = "run" | "ok" | "warn" | "fail" | "note";

export interface TraceLine {
  id: number;
  /** Milliseconds since the trace opened — measured, never simulated. */
  at: number;
  level: TraceLevel;
  text: string;
  /** Optional measured value: attempt counts, digests, latencies. */
  detail?: string;
}

export interface AuthTrace {
  lines: TraceLine[];
  emit: (level: TraceLevel, text: string, detail?: string) => void;
  /** Mark the most recent "run" line as finished, carrying its measured duration. */
  settle: (level: Exclude<TraceLevel, "run">, text: string, detail?: string) => void;
  reset: () => void;
}

export function useAuthTrace(): AuthTrace {
  const [lines, setLines] = useState<TraceLine[]>([]);
  const started = useRef<number>(0);
  const seq = useRef(0);

  const emit = useCallback((level: TraceLevel, text: string, detail?: string) => {
    // The clock starts at the FIRST line rather than at mount, so a form sitting untouched for two
    // minutes does not open its log with "at 121400ms".
    if (!started.current) started.current = performance.now();
    // STAMPED HERE, NOT INSIDE THE UPDATER. React invokes a state updater whenever it next flushes,
    // which during an 8-second proof-of-work is long after the event: reading the clock in there
    // dated the "challenge issued" line 8930ms when it really happened at ~200ms, and every line
    // emitted during the solve collapsed onto the same timestamp. A console whose whole claim is
    // that its numbers are measured cannot afford to measure the wrong moment.
    const at = Math.round(performance.now() - started.current);
    setLines(prev => [...prev, { id: seq.current++, at, level, text, detail }]);
  }, []);

  // Replaces the trailing in-flight line instead of appending, so a step reads as one entry that
  // resolves rather than two that look like separate work.
  const settle = useCallback((level: Exclude<TraceLevel, "run">, text: string, detail?: string) => {
    // Same reason as above: the completion time is now, not whenever React gets round to it.
    const at = Math.round(performance.now() - (started.current || performance.now()));
    setLines(prev => {
      const last = prev[prev.length - 1];
      const line = { id: last?.level === "run" ? last.id : seq.current++, at, level, text, detail };
      return last?.level === "run" ? [...prev.slice(0, -1), line] : [...prev, line];
    });
  }, []);

  const reset = useCallback(() => { started.current = 0; seq.current = 0; setLines([]); }, []);

  return { lines, emit, settle, reset };
}
