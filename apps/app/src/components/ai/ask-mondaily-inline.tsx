import { Loader2, Send } from "lucide-react";
import { useState } from "react";
import { getAuthHeaders } from "../../lib/api-client";
import { MondailyLogo } from "./mondaily-logo";

export function AskMondailyInline({ placeholder, onResponse }: { placeholder: string; onResponse?: (text: string) => void }) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    const message = value.trim();
    if (!message || loading) return;
    setLoading(true);
    setValue("");
    try {
      const headers = await getAuthHeaders();
      const apiUrl = import.meta.env.VITE_API_URL || "";
      const response = await fetch(`${apiUrl}/api/v1/ask`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message })
      });
      const data = await response.json();
      onResponse?.(data.reply || data.message || "No response.");
    } catch (err: any) {
      onResponse?.(`Connection error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      className="flex items-center gap-2 rounded-lg border border-white/[.10] bg-white/[.04] px-3 py-2 focus-within:border-indigo-500/40 transition-colors"
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      <span className="shrink-0 text-indigo-400">
        <MondailyLogo size={16} thinking={loading}/>
      </span>
      <input
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
      />
      <button
        className="grid h-8 w-8 place-items-center text-indigo-400 disabled:opacity-40"
        type="submit"
        disabled={loading || !value.trim()}
      >
        {loading ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
      </button>
    </form>
  );
}
