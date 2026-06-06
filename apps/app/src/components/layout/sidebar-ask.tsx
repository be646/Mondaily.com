import { Link } from "react-router-dom";
import { MessageCircle } from "lucide-react";

export function SidebarAsk() {
  return (
    <section className="mt-5">
      <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">Chats</p>
      <Link to="/dashboard/ask/new" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.04]">
        <MessageCircle size={15} />
        Ask Mondaily
      </Link>
    </section>
  );
}

