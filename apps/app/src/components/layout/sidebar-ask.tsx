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
        className="mb-1 flex w-full items-center gap-1.5 px-3 text-left text-[12px] font-semibold uppercase tracking-[0.16em] transition-colors hover:text-stone-950 dark:hover:text-stone-50"
        style={{ color: "var(--text-faint)" }}
      >
        Recent chats <span className="font-medium normal-case tracking-normal">({threads.length})</span>
        <ChevronDown size={10} className={`ml-auto transition-transform ${historyOpen ? "rotate-180" : ""}`}/>
      </button>
      {historyOpen && (showAll ? threads : threads.slice(0, CAP)).map(t => (
        <div key={t.id} className="group relative flex items-center">
          <Link
            to={`/ask/${t.id}`}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors truncate ${location.pathname === `/ask/${t.id}` ? "font-medium text-stone-950 dark:text-stone-50" : "text-stone-500 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-500 dark:hover:bg-stone-900 dark:hover:text-stone-200"}`}
          >
            <MessageCircle size={12} className="shrink-0"/>
            <span className="truncate">{t.title}</span>
          </Link>
          <button
            onClick={(e) => deleteThread(e, t.id)}
            className="absolute right-2 hidden rounded p-0.5 text-stone-400 hover:text-stone-500 group-hover:flex dark:text-stone-600 dark:hover:text-stone-400"
            title="Delete chat"
          >
            <Trash2 size={11}/>
          </button>
        </div>
      ))}
      {historyOpen && threads.length > CAP && (
        <button onClick={() => setShowAll(v => !v)}
          className="px-2.5 py-1 text-[11px] font-medium transition-colors hover:text-stone-950 dark:hover:text-stone-50" style={{ color: "var(--text-faint)" }}>
          {showAll ? "Show less" : `Show ${threads.length - CAP} more`}
        </button>
      )}
    </section>
  );
}
