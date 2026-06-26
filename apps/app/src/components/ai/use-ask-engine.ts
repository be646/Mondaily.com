import { useCallback, useState } from "react";
import { getThreads, saveThreads, createThread, addMessageToThread, type ChatMessage, type ChatThread } from "../../lib/chat-store";
import { getAuthHeaders } from "../../lib/api-client";
import {
  inferAgentHandoff, friendlyAskError, mapBackendSources,
  type AgentHandoff, type SourceCardData, type BackendSourceMeta,
} from "./ask-shared";
import type { AskPageContext } from "../../lib/ask-context-store";

/**
 * The one request pipeline every Ask/AI chat surface in the app must use —
 * main Ask Mondaily page, the Home dashboard box, and the right-side Ask AI
 * drawer. Different surfaces may render this differently (full screen,
 * compact, drawer) but must all get identical behavior: same endpoint, same
 * thread_id + history handling, same context passthrough, same agent
 * inference, same real (never fabricated) sources, same action-chip text.
 *
 * Threads persist via chat-store.ts (localStorage, keyed by thread id), so
 * a thread started on Home is the same thread when opened at /ask/:threadId
 * — no separate "memory" per surface.
 */

export type TokenUsage = { prompt_tokens: number; completion_tokens: number; total_tokens: number; reasoning_tokens?: number };
export type MessageMeta = Record<number, { agent: AgentHandoff; sources: SourceCardData[]; tokens?: number; usage?: TokenUsage; tokensExact?: boolean }>;

/** Fallback token estimate (~4 chars/token) when the provider returns no usage
 *  (e.g. the Anthropic fallback path). Shown with a "~" prefix in the UI. */
export const estimateTokens = (t: string): number => Math.max(1, Math.round((t ?? "").trim().length / 4));

/** Rebuild per-message agent + source cards from a stored thread, so reopening
 *  a conversation shows the records the AI found, not just the text. */
function metaFromMessages(msgs: ChatMessage[]): MessageMeta {
  const meta: MessageMeta = {};
  msgs.forEach((m, i) => {
    if (m.role === "assistant") {
      meta[i] = {
        agent: inferAgentHandoff(msgs[i - 1]?.content ?? ""),
        sources: mapBackendSources(m.sources as BackendSourceMeta[] | undefined),
        tokens: estimateTokens(m.content ?? ""),
      };
    }
  });
  return meta;
}

export interface UseAskEngineOptions {
  /** Page-level context (selected record/task/etc) passed to every request on this surface. */
  context?: AskPageContext;
  /** Existing thread to resume, if any (e.g. /ask/:threadId). */
  initialThreadId?: string | null;
  /** Called right after an assistant reply lands, with its index and full text — lets a surface drive its own streaming/typewriter animation. */
  onAssistantMessage?: (index: number, fullText: string) => void;
}

