import { Link, useLocation } from "react-router-dom";
import { MessageCircle, Plus } from "lucide-react";
import { useState, useEffect } from "react";

interface Thread { id: string; title: string; messages: unknown[]; }

function loadThreads(): Thread[] {
  try {
    const raw = localStorage.getItem("mondaily_chat_threads");
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function SidebarAsk() {
  const location = useLocation();
  const [threads, setThreads] = useState<Thread[]>([]);

  useEffect(() => {
    setThreads(loadThreads());
    const onStorage = () => setThreads(loadThreads());
    window.addEventListener("storage", onStorage);
    const interval = setInterval(() => setThreads(loadThreads()), 2000);
    return () => { window.removeEventListener("storage", onStorage); clearInterval(interval); };
  }, []);

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
      {threads.slice(0, 8).map(t => (
        <Link
          key={t.id}
          to={`/ask/${t.id}`}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors truncate ${location.pathname === `/ask/${t.id}` ? "bg-white/[.06] text-white" : "text-slate-500 hover:bg-white/[.04] hover:text-slate-300"}`}
        >
          <MessageCircle size={12} className="shrink-0"/>
          <span className="truncate">{t.title}</span>
        </Link>
      ))}
    </section>
  );
}
