import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { HelpCircle, X, Send, Loader2, Check, Terminal, RotateCcw, Star, ChevronRight } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useLanguage } from "../../hooks/useLanguage";
import {
  sessionKey, loadSession, saveSession, newSession, isSessionActive, summarizeHistory, latestDiagnostics,
  type HelpSession, type HelpMsg, type HelpDiagnostic, type HelpAction,
} from "./help-store";

/**
 * AI HELP CENTER — a PERSISTENT, source-backed diagnostic co-pilot (not a disposable chat). The whole
 * inquiry lives in a localStorage-backed session held by HelpProvider (which sits above the router
 * Outlet), so it survives route changes, panel close/reopen, and reloads. Navigation actions minimize
 * the panel and leave the case ACTIVE (a "resume Help" pill reopens it). After troubleshooting, Help
 * asks whether it's resolved, collects a rating, and only escalates to a ticket on an explicit click.
 * The agent is read-only: it guides/investigates, never fakes refunds/upgrades/fixes.
 */
type AskResp = { answer: string; category: string; needs_ticket: boolean; suggested_subject: string; language: string; cited_docs: string[]; diagnostics?: HelpDiagnostic[]; suggested_actions?: HelpAction[] };
interface SupportContext {
  identity: { display_name: string; email: string | null; role: string; workspace_name: string };
  entitlement: { tier: string; trial_ends_at: string | null };
  wallet: { remaining: number; included_monthly_credits: number | null; enrolled: boolean };
  readiness: { enabled_modules: string[]; email_connected: boolean };
  diagnostics: { ai_gateway: boolean; sovereign_search: boolean; sovereign_scrape: boolean };
}

interface HelpCtx {
  open: (prefill?: string) => void;
  close: () => void;
  newInquiry: () => void;
  session: HelpSession;
  update: (patch: Partial<HelpSession> | ((prev: HelpSession) => HelpSession)) => void;
  isOpen: boolean;
}
const HelpContext = createContext<HelpCtx>({ open: () => {}, close: () => {}, newInquiry: () => {}, session: newSession(), update: () => {}, isOpen: false });
export const useHelp = () => useContext(HelpContext);

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const key = sessionKey();
  const [session, setSession] = useState<HelpSession>(() => loadSession(key) ?? newSession());
  const [isOpen, setIsOpen] = useState(false);
  const [prefill, setPrefill] = useState("");

  // Mirror every change to localStorage so the case survives reloads.
  useEffect(() => { saveSession(key, session); }, [key, session]);

  const open = useCallback((p?: string) => { setPrefill(p ?? ""); setIsOpen(true); }, []);
  const close = useCallback(() => setIsOpen(false), []);
  const update = useCallback((patch: Partial<HelpSession> | ((prev: HelpSession) => HelpSession)) => {
    setSession(prev => {
      const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
      return { ...next, updatedAt: new Date().toISOString() };
    });
  }, []);
  const newInquiry = useCallback(() => { setSession(newSession()); setPrefill(""); setIsOpen(true); }, []);

  return (
    <HelpContext.Provider value={{ open, close, newInquiry, session, update, isOpen }}>
      {children}
      {isOpen && <HelpPanel prefill={prefill} />}
      {/* Minimized "resume" pill — bottom-right inside the canvas (never over the sidebar). */}
      {!isOpen && isSessionActive(session) && <ResumePill state={session.state} onOpen={() => open()} />}
    </HelpContext.Provider>
  );
}

/** The ONE Help entry — a small icon for the right-side global controls. */
export function HelpTopButton() {
  const { open } = useHelp();
  return (
    <button onClick={() => open()} title="Help & Support" aria-label="Open Help"
      className="flex h-7 w-7 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]">
      <HelpCircle size={15} />
    </button>
  );
}

const STATE_LABEL: Record<string, string> = {
  active: "Active", waiting_for_user: "Waiting on you", resolved: "Resolved", escalated: "Escalated", closed: "Closed",
};
const STATE_COLOR: Record<string, string> = {
  active: "#5fae8b", waiting_for_user: "#a3946b", resolved: "#5fae8b", escalated: "#7f93b0", closed: "var(--text-faint)",
};

