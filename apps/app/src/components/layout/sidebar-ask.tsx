import { Link, useLocation } from "react-router-dom";
import { MessageCircle, Trash2, ChevronDown } from "lucide-react";
import { useState, useEffect } from "react";
import { getThreads, saveThreads, loadThreadsFromServer, deleteThreadFromServer, type ChatThread } from "../../lib/chat-store";

export function SidebarAsk() {
  const location = useLocation();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  // Quiet by default — chat history opens on demand instead of always
  // listing up to 10 prior threads permanently in the sidebar.
  const [historyOpen, setHistoryOpen] = useState(false);

  const refresh = () => setThreads(getThreads());

  useEffect(() => {
    refresh();
    // Load from server on mount
    loadThreadsFromServer().then(t => setThreads(t)).catch(() => {});
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, []);

  const deleteThread = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const updated = threads.filter(t => t.id !== id);
    saveThreads(updated);
    setThreads(updated);
    deleteThreadFromServer(id).catch(() => {});
  };

  // No permanent "Ask Mondaily" row here — the primary nav already has a
  // single "Ask" entry (→ /ask/new). This section is purely quiet chat
  // history, and disappears entirely when there is no history to show.
  if (threads.length === 0) return null;

  return (
    <section className="mt-2">
      <button
        onClick={() => setHistoryOpen(o => !o)}
        className="mb-1 flex w-full items-center gap-1.5 px-3 text-left text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors hover:text-stone-950 dark:hover:text-stone-50"
        style={{ color: "var(--text-faint)" }}
      >
        Recent chats <span className="font-medium normal-case tracking-normal">({threads.length})</span>
        <ChevronDown size={10} className={`ml-auto transition-transform ${historyOpen ? "rotate-180" : ""}`}/>
      </button>
      {historyOpen && threads.slice(0, 10).map(t => (
        <div key={t.id} className="group relative flex items-center">
          <Link
            to={`/ask/${t.id}`}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors truncate ${location.pathname === `/ask/${t.id}` ? "font-medium text-stone-950 dark:text-stone-50" : "text-stone-500 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-500 dark:hover:bg-stone-900 dark:hover:text-stone-200"}`}
          >
            <MessageCircle size={12} className="shrink-0"/>
            <span className="truncate">{t.title}</span>
          </Link>
          <button
            onClick={(e) => deleteThread(e, t.id)}
            className="absolute right-2 hidden rounded p-0.5 text-stone-400 hover:text-indigo-500 group-hover:flex dark:text-stone-600 dark:hover:text-indigo-400"
            title="Delete chat"
          >
            <Trash2 size={11}/>
          </button>
        </div>
      ))}
    </section>
  );
}
