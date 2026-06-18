import { Loader2, Send } from "lucide-react";
import { useState } from "react";

export function AskMondailyInline({ placeholder, onResponse }: { placeholder: string; onResponse?: (text: string) => void }) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    const message = value.trim();
    if (!message || loading) return;
    setLoading(true);
    setValue("");
    try {
      const token = localStorage.getItem("mondaily_session_token");
      const workspaceId = localStorage.getItem("mondaily_workspace_id");
      const apiUrl = import.meta.env.PROD ? "https://api.mondaily.com" : (import.meta.env.VITE_API_URL || "");
      if (!token) {
        onResponse?.("Please sign in again before using Ask Mondaily.");
        return;
      }

      if (!workspaceId) {
        onResponse?.("Please finish onboarding and create a workspace before using Ask Mondaily.");
        return;
      }

      const response = await fetch(`${apiUrl}/api/v1/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Workspace-Id": workspaceId
        },
        body: JSON.stringify({ message })
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        onResponse?.(text || "Ask Mondaily failed.");
        return;
      }

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
      className="flex items-center gap-2 rounded-lg border-x border-t border-white/[.10] border-b-2 border-b-white/[.18] bg-white/[.04] px-3 py-2 focus-within:border-b-red-500/40 transition-colors"
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      <input
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
      />
      <button
        className="grid h-8 w-8 place-items-center text-red-400 disabled:opacity-40"
        type="submit"
        disabled={loading || !value.trim()}
      >
        {loading ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
      </button>
    </form>
  );
}
