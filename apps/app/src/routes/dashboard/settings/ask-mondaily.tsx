import { useState, useEffect } from "react";
import { Sparkles, Trash2, MessageCircle } from "lucide-react";
import { getThreads, saveThreads } from "../../../lib/chat-store";

const SETTINGS_KEY = "mondaily_ask_settings";

interface AskSettings {
  privacy: "allow" | "dont_allow" | "always_ask";
  webSearch: "allow" | "dont_allow" | "always_ask";
  shareDownvoted: "allow" | "dont_share" | "always_ask";
  model: "auto" | "fast" | "smart";
}

function loadSettings(): AskSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { privacy: "always_ask", webSearch: "allow", shareDownvoted: "dont_share", model: "auto" };
  } catch {
    return { privacy: "always_ask", webSearch: "allow", shareDownvoted: "dont_share", model: "auto" };
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
      className="rounded-lg border border-white/10 bg-[#0d0f13] px-3 py-1.5 text-sm text-white focus:border-red-500/40 outline-none"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Row({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-white/10 last:border-0">
      <div className="min-w-0">
        <div className="text-sm text-white">{label}</div>
        <div className="text-xs text-slate-500 mt-0.5">{description}</div>
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
    const token = localStorage.getItem("mondaily_session_token");
    const workspaceId = localStorage.getItem("mondaily_workspace_id");
    const apiUrl = (window as any).__VITE_API_URL__ || import.meta.env.VITE_API_URL || "";
    fetch(`${apiUrl}/api/v1/ask/credits`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {})
      }
    })
      .then(r => r.json())
      .then(data => setCredits(data))
      .catch(() => {});
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

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/10">
          <Sparkles size={18} className="text-red-400"/>
        </div>
        <div>
          <p className="text-xs text-slate-500">Manage your Ask Mondaily settings, prompts and tool access.</p>
        </div>
      </div>

      {/* General */}
      <section className="mb-6 rounded-xl border border-white/10 bg-white/[.02]">
        <div className="border-b border-white/10 px-5 py-3">
          <h2 className="text-sm font-medium text-white">General</h2>
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
      <section className="mb-6 rounded-xl border border-white/10 bg-white/[.02]">
        <div className="border-b border-white/10 px-5 py-3">
          <h2 className="text-sm font-medium text-white">Model</h2>
        </div>
        <Row label="Default model" description="This model will be used to generate all responses unless overridden.">
          <Dropdown value={settings.model} onChange={v => update({ model: v as AskSettings["model"] })} options={modelOptions}/>
        </Row>
      </section>

      {/* Credits */}
      <section className="mb-6 rounded-xl border border-white/10 bg-white/[.02]">
        <div className="border-b border-white/10 px-5 py-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-white">Credits</h2>
          <span className="text-xs text-slate-500">Resets on {resetStr}</span>
        </div>
        <div className="px-5 py-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-slate-500">Personal credits used</span>
            <span className="text-white font-medium">{usedCredits} / {creditLimit}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/10">
            <div className="h-1.5 rounded-full bg-red-500 transition-all" style={{ width: `${creditPct}%` }}/>
          </div>
          <p className="mt-3 text-xs text-slate-600">Each message you send uses 1 credit. Workspace credits and higher limits available with Pro plan.</p>
        </div>
      </section>

      {/* Chat history */}
      <section className="rounded-xl border border-white/10 bg-white/[.02]">
        <div className="border-b border-white/10 px-5 py-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-white">Chat history</h2>
          {threads.length > 0 && (
            <button onClick={deleteAllThreads} className="text-xs text-red-400 hover:text-red-300 transition-colors">Delete all</button>
          )}
        </div>
        {threads.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-slate-600">No conversations yet</div>
        ) : (
          <div className="divide-y divide-white/10">
            {threads.map(t => (
              <div key={t.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <MessageCircle size={13} className="text-slate-600 shrink-0"/>
                  <div className="min-w-0">
                    <div className="text-sm text-slate-300 truncate">{t.title}</div>
                    <div className="text-xs text-slate-600">{t.messages.length} messages · {new Date(t.updatedAt).toLocaleDateString()}</div>
                  </div>
                </div>
                <button onClick={() => deleteThread(t.id)} className="ml-4 shrink-0 rounded-lg p-1.5 text-slate-600 hover:bg-red-500/10 hover:text-red-400 transition-colors">
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
