import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { HelpCircle, X, Send, Loader2, LifeBuoy, Check } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useLanguage } from "../../hooks/useLanguage";

/**
 * Smart Help / Support surface. A right-side slide-over chat backed by the source-backed support
 * agent (POST /support/ask) — read-only, language-aware, never takes account actions. When the agent
 * flags a sensitive request it offers "Create support request" (POST /support/tickets). Opened from a
 * floating help button (mounted here) and via useHelp().open() from anywhere (Settings, Billing, …).
 */

interface HelpMsg { role: "user" | "assistant"; content: string; category?: string; needsTicket?: boolean; suggestedSubject?: string }
type AskResp = { answer: string; category: string; needs_ticket: boolean; suggested_subject: string; language: string };

const HelpContext = createContext<{ open: (prefill?: string) => void }>({ open: () => {} });
export const useHelp = () => useContext(HelpContext);

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prefill, setPrefill] = useState("");
  const open = useCallback((p?: string) => { setPrefill(p ?? ""); setIsOpen(true); }, []);
  return (
    <HelpContext.Provider value={{ open }}>
      {children}
      {/* Floating help button — the always-available entry point (top/help icon). */}
      <button
        onClick={() => open()}
        title="Help & Support"
        aria-label="Help & Support"
        className="fixed bottom-5 left-5 z-[190] flex h-10 w-10 items-center justify-center rounded-full border shadow-[0_8px_24px_-8px_rgba(0,0,0,0.35)] transition-all hover:-translate-y-0.5"
        style={{ background: "var(--surface-card)", borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}
      >
        <HelpCircle size={18} />
      </button>
      {isOpen && <HelpPanel prefill={prefill} onClose={() => setIsOpen(false)} />}
    </HelpContext.Provider>
  );
}

function HelpPanel({ prefill, onClose }: { prefill: string; onClose: () => void }) {
  const { t } = useLanguage();
  const [input, setInput] = useState(prefill);
  const [msgs, setMsgs] = useState<HelpMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [ticketDone, setTicketDone] = useState<Record<number, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const history = msgs.map(m => ({ role: m.role, content: m.content }));
    setMsgs(m => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const r = await apiClient.post<AskResp>("/support/ask", { message: text, history });
      setMsgs(m => [...m, { role: "assistant", content: r.answer, category: r.category, needsTicket: r.needs_ticket, suggestedSubject: r.suggested_subject }]);
    } catch {
      setMsgs(m => [...m, { role: "assistant", content: "I couldn't reach the help service. Please try again in a moment.", needsTicket: true, category: "bug_report", suggestedSubject: "Help service error" }]);
    } finally { setBusy(false); }
  }

  async function createTicket(idx: number, m: HelpMsg) {
    const priorUser = [...msgs].slice(0, idx).reverse().find(x => x.role === "user");
    try {
      await apiClient.post("/support/tickets", {
        category: m.category ?? "bug_report",
        subject: (m.suggestedSubject || priorUser?.content || "Support request").slice(0, 200),
        message: `${priorUser?.content ?? ""}\n\n---\nAgent summary: ${m.content}`.trim(),
        metadata: { source: "help_agent" },
      });
      setTicketDone(d => ({ ...d, [idx]: true }));
    } catch { /* keep the chat usable even if ticket creation hiccups */ }
  }

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-[201] flex h-full w-full max-w-md flex-col border-l shadow-2xl"
        style={{ background: "var(--surface-page)", borderColor: "var(--border-soft)" }} dir="auto">
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <div className="flex items-center gap-2">
            <LifeBuoy size={16} style={{ color: "var(--section-accent)" }} />
            <span className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>{t("help.title")}</span>
          </div>
          <button onClick={onClose} className="btn-icon h-7 w-7"><X size={15} /></button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {msgs.length === 0 && (
            <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>{t("help.subtitle")}</p>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${m.role === "user" ? "rounded-br-sm" : "rounded-bl-sm"}`}
                style={{ background: m.role === "user" ? "var(--surface-selected)" : "var(--surface-card)", color: "var(--text-primary)", border: "1px solid var(--border-soft)" }}>
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.role === "assistant" && m.needsTicket && (
                  ticketDone[i]
                    ? <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-emerald-500"><Check size={12} /> {t("help.ticket_created")}</p>
                    : <button onClick={() => createTicket(i, m)} className="mt-2 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors hover:border-[color:var(--section-accent)]"
                        style={{ borderColor: "var(--border-strong)", color: "var(--section-accent)" }}>{t("help.create_ticket")}</button>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text-muted)" }}><Loader2 size={13} className="animate-spin" /> …</div>}
        </div>

        <div className="border-t p-3" style={{ borderColor: "var(--border-soft)" }}>
          <div className="flex items-end gap-2">
            <textarea
              value={input} onChange={e => setInput(e.target.value)} rows={1}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={t("help.placeholder")}
              className="max-h-28 flex-1 resize-none rounded-lg border bg-transparent px-3 py-2 text-[13px] outline-none"
              style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }} />
            <button onClick={send} disabled={busy || !input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white disabled:opacity-40"
              style={{ background: "var(--section-accent)" }}>
              <Send size={15} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
