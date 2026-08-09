import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { subscribeAlerts, dismissAlert, type AppAlert } from "../../lib/alerts";

/**
 * Renders the app's own alerts — what just happened to the thing you clicked.
 *
 * Distinct from ToastHost, which renders SERVER notifications ("an agent finished"). This one
 * exists because 38 of 49 settings mutations failed with no visible consequence at all: the save
 * appeared to work, and did not.
 *
 * Bottom-left on purpose. ToastHost owns the bottom-right, and two surfaces stacking in the same
 * corner would cover each other at exactly the moment both have something to say.
 */

const TONE: Record<AppAlert["tone"], { border: string; dot: string }> = {
  error: { border: "var(--status-error)", dot: "var(--status-error)" },
  ok:    { border: "var(--border-soft)",  dot: "var(--status-ok)" },
  info:  { border: "var(--border-soft)",  dot: "var(--text-faint)" },
};

export function AlertHost() {
  const [alerts, setAlerts] = useState<AppAlert[]>([]);
  useEffect(() => subscribeAlerts(setAlerts), []);

  if (alerts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[120] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
      <AnimatePresence initial={false}>
        {alerts.map(a => {
          const tone = TONE[a.tone];
          return (
            <motion.div
              key={a.id} layout
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              role={a.tone === "error" ? "alert" : "status"}
              className="pointer-events-auto flex items-start gap-2.5 rounded-sm px-3 py-2.5"
              style={{ background: "var(--surface-card)", border: `1px solid ${tone.border}` }}
            >
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone.dot }} />
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium" style={{ color: "var(--text-primary)" }}>{a.text}</p>
                {a.detail && (
                  // The server's own words, wrapped rather than truncated — a half-shown reason is
                  // the same as no reason.
                  <p className="mt-0.5 break-words text-caption" style={{ color: "var(--text-muted)" }}>{a.detail}</p>
                )}
              </div>
              <button onClick={() => dismissAlert(a.id)} aria-label="Dismiss"
                className="shrink-0 transition-opacity hover:opacity-70" style={{ color: "var(--text-faint)" }}>
                <X size={13} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
