import { useState, useEffect } from "react";
import { Trash2, MessageCircle } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { getThreads, saveThreads } from "../../../lib/chat-store";
import { apiFetch, getAuthHeaders } from "../../../lib/api-client";

const SETTINGS_KEY = "mondaily_ask_settings";

interface AskSettings {
  privacy: "allow" | "dont_allow" | "always_ask";
  webSearch: "allow" | "dont_allow" | "always_ask";
  shareDownvoted: "allow" | "dont_share" | "always_ask";
  model: "auto" | "fast" | "smart";
  // Advanced behavior
  tone: "concise" | "balanced" | "detailed";
  scope: "workspace" | "both";
  autonomy: "ask" | "auto";
}

const DEFAULTS: AskSettings = {
  privacy: "always_ask", webSearch: "allow", shareDownvoted: "dont_share", model: "auto",
  tone: "balanced", scope: "both", autonomy: "ask",
};

function loadSettings(): AskSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function saveSettings(s: AskSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

function Dropdown({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-card)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-stone-500"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Row({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-[var(--border-soft)] last:border-0">
      <div className="min-w-0">
        <div className="text-sm text-[var(--text-primary)]">{label}</div>
        <div className="text-xs text-stone-500 mt-0.5">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function AskMondailySettings() {
  const [settings, setSettings] = useState<AskSettings>(loadSettings);
  const [threads, setThreads] = useState(() => getThreads());
  const [credits, setCredits] = useState<{ used: number; limit: number; period_end: string } | null>(null);

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || "";
    getAuthHeaders().then(headers =>
      apiFetch(`${apiUrl}/api/v1/ask/credits`, { headers })
        .then(r => r.json())
        .then(data => setCredits(data))
        .catch((e) => console.error("[bg-task] swallowed error:", e))
    );
  }, []);

  const update = (patch: Partial<AskSettings>) => {
    const updated = { ...settings, ...patch };
    setSettings(updated);
    saveSettings(updated);
  };

  const deleteThread = (id: string) => {
    const updated = threads.filter(t => t.id !== id);
    saveThreads(updated);
    setThreads(updated);
  };

  const deleteAllThreads = () => {
    saveThreads([]);
    setThreads([]);
  };

  // Count messages across all threads for credits
  const usedCredits = credits?.used ?? threads.reduce((sum, t) => sum + t.messages.filter(m => m.role === "user").length, 0);
  const creditLimit = credits?.limit ?? 1000;
  const creditPct = Math.min(Math.round((usedCredits / creditLimit) * 100), 100);

  // Next reset date — first day of next month
  const now = new Date();
  const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const resetStr = resetDate.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

  const privacyOptions = [
    { value: "allow", label: "Allow" },
    { value: "dont_allow", label: "Don't allow" },
    { value: "always_ask", label: "Always ask" },
  ];
  const shareOptions = [
    { value: "allow", label: "Allow" },
    { value: "dont_share", label: "Don't share" },
    { value: "always_ask", label: "Always ask" },
  ];
  const modelOptions = [
    { value: "auto", label: "Auto" },
    { value: "fast", label: "Fast" },
    { value: "smart", label: "Smart" },
  ];
  const toneOptions = [
    { value: "concise", label: "Concise" },
    { value: "balanced", label: "Balanced" },
    { value: "detailed", label: "Detailed" },
  ];
  const scopeOptions = [
    { value: "workspace", label: "Workspace only" },
    { value: "both", label: "Workspace + web" },
  ];
  const autonomyOptions = [
    { value: "ask", label: "Ask before acting" },
    { value: "auto", label: "Act autonomously" },
  ];

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)" }}>
          <LogoMark size={18} style={{ color: "var(--accent)" }}/>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em]" style={{ color: "var(--accent)" }}>// ASK MONDAILY</p>
          <p className="text-xs text-stone-500">Model, behavior, privacy, and conversation history for the AI console.</p>
        </div>
      </div>

      {/* General */}
      <section className="mb-6 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-hover)]">
        <div className="border-b border-[var(--border-soft)] px-5 py-3">
          <h2 className="text-sm font-medium text-[var(--text-primary)]">General</h2>
        </div>
        <Row label="Privacy" description="Web search queries will be shared with external search providers.">
          <Dropdown value={settings.privacy} onChange={v => update({ privacy: v as AskSettings["privacy"] })} options={privacyOptions}/>
        </Row>
        <Row label="Web search" description="Allow Mondaily AI to search the web for current information.">
          <Dropdown value={settings.webSearch} onChange={v => update({ webSearch: v as AskSettings["webSearch"] })} options={privacyOptions}/>
        </Row>
        <Row label="Share downvoted messages" description="Share conversations to help our team improve Mondaily AI.">
          <Dropdown value={settings.shareDownvoted} onChange={v => update({ shareDownvoted: v as AskSettings["shareDownvoted"] })} options={shareOptions}/>
        </Row>
      </section>

      {/* Model */}
      <section className="mb-6 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-hover)]">
        <div className="border-b border-[var(--border-soft)] px-5 py-3">
          <h2 className="text-sm font-medium text-[var(--text-primary)]">Model</h2>
        </div>
        <Row label="Default model" description="This model will be used to generate all responses unless overridden.">
          <Dropdown value={settings.model} onChange={v => update({ model: v as AskSettings["model"] })} options={modelOptions}/>
        </Row>
      </section>

      {/* Behavior — advanced response + autonomy controls */}
      <section className="mb-6 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-hover)]">
        <div className="border-b border-[var(--border-soft)] px-5 py-3">
          <h2 className="text-sm font-medium text-[var(--text-primary)]">Behavior</h2>
        </div>
        <Row label="Response tone" description="How concise or thorough Mondaily's answers should be.">
          <Dropdown value={settings.tone} onChange={v => update({ tone: v as AskSettings["tone"] })} options={toneOptions}/>
        </Row>
        <Row label="Default scope" description="Whether the AI reasons over your workspace only, or augments with web search.">
          <Dropdown value={settings.scope} onChange={v => update({ scope: v as AskSettings["scope"] })} options={scopeOptions}/>
        </Row>
        <Row label="Agent autonomy" description="Whether agents ask for approval before taking actions, or act on their own.">
          <Dropdown value={settings.autonomy} onChange={v => update({ autonomy: v as AskSettings["autonomy"] })} options={autonomyOptions}/>
        </Row>
      </section>

      {/* Credits */}
      <section className="mb-6 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-hover)]">
        <div className="border-b border-[var(--border-soft)] px-5 py-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--text-primary)]">Credits</h2>
          <span className="text-xs text-stone-500">Resets on {resetStr}</span>
        </div>
        <div className="px-5 py-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-stone-500">Personal credits used</span>
            <span className="text-[var(--text-primary)] font-medium">{usedCredits} / {creditLimit}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-[var(--surface-hover)]">
            <div className="h-1.5 rounded-full transition-all" style={{ width: `${creditPct}%`, background: "var(--accent)" }}/>
          </div>
          <p className="mt-3 text-xs text-stone-600">Each message you send uses 1 credit. Workspace credits and higher limits available with Pro plan.</p>
        </div>
      </section>

      {/* Chat history */}
      <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-hover)]">
        <div className="border-b border-[var(--border-soft)] px-5 py-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--text-primary)]">Chat history</h2>
          {threads.length > 0 && (
            <button onClick={deleteAllThreads} className="text-xs text-red-400 hover:text-red-300 transition-colors">Delete all</button>
          )}
        </div>
        {threads.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-stone-600">No conversations yet</div>
        ) : (
          <div className="divide-y divide-white/10">
            {threads.map(t => (
              <div key={t.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <MessageCircle size={13} className="text-stone-600 shrink-0"/>
                  <div className="min-w-0">
                    <div className="text-sm text-stone-300 truncate">{t.title}</div>
                    <div className="text-xs text-stone-600">{t.messages.length} messages · {new Date(t.updatedAt).toLocaleDateString()}</div>
                  </div>
                </div>
                <button onClick={() => deleteThread(t.id)} className="ml-4 shrink-0 rounded-lg p-1.5 text-stone-600 hover:bg-red-500/10 hover:text-red-400 transition-colors">
                  <Trash2 size={13}/>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