function ResumePill({ state, onOpen }: { state: string; onOpen: () => void }) {
  return (
    <button onClick={onOpen} aria-label="Resume Help"
      className="fixed bottom-4 right-4 z-[190] flex items-center gap-2 rounded-sm border px-3.5 py-2 transition-transform hover:-translate-y-0.5"
      style={{ background: "var(--surface-card)", borderColor: "var(--border-soft)" }}>
      <Terminal size={13} style={{ color: "var(--section-accent)" }} />
      <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>Help</span>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATE_COLOR[state] ?? "var(--text-faint)" }} />
      <ChevronRight size={12} style={{ color: "var(--text-faint)" }} />
    </button>
  );
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[11.5px]">
      <span style={{ color: "var(--text-faint)" }}>{">"}</span>
      <span className="w-16 shrink-0" style={{ color: "var(--text-muted)" }}>{label}</span>
      {ok !== undefined && <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: ok ? "#5fae8b" : "var(--text-faint)" }} />}
      <span className="truncate" style={{ color: "var(--text-secondary)" }}>{value}</span>
    </div>
  );
}

function DiagRow({ d }: { d: HelpDiagnostic }) {
  const color = d.status === "ok" ? "#5fae8b" : d.status === "warn" ? "#a3946b" : d.status === "error" ? "#d1524a" : "var(--text-faint)";
  return (
    <div className="flex items-start gap-2 font-mono text-[11px]">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="shrink-0" style={{ color: "var(--text-muted)" }}>{d.label}</span>
      <span className="truncate" style={{ color: "var(--text-secondary)" }} title={`${d.detail} · ${d.source}`}>{d.detail}</span>
    </div>
  );
}

