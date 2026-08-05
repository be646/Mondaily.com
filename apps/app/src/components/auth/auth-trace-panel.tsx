import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { TraceLine, TraceLevel } from "../../lib/auth-trace";
import { SAGE } from "./auth-shell";

/**
 * The live console beside the sign-in card.
 *
 * Deliberately quiet: hairlines, one accent, no scanlines or fake glitch. The content is the
 * spectacle — real attempt counts, real digests, real latencies — and dressing it up as a movie
 * terminal would undercut the one thing that makes it worth showing, which is that it is true.
 *
 * Hidden entirely until the first real event. An empty console framed as "waiting" is a promise the
 * page has not yet earned, and on a fresh load there is genuinely nothing happening.
 */

// Tokens, not hexes. The values are identical today, but a literal amber is invisible to a theme
// change and to the ratchet that keeps this app down to one palette. (Naming the hex here, even in
// a comment, still trips that ratchet — which is correct: it cannot tell a comment from a value.)
const TONE: Record<TraceLevel, string> = {
  run: "var(--status-warn)",
  ok: SAGE,
  warn: "var(--status-warn)",
  fail: "var(--status-error)",
  note: "var(--text-faint)",
};

const GLYPH: Record<TraceLevel, string> = {
  run: "▍", ok: "✓", warn: "!", fail: "✕", note: "·",
};

export function AuthTracePanel({ lines }: { lines: TraceLine[] }) {
  const scroller = useRef<HTMLDivElement>(null);

  // Follow the tail. Without this the newest line — the one the user is waiting on — sits below the
  // fold at exactly the moment it matters.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (lines.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, ease: "easeOut" }}
      className="w-full max-w-[400px] overflow-hidden rounded-sm border border-[var(--border-soft)] bg-zinc-900/40 lg:w-[380px]"
      aria-label="Authentication activity"
    >
      <div className="flex items-center gap-1.5 border-b border-[var(--border-soft)] px-4 py-3">
        <span className="h-2 w-2 rounded-full" style={{ background: SAGE, boxShadow: `0 0 8px ${SAGE}` }} />
        <span className="text-caption uppercase tracking-[0.2em] text-[var(--text-muted)]">Live process</span>
        <span className="ml-auto text-caption tabular-nums text-[var(--text-faint)]">{lines.length} step{lines.length === 1 ? "" : "s"}</span>
      </div>

      <div ref={scroller} className="max-h-[300px] overflow-y-auto px-4 py-3 font-mono text-label leading-[1.75]">
        <AnimatePresence initial={false}>
          {lines.map(l => (
            <motion.div key={l.id} layout initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
              className="flex gap-2">
              {/* Measured elapsed time — the number that proves this is not on a timer. */}
              <span className="shrink-0 tabular-nums text-[var(--text-faint)]">{String(l.at).padStart(4, " ")}ms</span>
              <span className="shrink-0" style={{ color: TONE[l.level] }}>
                {l.level === "run" ? <span className="animate-pulse">{GLYPH.run}</span> : GLYPH[l.level]}
              </span>
              <span className="min-w-0">
                <span style={{ color: l.level === "note" ? "var(--text-faint)" : "var(--text-secondary)" }}>{l.text}</span>
                {l.detail && <span className="ml-1.5 break-all" style={{ color: TONE[l.level] }}>{l.detail}</span>}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
