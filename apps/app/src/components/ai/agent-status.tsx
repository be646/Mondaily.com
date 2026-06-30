import React from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useSovereignAuthOptional } from "../auth/sovereign-auth-context";
import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import {
  MessageCircle, Settings, LogOut, User, X, Send, Share2,
  HelpCircle, MoreHorizontal, Copy, Check, Loader2,
  ThumbsUp, ThumbsDown, Sun, Moon, ListChecks, Network, Brain, Square, RotateCcw, Mic,
} from "lucide-react";
import { NotificationsBell } from "../ui/notifications-bell";
import { LogoMark } from "../logo";
import { apiFetch, getAuthHeaders } from "../../lib/api-client";
import { useAskEngine } from "./use-ask-engine";
import { useAskContextStore } from "../../lib/ask-context-store";
import { EvidenceStrip, SourceList, Markdown, TokenLedger, sourcesToLinks } from "./ask-shared";
import { useAttachments, AttachPicker, AttachChips, AttachButton } from "./use-attachments";
import { useVoiceDictation } from "./use-voice";

// ─── Ask side panel — Ask Mondaily in contextual mode. Same engine as the
// main Ask page and Home: same endpoint, history/thread_id handling, real
// sources, agent label, and action chips. The only difference is the
// compact drawer layout and that its context comes from whatever page is
// currently mounted underneath it (via useAskContextStore). ─────────────────
function AskPanel({ onClose }: { onClose: () => void }) {
  const pageContext = useAskContextStore(s => s.context);
  const [input, setInput] = useState("");
  const voice = useVoiceDictation(setInput);
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<Record<number, 1 | -1>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = taRef.current; if (el && input === "") el.style.height = "auto"; }, [input]);

  const attach = useAttachments();
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const copyMsg = (text: string, i: number) => { navigator.clipboard?.writeText(text).then(() => { setCopiedIdx(i); setTimeout(() => setCopiedIdx(null), 1500); }).catch(() => {}); };
  const { messages, loading, messageMeta, tokenCount, streamStatus, doSend, buildChipText, stop, regenerate } = useAskEngine({
    context: { ...(pageContext ?? { scope_label: "the workspace (no page context)" }), ...attach.attachContext },
  });

  async function sendFeedback(userMsg: string, aiMsg: string, rating: 1 | -1, idx: number) {
    setFeedbackGiven(prev => ({ ...prev, [idx]: rating }));
    try {
      const headers = await getAuthHeaders();
      const apiUrl = import.meta.env.VITE_API_URL || "";
      await apiFetch(`${apiUrl}/api/v1/feedback`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: userMsg, response: aiMsg, rating }),
      });
    } catch {}
  }

  // Stick-to-bottom lock (same model as the Home surface). `stickRef` stays true
  // while the user is parked near the bottom; scrolling up to re-read flips it
  // false so we stop yanking them, scrolling back down re-engages it. The pin runs
  // in useLayoutEffect — BEFORE paint — so the newest tokens are in view when the
  // frame lands: no post-paint jump, no shake. Only fires while a turn is active.
  const stickRef = useRef(true);
  const lastTopRef = useRef(0);
  const onMessagesScroll = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    const top = el.scrollTop;
    // Direction-aware: any upward scroll releases the follow (no tug); returning
    // to the bottom re-engages. The programmatic pin only ever moves down.
    if (top < lastTopRef.current - 1) stickRef.current = false;
    if (el.scrollHeight - top - el.clientHeight < 24) stickRef.current = true;
    lastTopRef.current = top;
  }, []);
  useLayoutEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    // Pin whenever stuck — including the final frame when the footer/cards mount —
    // so late content never shoves the answer. Direction-aware stick prevents tug.
    if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, loading, messageMeta]);

  const send = () => {
    const t = input.trim();
    if (!t && attach.attachments.length === 0) return;
    setInput(""); doSend(t || "Use the attached items.");
    if (attach.attachments.length) attach.clear();
  };
  const sendChip = (text: string) => doSend(text);
  const displayMessages = messages.length
    ? messages
    : [{ role: "assistant" as const, content: pageContext?.scope_label
        ? `Hi! I'm Mondaily AI, focused on ${pageContext.scope_label} right now. Ask me anything.`
        : "Hi! I'm Mondaily AI. Ask me anything about your business." }];

  return (
    <div className="flex h-full w-[300px] shrink-0 flex-col border-l border-[var(--border-soft)] bg-[var(--surface-card)]">
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-stone-500/15">
            <LogoMark size={10} className="text-stone-400"/>
          </div>
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">Ask Mondaily</span>
        </div>
        <div className="flex items-center gap-0.5">
          <div className="relative">
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="rounded-md p-1.5 text-stone-500 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
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
            className="rounded-md p-1.5 text-stone-500 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X size={13}/>
          </button>
        </div>
      </div>

      {/* Context strip — what this drawer is scoped to right now */}
      {pageContext?.scope_label && (
        <div className="shrink-0 border-b border-[var(--border-soft)] px-3 py-1.5">
          <span className="text-[10px] text-stone-500">Scoped to: <span className="text-stone-300">{pageContext.scope_label}</span></span>
        </div>
      )}

      {/* Messages */}
      <div ref={messagesRef} onScroll={onMessagesScroll} className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-3 space-y-3" style={{ overflowAnchor: "none", scrollBehavior: "auto", scrollbarWidth: "none" }}>
        {displayMessages.map((m, i) => {
          const meta = messageMeta[i];
          const AgentIcon = meta?.agent.icon;
          return (
            <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "assistant" && (
                <div className="flex h-5 w-5 shrink-0 items-center justify-center text-stone-400 mt-0.5">
                  <LogoMark size={16}/>
                </div>
              )}
              <div className={`flex flex-col gap-1 min-w-0 ${m.role === "user" ? "max-w-[85%]" : "flex-1"}`}>
                <div className={`min-w-0 break-words rounded-sm px-3 py-2 text-[12px] leading-relaxed ${
                  m.role === "user"
                    ? "bg-[var(--surface-hover)] border border-[var(--border-soft)] text-[var(--text-primary)] rounded-tr-sm whitespace-pre-wrap"
                    : "whitespace-pre-wrap"
                }`} style={m.role === "assistant" ? { color: "var(--text-secondary)" } : undefined}>
                  {m.role === "user"
                    ? m.content
                    : (loading && i === displayMessages.length - 1)
                      // Streaming: stable plain text (no per-token markdown re-parse → no jitter).
                      ? m.content
                      : <Markdown text={m.content} links={sourcesToLinks(meta?.sources)}/>}
                </div>

                {m.role === "assistant" && meta && AgentIcon && (
                  <div className="flex flex-wrap items-center gap-1.5 ml-1">
                    <span className="agent-badge" data-status="draft_ready">
                      <AgentIcon size={9}/>
                      {meta.agent.name}
                    </span>
                    <EvidenceStrip sources={meta.sources}/>
                  </div>
                )}
                {m.role === "assistant" && meta && !(loading && i === displayMessages.length - 1) && (
                  <div className="flex items-center gap-0.5 ml-0.5">
                    <button onClick={() => copyMsg(m.content, i)} title="Copy" className="rounded p-1 transition-colors hover:bg-stone-100 dark:hover:bg-stone-900" style={{ color: copiedIdx === i ? "var(--accent)" : "var(--text-faint)" }}>
                      {copiedIdx === i ? <Check size={11}/> : <Copy size={11}/>}
                    </button>
                    {i === messages.length - 1 && !loading && (
                      <button onClick={regenerate} title="Regenerate" className="rounded p-1 transition-colors hover:bg-stone-100 dark:hover:bg-stone-900" style={{ color: "var(--text-faint)" }}>
                        <RotateCcw size={11}/>
                      </button>
                    )}
                  </div>
                )}
                {m.role === "assistant" && meta?.usage && <TokenLedger usage={meta.usage}/>}
                {m.role === "assistant" && meta && meta.sources.length > 0 && (
                  <div className="ml-1">
                    <SourceList sources={meta.sources}/>
                  </div>
                )}

                {m.role === "assistant" && i > 0 && (
                  <div className="flex items-center gap-1 ml-1">
                    <button
                      onClick={() => sendFeedback(messages[i - 1]?.content ?? "", m.content, 1, i)}
                      className={`rounded p-0.5 transition-colors ${feedbackGiven[i] === 1 ? "text-emerald-400" : "text-stone-700 hover:text-emerald-400"}`}
                    >
                      <ThumbsUp size={10}/>
                    </button>
                    <button
                      onClick={() => sendFeedback(messages[i - 1]?.content ?? "", m.content, -1, i)}
                      className={`rounded p-0.5 transition-colors ${feedbackGiven[i] === -1 ? "text-stone-400" : "text-stone-700 hover:text-stone-400"}`}
                    >
                      <ThumbsDown size={10}/>
                    </button>
                    {feedbackGiven[i] && (
                      <span className="text-[10px] text-stone-700">{feedbackGiven[i] === 1 ? "Thanks!" : "Got it"}</span>
                    )}
                  </div>
                )}

                {/* Same action-chip set as Home and the main Ask page */}
                {m.role === "assistant" && !loading && i === messages.length - 1 && i > 0 && (
                  <div className="chat-pills-in flex flex-wrap items-center gap-1.5 ml-1 mt-1">
                    {([
                      { key: "task" as const, label: "Create task", Icon: ListChecks },
                      { key: "related" as const, label: "Related objects", Icon: Network },
                      { key: "explain" as const, label: "Explain reasoning", Icon: Brain },
                    ]).map(({ key, label, Icon }) => (
                      <button key={key} onClick={() => sendChip(buildChipText(key, i))}
                        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all hover:-translate-y-px"
                        style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}>
                        <Icon size={9}/> {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {loading && (
          <div className="flex gap-2 justify-start">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center text-stone-400 mt-0.5">
              <LogoMark size={16} thinking/>
            </div>
            <div className="rounded-sm bg-[var(--surface-hover)] border border-[var(--border-soft)] px-3 py-2 flex items-center gap-2">
              {streamStatus ? (
                <span className="text-[10.5px] text-stone-400">{streamStatus}</span>
              ) : tokenCount > 0 ? (
                <span className="text-[10.5px] text-stone-500">{tokenCount} tokens</span>
              ) : (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-stone-600 animate-bounce [animation-delay:0ms]"/>
                  <span className="h-1.5 w-1.5 rounded-full bg-stone-600 animate-bounce [animation-delay:150ms]"/>
                  <span className="h-1.5 w-1.5 rounded-full bg-stone-600 animate-bounce [animation-delay:300ms]"/>
                </>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div className="border-t border-[var(--border-soft)] p-3 shrink-0">
        <div className="relative">
          <AttachPicker attach={attach}/>
          <AttachChips attach={attach}/>
        </div>
        <div className="flex items-end gap-2 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2 focus-within:border-[var(--border-soft)] transition-colors">
          <AttachButton attach={attach}/>
          {voice.supported && (
            <button onClick={voice.toggle} title={voice.listening ? "Stop dictation" : "Dictate"}
              className={`shrink-0 transition-colors ${voice.listening ? "animate-pulse text-[var(--accent)]" : "text-stone-600 hover:text-stone-400"}`}>
              <Mic size={12}/>
            </button>
          )}
          <textarea
            ref={taRef}
            value={input}
            rows={1}
            onChange={e => { setInput(e.target.value); if (e.target.value.endsWith("@")) attach.setOpen(true); const el = e.target; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 120)}px`; }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask anything…"
            className="flex-1 resize-none self-center bg-transparent text-[12px] leading-5 text-[var(--text-primary)] placeholder-stone-600 outline-none"
            style={{ maxHeight: 120 }}
          />
          <button
            onClick={loading ? stop : send}
            disabled={!loading && !input.trim()}
            title={loading ? "Stop generating" : "Send"}
            className="text-stone-600 hover:text-stone-400 disabled:opacity-30 transition-colors"
          >
            {loading ? <Square size={11} strokeWidth={3} fill="currentColor"/> : <Send size={12}/>}
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
      <div className="fixed left-1/2 top-1/2 z-50 w-96 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Share2 size={14} className="text-stone-400"/>
            <span className="text-[13px] font-semibold text-[var(--text-primary)]">Share this view</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-stone-500 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X size={13}/>
          </button>
        </div>
        <p className="mb-3 text-[11px] text-stone-600 leading-relaxed">
          Anyone with this link can view this page if they have access to this workspace.
        </p>
        <div className="flex items-center gap-2 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2.5">
          <span className="flex-1 truncate text-[11px] text-stone-500">{url}</span>
          <button onClick={copy} className="shrink-0 text-stone-500 hover:text-[var(--text-primary)] transition-colors">
            {copied ? <Check size={13} className="text-emerald-400"/> : <Copy size={13}/>}
          </button>
        </div>
        {copied && <p className="mt-2 text-center text-[11px] text-emerald-400">Link copied!</p>}
      </div>
    </>
  );
}

const SHARE_PATHS = ["/objects/", "/lists/", "/search"];

function getCurrentTheme() {
  const theme = document.documentElement.dataset.theme;
  return theme === "light" ? "light" : "dark";
}

function applyHeaderTheme(theme: "light" | "dark") {
  localStorage.setItem("mondaily_appearance", theme);
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

// ─── Top bar ──────────────────────────────────────────────────────────────────
export function AgentStatusBar({ leftSlot }: { leftSlot?: React.ReactNode } = {}) {
  const me = useCurrentUser();
  const sov = useSovereignAuthOptional();
  const navigate = useNavigate();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => getCurrentTheme());

  const initials = (me.name || me.email)?.[0]?.toUpperCase() ?? "U";
  const fullName = me.name || "Account";
  const avatarUrl = me.imageUrl ?? undefined;
  const showShare = SHARE_PATHS.some(p => location.pathname.includes(p));
  const ThemeIcon = theme === "dark" ? Sun : Moon;

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyHeaderTheme(next);
  }

  return (
    <>
      {/* Top bar */}
      <div className="md-topbar relative flex items-center justify-between border-b border-[#e5e7eb] bg-white dark:border-[var(--border-soft)] dark:bg-[var(--surface-card)] px-4 py-1.5 shrink-0">
        {/* Left slot — page icon, label, search trigger */}
        <div className="flex items-center gap-3 min-w-0">
          {leftSlot ?? <span className="text-xs text-[#9ca3af] dark:text-stone-700">AI status: idle</span>}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1">
          {showShare && (
            <button
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-[#e5e7eb] px-2.5 py-1.5 text-[11px] text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827] transition-colors dark:border-[var(--border-soft)] dark:text-stone-500 dark:hover:bg-[var(--surface-hover)] dark:hover:text-[var(--text-primary)]"
            >
              <Share2 size={12}/> Share
            </button>
          )}

          <button
            className="rounded-lg p-1.5 text-[#9ca3af] hover:bg-[#f9fafb] hover:text-[#111827] transition-colors dark:text-stone-600 dark:hover:bg-[var(--surface-hover)] dark:hover:text-stone-300"
            title="Help"
          >
            <HelpCircle size={14}/>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-950 dark:text-stone-500 dark:hover:bg-stone-900 dark:hover:text-stone-50"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            <ThemeIcon size={15}/>
          </button>

          <NotificationsBell/>

          {/* Ask Mondaily toggle — compact command trigger */}
          <button
            onClick={() => setAskOpen(o => !o)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all duration-200 ${
              askOpen
                ? "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-400/30 dark:bg-stone-500/10 dark:text-[var(--text-primary)]"
                : "border-[#e5e7eb] bg-white text-[#52525b] hover:border-stone-200 hover:bg-stone-50 dark:border-[var(--border-soft)] dark:bg-transparent dark:text-stone-400 dark:hover:border-stone-400/30 dark:hover:bg-stone-500/10 dark:hover:text-[var(--text-primary)]"
            }`}
          >
            <LogoMark size={12} className={askOpen ? "text-stone-600 dark:text-stone-400" : "text-stone-500 dark:text-stone-400"}/>
            Ask AI
          </button>

          {/* User avatar */}
          <div className="relative ml-0.5">
            <button
              onClick={() => setUserMenuOpen(o => !o)}
              className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-stone-100 dark:bg-stone-500/20 text-[11px] font-semibold text-stone-600 dark:text-stone-400 hover:ring-2 hover:ring-stone-300 dark:hover:ring-stone-500/25 transition-all"
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
                  <div className="flex items-center gap-2.5 border-b border-[var(--border-soft)] px-3 py-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-stone-500/20 text-[11px] font-semibold text-stone-400">
                      {avatarUrl
                        ? <img src={avatarUrl} alt={fullName} className="h-full w-full object-cover"/>
                        : initials}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-[var(--text-primary)]">{fullName}</div>
                      <div className="truncate text-[10px] text-stone-600">{me.email}</div>
                    </div>
                  </div>
                  <Link to="/settings/account" onClick={() => setUserMenuOpen(false)} className="dropdown-item">
                    <User size={12}/> Account settings
                  </Link>
                  <Link to="/settings/workspace" onClick={() => setUserMenuOpen(false)} className="dropdown-item">
                    <Settings size={12}/> Workspace settings
                  </Link>
                  <div className="mx-2 my-1 border-t border-[var(--border-soft)]"/>
                  <button
                    onClick={async () => { setUserMenuOpen(false); await sov?.logout(); localStorage.removeItem("mondaily_workspace_id"); navigate("/auth/shadow-login"); }}
                    className="dropdown-item text-stone-400 hover:text-stone-300"
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
