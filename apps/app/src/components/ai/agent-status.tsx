import React from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useUser, useClerk } from "@clerk/react";
import { useState, useRef, useEffect } from "react";
import {
  MessageCircle, Settings, LogOut, User, X, Send, Share2,
  HelpCircle, MoreHorizontal, Copy, Check, Loader2, Sparkles,
  ThumbsUp, ThumbsDown,
} from "lucide-react";
import { NotificationsBell } from "../ui/notifications-bell";
import { LogoMark } from "../logo";
import { getThreads, saveThreads, createThread, addMessageToThread, type ChatMessage } from "../../lib/chat-store";
import { getAuthHeaders } from "../../lib/api-client";

async function callAsk(message: string): Promise<string> {
  const headers = await getAuthHeaders();
  const apiUrl = import.meta.env.VITE_API_URL || "";
  const res = await fetch(`${apiUrl}/api/v1/ask`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message,
      model: (() => { try { return JSON.parse(localStorage.getItem("mondaily_ask_settings") || "{}").model ?? "auto"; } catch { return "auto"; } })(),
      web_search: (() => { try { return JSON.parse(localStorage.getItem("mondaily_ask_settings") || "{}").webSearch === "allow"; } catch { return false; } })(),
    }),
  });
  const data = await res.json() as any;
  return data.reply || "No response.";
}

