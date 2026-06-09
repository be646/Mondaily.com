import { Link, useLocation } from "react-router-dom";
import { MessageCircle, Plus, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";
import { getThreads, saveThreads, type ChatThread } from "../../lib/chat-store";

export function SidebarAsk() {
  const location = useLocation();
  const [threads, setThreads] = useState<ChatThread[]>([]);

  const refresh = () => setThreads(getThreads());

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, []);

  const deleteThread = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const updated = threads.filter(t => t.id !== id);
    saveThreads(updated);
    setThreads(updated);
  };

  return (
    <section className="mt-5">
      <div className="mb-1 flex items-center justify-between px-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">Chats</p>
        <Link to="/ask/new" title="New chat" className="text-slate-600 hover:text-white">
          <Plus size={13}/>
        </Link>
      </div>
      <Link
        to="/ask/new"
        className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${location.pathname === "/ask/new" && threads.length === 0 ? "bg-white/[.06] text-white" : "text-slate-400 hover:bg-white/[.04] hover:text-slate-200"}`}
      >
        <MessageCircle size={13}/>
        Ask Mondaily
      </Link>
      {threads.slice(0, 10).map(t => (
        <div key={t.id} className="group relative flex items-center">
          <Link
            to={`/ask/${t.id}`}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors truncate ${location.pathname === `/ask/${t.id}` ? "bg-white/[.06] text-white" : "text-slate-500 hover:bg-white/[.04] hover:text-slate-300"}`}
          >
            <MessageCircle size={12} className="shrink-0"/>
            <span className="truncate">{t.title}</span>
          </Link>
          <button
            onClick={(e) => deleteThread(e, t.id)}
            className="absolute right-2 hidden rounded p-0.5 text-slate-600 hover:text-red-400 group-hover:flex"
            title="Delete chat"
          >
            <Trash2 size={11}/>
          </button>
        </div>
      ))}
    </section>
  );
}
