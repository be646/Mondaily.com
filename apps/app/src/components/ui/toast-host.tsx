import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Bell, X } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { resolveNotificationLink } from "../../lib/notification-link";

interface Notif {
  id: string; title: string; body?: string; type?: string;
  task_id?: string | null; metadata?: Record<string, unknown> | null;
  is_read: boolean; created_at: string;
}

/**
 * Change toasts — a sovereign, in-house pop-up surface (no toast library).
 * Watches the shared ["notifications"] query (same data the bell uses) and slides
 * in a toast for any genuinely NEW notification. Clicking it deep-links to the exact
 * record/decision via resolveNotificationLink. Primes silently on first load so the
 * existing backlog never floods the screen.
 */
export function ToastHost() {
  const navigate = useNavigate();
  const seen = useRef<Set<string> | null>(null);
  const [toasts, setToasts] = useState<Notif[]>([]);

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiClient.get<Notif[]>("/notifications"),
    refetchInterval: 20_000,
  });

  useEffect(() => {
    if (!data) return;
    if (seen.current === null) { seen.current = new Set(data.map(n => n.id)); return; } // prime, don't toast backlog
    const fresh = data.filter(n => !seen.current!.has(n.id));
    if (fresh.length === 0) return;
    fresh.forEach(n => seen.current!.add(n.id));
    setToasts(prev => [...fresh.slice(0, 3), ...prev].slice(0, 4));
  }, [data]);

  const dismiss = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map(t => window.setTimeout(() => dismiss(t.id), 6500));
    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map(t => (
          <motion.div key={t.id} layout role="button" tabIndex={0}
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.96 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            onClick={() => { navigate(resolveNotificationLink(t)); dismiss(t.id); }}
            className="pointer-events-auto flex cursor-pointer items-start gap-3 rounded-sm border p-3 text-left shadow-lg"
            style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)" }}>
              <Bell size={14} style={{ color: "var(--accent)" }} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{t.title}</div>
              {t.body && <div className="mt-0.5 line-clamp-2 text-[12px]" style={{ color: "var(--text-muted)" }}>{t.body}</div>}
            </div>
            <button onClick={(e) => { e.stopPropagation(); dismiss(t.id); }} className="shrink-0 rounded p-0.5 transition-colors" style={{ color: "var(--text-faint)" }} aria-label="Dismiss">
              <X size={13} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
