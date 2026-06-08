import { Link, useNavigate, useLocation } from "react-router-dom";
import { useUser, useClerk } from "@clerk/react";
import { useState } from "react";
import { MessageCircle, Settings, LogOut, User, X, Send, Share2, HelpCircle, MoreHorizontal, Copy, Check } from "lucide-react";

function AskPanel({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([
    { role: "assistant", text: "Hi! I'm Mondaily AI. Ask me anything about your business, pipeline, or contacts." }
  ]);
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const send = async () => {
    if (!input.trim()) return;
    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", text: userMsg }]);
    setLoading(true);
    try {
      const token = localStorage.getItem("mondaily_session_token");
      const workspaceId = localStorage.getItem("mondaily_workspace_id");
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/v1/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {})
        },
        body: JSON.stringify({ message: userMsg, thread_id: null })
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", text: data.reply || data.message || "I'm thinking..." }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", text: "Sorry, I couldn't connect right now." }]);
    }
    setLoading(false);
  };

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-white/10 bg-[#0d0f13]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageCircle size={14} className="text-red-400"/>
          <span className="text-sm font-medium text-white">Ask Mondaily</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="relative">
            <button onClick={() => setMenuOpen(!menuOpen)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/[.06] hover:text-white transition-colors">
              <MoreHorizontal size={14}/>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)}/>
                <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-white/10 bg-[#161820] shadow-xl">
                  <div className="p-1">
                    <Link to="/ask" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.04] hover:text-white">
                      <Share2 size={13}/> Open in full page
                    </Link>
                    <Link to="/settings/account" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.04] hover:text-white">
                      <Settings size={13}/> Ask Mondaily settings
                    </Link>
                  </div>
                </div>
              </>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/[.06] hover:text-white transition-colors">
            <X size={14}/>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "bg-red-500/20 text-white" : "bg-white/[.06] text-slate-300"}`}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-xl bg-white/[.06] px-3 py-2 text-sm text-slate-400">Thinking...</div>
          </div>
        )}
      </div>
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-3 py-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()}
            placeholder="Ask anything..."
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
          />
          <button onClick={send} className="text-slate-500 hover:text-red-400 transition-colors">
            <Send size={13}/>
          </button>
        </div>
      </div>
    </div>
  );
}

function ShareModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = window.location.href;

  const copy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose}/>
      <div className="fixed left-1/2 top-1/2 z-50 w-96 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#161820] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-medium text-white">Share this view</div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={15}/></button>
        </div>
        <div className="mb-3 text-xs text-slate-500">Anyone with this link can view this page if they have access to this workspace.</div>
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-3 py-2">
          <span className="flex-1 truncate text-xs text-slate-400">{url}</span>
          <button onClick={copy} className="shrink-0 text-slate-400 hover:text-white transition-colors">
            {copied ? <Check size={14} className="text-green-400"/> : <Copy size={14}/>}
          </button>
        </div>
        {copied && <div className="mt-2 text-xs text-green-400 text-center">Link copied!</div>}
      </div>
    </>
  );
}

const SHARE_PATHS = ["/objects/", "/lists/", "/search"];

export function AgentStatusBar() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const navigate = useNavigate();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const initials = user?.firstName?.[0] ?? user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ?? "U";
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Account";
  const avatarUrl = user?.imageUrl;
  const showShare = SHARE_PATHS.some(p => location.pathname.includes(p));

  return (
    <>
      <div className="relative flex items-center justify-between border-b border-white/10 bg-[#0d0f13] px-4 py-2">
        <div className="text-xs text-slate-600">AI status: idle</div>
        <div className="flex items-center gap-1.5">
          {/* Share button — only on record/list pages */}
          {showShare && (
            <button
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/[.04] hover:text-white transition-colors"
            >
              <Share2 size={12}/>
              Share
            </button>
          )}

          {/* Help */}
          <button className="rounded-lg p-1.5 text-slate-500 hover:bg-white/[.04] hover:text-slate-300 transition-colors">
            <HelpCircle size={15}/>
          </button>

          {/* Ask Mondaily */}
          <button
            onClick={() => setAskOpen(!askOpen)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-all ${askOpen ? "border-red-500/40 bg-red-500/10 text-white" : "border-white/10 text-slate-400 hover:border-red-500/30 hover:bg-red-500/5 hover:text-white"}`}
          >
            <MessageCircle size={13} className="text-red-400"/>
            Ask Mondaily
          </button>

          {/* User avatar */}
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-red-500/20 text-xs font-medium text-red-400 hover:ring-2 hover:ring-red-500/30 transition-all"
            >
              {avatarUrl ? <img src={avatarUrl} alt={fullName} className="h-full w-full object-cover"/> : initials}
            </button>

            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)}/>
                <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-white/10 bg-[#161820] shadow-2xl">
                  <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
                    <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-red-500/20 text-sm font-medium text-red-400 shrink-0">
                      {avatarUrl ? <img src={avatarUrl} alt={fullName} className="h-full w-full object-cover"/> : initials}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white truncate">{fullName}</div>
                      <div className="text-xs text-slate-500 truncate">{user?.emailAddresses?.[0]?.emailAddress}</div>
                    </div>
                  </div>
                  <div className="p-2">
                    <Link to="/settings/account" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.04] hover:text-white transition-colors">
                      <User size={14}/> Account settings
                    </Link>
                    <Link to="/settings/workspace" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.04] hover:text-white transition-colors">
                      <Settings size={14}/> Workspace settings
                    </Link>
                  </div>
                  <div className="border-t border-white/10 p-2">
                    <button
                      onClick={() => { setUserMenuOpen(false); signOut(() => navigate("/sign-in")); }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.04] hover:text-red-400 transition-colors"
                    >
                      <LogOut size={14}/> Sign out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {askOpen && (
        <div className="fixed right-0 top-0 bottom-0 z-30 flex">
          <AskPanel onClose={() => setAskOpen(false)}/>
        </div>
      )}

      {shareOpen && <ShareModal onClose={() => setShareOpen(false)}/>}
    </>
  );
}