// ─── Ask side panel ───────────────────────────────────────────────────────────
function AskPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Hi! I'm Mondaily AI. Ask me anything about your business." },
  ]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<Record<number, 1 | -1>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  async function sendFeedback(userMsg: string, aiMsg: string, rating: 1 | -1, idx: number) {
    setFeedbackGiven(prev => ({ ...prev, [idx]: rating }));
    try {
      const headers = await getAuthHeaders();
      const apiUrl = import.meta.env.VITE_API_URL || "";
      await fetch(`${apiUrl}/api/v1/feedback`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: userMsg, response: aiMsg, rating }),
      });
    } catch {}
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    let threadId = currentThreadId;
    if (!threadId) {
      const thread = createThread(text);
      saveThreads([thread, ...getThreads()]);
      threadId = thread.id;
      setCurrentThreadId(threadId);
    }
    const userMsg: ChatMessage = { role: "user", content: text };
    const withUser = [...messages, userMsg];
    setMessages(withUser);
    addMessageToThread(threadId, userMsg);
    setLoading(true);
    try {
      const reply = await callAsk(text);
      const aiMsg: ChatMessage = { role: "assistant", content: reply };
      setMessages([...withUser, aiMsg]);
      addMessageToThread(threadId, aiMsg);
    } catch (err: any) {
      setMessages([...withUser, { role: "assistant", content: `Error: ${err.message}` }]);
    }
    setLoading(false);
  }

  return (
    <div className="flex h-full w-[300px] shrink-0 flex-col border-l border-white/[.06] bg-[#0d0f13]">
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-white/[.06] px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-indigo-500/15">
            <Sparkles size={10} className="text-indigo-400"/>
          </div>
          <span className="text-[13px] font-semibold text-white">Ask Mondaily</span>
        </div>
        <div className="flex items-center gap-0.5">
          <div className="relative">
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-white/[.05] hover:text-white transition-colors"
            >
              <MoreHorizontal size={13}/>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)}/>
                <div className="dropdown-panel absolute right-0 top-full z-50 w-52">
                  <Link
                    to="/ask/new"
                    onClick={() => { setMenuOpen(false); onClose(); }}
                    className="dropdown-item"
                  >
                    <Share2 size={12}/> Open full page
                  </Link>
                  <Link
                    to="/settings/ask-mondaily"
                    onClick={() => setMenuOpen(false)}
                    className="dropdown-item"
                  >
                    <Settings size={12}/> Ask Mondaily settings
                  </Link>
                </div>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-white/[.05] hover:text-white transition-colors"
          >
            <X size={13}/>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && (
              <div className="flex h-5 w-5 shrink-0 items-center justify-center text-indigo-400 mt-0.5">
                <LogoMark size={16}/>
              </div>
            )}
            <div className="flex flex-col gap-1 max-w-[85%]">
              <div className={`rounded-xl px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-white/[.06] border border-white/[.08] text-white rounded-tr-sm"
                  : "text-slate-300"
              }`}>
                {m.content}
              </div>
              {m.role === "assistant" && i > 0 && (
                <div className="flex items-center gap-1 ml-1">
                  <button
                    onClick={() => sendFeedback(messages[i - 1]?.content ?? "", m.content, 1, i)}
                    className={`rounded p-0.5 transition-colors ${feedbackGiven[i] === 1 ? "text-emerald-400" : "text-zinc-700 hover:text-emerald-400"}`}
                  >
                    <ThumbsUp size={10}/>
                  </button>
                  <button
                    onClick={() => sendFeedback(messages[i - 1]?.content ?? "", m.content, -1, i)}
                    className={`rounded p-0.5 transition-colors ${feedbackGiven[i] === -1 ? "text-indigo-400" : "text-zinc-700 hover:text-indigo-400"}`}
                  >
                    <ThumbsDown size={10}/>
                  </button>
                  {feedbackGiven[i] && (
                    <span className="text-[10px] text-zinc-700">{feedbackGiven[i] === 1 ? "Thanks!" : "Got it"}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-2 justify-start">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center text-indigo-400 mt-0.5">
              <LogoMark size={16} thinking/>
            </div>
            <div className="rounded-xl bg-white/[.04] border border-white/[.06] px-3 py-2 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-600 animate-bounce [animation-delay:0ms]"/>
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-600 animate-bounce [animation-delay:150ms]"/>
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-600 animate-bounce [animation-delay:300ms]"/>
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div className="border-t border-white/[.06] p-3 shrink-0">
        <div className="flex items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.03] px-3 py-2 focus-within:border-white/[.14] transition-colors">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()}
            placeholder="Ask anything…"
            className="flex-1 bg-transparent text-[12px] text-white placeholder-zinc-600 outline-none"
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="text-zinc-600 hover:text-indigo-400 disabled:opacity-30 transition-colors"
          >
            {loading ? <Loader2 size={12} className="animate-spin"/> : <Send size={12}/>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Share modal ──────────────────────────────────────────────────────────────
function ShareModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = window.location.href;
  function copy() {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" onClick={onClose}/>
      <div className="fixed left-1/2 top-1/2 z-50 w-96 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[.09] bg-[#0d0f13] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Share2 size={14} className="text-zinc-400"/>
            <span className="text-[13px] font-semibold text-white">Share this view</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-white/[.05] hover:text-white transition-colors"
          >
            <X size={13}/>
          </button>
        </div>
        <p className="mb-3 text-[11px] text-zinc-600 leading-relaxed">
          Anyone with this link can view this page if they have access to this workspace.
        </p>
        <div className="flex items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.03] px-3 py-2.5">
          <span className="flex-1 truncate text-[11px] text-zinc-500">{url}</span>
          <button onClick={copy} className="shrink-0 text-zinc-500 hover:text-white transition-colors">
            {copied ? <Check size={13} className="text-emerald-400"/> : <Copy size={13}/>}
          </button>
        </div>
        {copied && <p className="mt-2 text-center text-[11px] text-emerald-400">Link copied!</p>}
      </div>
    </>
  );
}

const SHARE_PATHS = ["/objects/", "/lists/", "/search"];

// ─── Top bar ──────────────────────────────────────────────────────────────────
export function AgentStatusBar({ leftSlot }: { leftSlot?: React.ReactNode } = {}) {
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
      {/* Top bar */}
      <div className="md-topbar relative flex items-center justify-between border-b border-[#e5e7eb] bg-white dark:border-white/[.06] dark:bg-[#0d0f13] px-4 py-1.5 shrink-0">
        {/* Left slot — page icon, label, search trigger */}
        <div className="flex items-center gap-3 min-w-0">
          {leftSlot ?? <span className="text-xs text-[#9ca3af] dark:text-zinc-700">AI status: idle</span>}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1">
          {showShare && (
            <button
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-[#e5e7eb] px-2.5 py-1.5 text-[11px] text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827] transition-colors dark:border-white/[.07] dark:text-zinc-500 dark:hover:bg-white/[.04] dark:hover:text-white"
            >
              <Share2 size={12}/> Share
            </button>
          )}

          <button
            className="rounded-lg p-1.5 text-[#9ca3af] hover:bg-[#f9fafb] hover:text-[#111827] transition-colors dark:text-zinc-600 dark:hover:bg-white/[.04] dark:hover:text-zinc-300"
            title="Help"
          >
            <HelpCircle size={14}/>
          </button>

          <NotificationsBell/>

          {/* Ask Mondaily toggle */}
          <button
            onClick={() => setAskOpen(o => !o)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all ${
              askOpen
                ? "border-[#ddd6fe] bg-[#ede9fe] text-[#6d28d9] dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-white"
                : "border-[#ddd6fe] bg-[#f5f3ff] text-[#6d28d9] hover:bg-[#ede9fe] dark:border-white/[.07] dark:bg-transparent dark:text-zinc-500 dark:hover:border-indigo-500/25 dark:hover:bg-indigo-500/[.05] dark:hover:text-white"
            }`}
          >
            <MessageCircle size={12} className="text-[#7c3aed] dark:text-indigo-400"/>
            Ask AI
          </button>

          {/* User avatar */}
          <div className="relative ml-0.5">
            <button
              onClick={() => setUserMenuOpen(o => !o)}
              className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:ring-2 hover:ring-indigo-300 dark:hover:ring-indigo-500/25 transition-all"
            >
              {avatarUrl
                ? <img src={avatarUrl} alt={fullName} className="h-full w-full object-cover"/>
                : initials}
            </button>

            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)}/>
                <div className="dropdown-panel absolute right-0 top-full mt-2 w-56 z-50">
                  {/* User info header */}
                  <div className="flex items-center gap-2.5 border-b border-white/[.06] px-3 py-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-indigo-500/20 text-[11px] font-semibold text-indigo-400">
                      {avatarUrl
                        ? <img src={avatarUrl} alt={fullName} className="h-full w-full object-cover"/>
                        : initials}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-white">{fullName}</div>
                      <div className="truncate text-[10px] text-zinc-600">{user?.emailAddresses?.[0]?.emailAddress}</div>
                    </div>
                  </div>
                  <Link to="/settings/account" onClick={() => setUserMenuOpen(false)} className="dropdown-item">
                    <User size={12}/> Account settings
                  </Link>
                  <Link to="/settings/workspace" onClick={() => setUserMenuOpen(false)} className="dropdown-item">
                    <Settings size={12}/> Workspace settings
                  </Link>
                  <div className="mx-2 my-1 border-t border-white/[.05]"/>
                  <button
                    onClick={() => { setUserMenuOpen(false); signOut(() => navigate("/sign-in")); }}
                    className="dropdown-item text-indigo-400 hover:text-indigo-300"
                  >
                    <LogOut size={12}/> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Ask side panel */}
      {askOpen && (
        <div className="fixed right-0 top-0 bottom-0 z-30 flex shadow-[−8px_0_32px_rgba(0,0,0,0.4)]">
          <AskPanel onClose={() => setAskOpen(false)}/>
        </div>
      )}

      {shareOpen && <ShareModal onClose={() => setShareOpen(false)}/>}
    </>
  );
}
