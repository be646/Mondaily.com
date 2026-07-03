import { Loader2, Send } from "lucide-react";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { apiFetch, getAuthHeaders } from "../../lib/api-client";
import { LogoMark } from "../logo";
import { friendlyAskError } from "./ask-shared";
import { askModeForPath } from "../../lib/ask-mode";

export function AskMondailyInline({ placeholder, onResponse }: { placeholder: string; onResponse?: (text: string) => void }) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const mode = askModeForPath(useLocation().pathname);

  async function submit() {
    const message = value.trim();
    if (!message || loading) return;
    setLoading(true);
    setValue("");
    try {
      const headers = await getAuthHeaders();
      const apiUrl = import.meta.env.VITE_API_URL || "";
      const response = await apiFetch(`${apiUrl}/api/v1/ask`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message })
      });
      if (!response.ok) throw new Error(`AI error: ${response.status}`);
      const data = await response.json();
      onResponse?.(data.reply || data.message || "No response.");
    } catch (err: any) {
      onResponse?.(friendlyAskError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      className="flex items-center gap-2 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2 transition-colors focus-within:border-[var(--section-accent)]"
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      <span className="shrink-0" style={{ color: "var(--section-accent)" }}>
        <LogoMark size={16} thinking={loading}/>
      </span>
      {/* Page-aware mode label — names the scope the (existing) Ask engine is grounded in here. */}
      <span title={mode.hint} className="shrink-0 rounded-full border px-1.5 py-0.5 text-[9.5px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
        {mode.label}
      </span>
      <input
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-stone-600"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
      />
      <button
        className="grid h-8 w-8 place-items-center rounded-lg text-stone-400 transition-colors hover:bg-stone-500/10 disabled:opacity-40"
        type="submit"
        disabled={loading || !value.trim()}
      >
        {loading ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
      </button>
    </form>
  );
}
