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

export type MessageMeta = Record<number, { agent: AgentHandoff; sources: SourceCardData[] }>;

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
  const [messageMeta, setMessageMeta] = useState<MessageMeta>({});

  const loadThread = useCallback((threadId: string | null) => {
    if (!threadId) { setMessages([]); setCurrentThreadId(null); setMessageMeta({}); setSuggestions([]); return; }
    const t = getThreads().find(t => t.id === threadId);
    setMessages(t?.messages ?? []);
    setCurrentThreadId(t?.id ?? null);
    setMessageMeta({});
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
    try {
      let model = "auto";
      let web_search = false;
      try {
        const s = JSON.parse(localStorage.getItem("mondaily_ask_settings") || "{}");
        model = s.model ?? "auto";
        web_search = s.webSearch === "allow";
      } catch {}
      const headers = await getAuthHeaders();
      const apiUrl = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${apiUrl}/api/v1/ask`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: text, model, web_search, history, thread_id: tid, context: opts.context }),
      });
      if (!res.ok) throw new Error(`AI error: ${res.status}`);
      const data = await res.json() as { reply?: string; suggestions?: string[]; sources?: BackendSourceMeta[] };
      const reply = data.reply || "No response.";
      const aiMsg: ChatMessage = { role: "assistant", content: reply };
      const finalMsgs = [...withUser, aiMsg];
      setMessages(finalMsgs);
      addMessageToThread(tid, aiMsg);
      const idx = finalMsgs.length - 1;
      setMessageMeta(prev => ({ ...prev, [idx]: { agent: inferAgentHandoff(text), sources: mapBackendSources(data.sources) } }));
      if (data.suggestions?.length) setSuggestions(data.suggestions);
      opts.onAssistantMessage?.(idx, reply);
    } catch (err: any) {
      const errMsg: ChatMessage = { role: "assistant", content: friendlyAskError(err) };
      setMessages([...withUser, errMsg]);
      addMessageToThread(tid, errMsg);
    }
    setLoading(false);
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
    doSend, loadThread, buildChipText, clear,
  };
}
