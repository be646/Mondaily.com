import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { HelpCircle, X, Send, Loader2, Check, Terminal } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useLanguage } from "../../hooks/useLanguage";

/**
 * Smart Help / Support — a terminal-styled, source-backed assistant that feels like Mondaily's
 * onboarding console (not a generic support widget). On open it loads the REAL workspace context
 * (GET /support/context) and shows it as status rows — no fake loading, no invented diagnostics.
 * The agent (POST /support/ask) is read-only, knows the user's identity/plan/credits, may suggest
 * upgrades/credit packs but NEVER performs account actions; sensitive requests become a ticket
 * (POST /support/tickets) stamped with the requester's identity + current route.
 *
 * Entry points: the top-header help icon (HelpTopButton) and useHelp().open() from anywhere
 * (e.g. Billing). No floating button over the sidebar/user area.
 */

interface HelpMsg { role: "user" | "assistant"; content: string; category?: string; needsTicket?: boolean; suggestedSubject?: string }
type AskResp = { answer: string; category: string; needs_ticket: boolean; suggested_subject: string; language: string; cited_docs: string[] };
interface SupportContext {
  identity: { display_name: string; email: string | null; role: string; workspace_name: string };
  language: string;
  entitlement: { tier: string; trial_ends_at: string | null };
  wallet: { remaining: number; included_monthly_credits: number | null; enrolled: boolean };
  readiness: { enabled_modules: string[]; email_connected: boolean };
  diagnostics: { ai_gateway: boolean; sovereign_search: boolean; sovereign_scrape: boolean };
}

const HelpContext = createContext<{ open: (prefill?: string) => void }>({ open: () => {} });
export const useHelp = () => useContext(HelpContext);

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prefill, setPrefill] = useState("");
  const open = useCallback((p?: string) => { setPrefill(p ?? ""); setIsOpen(true); }, []);
  return (
    <HelpContext.Provider value={{ open }}>
      {children}
      {isOpen && <HelpPanel prefill={prefill} onClose={() => setIsOpen(false)} />}
    </HelpContext.Provider>
  );
}

/** The main Help entry — a small icon for the top header. */
export function HelpTopButton() {
  const { open } = useHelp();
  return (
    <button onClick={() => open()} title="Help & Support" aria-label="Help & Support"
      className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-stone-100 dark:hover:bg-stone-900"
      style={{ color: "var(--text-faint)" }}>
      <HelpCircle size={15} />
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

function HelpPanel({ prefill, onClose }: { prefill: string; onClose: () => void }) {
  const { t } = useLanguage();
  const [input, setInput] = useState(prefill);
  const [msgs, setMsgs] = useState<HelpMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [ticketDone, setTicketDone] = useState<Record<number, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  // REAL context — the terminal status rows reflect data actually loaded (no fake diagnostics).
  const ctx = useQuery<SupportContext>({ queryKey: ["support-context"], queryFn: () => apiClient.get("/support/context"), staleTime: 60_000, retry: false });

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, busy]);

  async function send(text0?: string) {
    const text = (text0 ?? input).trim();
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
        route: window.location.pathname,   // context only — the backend never acts on this
        metadata: { source: "help_agent" },
      });
      setTicketDone(d => ({ ...d, [idx]: true }));
    } catch { /* keep the chat usable even if ticket creation hiccups */ }
  }

  const c = ctx.data;
  const suggestions = ["What plan am I on?", "How many credits do I have?", "How do I use Discovery?"];

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-[201] flex h-full w-full max-w-md flex-col border-l shadow-2xl"
        style={{ background: "var(--surface-page)", borderColor: "var(--border-soft)" }} dir="auto">
        {/* Terminal-style header */}
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
          <div className="flex items-center gap-2">
            <Terminal size={15} style={{ color: "var(--section-accent)" }} />
            <span className="font-mono text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{t("help.title")}</span>
          </div>
          <button onClick={onClose} className="btn-icon h-7 w-7"><X size={15} /></button>
        </div>

        {/* Real context rows */}
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
          {msgs.length === 0 && (
            <>
              <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>{t("help.subtitle")}</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map(s => (
                  <button key={s} onClick={() => send(s)} className="rounded-full border px-2.5 py-1 text-[11.5px] transition-colors hover:border-[color:var(--section-accent)]"
                    style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>{s}</button>
                ))}
              </div>
            </>
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
            <textarea value={input} onChange={e => setInput(e.target.value)} rows={1}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={t("help.placeholder")}
              className="max-h-28 flex-1 resize-none rounded-lg border bg-transparent px-3 py-2 text-[13px] outline-none"
              style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }} />
            <button onClick={() => send()} disabled={busy || !input.trim()}
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
