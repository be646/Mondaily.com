import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { TraceLine, TraceLevel } from "../../lib/auth-trace";
import { SAGE } from "./auth-shell";

/**
 * The live console beside the sign-in card — a bare terminal, not a panel.
 *
 * NO FRAME ON PURPOSE. A card with a border and a titled header reads as another piece of product
 * UI, which invites the reader to skim it like a widget. Stripped to raw monospace on the canvas it
 * reads as output: something the machine is printing, not something a designer arranged. That is
 * the correct impression, because every line is genuinely printed as it happens.
 *
 * The content stays the spectacle — real attempt counts, real digests, real latencies. No scanlines,
 * no fake glitch, no green-on-black nostalgia: dressing it up would undercut the one thing that
 * makes it worth showing, which is that it is true.
 *
 * Hidden entirely until the first real event, since on a fresh load nothing is happening yet.
 */

const TONE: Record<TraceLevel, string> = {
  run: "var(--status-warn)",
  ok: SAGE,
  warn: "var(--status-warn)",
  fail: "var(--status-error)",
  note: "var(--text-faint)",
};

const GLYPH: Record<TraceLevel, string> = {
  run: "›", ok: "✓", warn: "!", fail: "✕", note: "·",
};

export function AuthTracePanel({ lines }: { lines: TraceLine[] }) {
  const scroller = useRef<HTMLDivElement>(null);

  // Follow the tail. Without this the newest line — the one being waited on — sits below the fold
  // at exactly the moment it matters.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (lines.length === 0) return null;

  const busy = lines[lines.length - 1]?.level === "run";

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}
      className="w-full max-w-[400px] font-mono lg:w-[400px] lg:pt-1"
      aria-label="Authentication activity"
    >
      {/* A command line, not a title bar — the frame's job done by one line of text. */}
      <div className="flex items-baseline gap-2 text-caption tracking-wide">
        <span style={{ color: SAGE }}>$</span>
        <span className="text-[var(--text-muted)]">mondaily auth --live</span>
      </div>

      <div ref={scroller} className="mt-2 max-h-[320px] overflow-y-auto text-label leading-[1.8]">
        <AnimatePresence initial={false}>
          {lines.map(l => (
            <motion.div key={l.id} layout initial={{ opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}
              className="flex gap-2">
              {/* Measured elapsed time — the number that proves this is not on a timer. */}
              <span className="shrink-0 tabular-nums text-[var(--text-faint)]">{String(l.at).padStart(5, " ")}ms</span>
              <span className="shrink-0" style={{ color: TONE[l.level] }}>{GLYPH[l.level]}</span>
              <span className="min-w-0">
                <span style={{ color: l.level === "note" ? "var(--text-faint)" : "var(--text-secondary)" }}>{l.text}</span>
                {l.detail && <span className="ml-1.5 break-all" style={{ color: TONE[l.level] }}>{l.detail}</span>}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* The cursor sits on its own line and only while something is genuinely in flight, so a
            finished run ends quietly instead of blinking as though it were still working. */}
        {busy && (
          <div className="flex gap-2">
            <span className="shrink-0 tabular-nums opacity-0">{"".padStart(5, " ")}ms</span>
            <span className="animate-pulse" style={{ color: SAGE }}>▍</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