export function useAskEngine(opts: UseAskEngineOptions = {}) {
  const initial: ChatThread | undefined = opts.initialThreadId
    ? getThreads().find(t => t.id === opts.initialThreadId)
    : undefined;

  const [messages, setMessages] = useState<ChatMessage[]>(initial?.messages ?? []);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(initial?.id ?? null);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [messageMeta, setMessageMeta] = useState<MessageMeta>(() => metaFromMessages(initial?.messages ?? []));
  /** Live token count of the answer currently streaming (resets each send). */
  const [tokenCount, setTokenCount] = useState(0);
  /** Current tool-activity status during streaming, e.g. "Running search records…". */
  const [streamStatus, setStreamStatus] = useState<string | null>(null);

  const loadThread = useCallback((threadId: string | null) => {
    if (!threadId) { setMessages([]); setCurrentThreadId(null); setMessageMeta({}); setSuggestions([]); return; }
    const t = getThreads().find(t => t.id === threadId);
    setMessages(t?.messages ?? []);
    setCurrentThreadId(t?.id ?? null);
    setMessageMeta(metaFromMessages(t?.messages ?? []));
    setSuggestions([]);
  }, []);

  const doSend = useCallback(async (text: string) => {
    if (!text || loading) return;
    let tid = currentThreadId;
    if (!tid) {
      const thread = createThread(text);
      saveThreads([thread, ...getThreads()]);
      tid = thread.id;
      setCurrentThreadId(tid);
    }
    // History captured BEFORE the new message is appended — this is what
    // gives the backend real memory of the thread on every surface.
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    const userMsg: ChatMessage = { role: "user", content: text };
    const withUser = [...messages, userMsg];
    setMessages(withUser);
    addMessageToThread(tid, userMsg);
    setLoading(true);
    setSuggestions([]);
    setTokenCount(0);
    setStreamStatus(null);

    let model = "auto";
    let web_search = false;
    try {
      const s = JSON.parse(localStorage.getItem("mondaily_ask_settings") || "{}");
      model = s.model ?? "auto";
      web_search = s.webSearch === "allow";
    } catch {}
    const headers = await getAuthHeaders();
    const apiUrl = import.meta.env.VITE_API_URL || "";
    const body = JSON.stringify({ message: text, model, web_search, history, thread_id: tid, context: opts.context });
    const aiIdx = withUser.length; // index the assistant message will occupy

    try {
      // ── Streaming path (SSE): tokens render live, like Claude.ai ──
      const res = await fetch(`${apiUrl}/api/v1/ask/stream`, { method: "POST", headers, body });
      if (!res.ok || !res.body) throw new Error(`AI error: ${res.status}`);

      // Seed an empty assistant message we fill as tokens arrive.
      setMessages([...withUser, { role: "assistant", content: "" }]);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamed = "";
      let tokens = 0;
      let finalReply = "";
      let finalSources: BackendSourceMeta[] | undefined;
      let finalSuggestions: string[] = [];
      let finalUsage: TokenUsage | undefined;
      let liveSources: BackendSourceMeta[] = []; // accumulated from streamed `sources` events

      const applyText = (t: string) =>
        setMessages(prev => { const c = [...prev]; c[aiIdx] = { role: "assistant", content: t }; return c; });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload) continue;
          let ev: any;
          try { ev = JSON.parse(payload); } catch { continue; }
          if (ev.type === "token") {
            streamed += ev.text;
            tokens += 1;
            setTokenCount(tokens);
            setStreamStatus(null);
            applyText(streamed.replace(/<followups>[\s\S]*$/, "")); // never show the control block
          } else if (ev.type === "status") {
            setStreamStatus(ev.text);
          } else if (ev.type === "sources") {
            // Cards stream in the instant each tool finishes — render them now,
            // while the model is still generating the text answer.
            liveSources = [...liveSources, ...((ev.sources ?? []) as BackendSourceMeta[])];
            setMessageMeta(prev => ({ ...prev, [aiIdx]: { agent: inferAgentHandoff(text), sources: mapBackendSources(liveSources) } }));
          } else if (ev.type === "done") {
            finalReply = ev.reply ?? streamed;
            finalSources = ev.sources;
            finalSuggestions = ev.suggestions ?? [];
            finalUsage = ev.usage;
          }
        }
      }

      const reply = finalReply || streamed || "No response.";
      const savedSources = finalSources ?? liveSources;
      applyText(reply);
      addMessageToThread(tid, { role: "assistant", content: reply, sources: savedSources });
      setMessageMeta(prev => ({ ...prev, [aiIdx]: { agent: inferAgentHandoff(text), sources: mapBackendSources(savedSources), tokens: finalUsage?.total_tokens ?? estimateTokens(reply), usage: finalUsage, tokensExact: finalUsage != null } }));
      if (finalSuggestions.length) setSuggestions(finalSuggestions);
      setStreamStatus(null);
      opts.onAssistantMessage?.(aiIdx, reply);
    } catch (err: any) {
      // ── Fallback: non-streaming endpoint if streaming is unavailable ──
      try {
        const res = await fetch(`${apiUrl}/api/v1/ask`, { method: "POST", headers, body });
        if (!res.ok) throw new Error(`AI error: ${res.status}`);
        const data = await res.json() as { reply?: string; suggestions?: string[]; sources?: BackendSourceMeta[]; usage?: TokenUsage };
        const reply = data.reply || "No response.";
        setMessages([...withUser, { role: "assistant", content: reply }]);
        addMessageToThread(tid, { role: "assistant", content: reply });
        setMessageMeta(prev => ({ ...prev, [aiIdx]: { agent: inferAgentHandoff(text), sources: mapBackendSources(data.sources), tokens: data.usage?.total_tokens ?? estimateTokens(reply), usage: data.usage, tokensExact: data.usage != null } }));
        if (data.suggestions?.length) setSuggestions(data.suggestions);
        opts.onAssistantMessage?.(aiIdx, reply);
      } catch (err2: any) {
        const errMsg: ChatMessage = { role: "assistant", content: friendlyAskError(err2) };
        setMessages([...withUser, errMsg]);
        addMessageToThread(tid, errMsg);
      }
    }
    setLoading(false);
    setStreamStatus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, currentThreadId, loading, opts.context]);

  /** Builds the real context-rich text for an action chip attached to assistant message index i — never a generic standalone string. */
  const buildChipText = useCallback((kind: "explain" | "task" | "draft" | "related" | "decision" | "workflow", i: number) => {
    const prevQuestion = messages[i - 1]?.content ?? "";
    const prevAnswer = messages[i]?.content ?? "";
    switch (kind) {
      case "explain":
        return `Explain your reasoning for your previous answer about: "${prevQuestion}". Previous answer: "${prevAnswer}". Walk through it step by step.`;
      case "task":
        return `Create a task to follow up on this answer. The original question was: "${prevQuestion}". The answer was: "${prevAnswer}". If anything is ambiguous, ask me to confirm the task title or due date before creating it.`;
      case "draft":
        return `Draft a message based on this answer. The original question was: "${prevQuestion}". The answer was: "${prevAnswer}".`;
      case "related":
        return `Show me the related objects in the workspace graph for the subject of this answer. The original question was: "${prevQuestion}". The answer was: "${prevAnswer}".`;
      case "decision":
        return `Add this to the decision queue for my review. The original question was: "${prevQuestion}". The answer was: "${prevAnswer}". Use create_decision with a clear recommended_action.`;
      case "workflow":
        return `Create a draft workflow based on this answer. The original question was: "${prevQuestion}". The answer was: "${prevAnswer}". Save it as a disabled draft for me to review — don't enable it.`;
    }
  }, [messages]);

  const clear = useCallback(() => {
    setMessages([]);
    setCurrentThreadId(null);
    setSuggestions([]);
    setMessageMeta({});
  }, []);

  return {
    messages, setMessages,
    currentThreadId, setCurrentThreadId,
    loading, suggestions, setSuggestions,
    messageMeta, setMessageMeta,
    tokenCount, streamStatus,
    doSend, loadThread, buildChipText, clear,
  };
}
