import { useCallback, useRef, useState } from "react";
import { getThreads, saveThreads, createThread, addMessageToThread, type ChatMessage, type ChatThread , truncateThread} from "../../lib/chat-store";
import { apiFetch, getAuthHeaders } from "../../lib/api-client";
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
export type MessageMeta = Record<number, { agent: AgentHandoff; sources: SourceCardData[]; tokens?: number; usage?: TokenUsage; tokensExact?: boolean; memory?: { used: number; refs: string[] }; degraded?: boolean }>;

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
        memory: (m as { memory?: { used: number; refs: string[] } }).memory,
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
  /** Called right after an assistant reply lands, with its index and full text — lets a surface drive its own streaming/typewriter animation.
   *  `alreadyRenderedLive` is true when SSE tokens already animated on screen; a surface must NOT
   *  re-animate those (doing so visibly collapses the finished answer and retypes it). */
  onAssistantMessage?: (index: number, fullText: string, alreadyRenderedLive?: boolean) => void;
}

export function useAskEngine(opts: UseAskEngineOptions = {}) {
  const initial: ChatThread | undefined = opts.initialThreadId
    ? getThreads().find(t => t.id === opts.initialThreadId)
    : undefined;

  const [messages, setMessages] = useState<ChatMessage[]>(initial?.messages ?? []);
  /** Always the CURRENT messages. doSend used to read the `messages` closure, so a caller that
   *  trimmed the transcript and re-sent on the next tick (regenerate) still sent the pre-trim
   *  array — the popped turns came back duplicated. Reading through a ref removes that race. */
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(initial?.id ?? null);
  const [loading, setLoading] = useState(false);
  // Live abort handle for the in-flight request (for Stop) + last user prompt (for Regenerate).
  const abortRef = useRef<AbortController | null>(null);
  const lastUserTextRef = useRef<string>("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [messageMeta, setMessageMeta] = useState<MessageMeta>(() => metaFromMessages(initial?.messages ?? []));
  /** Live token count of the answer currently streaming (resets each send). */
  const [tokenCount, setTokenCount] = useState(0);
  /**
   * Elapsed seconds for the CURRENT turn, from a real clock.
   *
   * Counted from the moment the request leaves, ticked once a second, frozen when the turn ends —
   * so what the user reads is the actual wall time their question has taken, not an animation.
   */
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  /**
   * Every step the run ACTUALLY took, in order — the tool statuses as they arrived. This is the
   * honest version of a "plan" display: nothing is announced up front (that would be invented
   * progress, the pattern this codebase keeps removing); completed steps accumulate as they truly
   * complete, and the UI can render them as a live checklist.
   */
  const [stepLog, setStepLog] = useState<string[]>([]);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const freezeClock = () => { if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; } };

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
    lastUserTextRef.current = text;
    let tid = currentThreadId;
    if (!tid) {
      const thread = createThread(text);
      saveThreads([thread, ...getThreads()]);
      tid = thread.id;
      setCurrentThreadId(tid);
    }
    // History captured BEFORE the new message is appended — this is what
    // gives the backend real memory of the thread on every surface.
    const current = messagesRef.current;
    const history = current.map(m => ({ role: m.role, content: m.content }));
    const userMsg: ChatMessage = { role: "user", content: text };
    const withUser = [...current, userMsg];
    setMessages(withUser);
    addMessageToThread(tid, userMsg);
    setLoading(true);
    setSuggestions([]);
    setTokenCount(0);
    setElapsedSeconds(0);
    setStepLog([]);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    const startedAt = Date.now();
    elapsedTimerRef.current = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    setStreamStatus(null);

    let model = "auto";
    let web_search = false;
    // tone/scope were stored by Settings and never sent — the controls looked functional and did
    // nothing, exactly like the mode selector before it was wired up.
    let tone: string | undefined;
    let scope: string | undefined;
    try {
      const s = JSON.parse(localStorage.getItem("mondaily_ask_settings") || "{}");
      model = s.model ?? "auto";
      web_search = s.webSearch === "allow";
      tone = s.tone;
      scope = s.scope;
    } catch {}
    const headers = await getAuthHeaders();
    const apiUrl = import.meta.env.VITE_API_URL || "";
    const body = JSON.stringify({ message: text, model, web_search, tone, scope, history, thread_id: tid, context: opts.context });
    const aiIdx = withUser.length; // index the assistant message will occupy
    // Hoisted so the catch can salvage partial output if the stream stalls.
    let streamed = "";
    let liveSources: BackendSourceMeta[] = [];

    // Abort the stream if it stalls — the provider SDK timeout does NOT cut an
    // active-but-frozen stream, which caused "loading forever, then nothing".
    const controller = new AbortController();
    abortRef.current = controller;
    let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
    const bump = (ms: number) => { if (inactivityTimer) clearTimeout(inactivityTimer); inactivityTimer = setTimeout(() => controller.abort(), ms); };
    const overallTimer = setTimeout(() => controller.abort(), 120_000); // hard ceiling
    const clearTimers = () => { if (inactivityTimer) clearTimeout(inactivityTimer); clearTimeout(overallTimer); };

    try {
      // ── Streaming path (SSE): tokens render live, like Claude.ai ──
      bump(25_000); // up to 20s to first byte
      const res = await apiFetch(`${apiUrl}/api/v1/ask/stream`, { method: "POST", headers, body, signal: controller.signal });
      // Read the REAL backend message (e.g. credits-exhausted / burst-limit text) instead of
      // discarding it — the old bare `AI error: ${status}` made every failure look like a generic
      // outage, hiding specific, actionable reasons like "resets around 3:40 PM".
      if (!res.ok || !res.body) throw new Error((await res.text().catch(() => "")) || `AI error: ${res.status}`);

      // Seed an empty assistant message we fill as tokens arrive.
      setMessages([...withUser, { role: "assistant", content: "" }]);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let tokens = 0;
      let finalReply = "";
      let finalSources: BackendSourceMeta[] | undefined;
      let finalSuggestions: string[] = [];
      let finalMemory: { used: number; refs: string[] } | undefined; let finalUsage: TokenUsage | undefined; let finalDegraded = false;

      const applyText = (t: string) =>
        setMessages(prev => { const c = [...prev]; c[aiIdx] = { role: "assistant", content: t }; return c; });

      while (true) {
        const { done, value } = await reader.read();
        /**
         * 75s, not 30. The stall window was tuned when answers were one or two shallow rounds.
         * A deep multi-round analysis legitimately goes quiet for longer than 30s between frames —
         * the model is ingesting large tool results before its final synthesis — and the guard was
         * aborting REAL work in progress, then falling back and re-charging for a second attempt.
         * Seen live on a six-round cross-object question that had already streamed all its sources.
         */
        bump(75_000);
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
            /**
             * ESTIMATED from characters, not counted from frames. One SSE frame can carry many
             * tokens, so `frames++` understated long answers by whatever the transport happened to
             * batch — the number changed with network conditions, not with the answer. ~4 chars per
             * token is the same estimate used everywhere else here; the EXACT count arrives with
             * the provider's usage on the done frame and replaces this.
             */
            tokens = estimateTokens(streamed);
            setTokenCount(tokens);
            setStreamStatus(null);
            applyText(streamed.replace(/<followups>[\s\S]*$/, "")); // never show the control block
          } else if (ev.type === "status") {
            setStreamStatus(ev.text);
            setStepLog(prev => prev[prev.length - 1] === ev.text ? prev : [...prev, ev.text]);
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
            finalMemory = ev.memory;
            finalDegraded = ev.degraded === true;
          }
        }
      }

      clearTimers();
      const reply = finalReply || streamed || "I couldn't generate a response just now — please try again.";
      const savedSources = finalSources ?? liveSources;
      applyText(reply);
      addMessageToThread(tid, { role: "assistant", content: reply, sources: savedSources, memory: finalMemory });
      setMessageMeta(prev => ({ ...prev, [aiIdx]: { agent: inferAgentHandoff(text), sources: mapBackendSources(savedSources), tokens: finalUsage?.total_tokens ?? estimateTokens(reply), usage: finalUsage, tokensExact: finalUsage != null, memory: finalMemory, degraded: finalDegraded } }));
      if (finalSuggestions.length) setSuggestions(finalSuggestions);
      setStreamStatus(null);
      opts.onAssistantMessage?.(aiIdx, reply, tokens > 0);
    } catch (err: any) {
      clearTimers();
      // If the stream already produced meaningful text before stalling/aborting,
      // KEEP it rather than re-running (avoids a blank bubble AND a duplicate charge).
      const partial = streamed.replace(/<followups>[\s\S]*$/, "").trim();
      if (partial.length > 1) {
        setMessages([...withUser, { role: "assistant", content: partial }]);
        addMessageToThread(tid, { role: "assistant", content: partial, sources: liveSources });
        setMessageMeta(prev => ({ ...prev, [aiIdx]: { agent: inferAgentHandoff(text), sources: mapBackendSources(liveSources), tokens: estimateTokens(partial) } }));
        opts.onAssistantMessage?.(aiIdx, partial, true); // this text already appeared live
        freezeClock(); setLoading(false);
        setStreamStatus(null);
        return;
      }
      // ── Fallback: non-streaming endpoint, with its OWN hard timeout so it
      // can't hang either. ──
      try {
        const ctrl2 = new AbortController();
        const t2 = setTimeout(() => ctrl2.abort(), 45_000);
        const res = await apiFetch(`${apiUrl}/api/v1/ask`, { method: "POST", headers, body, signal: ctrl2.signal });
        clearTimeout(t2);
        if (!res.ok) throw new Error((await res.text().catch(() => "")) || `AI error: ${res.status}`);
        const data = await res.json() as { reply?: string; suggestions?: string[]; sources?: BackendSourceMeta[]; usage?: TokenUsage; memory?: { used: number; refs: string[] } };
        const reply = data.reply || "I couldn't generate a response just now — please try again.";
        // Persist sources too, so reopening the thread keeps source attribution
        // (the streaming success path does this; the fallback must match).
        setMessages([...withUser, { role: "assistant", content: reply, sources: data.sources }]);
        addMessageToThread(tid, { role: "assistant", content: reply, sources: data.sources, memory: data.memory });
        setMessageMeta(prev => ({ ...prev, [aiIdx]: { agent: inferAgentHandoff(text), sources: mapBackendSources(data.sources), tokens: data.usage?.total_tokens ?? estimateTokens(reply), usage: data.usage, tokensExact: data.usage != null, memory: data.memory } }));
        if (data.suggestions?.length) setSuggestions(data.suggestions);
        opts.onAssistantMessage?.(aiIdx, reply, false); // non-streaming fallback — nothing animated yet
      } catch (err2: any) {
        const errMsg: ChatMessage = { role: "assistant", content: friendlyAskError(err2) };
        setMessages([...withUser, errMsg]);
        addMessageToThread(tid, errMsg);
      }
    }
    freezeClock(); setLoading(false);
    setStreamStatus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, currentThreadId, loading, opts.context]);

  /** Builds the real context-rich text for an action chip attached to assistant message index i — never a generic standalone string. */
  const buildChipText = useCallback((kind: "explain" | "task" | "draft" | "related" | "decision" | "workflow" | "report", i: number) => {
    // Reference the prior answer by a SHORT snippet only. The backend already
    // receives the full thread history on every send, so the model has the real
    // previous Q&A in context — embedding the entire question + answer was
    // unnecessary AND caused each chip click to nest the previous (already-huge)
    // prompt, doubling the token count every time until the request failed.
    const raw = (messages[i]?.content ?? "").replace(/\s+/g, " ").trim();
    const snippet = raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
    const ref = snippet ? ` (re: "${snippet}")` : "";
    switch (kind) {
      case "explain":
        return `Explain your reasoning for your previous answer, step by step.${ref}`;
      case "task":
        return `Create a task to follow up on your previous answer.${ref} If the title or due date is ambiguous, ask me to confirm before creating it.`;
      case "draft":
        return `Draft a message based on your previous answer.${ref}`;
      case "related":
        return `Show me the related objects in the workspace graph for the subject of your previous answer.${ref}`;
      case "decision":
        return `Add your previous answer to the decision queue for my review. Use create_decision with a clear recommended_action.${ref}`;
      case "workflow":
        return `Create a draft workflow based on your previous answer. Save it as a disabled draft for me to review — don't enable it.${ref}`;
      case "report":
        return `Create a real saved report based on your previous answer using create_report. Pick the best report type and object_type, and confirm the title with me if it's ambiguous.${ref}`;
    }
  }, [messages]);

  const clear = useCallback(() => {
    setMessages([]);
    setCurrentThreadId(null);
    setSuggestions([]);
    setMessageMeta({});
  }, []);

  /** Stop the in-flight generation. The fetch loop's abort handler salvages any
   *  partial text already streamed, so the user keeps what was produced. */
  const stop = useCallback(() => {
    abortRef.current?.abort();
    freezeClock(); setLoading(false);
  }, []);

  /** Regenerate the last answer: drop the last assistant turn and re-ask the last
   *  user message (so it isn't duplicated in the thread). */
  const regenerate = useCallback(() => {
    if (loading || !lastUserTextRef.current) return;
    // Trim the last exchange, then hand doSend the trimmed transcript directly via the
    // ref. Previously this re-sent on a 0ms timeout hoping React had committed first;
    // it hadn't, so the popped turns were re-sent and reappeared duplicated.
    const trimmed = [...messagesRef.current];
    if (trimmed[trimmed.length - 1]?.role === "assistant") trimmed.pop();
    if (trimmed[trimmed.length - 1]?.role === "user") trimmed.pop();
    messagesRef.current = trimmed;
    setMessages(trimmed);
    void doSend(lastUserTextRef.current);
  }, [loading, doSend]);

  /**
   * EDIT AND RE-RUN the last question — the Claude staple this chat lacked. A typo meant living
   * with the wrong answer or burying it under a correction turn.
   *
   * The last user turn and everything after it are removed from BOTH the visible messages and the
   * stored thread, then the corrected text goes through the same doSend as any question — one send
   * path, no special replay logic to drift out of sync.
   */
  const editAndResend = (text: string) => {
    const t = text.trim();
    if (!t || loading) return;
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === "user") { lastUser = i; break; }
    if (lastUser >= 0) {
      setMessages(prev => prev.slice(0, lastUser));
      if (currentThreadId) truncateThread(currentThreadId, lastUser);
    }
    // let the truncation commit before the send appends
    setTimeout(() => doSend(t), 0);
  };

  return {
    messages, setMessages,
    currentThreadId, setCurrentThreadId,
    loading, suggestions, setSuggestions,
    messageMeta, setMessageMeta,
    tokenCount, elapsedSeconds, streamStatus, stepLog, editAndResend,
    doSend, loadThread, buildChipText, clear, stop, regenerate,
  };
}
