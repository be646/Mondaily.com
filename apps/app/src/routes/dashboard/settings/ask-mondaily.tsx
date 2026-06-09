import { useState } from "react";
import { Sparkles, Trash2, MessageCircle, ExternalLink } from "lucide-react";
import { getThreads, saveThreads } from "../../../lib/chat-store";

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`relative h-5 w-9 rounded-full transition-colors ${enabled ? "bg-red-500" : "bg-white/10"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`}/>
    </button>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="rounded-lg border border-white/10 bg-[#0d0f13] px-3 py-1.5 text-sm text-white">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function AskMondailySettings() {
  const [webSearch, setWebSearch] = useState(true);
  const [shareDownvoted, setShareDownvoted] = useState(false);
  const [model, setModel] = useState("auto");
  const [threads, setThreads] = useState(() => getThreads());

  const deleteThread = (id: string) => {
    const updated = threads.filter(t => t.id !== id);
    saveThreads(updated);
    setThreads(updated);
  };

  const deleteAllThreads = () => {
    saveThreads([]);
    setThreads([]);
  };

  const credits = 46;
  const creditLimit = 1000;
  const creditPct = Math.round((credits / creditLimit) * 100);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/10">
          <Sparkles size={18} className="text-red-400"/>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-white">Ask Mondaily</h1>
          <p className="text-xs text-slate-500">Manage your Ask Mondaily settings, prompts and tool access.</p>
        </div>
      </div>

      {/* General */}
      <section className="mb-6 rounded-xl border border-white/10 bg-white/[.02]">
        <div className="border-b border-white/10 px-5 py-3">
          <h2 className="text-sm font-medium text-white">General</h2>
        </div>

        {/* Privacy */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <div className="text-sm text-white">Privacy</div>
            <div className="text-xs text-slate-500 mt-0.5">Web search queries will be shared with external search providers.</div>
          </div>
          <span className="text-xs text-slate-500">Always ask</span>
        </div>

        {/* Web search */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <div className="text-sm text-white">Web search</div>
            <div className="text-xs text-slate-500 mt-0.5">Allow Mondaily AI to search the web for current information.</div>
          </div>
          <Toggle enabled={webSearch} onChange={setWebSearch}/>
        </div>

        {/* Share downvoted */}
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <div className="text-sm text-white">Share downvoted messages</div>
            <div className="text-xs text-slate-500 mt-0.5">Share conversations to help our team improve Mondaily AI.</div>
          </div>
          <Toggle enabled={shareDownvoted} onChange={setShareDownvoted}/>
        </div>
      </section>

      {/* Model */}
      <section className="mb-6 rounded-xl border border-white/10 bg-white/[.02]">
        <div className="border-b border-white/10 px-5 py-3">
          <h2 className="text-sm font-medium text-white">Model</h2>
        </div>
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <div className="text-sm text-white">Default model</div>
            <div className="text-xs text-slate-500 mt-0.5">This model will be used to generate all responses unless overridden.</div>
          </div>
          <Select value={model} onChange={setModel} options={[
            { value: "auto", label: "Auto" },
            { value: "fast", label: "Fast" },
            { value: "smart", label: "Smart" },
          ]}/>
        </div>
      </section>

      {/* Credits */}
      <section className="mb-6 rounded-xl border border-white/10 bg-white/[.02]">
        <div className="border-b border-white/10 px-5 py-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-white">Credits</h2>
          <span className="text-xs text-slate-500">Resets on 6 Jul 2026</span>
        </div>
        <div className="px-5 py-4">
          <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
            <span>Personal credits used</span>
            <span className="text-white">{credits} / {creditLimit}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/10">
            <div className="h-1.5 rounded-full bg-red-500 transition-all" style={{ width: `${creditPct}%` }}/>
          </div>
          <p className="mt-3 text-xs text-slate-600">Workspace credits and higher limits coming soon with Pro plan.</p>
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
