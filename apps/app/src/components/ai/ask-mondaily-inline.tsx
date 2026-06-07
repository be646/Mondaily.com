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
      const response = await fetch(`${import.meta.env.VITE_API_URL || "/api/v1"}/ask/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {})
        },
        body: JSON.stringify({ message })
      });
      if (!response.ok || !response.body) throw new Error("Ask Mondaily request failed");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let result = "";
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        result += decoder.decode(chunk, { stream: true });
        onResponse?.(result);
      }
    } catch {
      onResponse?.("Mondaily could not reach the AI service. Check the API URL and authentication settings.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <form className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <input className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600" value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} />
      <button className="grid h-8 w-8 place-items-center text-red-400 disabled:opacity-40" type="submit" disabled={loading || !value.trim()} aria-label="Send">{loading ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}</button>
    </form>
  );
}