function HelpPanel({ prefill }: { prefill: string }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { session, update, close, newInquiry } = useHelp();
  const [input, setInput] = useState(prefill);
  const [busy, setBusy] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const ctx = useQuery<SupportContext>({ queryKey: ["support-context"], queryFn: () => apiClient.get("/support/context"), staleTime: 60_000, retry: false });
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [session.messages, busy, session.state]);

  async function send(text0?: string) {
    const text = (text0 ?? input).trim();
    if (!text || busy) return;
    setInput("");
    const history = session.messages.filter(m => !m.system).map(m => ({ role: m.role, content: m.content }));
    update(s => ({ ...s, subject: s.subject ?? text.slice(0, 120), messages: [...s.messages, { role: "user", content: text }], state: "active" }));
    setBusy(true);
    try {
      const r = await apiClient.post<AskResp>("/support/ask", { message: text, history, route: window.location.pathname });
      update(s => ({
        ...s, category: r.category ?? s.category,
        messages: [...s.messages, { role: "assistant", content: r.answer, category: r.category, needsTicket: r.needs_ticket, suggestedSubject: r.suggested_subject, diagnostics: r.diagnostics, actions: r.suggested_actions }],
        state: "waiting_for_user",
      }));
    } catch {
      update(s => ({ ...s, messages: [...s.messages, { role: "assistant", content: "I couldn't reach the help service. Please try again in a moment.", needsTicket: true, category: "bug_report", suggestedSubject: "Help service error" }], state: "waiting_for_user" }));
    } finally { setBusy(false); }
  }

  async function createTicket() {
    if (session.ticketCreated) return;   // one request per inquiry — never duplicate silently
    const firstUser = session.messages.find(m => m.role === "user");
    const subject = (session.subject || firstUser?.content || "Support request").slice(0, 200);
    const message = summarizeHistory(session);
    // Investigate-first: don't open a hollow ticket. If the user escalated before describing anything,
    // ask one clarifying question and keep the chat open instead of sending an empty request.
    if (!firstUser || message.trim().length < 15) {
      update(s => ({ ...s, state: "waiting_for_user", messages: [...s.messages, { role: "assistant", content: "Before I open a request, tell me a bit more so our team can help: what were you trying to do, and what happened instead (any error message)?", needsTicket: true, category: s.category ?? "bug_report" }] }));
      return;
    }
    try {
      const res = await apiClient.post<{ id: string }>("/support/tickets", {
        category: session.category ?? "bug_report",
        subject,
        message,
        route: window.location.pathname,
        metadata: {
          source: "help_agent",
          diagnostics: latestDiagnostics(session),
          route_history: session.routeHistory,
          history_summary: message,
          rating: session.rating,
          feedback: session.feedback,
        },
      });
      update(s => ({ ...s, ticketCreated: true, ticketId: res?.id ?? null, state: "escalated", messages: [...s.messages, { role: "assistant", system: true, content: "Support request created — our team will follow up. You can keep replying here." }] }));
    } catch (e) {
      // Surface the server's "needs more info" nudge (422) instead of failing silently. The API
      // returns { error, needs_more_info, questions } as the response body; apiClient throws it as text.
      let ask = "I couldn't open the request just now. Add a little more detail about the issue and try again.";
      try {
        const parsed = JSON.parse((e as Error)?.message ?? "{}") as { error?: string; questions?: string[] };
        if (parsed.error) ask = [parsed.error, ...(parsed.questions ?? [])].join(" ");
      } catch { /* non-JSON error — keep the generic ask */ }
      update(s => ({ ...s, state: "waiting_for_user", messages: [...s.messages, { role: "assistant", content: ask, needsTicket: true, category: s.category ?? "bug_report" }] }));
    }
  }

  function runAction(a: HelpAction) {
    if (a.action === "navigate" && a.payload) {
      // Navigate WITHOUT ending the case: log the route, add a guiding note, minimize (keep session).
      update(s => ({
        ...s, lastRoute: a.payload!, routeHistory: [...s.routeHistory, a.payload!],
        messages: [...s.messages, { role: "assistant", system: true, content: `I opened ${a.label}. Try it again, then tell me if it's still an issue.`, actions: [{ label: "Still having trouble", action: "follow_up" }] }],
        state: "waiting_for_user",
      }));
      close();
      navigate(a.payload);
    } else if (a.action === "create_ticket") createTicket();
    else if (a.action === "follow_up") inputRef.current?.focus();
  }

  function submitRating(stars: number) {
    update(s => ({ ...s, rating: stars, feedback: feedbackText.trim() || null, state: "closed", messages: [...s.messages, { role: "assistant", system: true, content: `Thanks — rated ${stars}/5.` }] }));
    // If a ticket exists, attach the rating/feedback as a comment (safe; existing endpoint).
    if (session.ticketId) apiClient.post(`/support/tickets/${session.ticketId}/comments`, { body: `Rating: ${stars}/5${feedbackText.trim() ? `\nFeedback: ${feedbackText.trim()}` : ""}` }).catch(() => {});
  }

  const c = ctx.data;
  const suggestions = ["Why is Discovery slow?", "How many credits do I have?", "What plan am I on?", "What is my name?"];
  const lastAssistantIdx = [...session.messages].map(m => m.role).lastIndexOf("assistant");
  // Resolution controls appear once Help has answered and the case is still open.
  const showResolution = lastAssistantIdx >= 0 && (session.state === "waiting_for_user" || session.state === "active") && !busy;
  const showRating = session.state === "resolved" && session.rating === null;

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/30 backdrop-blur-[1px]" onClick={close} />
      <aside className="fixed right-0 top-0 z-[201] flex h-full w-full max-w-md flex-col border-l" style={{ background: "var(--surface-page)", borderColor: "var(--border-soft)" }} dir="auto">
        {/* Persistent case header */}
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
          <div className="flex min-w-0 items-center gap-2">
            <Terminal size={15} style={{ color: "var(--section-accent)" }} />
            <span className="truncate font-mono text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{session.subject ? session.subject : t("help.title")}</span>
            <span className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: `color-mix(in srgb, ${STATE_COLOR[session.state]} 14%, transparent)`, color: STATE_COLOR[session.state] }}>
              {STATE_LABEL[session.state]}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={newInquiry} title="Start new help inquiry" aria-label="Start new help inquiry" className="btn-icon h-7 w-7"><RotateCcw size={14} /></button>
            <button onClick={close} className="btn-icon h-7 w-7"><X size={15} /></button>
          </div>
        </div>

        {/* Live context rows (real, from /support/context) */}
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          {ctx.isLoading && <div className="flex items-center gap-2 font-mono text-[11.5px]" style={{ color: "var(--text-muted)" }}><Loader2 size={11} className="animate-spin" /> reading workspace context…</div>}
          {c && (
            <div className="space-y-1">
              <StatusRow label="user" value={`${c.identity.display_name} · ${c.identity.role}`} />
              <StatusRow label="plan" value={`${c.entitlement.tier}${c.entitlement.trial_ends_at ? " · trial" : ""}`} />
              {c.wallet.enrolled && <StatusRow label="credits" value={`${c.wallet.remaining.toLocaleString()} remaining${c.wallet.included_monthly_credits ? ` / ${c.wallet.included_monthly_credits.toLocaleString()} mo` : ""}`} />}
              <StatusRow label="search" value={c.diagnostics.sovereign_search ? "online" : "not configured"} ok={c.diagnostics.sovereign_search} />
              <StatusRow label="email" value={c.readiness.email_connected ? "connected" : "not connected"} ok={c.readiness.email_connected} />
            </div>
          )}
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {session.messages.length === 0 && (
            <>
              <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>{t("help.subtitle")}</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map(s => (
                  <button key={s} onClick={() => send(s)} className="rounded-sm border px-2.5 py-1 text-[11.5px] transition-colors hover:border-[color:var(--section-accent)]"
                    style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>{s}</button>
                ))}
              </div>
            </>
          )}
          {session.messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex flex-col items-start"}>
              <div className={`max-w-[90%] rounded-md px-3.5 py-2.5 text-[13px] leading-relaxed ${m.role === "user" ? "self-end rounded-br-sm" : "rounded-bl-sm"} ${m.system ? "italic" : ""}`}
                style={{ background: m.role === "user" ? "var(--surface-selected)" : "var(--surface-card)", color: m.system ? "var(--text-muted)" : "var(--text-primary)", border: "1px solid var(--border-soft)" }}>
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.role === "assistant" && (m.diagnostics?.length ?? 0) > 0 && (
                  <div className="mt-2.5 space-y-1 rounded-lg border p-2.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-page)" }}>
                    {m.diagnostics!.map((d, k) => <DiagRow key={k} d={d} />)}
                  </div>
                )}
              </div>
              {/* Suggested actions after every assistant answer */}
              {m.role === "assistant" && (m.actions?.length ?? 0) > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {m.actions!.map((a, k) => {
                    const isTicket = a.action === "create_ticket";
                    if (isTicket && session.ticketCreated) return null;
                    return (
                      <button key={k} onClick={() => runAction(a)}
                        className="rounded-sm border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:border-[color:var(--section-accent)]"
                        style={{ borderColor: isTicket ? "var(--border-strong)" : "var(--border-soft)", color: isTicket ? "var(--section-accent)" : "var(--text-secondary)" }}>
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text-muted)" }}><Loader2 size={13} className="animate-spin" /> …</div>}

          {/* Resolution controls — after Help has responded, ask if it's solved */}
          {showResolution && (
            <div className="rounded-sm border p-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
              <p className="mb-2 text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>Did this solve the issue?</p>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => update(s => ({ ...s, state: "resolved" }))} className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: "#5fae8b" }}>Fixed</button>
                <button onClick={() => send("It's still not resolved — what else can I try before opening a support request?")} className="rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>Still having trouble</button>
                {!session.ticketCreated && <button onClick={createTicket} className="rounded-lg border px-3 py-1.5 text-[12px] font-medium" style={{ borderColor: "var(--border-strong)", color: "var(--section-accent)" }}>Create support request</button>}
              </div>
            </div>
          )}

          {/* Rating step after "Fixed" */}
          {showRating && (
            <div className="rounded-sm border p-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
              <p className="mb-2 text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>How helpful was this? (1–5)</p>
              <div className="mb-2 flex gap-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} onClick={() => submitRating(n)} aria-label={`Rate ${n}`} className="transition-transform hover:scale-110">
                    <Star size={20} style={{ color: "#a3946b" }} />
                  </button>
                ))}
              </div>
              <textarea value={feedbackText} onChange={e => setFeedbackText(e.target.value)} rows={2} placeholder="Anything to add? (optional)"
                className="w-full resize-none rounded-lg border bg-transparent px-2.5 py-2 text-[12px] outline-none" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }} />
            </div>
          )}

          {session.state === "closed" && session.rating != null && (
            <p className="flex items-center gap-1.5 text-[12px] text-[#2f9e6b]"><Check size={13} /> Inquiry closed · rated {session.rating}/5. Start a new inquiry any time.</p>
          )}
        </div>

        <div className="border-t p-3" style={{ borderColor: "var(--border-soft)" }}>
          <div className="flex items-end gap-2">
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} rows={1}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={t("help.placeholder")}
              className="max-h-28 flex-1 resize-none rounded-lg border bg-transparent px-3 py-2 text-[13px] outline-none"
              style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }} />
            <button onClick={() => send()} disabled={busy || !input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white disabled:opacity-40" style={{ background: "var(--section-accent)" }}>
              <Send size={15} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
