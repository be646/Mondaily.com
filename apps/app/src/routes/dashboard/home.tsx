import { useCurrentUser } from "../../hooks/useCurrentUser";
import { motion } from "framer-motion";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Calendar, CheckSquare, Send, Loader2, User, Clock, ArrowUpRight, ArrowUp, Plus, Zap, MailCheck, Brain, TrendingUp, ListChecks, BellDot, CornerDownLeft, Printer, Mic, Inbox, FileText, Paperclip, X, Search, Square, RotateCcw, Copy, Check, ThumbsUp, ThumbsDown, ChevronDown } from "lucide-react";
import { LogoMark } from "../../components/logo";
import { NeedsYouPanel, WorkspaceGraphPulse } from "../../components/ai/command-center";
import { AgentConstellationPanel } from "../../components/ai/agent-constellation";
import { useDecisionQueue } from "../../components/ai/decision-queue";
import {
  EvidenceStrip, SourceList, friendlyAskError, TokenLedger, Markdown, sourcesToLinks,
} from "../../components/ai/ask-shared";
import { useAskEngine } from "../../components/ai/use-ask-engine";
import { useVoiceDictation } from "../../components/ai/use-voice";
import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageSkeleton } from "../../components/ui/page-state";
import { apiClient, apiFetch, getAuthHeaders, BASE_URL } from "../../lib/api-client";
import { getThreads } from "../../lib/chat-store";
import { TaskDetailPanel } from "../../components/tasks/task-detail-panel";
import { useModules } from "../../hooks/useModules";
import { useWorkspaceSuggestions } from "../../hooks/useWorkspaceSuggestions";
import { applyTerms, EMPTY_PROFILE } from "@mondaily/shared/profile";
import { useLanguage } from "../../hooks/useLanguage";
import { useDisplayIdentity } from "../../hooks/useDisplayIdentity";
import { isOverdue as isPastDue } from "@mondaily/shared/dates";
import { Modal } from "@/components/ui/modal";

// Converts markdown to clean readable JSX — strips tables, stars, dashes
// (Removed a second, local markdown renderer used only by the scan modal — the shared <Markdown>
//  component already renders the same content type, and two renderers meant two different
//  outputs for identical text.)

const QUICK_PROMPTS: { icon: React.ElementType; label: string; description: string; prompt: string; promptKey?: string }[] = [
  {
    icon: BellDot,
    label: "Daily brief",
    description: "Everything that happened",
    prompt: "Give me a full daily brief: check my notifications, list my open tasks by priority, highlight any overdue items, and summarise recent activity across the workspace graph. Then tell me exactly what I should focus on right now and suggest 3 specific actions to take.",
  },
  {
    icon: TrendingUp,
    label: "What needs attention?",
    description: "Stalled deals, assets, relationships",
    // The backend generates this same prompt from the workspace profile (and localizes
    // it). `promptKey` lets the rendered prompt prefer that version — the literal below
    // is only the fallback when /workspace/suggestions hasn't answered.
    promptKey: "attention",
    prompt: "Review the workspace graph. Which deals, assets, or relationships are stalled, overdue for follow-up, or close to closing? Rank them by urgency and tell me exactly what action to take on each one.",
  },
  {
    icon: ListChecks,
    label: "Decisions waiting on me",
    description: "What the agents queued for approval",
    promptKey: "decisions",
    prompt: "What decisions are waiting on me? Summarize each with the context I need to decide, and recommend an action.",
  },
  {
    icon: Brain,
    label: "Meeting prep",
    description: "Brief on who you're meeting",
    prompt: "Help me prep for my next meeting. Search the workspace graph for the contact or company I'm meeting with, find any related deals, finance, or tasks, and give me a concise brief: key facts, open items, what to ask, and what outcome to aim for.",
  },
  {
    icon: MailCheck,
    label: "Follow-up message",
    description: "Draft after a meeting",
    prompt: "Draft a professional follow-up message for my last meeting. Check my recent tasks and the workspace graph for context on who I met, what was discussed, and any open action items. Make it concise, warm, and end with a clear next step.",
  },
  {
    icon: ListChecks,
    label: "Weekly focus plan",
    description: "Priorities for this week",
    prompt: "Review all my open tasks and tell me what I should focus on this week. Group them by priority, flag anything overdue, and build me a simple day-by-day action plan for the week. Be specific and opinionated.",
  },
  {
    icon: Zap,
    label: "What needs action today?",
    description: "Urgent items right now",
    prompt: "Scan everything across the workspace graph — tasks, notifications, finance, relationships — and tell me what genuinely needs my attention today. Only surface real urgent items. Give me a ranked list with one action per item.",
  },
] as const;

interface Task { id: string; title: string; completed: boolean; due_date?: string; priority?: string; status?: string; assignee_id?: string; assignee_email?: string; created_at?: string; notes?: string; labels?: string[]; record_id?: string; record_name?: string; updated_at?: string; }
interface Member { id: string; user_id: string; email: string; name: string; }
interface Meeting { id: string; title: string; start_time: string; attendees?: string[] }
interface WorkspaceSummary {
  workspace_id: string;
  name: string;
  role: string;
  counts: { tasks: number; lists: number; nodes: number; deals: number };
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_STYLE: Record<string, string> = {
  urgent: "border border-[#c6892e]/30 bg-[#c6892e]/10 text-[#c6892e] dark:text-[#c6892e]",
  // high and medium were byte-identical strings; low is token-ised like the rest.
  high:   "border border-[var(--border-soft)] bg-[var(--surface-hover)] text-[var(--text-secondary)]",
  medium: "border border-[var(--border-soft)] bg-[var(--surface-hover)] text-[var(--text-secondary)]",
  low:    "border border-[var(--border-soft)] bg-[var(--surface-page)] text-[var(--text-muted)]",
};

export function HomePage() {
  const me = useCurrentUser();
  const navigate = useNavigate();
  // Resolve a real display name (session → member record → email local-part → "there"); this fixes
  // "Good morning, there" when the auth session's name/email is sparse on restore.
  const { firstName } = useDisplayIdentity();
  const { hasFinance } = useModules();
  const { data: wsSuggestions } = useWorkspaceSuggestions();  // profile-aware prompts + terms
  const wsProfile = wsSuggestions?.profile ?? EMPTY_PROFILE;
  // The backend already builds profile-aware, LOCALIZED Home prompts (GET
  // /workspace/suggestions -> home[]). They were fetched and thrown away, so a
  // non-English or non-default-industry workspace still saw hardcoded English
  // copy. Prefer the server's wording, fall back to the literal in QUICK_PROMPTS.
  const serverPrompt = (key?: string, fallback?: string) =>
    (key ? wsSuggestions?.home?.find(h => h.key === key)?.prompt : undefined) ?? fallback ?? "";
  const loc = useLanguage();   // locale-aware date formatting (+ keeps <html dir> synced app-wide)
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const voice = useVoiceDictation(setInput);
  const [taskScope, setTaskScope] = useState<"mine" | "all">("mine");
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [taskWidgetInput, setTaskWidgetInput] = useState("");
  const [taskWidgetLoading, setTaskWidgetLoading] = useState(false);
  const [taskWidgetReply, setTaskWidgetReply] = useState<string | null>(null);
  // Follow-ups for the LAST widget answer. The API returned these on every call and the widget
  // read the field and then threw it away — suggestions existed everywhere except where shown.
  const [taskWidgetFollowups, setTaskWidgetFollowups] = useState<string[]>([]);
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const taskPickerRef = useRef<HTMLDivElement>(null);
  const [scanReport, setScanReport] = useState<string | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanTimestamp, setScanTimestamp] = useState("");
  const [riskBanner, setRiskBanner] = useState<number | null>(null); // number of new risk alerts created
  const [streamingMsgIdx, setStreamingMsgIdx] = useState<number | null>(null);
  const [streamedUpTo, setStreamedUpTo] = useState(0);
  const streamRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Answers render as soon as they arrive. This used to run a random-speed typewriter
  // (3–7 chars/frame) over text that had ALREADY fully arrived — a completed response
  // performing live generation it wasn't doing. Real token-by-token output comes from SSE
  // and is already on screen by the time this fires.
  const startStreaming = useCallback((_msgIdx: number, _fullText: string, _alreadyRenderedLive?: boolean) => {
    if (streamRef.current) { clearInterval(streamRef.current); streamRef.current = null; }
    setStreamingMsgIdx(null);
  }, []);

  // Stop the typewriter when Home unmounts — otherwise navigating away mid-answer
  // leaks an 18ms interval that keeps calling setState on a dead component.
  useEffect(() => () => { if (streamRef.current) clearInterval(streamRef.current); }, []);

