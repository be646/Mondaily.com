import { Link, useLocation } from "react-router-dom";
import { MessageCircle, Trash2, ChevronDown } from "lucide-react";
import { useState, useEffect } from "react";
import { getThreads, saveThreads, loadThreadsFromServer, deleteThreadFromServer, type ChatThread } from "../../lib/chat-store";

export function SidebarAsk() {
  const location = useLocation();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  // Open by default — consistent with the other sidebar sections.
  const [historyOpen, setHistoryOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const CAP = 6;

  const refresh = () => setThreads(getThreads());

  useEffect(() => {
    refresh();
    // Load from server on mount
    loadThreadsFromServer().then(t => setThreads(t)).catch((e) => console.error("[bg-task] swallowed error:", e));
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, []);

  const deleteThread = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const updated = threads.filter(t => t.id !== id);
    saveThreads(updated);
    setThreads(updated);
    deleteThreadFromServer(id).catch((e) => console.error("[bg-task] swallowed error:", e));
  };

  // No permanent "Ask Mondaily" row here — the primary nav already has a
  // single "Ask" entry (→ /ask/new). This section is purely quiet chat
  // history, and disappears entirely when there is no history to show.
  if (threads.length === 0) return null;

  return (
    <section className="mt-2">
      <button
        onClick={() => setHistoryOpen(o => !o)}
        className="mb-1 flex w-full items-center gap-1.5 px-2.5 text-left text-[11px] font-semibold uppercase tracking-widest transition-colors hover:text-[var(--text-secondary)]"
        style={{ color: "var(--text-faint)" }}
      >
        Recent chats <span className="font-medium normal-case tracking-normal">({threads.length})</span>
        <ChevronDown size={10} className={`ml-auto transition-transform ${historyOpen ? "rotate-180" : ""}`}/>
      </button>
      {historyOpen && (showAll ? threads : threads.slice(0, CAP)).map(t => {
        const active = location.pathname === `/ask/${t.id}`;
        return (
          <div key={t.id} className="group relative flex items-center">
            <Link
              to={`/ask/${t.id}`}
              className={`flex min-w-0 flex-1 items-center gap-2.5 truncate rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${active ? "font-medium" : "hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"}`}
              style={{ color: active ? "var(--text-primary)" : "var(--text-secondary)", background: active ? "var(--surface-hover)" : undefined }}
            >
              <MessageCircle size={14} className="shrink-0" style={{ color: active ? "var(--text-primary)" : "var(--text-muted)" }}/>
              <span className="truncate">{t.title}</span>
            </Link>
            <button
              onClick={(e) => deleteThread(e, t.id)}
              className="absolute right-2 hidden rounded p-0.5 group-hover:flex"
              style={{ color: "var(--text-faint)" }}
              title="Delete chat"
            >
              <Trash2 size={11}/>
            </button>
          </div>
        );
      })}
      {historyOpen && threads.length > CAP && (
        <button onClick={() => setShowAll(v => !v)}
          className="px-2.5 py-1 text-[11px] font-medium transition-colors hover:text-[var(--text-secondary)]" style={{ color: "var(--text-faint)" }}>
          {showAll ? "Show less" : `Show ${threads.length - CAP} more`}
        </button>
      )}
    </section>
  );
}