  // ── Attachments: pinned records + client-read text files fed to the chat as
  //    context (no storage — record data comes from /search, file text via FileReader). ──
  type AttachItem =
    | { kind: "record"; id: string; object_type: string; title: string; data: unknown }
    | { kind: "file"; id: string; title: string; text: string };
  const [attachments, setAttachments] = useState<AttachItem[]>([]);
  // Ask MODE, shared with Settings via the same localStorage key the engine reads, so the two can
  // never disagree. Sovereign product: a mode is how much WORK to do, not whose model to use.
  const [askMode, setAskMode] = useState<"auto" | "fast" | "smart">(() => {
    try { return (JSON.parse(localStorage.getItem("mondaily_ask_settings") || "{}").model) || "auto"; }
    catch { return "auto"; }
  });
  const [modeOpen, setModeOpen] = useState(false);
  function pickMode(m: "auto" | "fast" | "smart") {
    setAskMode(m); setModeOpen(false);
    try {
      const cur = JSON.parse(localStorage.getItem("mondaily_ask_settings") || "{}");
      localStorage.setItem("mondaily_ask_settings", JSON.stringify({ ...cur, model: m }));
    } catch { /* a mode preference is not worth failing a send over */ }
  }
  const [attachOpen, setAttachOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const copyMessage = (text: string, i: number) => { navigator.clipboard?.writeText(text).then(() => { setCopiedIdx(i); setTimeout(() => setCopiedIdx(null), 1500); }).catch(() => {}); };
  const [feedbackGiven, setFeedbackGiven] = useState<Record<number, 1 | -1>>({});
  const sendFeedback = async (userMsg: string, aiMsg: string, rating: 1 | -1, idx: number) => {
    setFeedbackGiven(prev => ({ ...prev, [idx]: rating }));
    try {
      const headers = await getAuthHeaders();
      const apiUrl = import.meta.env.VITE_API_URL || "";
      await apiFetch(`${apiUrl}/api/v1/feedback`, { method: "POST", headers, body: JSON.stringify({ message: userMsg, response: aiMsg, rating }) });
    } catch {}
  };
  const [attachQuery, setAttachQuery] = useState("");
  const [attachResults, setAttachResults] = useState<{ id: string; object_type: string; data: Record<string, unknown> }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!attachOpen || attachQuery.trim().length < 2) { setAttachResults([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await apiClient.post<{ id: string; object_type: string; data: Record<string, unknown> }[]>("/search", { query: attachQuery.trim() });
        if (!cancelled) setAttachResults((res ?? []).slice(0, 8));
      } catch { if (!cancelled) setAttachResults([]); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [attachQuery, attachOpen]);
  const recordTitle = (r: { object_type: string; data: Record<string, unknown> }) =>
    String(r.data?.name ?? r.data?.title ?? r.object_type ?? "record");
  const addRecord = (r: { id: string; object_type: string; data: Record<string, unknown> }) => {
    setAttachments(a => a.some(x => x.id === r.id) ? a : [...a, { kind: "record", id: r.id, object_type: r.object_type, title: recordTitle(r), data: r.data }]);
    setAttachOpen(false); setAttachQuery(""); setAttachResults([]);
  };
  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "").slice(0, 20000);
      setAttachments(a => [...a, { kind: "file", id: `f-${f.name}-${text.length}`, title: f.name, text }]);
    };
    reader.readAsText(f);
    setAttachOpen(false);
    e.target.value = "";
  };
  const attachContext = attachments.length
    ? { attachments: attachments.map(a => a.kind === "record"
        ? { object_type: a.object_type, node_id: a.id, title: a.title, data: a.data }
        : { kind: "file", title: a.title, text: a.text }) }
    : {};

  // Same request pipeline as the main Ask Mondaily page and the right-side
  // drawer: same endpoint, thread_id/history handling, agent inference, real
  // sources. Home's context is general workspace scope.
  const {
    messages, setMessages, currentThreadId, setCurrentThreadId, loading,
    suggestions, setSuggestions, messageMeta, doSend, buildChipText, stop, regenerate, streamStatus, tokenCount, elapsedSeconds,
  } = useAskEngine({ context: { scope_label: "the Home dashboard (general workspace)", ...attachContext }, onAssistantMessage: startStreaming });

  useEffect(() => {
    if (!promptPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPromptPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [promptPickerOpen]);

  const tasksQuery = useQuery({
    queryKey: ["tasks", "home", taskScope],
    queryFn: () => apiClient.get<Task[]>(`/tasks?filter=${taskScope}&sort=priority`),
    // Keep the prior scope's data on screen while the new scope loads. Without this, toggling
    // task scope (mine ↔ all) changes the query key → data briefly undefined → every derived
    // count (overdue / urgent / unread) drops to 0 → the attention pills flicker out and back in.
    placeholderData: keepPreviousData,
  });
  const membersQuery = useQuery({ queryKey: ["members"], queryFn: () => apiClient.get<Member[]>("/members") });
  // (Removed the /meetings/today query: it read an object_type nothing writes, so it always
  // returned []. Native meetings come from nativeMeetingsQ below — the same calendar_event rows,
  // fetched once.)
  // Real connected-calendar events (Google / Microsoft, direct OAuth — no middleman).
  interface CalEvent { id: string; title: string; start: string; end?: string; allDay: boolean; location?: string; attendees: number; meetingUrl?: string; provider: string }
  const calendarQ = useQuery({
    queryKey: ["calendar", "today"],
    queryFn: () => apiClient.get<{ connected: boolean; provider?: string; email?: string; needs_reauth?: boolean; events: CalEvent[] }>("/integrations/calendar/events?days=1"),
    staleTime: 60_000,
  });
  // Native Mondaily meetings (calendar_event nodes) — shown ALONGSIDE the Google/Outlook connectors,
  // so meetings created in-app appear here even without a connected external calendar.
  const nativeMeetingsQ = useQuery({
    queryKey: ["calendar", "native", "today"],
    queryFn: () => {
      const s = new Date(); s.setHours(0, 0, 0, 0);
      const e = new Date(s.getTime() + 86_400_000);
      return apiClient.get<{ events: { id: string; title: string; start_at: string; end_at?: string; location?: string; attendees?: unknown[] }[] }>(`/calendar/events?from=${s.toISOString()}&to=${e.toISOString()}`);
    },
    staleTime: 60_000, retry: false,
  });
  const [connectingCal, setConnectingCal] = useState<string | null>(null);
  async function connectCalendar(provider: "google" | "microsoft") {
    setConnectingCal(provider);
    try {
      const r = await apiClient.post<{ auth_url?: string; error?: string }>("/integrations/connect", { provider });
      if (r.auth_url) {
        const popup = window.open(r.auth_url, "mondaily-calendar", "width=520,height=680");
        // Refresh once the OAuth popup posts back success.
        const onMsg = (e: MessageEvent) => {
          // Only trust this message from our own API origin — the handler previously acted on a
          // postMessage from any origin at all.
          if (e.origin !== new URL(BASE_URL, window.location.href).origin) return;
          if (e.data?.type === "nylas-connect" && e.data.ok) {
            qc.invalidateQueries({ queryKey: ["calendar"] });
            window.removeEventListener("message", onMsg);
          }
        };
        window.addEventListener("message", onMsg);
        // Fallback: poll refetch when the popup closes.
        const timer = setInterval(() => { if (popup?.closed) { clearInterval(timer); qc.invalidateQueries({ queryKey: ["calendar"] }); } }, 1200);
      } else if (r.error) {
        alert(r.error);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not start the connection.");
    } finally {
      setConnectingCal(null);
    }
  }
  const notificationsQuery = useQuery({
    // Same key+URL as the agent dock's fetch so React Query dedupes it into ONE
    // request instead of two identical /notifications?limit=50 round-trips.
    queryKey: ["notifications", "recent-50"],
    queryFn: () => apiClient.get<{ id: string; type: string; is_read: boolean; title: string; body?: string; created_at?: string }[]>("/notifications?limit=50"),
    staleTime: 60_000,
  });
  // The REAL unread total for the telemetry pill — counting unread inside the 50-row page above
  // showed "50 unread" while the bell said 71 (a page size reported as a fact).
  const unreadCountQuery = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => apiClient.get<{ unread: number; capped?: boolean }>("/notifications/unread-count"),
    staleTime: 60_000,
  });
  // Real pending-decision count for the command room's telemetry strip —
  // same query/endpoint the Decision Queue panel itself uses below.
  const decisionsQuery = useDecisionQueue();
  // AI Chief-of-Staff: reasons over ALL pending decisions and returns the top-3
  // that most need the operator right now (impact+urgency, not just risk label).
  // Only fetched when there's actually a pending queue, and fail-soft (retry:false).
  const chiefQuery = useQuery<{ priorities: { title: string; why: string; action: string; decision_id: string | null; agent_name: string | null }[]; count: number }>({
    queryKey: ["chief-of-staff", "home"],
    queryFn: () => apiClient.get("/decisions/chief-of-staff"),
    enabled: (decisionsQuery.data?.length ?? 0) > 0,
    staleTime: 180_000,
    retry: false,
  });
  const workspacesQuery = useQuery({
    queryKey: ["workspaces", "mine", "home"],
    queryFn: () => apiClient.get<{ workspaces: WorkspaceSummary[] }>("/workspaces/mine"),
    staleTime: 120_000,
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const members = membersQuery.data ?? [];
  const activeTasks = (tasksQuery.data ?? [])
    .filter(t => !t.completed && t.status !== "done")
    .sort((a, b) => (PRIORITY_ORDER[a.priority ?? "low"] ?? 3) - (PRIORITY_ORDER[b.priority ?? "low"] ?? 3));

  const getMemberName = (task: Task) => {
    if (!task.assignee_id) return task.assignee_email?.split("@")[0] ?? null;
    const m = members.find(m => m.user_id === task.assignee_id);
    return m ? (m.name || m.email.split("@")[0]) : (task.assignee_email?.split("@")[0] ?? null);
  };

  const isChatting = messages.length > 0;
  const recentThreads = useMemo(() => getThreads().slice(0, 3), [currentThreadId, messages.length]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Reset the auto-expanded textarea back to one row once it's cleared (after send).
  useEffect(() => { const el = inputRef.current; if (el && input === "") el.style.height = "auto"; }, [input]);

  // Top-down streaming with a stick-to-bottom lock. `stickRef` stays true while
  // the user is parked near the bottom; if they scroll up to re-read it flips
  // false and we stop yanking them. The pin runs in useLayoutEffect — BEFORE the
  // browser paints the new frame — so the newest tokens are already in view when
  // the frame lands. No post-paint jump, no smooth-scroll tussle, no jitter.
  const stickRef = useRef(true);
  const lastTopRef = useRef(0);
  const onMessagesScroll = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    const top = el.scrollTop;
    // Direction-aware: ANY upward scroll instantly releases the follow (no tug);
    // returning to the very bottom re-engages it. The programmatic pin only ever
    // moves DOWN, so it never trips the release.
    if (top < lastTopRef.current - 1) stickRef.current = false;
    if (el.scrollHeight - top - el.clientHeight < 24) stickRef.current = true;
    lastTopRef.current = top;
  }, []);
  useLayoutEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    // Pin to bottom whenever the user is stuck there (stickRef) — INCLUDING the
    // final frame when streaming ends and the footer/cards/pills mount, so that
    // late content doesn't shove the answer (kills the end-of-stream jump). The
    // direction-aware stickRef means any upward scroll has already released the
    // follow, so this never tugs when reading back.
    if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, loading, streamedUpTo, streamingMsgIdx, messageMeta]);

  // Run AI risk scan once per day (throttled via localStorage)
  useEffect(() => {
    const SCAN_KEY = "mondaily:lastRiskScan";
    const last = localStorage.getItem(SCAN_KEY);
    const now = Date.now();
    if (last && now - parseInt(last, 10) < 24 * 60 * 60 * 1000) return;
    const run = async () => {
      try {
        const res = await apiClient.post<{ created: number }>("/generate/risk-alerts", {});
        localStorage.setItem(SCAN_KEY, String(now));
        if (res.created > 0) {
          setRiskBanner(res.created);
          qc.invalidateQueries({ queryKey: ["notifications"] });
        }
      } catch {}
    };
    // Small delay so it doesn't block page render
    const t = setTimeout(run, 3000);
    return () => clearTimeout(t);
  }, []);

  const send = () => {
    // Guard while a reply is generating: doSend() bails on `loading`, so clearing
    // here first would silently destroy the typed text and any pinned attachments.
    if (loading) return;
    const t = input.trim();
    if (!t && attachments.length === 0) return;
    setInput("");
    doSend(t || "Use the attached items.");
    if (attachments.length) setAttachments([]); // consumed — pinned into this turn's context
  };

  const newChat = () => {
    setMessages([]);
    setCurrentThreadId(null);
    setInput("");
    setSuggestions([]);
  };

  const printReport = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    const plain = (scanReport ?? "").replace(/[*_`#|]/g, "").replace(/\n{3,}/g, "\n\n");
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Mondaily Scan Report — ${scanTimestamp}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 48px auto; color: #1c1917; line-height: 1.7; font-size: 15px; }
  h1 { font-size: 20px; margin-bottom: 4px; } p.meta { color: #666; font-size: 13px; margin-bottom: 32px; }
  pre { white-space: pre-wrap; word-break: break-word; }
  @media print { body { margin: 24px; } }
</style></head><body>
<h1>Mondaily AI Scan Report</h1>
<p class="meta">${scanTimestamp}</p>
<pre>${plain}</pre>
</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const runScan = async () => {
    if (scanLoading) return;
    setScanLoading(true);
    setScanReport(null);
    setScanTimestamp(new Date().toLocaleString(loc.lang, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }));
    try {
      let model = "auto";
      try { const s = JSON.parse(localStorage.getItem("mondaily_ask_settings") || "{}"); model = s.model ?? "auto"; } catch {}
      const data = await apiClient.post<{ reply: string }>("/ask", {
        message: "Scan all my tasks and notifications. Flag every overdue item with its due date, summarise what needs action today, and give me 3 specific next steps. Format it as a clear report.",
        model,
      });
      setScanReport(data.reply || "No results.");
      qc.invalidateQueries({ queryKey: ["tasks", "home"] });
    } catch (err: any) {
      setScanReport(friendlyAskError(err));
    }
    setScanLoading(false);
  };

  // Handles the task widget input: open-by-name, create, or free AI question
  const submitTaskWidgetInput = async (raw: string) => {
    const text = raw.trim();
    if (!text || taskWidgetLoading) return;
    setTaskWidgetInput("");
    setTaskWidgetReply(null);

    // Try to open a task by fuzzy title match ("open X", "show X", "find X")
    const openIntent = /^(open|show|find|view|search|look up)\s+/i.test(text);
    if (openIntent) {
      const query = text.replace(/^(open|show|find|view|search|look up)\s+/i, "").toLowerCase();
      const match = activeTasks.find(t => t.title.toLowerCase().includes(query));
      if (match) { setDetailTask(match); return; }
    }

    // Otherwise send to AI (create task / question / anything)
    setTaskWidgetLoading(true);
    try {
      let model = "auto";
      try { const s = JSON.parse(localStorage.getItem("mondaily_ask_settings") || "{}"); model = s.model ?? "auto"; } catch {}
      const data = await apiClient.post<{ reply: string; suggestions?: string[] }>("/ask", { message: text, model });
      setTaskWidgetReply(data.reply || "Done.");
      setTaskWidgetFollowups((data.suggestions ?? []).slice(0, 3));
      // Refresh task list in case AI created/updated tasks
      qc.invalidateQueries({ queryKey: ["tasks", "home"] });
    } catch (err: any) {
      setTaskWidgetReply(friendlyAskError(err));
    }
    setTaskWidgetLoading(false);
  };

  const sendSuggestion = useCallback((text: string) => {
    setSuggestions([]);
    doSend(text);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doSend]);

  // Apply the workspace's preferred terminology to a prompt before sending (display/help copy only —
  // e.g. "deal" → "case" for a clinic). No-op when the profile has no preferred terms.
  const firePrompt = useCallback((text: string) => {
    setPromptPickerOpen(false);
    sendSuggestion(applyTerms(text, wsProfile));
  }, [sendSuggestion, wsProfile]);

  // Route/context chips fill the input and focus it rather than auto-sending
  // — the user reviews and completes the question before it goes anywhere.
  const prefill = useCallback((text?: string) => {
    setInput(text ?? "");
    inputRef.current?.focus();
  }, []);

  const todayLabel = loc.formatDate(new Date(), { weekday: "long", month: "long", day: "numeric" });
  const overdueCount = activeTasks.filter(t => isPastDue(t.due_date)).length;
  const openTaskCount = activeTasks.length;
  const urgentCount  = activeTasks.filter(t => t.priority === "urgent").length;
  // Count unread AI risk alerts from notifications (persists across page loads, not just the one scan run)
  const unreadRiskCount = (notificationsQuery.data ?? []).filter(n => n.type === "ai_risk" && !n.is_read).length;
  // Server total when available; the page-local count only bridges the first render.
  const unreadCount = unreadCountQuery.data?.unread ?? (notificationsQuery.data ?? []).filter(n => !n.is_read).length;
  // Honest load state for the header pill: amber while any of the three feeds is still in flight,
  // green only once they have all actually returned, red if one failed.
  const workspaceDataLoading = tasksQuery.isLoading || notificationsQuery.isLoading || decisionsQuery.isLoading;
  const workspaceDataOk = !tasksQuery.isError && !notificationsQuery.isError && !decisionsQuery.isError;
  const currentWorkspaceId = typeof window !== "undefined" ? localStorage.getItem("mondaily_workspace_id") : null;
  const workspaceSummaries = workspacesQuery.data?.workspaces ?? [];
  const currentWorkspace = workspaceSummaries.find(w => w.workspace_id === currentWorkspaceId);
  const currentDataCount = currentWorkspace ? currentWorkspace.counts.tasks + currentWorkspace.counts.lists + currentWorkspace.counts.nodes : null;
  const populatedWorkspace = workspaceSummaries.find(w => w.workspace_id !== currentWorkspaceId && (w.counts.tasks + w.counts.lists + w.counts.nodes) > Math.max(currentDataCount ?? 0, 0));
  // Only ever suggest switching when the user genuinely belongs to MORE THAN ONE workspace — a
  // brand-new single-workspace account can never be nudged toward another tenant's metrics.
  const showWorkspaceRecovery = Boolean(workspaceSummaries.length > 1 && populatedWorkspace && (currentDataCount === 0 || currentDataCount === null));

  return (
    <div className="home-control-room ask-frame mx-auto max-w-6xl px-4 py-8 sm:px-6">

      {/* ── Workspace Command Room — a full-width band, not a card. Bleeds
          past the page's own padding so it reads as the page's top zone,
          not another boxed panel stacked with the rest. Left-aligned, not
          centered — reads as a normal page header. ── */}
      <div className="command-room relative -mx-4 -mt-8 mb-7 border-b px-4 pb-3 pt-4 sm:-mx-6 sm:px-8" style={{ borderColor: "var(--border-soft)" }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          {/* Left — greeting + a clean cluster: frameless AI agents and the
              graph/source status. Collapses while chatting (notifications stay). */}
          {/* Greeting moved into the centered chat hero below — only a slim date
              kicker remains here so the top band isn't empty. */}
          <div className="welcome-info min-w-0">
            <p className="home-section-kicker">{todayLabel}</p>
            {isChatting && <h1 className="home-hero-title mt-1.5">{greeting}, {firstName}.</h1>}
          </div>

          {/* Right — signals bar, top-right (always renders; not inside the
              collapsing welcome) */}
          <div className="flex flex-col gap-2 lg:items-end">
            {/* Decisions count intentionally lives ONLY in the Attention stream below (which owns
                approvals), not here — the two used to echo the same number. */}
            <div className="home-telemetry-strip">
              <Link to="/tasks" state={{ filter: taskScope === "mine" ? "mine" : "all" }}><ListChecks size={13}/><strong>{activeTasks.length}</strong>{taskScope === "mine" ? "my open tasks" : "open tasks"}</Link>
              {/* Bell, not the Inbox envelope — this counts NOTIFICATIONS and links there; the
                  envelope read as "50 unread messages" while the Inbox was empty. */}
              <Link to="/notifications"><BellDot size={13}/><strong>{unreadCount}</strong>unread</Link>
            </div>

            {/* Overdue / urgent / AI-risk relocated into the console status rail below, so no signal
                is duplicated: the persistent telemetry strip above owns the global counters (open
                tasks + unread); the rail owns live status + actionable "Right now" signals. */}
          </div>
        </div>
        {/* Consolidated status rail — one hairline console strip under the header: live graph/source
            status + the synthesized "Right now" signals, so the operator lands oriented from a single
            row instead of scattered centered clusters. Data/links unchanged; only relocated here. */}
        {(() => {
          const now = Date.now();
          const pending = decisionsQuery.data?.length ?? 0;
          const overdue = (tasksQuery.data ?? []).filter(t => !t.completed && isPastDue(t.due_date)).length;
          const risk = unreadRiskCount || (riskBanner ?? 0);
          const starts: number[] = [];
          for (const e of nativeMeetingsQ.data?.events ?? []) { const t = new Date(e.start_at).getTime(); if (Number.isFinite(t) && t >= now) starts.push(t); }
          for (const e of (calendarQ.data?.events ?? []) as { start?: string; start_at?: string }[]) { const t = new Date(e.start ?? e.start_at ?? "").getTime(); if (Number.isFinite(t) && t >= now) starts.push(t); }
          const nextStart = starts.length ? Math.min(...starts) : null;
          // Unread is intentionally NOT here — it lives once in the persistent top-right telemetry strip.
          const seg: { label: string; to: string; tone: string; state?: Record<string, unknown> }[] = [];
          if (pending) seg.push({ label: `${pending} need${pending === 1 ? "s" : ""} approval`, to: "/decisions", tone: "var(--section-accent)" });
          if (overdue) seg.push({ label: `${overdue} overdue`, to: "/tasks", state: { filter: "overdue" }, tone: "var(--status-error)" });
          if (urgentCount > 0) seg.push({ label: `${urgentCount} urgent`, to: "/tasks", state: { filter: "mine", priority: "urgent" }, tone: "var(--status-warn)" });
          if (risk > 0) seg.push({ label: `${risk} AI risk alert${risk > 1 ? "s" : ""}`, to: "/notifications", tone: "var(--status-warn)" });
          if (nextStart) seg.push({ label: `Next meeting ${new Date(nextStart).toLocaleTimeString(loc.lang, { hour: "2-digit", minute: "2-digit" })}`, to: "/calendar", tone: "var(--text-secondary)" });
          return (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-2.5" style={{ borderColor: "var(--border-soft)" }}>
              {/* Says exactly what it knows: whether this page's data loaded. It previously read
                  "Graph synced" / "Sources checked" — implying a sync and a source-verification
                  pass that nothing in the app performs, and it painted green during the initial
                  load (before any row had arrived) because isError is false until a response fails. */}
              <span className="status-line">
                <span className="live-dot" style={{ background: workspaceDataLoading ? "var(--status-warn)" : workspaceDataOk ? "var(--section-accent)" : "var(--status-error)" }}/>
                {workspaceDataLoading ? "Loading workspace data" : workspaceDataOk ? "Workspace data loaded" : "Some data failed to load"}
              </span>
              {seg.length > 0 && <span className="hidden h-3 w-px sm:inline-block" style={{ background: "var(--border-soft)" }} />}
              {seg.length > 0 && <span className="text-caption font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>Right now</span>}
              {seg.map((s, i) => (
                <Link key={i} to={s.to} state={s.state} className="inline-flex items-center gap-1.5 text-[11.5px] font-medium transition-colors hover:opacity-80" style={{ color: s.tone }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.tone }} />{s.label}
                </Link>
              ))}
            </div>
          );
        })()}
      </div>

      {showWorkspaceRecovery && populatedWorkspace && (
        <div className="mb-4 rounded-sm px-4 py-3 sm:flex sm:items-center sm:justify-between sm:gap-4" style={{ background: "color-mix(in srgb, var(--status-warn) 8%, var(--surface-card))", border: "1px solid color-mix(in srgb, var(--status-warn) 25%, var(--border-soft))" }}>
          <div>
            <p className="text-body font-medium" style={{ color: "var(--text-primary)" }}>You may be viewing an empty workspace.</p>
            <p className="mt-0.5 text-body" style={{ color: "var(--text-muted)" }}>
              {populatedWorkspace.name} has {populatedWorkspace.counts.tasks} tasks, {populatedWorkspace.counts.lists} lists, and {populatedWorkspace.counts.nodes} records.
            </p>
          </div>
          <Link to="/workspaces" className="btn-suggested mt-3 shrink-0 sm:mt-0">
            Choose workspace
          </Link>
        </div>
      )}

      {/* ── Ask Mondaily — frameless console: suggestions/messages plus the
          actual input bar. No outer card around the whole area. ── */}
      {/* Honest degradation. These panels used to vanish silently when their query failed —
          the priorities rail simply wasn't there, assignee names just disappeared — which
          looks like "nothing to do" rather than "we couldn't load it". Name what's missing. */}
      {(() => {
        const missing = [
          (notificationsQuery.isError || decisionsQuery.isError) && "agent and decision signals",
          chiefQuery.isError && "what needs you most",
          membersQuery.isError && "assignee names",
          workspacesQuery.isError && "workspace checks",
        ].filter(Boolean) as string[];
        if (missing.length === 0) return null;
        return (
          <div className="mb-4 rounded-sm border border-[#c6892e]/25 bg-[#c6892e]/[.07] px-4 py-3 text-sm text-[#c6892e]">
            Could not load {missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`}. What you see below may be incomplete.
          </div>
        );
      })()}

      <section className="home-section relative mx-auto mt-6 max-w-4xl sm:mt-8">
        <div className={`relative w-full min-w-0 ${isChatting ? "flex flex-col overflow-hidden" : ""}`} style={isChatting ? { height: "min(70vh, 640px)" } : undefined}>
        {!isChatting && (
          <div className="mx-auto mb-6 flex max-w-2xl flex-col items-center text-center">
            <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.01em]" style={{ color: "var(--text-primary)" }}>{greeting}, {firstName}</h2>
            <p className="mt-1 text-body" style={{ color: "var(--text-faint)" }}>What do you want to get done today?</p>
          </div>
        )}

        {/* "Right now" signals relocated into the consolidated console status rail in the
            command-room header above (Graph/Sources + needs-approval/overdue/next-meeting/unread),
            so the hero stays a clean command area and the operator lands oriented from one strip. */}

        {/* AI Chief-of-Staff rail: the single "what needs you most" reasoned readout.
            Reasons over the whole pending queue and surfaces the top-3 with a one-line
            why + concrete action, each jumping to that decision. Only shows when the
            model returned priorities (fail-soft: no queue / model down → nothing). */}
        {!isChatting && (chiefQuery.data?.priorities?.length ?? 0) > 0 && (
          <div className="mx-auto mb-6 w-full max-w-2xl">
            <div className="mb-2 flex items-center gap-2">
              <Brain size={13} style={{ color: "var(--section-accent)" }} />
              <span className="text-caption font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>What needs you most</span>
              {chiefQuery.data && chiefQuery.data.count > chiefQuery.data.priorities.length && (
                <Link to="/decisions" className="text-[10px] font-medium hover:underline" style={{ color: "var(--text-faint)" }}>+{chiefQuery.data.count - chiefQuery.data.priorities.length} more</Link>
              )}
            </div>
            <div className="grid gap-1.5">
              {chiefQuery.data!.priorities.map((p, i) => (
                <Link
                  key={i}
                  to={p.decision_id ? `/decisions?id=${p.decision_id}` : "/decisions"}
                  className="group flex items-start gap-3 rounded-md border px-3 py-2.5 transition-colors hover:border-[color:var(--section-accent)]"
                  style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold" style={{ background: "var(--section-accent-soft, var(--surface-hover))", color: "var(--section-accent)" }}>{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-row font-semibold" style={{ color: "var(--text-primary)" }}>{p.title}</span>
                      <ArrowUpRight size={13} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60" style={{ color: "var(--section-accent)" }} />
                    </span>
                    <span className="mt-0.5 block text-label leading-snug" style={{ color: "var(--text-secondary)" }}>{p.why}</span>
                    <span className="mt-1 flex items-center gap-1 text-[11px] font-medium" style={{ color: "var(--section-accent)" }}><Zap size={10} />{p.action}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {isChatting && (
          <div ref={messagesRef} onScroll={onMessagesScroll} className="relative w-full min-w-0 min-h-0 flex-1 space-y-6 overflow-y-auto overflow-x-hidden overscroll-contain pb-10 pt-2 pr-1" style={{ scrollbarWidth: "none", overflowAnchor: "none", scrollBehavior: "auto" }}>
            {(() => {
              // Unified turn list: real messages + a single PENDING assistant row while
              // thinking. The pending row shares the SAME key/index/structure as the
              // real assistant row that replaces it, so React reconciles IN PLACE — no
              // unmount/remount, no positional shift (the Gemini zero-shift model).
              const turns: Array<{ role: "user" | "assistant"; content: string; pending?: boolean }> =
                messages.map(mm => ({ role: mm.role as "user" | "assistant", content: mm.content }));
              if (loading && streamingMsgIdx === null && turns[turns.length - 1]?.role === "user")
                turns.push({ role: "assistant", content: "", pending: true });
              return turns.map((m, i) => {
                const isStreaming = streamingMsgIdx === i;
                const displayText = isStreaming ? m.content.slice(0, streamedUpTo) : m.content;
                const meta = messageMeta[i];
                const showThinking = !!m.pending || (isStreaming && !displayText);
                return (
                  <div key={i} data-role={m.role} className={`mx-auto w-full max-w-3xl min-w-0 ${m.role === "user" ? "flex justify-end" : "flex gap-3 items-start"}`}>
                    {m.role === "assistant" && (
                      <div className="mt-0.5 shrink-0" style={{ color: "var(--text-muted)" }}>
                        <LogoMark size={16} thinking={showThinking}/>
                      </div>
                    )}
                    {m.role === "user" ? (
                      <div className="ask-user-bubble max-w-[72%] min-w-0 break-words whitespace-pre-wrap rounded-sm rounded-tr-sm px-3.5 py-2.5 text-sm leading-relaxed">
                        {m.content}
                      </div>
                    ) : (
                      <div className="flex-1 min-w-0">
                        {/* UNIFIED slot — thinking, streaming, and final markdown all
                            render inside the SAME tags/indent; only the inner text swaps.
                            The top-edge never moves. */}
                        <div className="ask-assistant-line min-w-0 break-words whitespace-pre-wrap pl-4 text-sm space-y-0.5">
                          {showThinking
                            // The REAL tool phase from the engine ("Running search records…") when
                            // one is streaming; otherwise a plain "Thinking…". This used to cycle a
                            // fixed 4-step script on an 850ms timer — invented progress that had no
                            // connection to what the model was actually doing.
                            ? <span className="italic animate-pulse" style={{ color: "var(--text-faint)" }}>
                                {streamStatus ?? (tokenCount > 0 ? "Writing" : "Thinking")}…
                                {" "}<span className="not-italic tabular-nums opacity-70">· {elapsedSeconds < 60 ? `${elapsedSeconds}s` : `${Math.floor(elapsedSeconds / 60)}m ${String(elapsedSeconds % 60).padStart(2, "0")}s`}{tokenCount > 0 ? ` · ~${tokenCount} tokens` : ""}</span>
                              </span>
                            : isStreaming
                              // While streaming: render as STABLE plain text (the parent is
                              // whitespace-pre-wrap) so half-typed lines don't re-parse into
                              // headings/lists/tables each token — that re-parse was the jitter.
                              // Format to full markdown only once the answer is complete.
                              ? <span style={{ color: "var(--text-secondary)" }}>{displayText}</span>
                              : <Markdown text={displayText} links={sourcesToLinks(meta?.sources)}/>}
                          {isStreaming && displayText && <span className="inline-block w-0.5 h-4 bg-current animate-pulse ml-0.5 align-middle opacity-60"/>}
                        </div>
                        {/* The per-answer "Finance Agent"/"Signal Agent" badge was removed: that
                            name came from a regex over the user's own prompt, while the reply
                            always came from the generic /ask endpoint — attribution to an agent
                            that never ran, plus a hardcoded draft-ready status attribute styled as
                            a real agent state. The evidence strip below is real: it lists the
                            sources the answer was actually built from. */}
                        {!isStreaming && meta && (
                          <div className="flex flex-wrap items-center gap-2 mt-2 pl-4">
                            <EvidenceStrip sources={meta.sources}/>
                          </div>
                        )}
                        {!isStreaming && meta && (
                          <div className="flex items-center gap-1 mt-1.5 pl-3.5">
                            <button onClick={() => copyMessage(m.content, i)} title="Copy" className="rounded-md p-1.5 transition-colors hover:bg-[var(--surface-hover)]" style={{ color: copiedIdx === i ? "var(--section-accent)" : "var(--text-faint)" }}>
                              {copiedIdx === i ? <Check size={12}/> : <Copy size={12}/>}
                            </button>
                            <button onClick={() => sendFeedback(messages[i-1]?.content ?? "", m.content, 1, i)} title="Good response" className="rounded-md p-1.5 transition-colors hover:bg-[var(--surface-hover)]" style={{ color: feedbackGiven[i] === 1 ? "var(--section-accent)" : "var(--text-faint)" }}>
                              <ThumbsUp size={12}/>
                            </button>
                            <button onClick={() => sendFeedback(messages[i-1]?.content ?? "", m.content, -1, i)} title="Bad response" className="rounded-md p-1.5 transition-colors hover:bg-[var(--surface-hover)]" style={{ color: feedbackGiven[i] === -1 ? "var(--text-muted)" : "var(--text-faint)" }}>
                              <ThumbsDown size={12}/>
                            </button>
                            {i === messages.length - 1 && !loading && (
                              <button onClick={regenerate} title="Regenerate" className="rounded-md p-1.5 transition-colors hover:bg-[var(--surface-hover)]" style={{ color: "var(--text-faint)" }}>
                                <RotateCcw size={12}/>
                              </button>
                            )}
                          </div>
                        )}
                        {!isStreaming && meta?.usage && (
                          <div className="pl-4"><TokenLedger usage={meta.usage}/></div>
                        )}
                        {!isStreaming && meta && meta.sources.length > 0 && (
                          <div className="mt-2.5 pl-4">
                            <SourceList sources={meta.sources}/>
                          </div>
                        )}
                        {/* Suggested actions — clean, borderless inline pill row that
                            reads as a light extra layer under the answer (no heavy frame). */}
                        {!isStreaming && !loading && i === messages.length - 1 && (
                          <div className="chat-pills-in mt-2.5 flex flex-wrap items-center gap-1.5 pl-4">
                            {/* Primary actions stay visible */}
                            {([
                              { key: "task", label: "Create task" },
                              { key: "draft", label: "Draft message" },
                            ] as { key: "task" | "draft"; label: string }[]).map(a => (
                              <button key={a.key} onClick={() => sendSuggestion(buildChipText(a.key, i))}
                                className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-[12.5px] font-medium transition-all hover:-translate-y-px"
                                style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}>
                                <LogoMark size={11}/>{a.label}
                              </button>
                            ))}
                            {/* Secondary actions collapsed into a tidy menu */}
                            <div className="relative">
                              <button onClick={() => setActionsOpen(o => !o)}
                                className="inline-flex items-center gap-1 rounded-sm border px-3 py-1.5 text-[12.5px] font-medium transition-all hover:-translate-y-px"
                                style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}>
                                Actions <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
                              </button>
                              {actionsOpen && (
                                <div className="absolute bottom-full left-0 z-40 mb-1.5 w-48 overflow-hidden rounded-sm border" style={{ background: "var(--surface-card)", borderColor: "var(--border-soft)" }}>
                                  {([
                                    { key: "related", label: "Show related" },
                                    { key: "explain", label: "Explain reasoning" },
                                    { key: "decision", label: "Add to decision queue" },
                                    { key: "workflow", label: "Draft workflow" },
                                  ] as { key: "related" | "explain" | "decision" | "workflow"; label: string }[]).map(a => (
                                    <button key={a.key} onClick={() => { setActionsOpen(false); sendSuggestion(buildChipText(a.key, i)); }}
                                      className="block w-full px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-[var(--surface-hover)]" style={{ color: "var(--text-secondary)" }}>
                                      {a.label}
                                    </button>
                                  ))}
                                  {/* Real: the Ask backend has a create_report tool (ask.ts) and the chip kind exists. */}
                                  <button onClick={() => { setActionsOpen(false); sendSuggestion(buildChipText("report", i)); }}
                                    className="block w-full px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-[var(--surface-hover)]" style={{ color: "var(--text-secondary)" }}>
                                    Create report
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
            {!loading && streamingMsgIdx === null && suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2 pl-9">
                {suggestions.map((s, i) => (
                  <motion.button
                    key={`${i}-${s}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.28, delay: i * 0.06 }}
                    onClick={() => sendSuggestion(s)}
                    className="group inline-flex items-center gap-1.5 rounded-sm border px-3.5 py-1.5 text-[12.5px] font-medium transition-all hover:-translate-y-px"
                    style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}
                  >
                    <span>{s}</span>
                    <CornerDownLeft size={11} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: "var(--section-accent)" }}/>
                  </motion.button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Input — pinned at the bottom of the chat column while chatting */}
        <div className={`relative mx-auto w-full max-w-3xl ${isChatting ? "mt-3 shrink-0" : ""}`} ref={pickerRef}>
          {promptPickerOpen && (
            <div className="absolute top-full left-0 z-50 mt-2 w-full overflow-hidden rounded-sm border" style={{ background: "var(--surface-card)", borderColor: "var(--border-soft)" }}>
              <div className="border-b px-4 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
                <p className="text-caption font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>{loc.t("home.quick_prompts")}</p>
              </div>
              <div className="grid max-h-[50vh] grid-cols-1 gap-px overflow-y-auto p-1.5">
                {QUICK_PROMPTS.map(({ icon: Icon, label, description, prompt, promptKey }) => (
                  <button key={label} onClick={() => firePrompt(serverPrompt(promptKey, prompt))}
                    className="group flex items-center gap-3 rounded-sm px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-[var(--surface-hover)] transition-colors group-hover:bg-[var(--surface-selected)]">
                      <Icon size={13} className="text-[var(--text-secondary)]"/>
                    </span>
                    <span>
                      <span className="block text-sm transition-colors" style={{ color: "var(--text-primary)" }}>{label}</span>
                      <span className="block text-label" style={{ color: "var(--text-muted)" }}>{description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Attach picker — records (live search) + text files (read client-side) */}
          {attachOpen && (
            <div className="absolute top-full left-0 z-50 mt-2 w-full overflow-hidden rounded-sm border" style={{ background: "var(--surface-card)", borderColor: "var(--border-soft)" }}>
              <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border-soft)" }}>
                <Search size={13} style={{ color: "var(--text-faint)" }}/>
                <input autoFocus value={attachQuery} onChange={e => setAttachQuery(e.target.value)}
                  placeholder="Search records to attach…"
                  className="flex-1 bg-transparent text-sm outline-none" style={{ color: "var(--text-primary)" }}/>
                <button onClick={() => fileInputRef.current?.click()} className="shrink-0 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                  <Paperclip size={11}/> File
                </button>
              </div>
              <div className="max-h-56 overflow-y-auto p-1.5">
                {attachResults.length === 0 ? (
                  <p className="px-2 py-2 text-body" style={{ color: "var(--text-faint)" }}>{attachQuery.trim().length < 2 ? "Type to search records, or attach a text file." : "No matches."}</p>
                ) : attachResults.map(r => (
                  <button key={r.id} onClick={() => addRecord(r)} className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface-hover)]">
                    <span className="rounded px-1.5 py-px text-caption font-medium uppercase tracking-wide" style={{ background: "var(--surface-hover)", color: "var(--text-muted)" }}>{r.object_type}</span>
                    <span className="truncate text-sm" style={{ color: "var(--text-primary)" }}>{recordTitle(r)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept=".txt,.md,.csv,.json,.log,.tsv,text/plain" onChange={onFilePick} className="hidden"/>

          {/* Composer as a COLUMN: the question gets the full width on top, and the controls sit in
              a bar inside the bottom border. It was one horizontal row, so the input competed for
              width with five buttons and a one-line box invited a search query rather than a
              question. Same controls, same handlers, same order — regrouped. */}
          <div data-busy={loading} className="ask-input chat-input-bar chat-input-orbit flex flex-col gap-1 px-2.5 py-2 transition-all sm:px-3"
            style={isChatting ? { backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" } : undefined}>
            <textarea ref={inputRef} value={input} rows={1}
              onChange={e => {
                setInput(e.target.value);
                if (e.target.value.endsWith("@")) setAttachOpen(true); // @-mention → record picker
                // Auto-expand up to a max height, then scroll inside.
                const el = e.target; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
              }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={isChatting ? "Continue the conversation… (Shift+Enter for new line)" : "What do you want to know?"}
              className="w-full resize-none bg-transparent px-1 pt-1.5 text-[15px] leading-6 outline-none"
              style={{ color: "var(--text-primary)", minHeight: 52, maxHeight: 160 }}/>
            {/* ── control bar, inside the composer ── */}
            <div className="flex flex-wrap items-center gap-1">
          {attachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {attachments.map(a => (
                <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}>
                  {a.kind === "file" ? <FileText size={11} style={{ color: "var(--section-accent)" }}/> : <Inbox size={11} style={{ color: "var(--section-accent)" }}/>}
                  <span className="max-w-[180px] truncate">{a.title}</span>
                  <button onClick={() => setAttachments(list => list.filter(x => x.id !== a.id))} title="Remove" style={{ color: "var(--text-faint)" }}><X size={11}/></button>
                </span>
              ))}
            </div>
          )}
            <button onClick={() => setPromptPickerOpen(o => !o)} title="Quick prompts"
              className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-full transition-colors ${promptPickerOpen ? "bg-[var(--surface-selected)] text-[var(--text-primary)]" : "hover:bg-[var(--surface-hover)]"}`}
              style={promptPickerOpen ? undefined : { color: "var(--text-muted)" }}>
              <Plus size={18}/>
            </button>
            <button onClick={() => setAttachOpen(o => !o)} title="Attach record or file"
              className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-full transition-colors ${attachOpen ? "bg-[var(--surface-selected)] text-[var(--text-primary)]" : "hover:bg-[var(--surface-hover)]"}`}
              style={attachOpen ? undefined : { color: "var(--text-muted)" }}>
              <Paperclip size={17}/>
            </button>
              <span className="ml-auto" />
              <div className="relative shrink-0">
                <button onClick={() => setModeOpen(o => !o)} title="How much work Mondaily should do"
                  className="flex h-7 items-center gap-1 rounded-sm px-2 text-body capitalize transition-colors hover:bg-[var(--surface-hover)]"
                  style={{ color: "var(--text-secondary)" }}>
                  {askMode}<ChevronDown size={11}/>
                </button>
                {modeOpen && (
                  <div className="absolute bottom-full right-0 z-50 mb-1.5 w-56 overflow-hidden rounded-sm border" style={{ background: "var(--surface-card)", borderColor: "var(--border-soft)" }}>
                    {([
                      { id: "auto"  as const, label: "Auto",  hint: "Picks depth from the question" },
                      { id: "fast"  as const, label: "Fast",  hint: "One pass — for quick lookups" },
                      { id: "smart" as const, label: "Smart", hint: "More tool rounds and reasoning" },
                    ]).map(m => (
                      <button key={m.id} onClick={() => pickMode(m.id)}
                        className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-hover)]">
                        <Check size={12} className="mt-0.5 shrink-0" style={{ color: askMode === m.id ? "var(--section-accent)" : "transparent" }}/>
                        <span className="min-w-0">
                          <span className="block text-body" style={{ color: "var(--text-primary)" }}>{m.label}</span>
                          <span className="block text-body" style={{ color: "var(--text-faint)" }}>{m.hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            {isChatting && (
              <button onClick={newChat} className="shrink-0 text-xs transition-colors mr-0.5" style={{ color: "var(--text-faint)" }}>Clear</button>
            )}
            {voice.supported && (
              <button onClick={voice.toggle} title={voice.listening ? "Stop dictation" : "Dictate"}
                className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-full transition-colors ${voice.listening ? "animate-pulse" : "hover:bg-[var(--surface-hover)]"}`}
                style={{ color: voice.listening ? "var(--section-accent)" : "var(--text-muted)" }}>
                <Mic size={15}/>
              </button>
            )}
            {/* Send while idle; Stop (square) while generating */}
            <button onClick={loading ? stop : send} disabled={!loading && !input.trim() && attachments.length === 0}
              title={loading ? "Stop generating" : "Send"}
              className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150 disabled:cursor-not-allowed"
              style={loading
                ? { background: "var(--surface-selected)", color: "var(--section-accent)", border: "1px solid var(--section-accent)" }
                : input.trim()
                  ? { background: "var(--surface-selected)", color: "var(--section-accent)", border: "1px solid var(--section-accent)" }
                  : { background: "var(--surface-hover)", color: "var(--text-faint)" }}>
              {loading ? <Square size={13} strokeWidth={3} fill="currentColor"/> : <ArrowUp size={17} strokeWidth={2.5}/>}
            </button>
            </div>
          </div>
        </div>

        {/* Recent threads — directly under the input box, centered */}
        {!isChatting && recentThreads.length > 0 && (
          <div className="mx-auto mt-3 flex max-w-3xl flex-wrap items-center justify-center gap-2">
            <span className="text-label" style={{ color: "var(--text-faint)" }}>Recent:</span>
            {recentThreads.map(t => (
              <Link key={t.id} to={`/ask/${t.id}`} className="truncate max-w-[180px] text-[11px] transition-colors hover:text-stone-900 dark:hover:text-[var(--text-primary)]" style={{ color: "var(--text-muted)" }}>{t.title}</Link>
            ))}
            <span className="text-xs" style={{ color: "var(--text-faint)" }}>·</span>
            <Link to="/ask/new" className="text-[11px] transition-colors hover:text-stone-900 dark:hover:text-[var(--text-primary)]" style={{ color: "var(--text-muted)" }}>Full chat →</Link>
          </div>
        )}
        {!isChatting && recentThreads.length === 0 && (
          <div className="mx-auto mt-2 flex max-w-3xl justify-center">
            <Link to="/ask/new" className="text-[11px] transition-colors hover:text-stone-900 dark:hover:text-[var(--text-primary)]" style={{ color: "var(--text-muted)" }}>Open full chat →</Link>
          </div>
        )}

        {/* Smart starter cards — spaced below the input + recent */}
        {!isChatting && (
          <div className="mx-auto mt-6 max-w-2xl divide-y divide-[var(--border-soft)] border-t border-[var(--border-soft)]">
            {[
              {
                Icon: ListChecks,
                label: overdueCount > 0 ? `Show my ${overdueCount} overdue task${overdueCount === 1 ? "" : "s"}` : openTaskCount > 0 ? `Show my ${openTaskCount} open tasks` : "Show my tasks",
                sub: "as a clear table",
                prompt: "List my overdue and open tasks as a table with due dates and priority, then tell me what to focus on first.",
              },
              {
                Icon: TrendingUp,
                label: "What changed this week",
                sub: "across the workspace",
                prompt: "Summarise what changed across my workspace in the last 7 days — new and updated records, deals, and relationships — and flag anything that needs attention.",
              },
              hasFinance
                ? { Icon: FileText, label: "List overdue invoices", sub: "with totals", prompt: "List my overdue invoices as a table with amounts and days overdue, and give me the total outstanding." }
                : { Icon: Brain, label: "Plan my week", sub: "an opinionated brief", prompt: "Review my open tasks and recent activity, then build me an opinionated day-by-day plan for this week with specific next actions." },
              {
                Icon: Search,
                label: wsProfile.target_customers.trim()
                  ? `Find ${wsProfile.target_customers.trim()}${wsProfile.region.trim() ? ` in ${wsProfile.region.trim()}` : ""}`
                  : "Discover leads on the web",
                sub: "AI search across the open web + social",
                prompt: "",
                to: "/discovery",
              },
            ].map(s => (
              <button key={s.label} onClick={() => ("to" in s && s.to ? navigate(s.to) : sendSuggestion(applyTerms(s.prompt, wsProfile)))}
                className="group flex w-full items-center gap-3 px-2 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]">
                <s.Icon size={14} className="shrink-0" style={{ color: "var(--text-faint)" }}/>
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-body" style={{ color: "var(--text-primary)" }}>{s.label}</span>
                  <span className="ml-2 text-body" style={{ color: "var(--text-faint)" }}>{s.sub}</span>
                </span>
                <ArrowUpRight size={13} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60" style={{ color: "var(--text-faint)" }}/>
              </button>
            ))}
          </div>
        )}

        </div>
      </section>

      {/* ── Needs you — LEADS the cockpit: the one ranked "act now" list (decisions/risk/activity),
          promoted above the live-ops telemetry so what needs you is the first thing after the composer. ── */}
      <NeedsYouPanel
        notifications={notificationsQuery.data ?? []}
        notificationsError={notificationsQuery.isError}
        // Home is this panel's only mount, and it never passed this — so both of its
        // error/empty CTAs ("Ask what still works" / "Ask what changed") were dead buttons.
        onAskMondaily={prefill}
      />

      {/* ── Operating Picture — graph telemetry and the agent map share one
          continuous control-room zone. The components keep their own data
          and actions; this wrapper only gives the page a clearer hierarchy. ── */}
      <section className="home-section home-operating-picture">
        {/* The accent dot here was bound to nothing — a "live" light that was always on. The
            constellation below reports the real live-agent count. */}
        <div className="mb-4 flex items-center gap-2">
          <p className="home-section-title !mb-0">Live operations</p>
        </div>
        {/* Agents lead — the AI command center is the centerpiece, with the
            workspace pulse as supporting context below it. */}
        <div className="space-y-6">
          <div id="agents" className="scroll-mt-20">
            <AgentConstellationPanel />
          </div>
          <WorkspaceGraphPulse />
        </div>
      </section>

      {/* ── Today's Flow — tasks and meetings, side by side. ── */}
      <section className="home-section">
        <div className="today-flow-header flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="home-section-title">Today&rsquo;s work</p>
          </div>
          <div className="today-scope-switch" role="group" aria-label="Task scope">
            {(["mine", "all"] as const).map(scope => (
              <button
                key={scope}
                onClick={() => setTaskScope(scope)}
                className="today-scope-option"
                data-active={taskScope === scope}
              >
                {scope === "mine" ? "Assigned to me" : "Workspace"}
              </button>
            ))}
          </div>
        </div>
        <div className="today-flow-grid grid gap-6 md:grid-cols-2">

        {/* Tasks card */}
        <section className="flow-panel-clean flex flex-col overflow-hidden">
          <div className="flow-panel-heading flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckSquare size={13} className="text-[var(--text-secondary)]"/>
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{loc.t("nav.tasks")}</span>
              {/* Previously claimed AI ordering that never happened — the list is sorted by due
                  date in the widget below, and the label now says exactly that. */}
              <span className="flow-micro-badge">Soonest due</span>
            </div>
            <Link to="/tasks" className="flex items-center gap-0.5 text-[11px] transition-colors hover:text-stone-900 dark:hover:text-[var(--text-primary)]" style={{ color: "var(--text-muted)" }}>
              View all <ArrowUpRight size={11}/>
            </Link>
          </div>

          <div className="flex-1">
            {tasksQuery.isLoading ? (
              <div className="py-4"><PageSkeleton rows={4} label="Loading tasks…"/></div>
            ) : tasksQuery.isError ? (
              <div className="py-4">
                <div className="rounded-sm px-4 py-5 text-center" style={{ background: "color-mix(in srgb, var(--status-warn) 7%, var(--surface-card))", border: "1px solid color-mix(in srgb, var(--status-warn) 24%, var(--border-soft))" }}>
                  <p className="text-body font-medium" style={{ color: "var(--text-primary)" }}>Could not load tasks</p>
                  <p className="mt-1 text-body" style={{ color: "var(--text-muted)" }}>{(tasksQuery.error as Error)?.message || "The tasks API did not return data."}</p>
                  <button onClick={() => tasksQuery.refetch()} className="btn-suggested mt-3 !px-2.5 !py-1 !text-[11px]">Retry</button>
                </div>
              </div>
            ) : activeTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1.5 py-14 text-center px-4">
                <LogoMark size={16} className="mb-2" style={{ color: "var(--text-faint)" }}/>
                <p className="text-body" style={{ color: "var(--text-secondary)" }}>No open tasks.</p>
                <p className="mt-0.5 text-body" style={{ color: "var(--text-faint)" }}>Ask AI to create tasks from your work.</p>
              </div>
            ) : (
              <ul className="flow-list">
                {[...activeTasks].sort((a, b) => {
                  // Overdue first, then by soonest due date; undated tasks sink to the bottom.
                  const ad = a.due_date ? new Date(a.due_date).getTime() : Infinity;
                  const bd = b.due_date ? new Date(b.due_date).getTime() : Infinity;
                  return ad - bd;
                }).slice(0, 6).map(item => {
                  const isOverdue = isPastDue(item.due_date);
                  const assigneeName = getMemberName(item);
                  const statusColor = item.status === "review" ? "bg-[#c6892e]" : item.status === "done" ? "btn-solid dark:bg-stone-100" : item.status === "in_progress" ? "bg-stone-500 dark:bg-stone-400" : "bg-stone-300 dark:bg-stone-700";
                  return (
                    <li key={item.id} onClick={() => setDetailTask(item)}
                      className="flow-list-row group flex cursor-pointer items-center gap-3 transition-colors">
                      <span className={`shrink-0 h-1.5 w-1.5 rounded-full ${statusColor}`}/>
                      <span className="flex-1 min-w-0 truncate text-sm transition-colors" style={{ color: "var(--text-secondary)" }}>{item.title}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.priority && item.priority !== "low" && (
                          <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${PRIORITY_STYLE[item.priority] ?? PRIORITY_STYLE.medium}`}>{item.priority}</span>
                        )}
                        {item.due_date && (
                          <span className="flex items-center gap-0.5 text-[11px]" style={{ color: isOverdue ? "var(--status-warn)" : "var(--text-faint)" }}>
                            <Clock size={9}/>
                            {new Date(item.due_date).toLocaleDateString(loc.lang, { month: "short", day: "numeric" })}
                          </span>
                        )}
                        {assigneeName && (
                          <span className="hidden sm:flex items-center gap-0.5 text-[11px]" style={{ color: "var(--text-faint)" }}>
                            <User size={9}/>{assigneeName}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Task AI footer */}
          <div className="flow-panel-footer" ref={taskPickerRef}>
            <div className="relative flex items-center gap-2 rounded-sm border px-3 py-2 transition-colors" style={{ background: "color-mix(in srgb, var(--surface-hover) 48%, transparent)", borderColor: "var(--border-soft)" }}>
              <LogoMark size={11} className="shrink-0" style={{ color: "var(--text-muted)" }}/>
              <input value={taskWidgetInput}
                onChange={e => setTaskWidgetInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submitTaskWidgetInput(taskWidgetInput)}
                placeholder="Add task or ask AI…"
                className="flex-1 bg-transparent text-xs outline-none min-w-0" style={{ color: "var(--text-primary)" }}/>
              {taskWidgetLoading ? (
                <Loader2 size={11} className="animate-spin shrink-0" style={{ color: "var(--text-faint)" }}/>
              ) : (
                <>
                  <button onClick={runScan} disabled={scanLoading} title="AI scan report"
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-40" style={{ border: "1px solid var(--border-soft)", color: "var(--text-muted)" }}>
                    {scanLoading ? <Loader2 size={9} className="animate-spin"/> : "Scan"}
                  </button>
                  <button onClick={() => submitTaskWidgetInput(taskWidgetInput)} disabled={!taskWidgetInput.trim()}
                    className="shrink-0 text-[var(--text-secondary)] transition-colors hover:text-stone-900 disabled:opacity-30 dark:text-[var(--text-secondary)] dark:hover:text-[var(--text-primary)]">
                    <Send size={11}/>
                  </button>
                </>
              )}
            </div>
            {/* The agent's answer. It was previously computed (and charged for) but never
                rendered, so asking here looked like it did nothing. */}
            {taskWidgetReply && (
              <div className="mt-2 flex items-start gap-2 rounded-sm border px-3 py-2" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
                <LogoMark size={11} className="mt-0.5 shrink-0" style={{ color: "var(--section-accent)" }}/>
                <p className="flex-1 whitespace-pre-wrap text-[12px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{taskWidgetReply}</p>
                <button onClick={() => { setTaskWidgetReply(null); setTaskWidgetFollowups([]); }} title="Dismiss"
                  className="shrink-0 transition-colors" style={{ color: "var(--text-faint)" }}>
                  <X size={11}/>
                </button>
              </div>
            )}
            {taskWidgetReply && taskWidgetFollowups.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {taskWidgetFollowups.map((f, i) => (
                  <button key={i} onClick={() => { setTaskWidgetReply(null); setTaskWidgetFollowups([]); void submitTaskWidgetInput(f); }}
                    className="rounded-full border px-2.5 py-1 text-[11px] transition-colors hover:bg-[var(--surface-hover)]"
                    style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Meetings card — real connected calendar (Google / Microsoft) + workspace meetings */}
        {(() => {
          const cal = calendarQ.data;
          const calConnected = cal?.connected;
          // Merge connected-calendar events with any workspace-created meetings, sorted by start.
          const calEvents = (cal?.events ?? []).map(e => ({ id: e.id, title: e.title, when: e.allDay ? "All day" : new Date(e.start).toLocaleTimeString(loc.lang, { hour: "numeric", minute: "2-digit" }), sub: e.location || (e.attendees ? `${e.attendees} attendee${e.attendees === 1 ? "" : "s"}` : ""), url: e.meetingUrl, start: e.start }));
          // Native Mondaily meetings — link to the in-app meeting room.
          const nativeEvents = (nativeMeetingsQ.data?.events ?? []).map(e => ({ id: `native-${e.id}`, title: e.title, when: new Date(e.start_at).toLocaleTimeString(loc.lang, { hour: "numeric", minute: "2-digit" }), sub: e.location || (e.attendees?.length ? `${e.attendees.length} attendee${e.attendees.length === 1 ? "" : "s"}` : "Mondaily"), url: `/calls/${e.id}`, start: e.start_at }));
          const allEvents = [...calEvents, ...nativeEvents].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
          const loading = calendarQ.isLoading || nativeMeetingsQ.isLoading;
          return (
            <section className="flow-panel-clean flex flex-col overflow-hidden">
              <div className="flow-panel-heading flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar size={13} className="text-[var(--text-secondary)]"/>
                  <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Meetings</span>
                  {calConnected && cal?.provider && (
                    <span className="flow-micro-badge" title={cal.email}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--status-ok)" }}/> {cal.provider === "microsoft" ? "Outlook" : "Google"}
                    </span>
                  )}
                </div>
                <span className="text-label" style={{ color: "var(--text-faint)" }}>{loc.t("home.today")}</span>
              </div>
              <div className="flex-1">
                {loading ? (
                  <div className="py-4"><PageSkeleton rows={3} label="Loading meetings…"/></div>
                ) : allEvents.length ? (
                  <ul className="flow-list">
                    {allEvents.map(m => {
                      const row = (
                        <>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm" style={{ color: "var(--text-secondary)" }}>{m.title}</p>
                            {m.sub && <p className="mt-0.5 truncate text-label" style={{ color: "var(--text-faint)" }}>{m.sub}</p>}
                          </div>
                          <span className="shrink-0 text-label tabular-nums" style={{ color: "var(--text-muted)" }}>{m.when}</span>
                        </>
                      );
                      // Internal meeting rooms ("/calls/:id") stay in the SPA — they were opening
                      // in a new tab with a full page reload. Only external provider links
                      // (Google/Outlook) get target="_blank".
                      return m.url?.startsWith("/") ? (
                        <li key={m.id}><Link to={m.url} className="flow-list-row group flex items-center gap-3 hover:opacity-90">{row}</Link></li>
                      ) : m.url ? (
                        <li key={m.id}><a href={m.url} target="_blank" rel="noreferrer" className="flow-list-row group flex items-center gap-3 hover:opacity-90">{row}</a></li>
                      ) : (
                        <li key={m.id} className="flow-list-row flex items-center gap-3">{row}</li>
                      );
                    })}
                  </ul>
                ) : calConnected ? (
                  <div className="flex flex-col items-center justify-center gap-1.5 py-14 text-center px-5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-sm mb-3" style={{ background: "var(--surface-hover)", border: "1px solid var(--border-soft)" }}>
                      <Calendar size={16} style={{ color: "var(--text-faint)" }}/>
                    </div>
                    <p className="text-body font-medium" style={{ color: "var(--text-secondary)" }}>No meetings today</p>
                    <p className="mt-1 text-label" style={{ color: "var(--text-faint)" }}>Your {cal?.provider === "microsoft" ? "Outlook" : "Google"} calendar is connected and clear.</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-9 text-center px-5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-sm mb-3" style={{ background: "var(--surface-hover)", border: "1px solid var(--border-soft)" }}>
                      <Calendar size={16} style={{ color: "var(--text-faint)" }}/>
                    </div>
                    <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>Connect your calendar</p>
                    <p className="mt-1 mb-3 text-label max-w-[240px]" style={{ color: "var(--text-faint)" }}>Sync Google or Outlook to see your day here — read-only, connected directly, no third-party broker.</p>
                    <div className="flex gap-2">
                      <button onClick={() => connectCalendar("google")} disabled={!!connectingCal} className="btn-secondary !px-3 !py-1.5 !text-[11px]">
                        {connectingCal === "google" ? <Loader2 size={11} className="inline animate-spin"/> : "Connect Google"}
                      </button>
                      <button onClick={() => connectCalendar("microsoft")} disabled={!!connectingCal} className="btn-secondary !px-3 !py-1.5 !text-[11px]">
                        {connectingCal === "microsoft" ? <Loader2 size={11} className="inline animate-spin"/> : "Connect Outlook"}
                      </button>
                    </div>
                    {cal?.needs_reauth && <p className="mt-2 text-label" style={{ color: "var(--status-warn)" }}>Reconnect needed — your calendar token expired.</p>}
                  </div>
                )}
              </div>
            </section>
          );
        })()}
          </div>
      </section>

      {detailTask && (
        <TaskDetailPanel task={detailTask} members={members}
          onClose={() => setDetailTask(null)}
          onUpdate={() => { qc.invalidateQueries({ queryKey: ["tasks", "home"] }); }}
        />
      )}

      {/* Scan report modal */}
      {(scanReport || scanLoading) && (
        <Modal title="AI Scan Report" subtitle={scanTimestamp || undefined}
          onClose={() => { if (!scanLoading) setScanReport(null); }}
          headerAction={!scanLoading && scanReport ? (
            <button onClick={printReport}
              className="flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-label transition-colors hover:bg-[var(--surface-hover)]"
              style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
              <Printer size={11}/> Print
            </button>
          ) : undefined}
          footer={!scanLoading && scanReport ? (
            <button onClick={() => setScanReport(null)}
              className="h-8 rounded-md px-3 text-label transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: "var(--text-secondary)" }}>Close</button>
          ) : undefined}>
            <div className="flex-1 space-y-1 overflow-y-auto px-5 py-5 text-sm" style={{ color: "var(--text-secondary)" }}>
              {scanLoading ? (
                <div className="flex items-center gap-3 py-4" style={{ color: "var(--text-muted)" }}>
                  <LogoMark size={22} thinking />
                  <span className="text-sm italic tracking-wide">Searching workspace…</span>
                </div>
              ) : scanReport ? <Markdown text={scanReport}/> : null}
            </div>
        </Modal>
      )}
    </div>
  );
}
