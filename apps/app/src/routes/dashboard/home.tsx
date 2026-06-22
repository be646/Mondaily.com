import { useUser } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, CheckSquare, Sparkles, Send, Loader2, User, Clock, ArrowUpRight, Flag, Plus, Zap, MailCheck, Brain, TrendingUp, ListChecks, BellDot, CornerDownLeft, Printer, Mic, GitBranch, Inbox, FileText } from "lucide-react";
import { LogoMark } from "../../components/logo";
import { NeedsYouPanel, WorkspaceGraphPulse } from "../../components/ai/command-center";
import { AgentConstellationPanel } from "../../components/ai/agent-constellation";
import { useDecisionQueue } from "../../components/ai/decision-queue";
import {
  GRAPH_REASONING_STEPS, EvidenceStrip, SourceCard, friendlyAskError,
} from "../../components/ai/ask-shared";
import { useAskEngine } from "../../components/ai/use-ask-engine";
import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { PageSkeleton, ErrorState } from "../../components/ui/page-state";
import { apiClient } from "../../lib/api-client";
import { getThreads } from "../../lib/chat-store";
import { TaskDetailPanel } from "../../components/tasks/task-detail-panel";
import { useModules } from "../../hooks/useModules";

// Converts markdown to clean readable JSX — strips tables, stars, dashes
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = (key: string) => {
    if (!listBuffer.length) return;
    nodes.push(
      <ul key={key} className="my-1.5 space-y-1 pl-1">
        {listBuffer.map((item, i) => (
          <li key={i} className="flex gap-2.5 text-slate-200">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-500"/>
            <span className="leading-7">{inlineFormat(item)}</span>
          </li>
        ))}
      </ul>
    );
    listBuffer = [];
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    // blank
    if (!trimmed) { flushList(`l${i}`); nodes.push(<div key={i} className="h-2"/>); return; }
    // table separator rows like |---|---| — skip entirely
    if (/^\|[-| :]+\|$/.test(trimmed)) return;
    // table data rows like | col | col | — render as bullet list row
    if (/^\|/.test(trimmed) && /\|$/.test(trimmed)) {
      const cells = trimmed.split("|").map(c => c.trim()).filter(Boolean);
      listBuffer.push(cells.join("  ·  "));
      return;
    }
    // headings
    if (/^#{1,3}\s/.test(trimmed)) {
      flushList(`l${i}`);
      const t = trimmed.replace(/^#{1,3}\s/, "");
      nodes.push(<p key={i} className="mt-4 mb-1 text-sm font-semibold text-white">{t}</p>);
      return;
    }
    // horizontal rule
    if (/^---+$/.test(trimmed)) {
      flushList(`l${i}`);
      nodes.push(<hr key={i} className="border-white/[.06] my-3"/>);
      return;
    }
    // bullet list
    if (/^[-*•]\s/.test(trimmed)) {
      listBuffer.push(trimmed.replace(/^[-*•]\s/, ""));
      return;
    }
    // numbered list
    if (/^\d+\.\s/.test(trimmed)) {
      listBuffer.push(trimmed.replace(/^\d+\.\s/, ""));
      return;
    }
    flushList(`l${i}`);
    nodes.push(<p key={i} className="leading-7 text-slate-200">{inlineFormat(trimmed)}</p>);
  });
  flushList("end");
  return <>{nodes}</>;
}

function inlineFormat(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__)/g);
  return parts.map((p, i) => {
    if (/^\*\*/.test(p) || /^__/.test(p))
      return <strong key={i} className="font-semibold text-white">{p.slice(2, -2)}</strong>;
    return p.replace(/[*_`|]/g, "");  // strip * _ ` | from plain spans
  });
}

const QUICK_PROMPTS = [
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
    prompt: "Review the workspace graph. Which deals, assets, or relationships are stalled, overdue for follow-up, or close to closing? Rank them by urgency and tell me exactly what action to take on each one.",
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

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_STYLE: Record<string, string> = {
  urgent: "bg-indigo-400/10 text-indigo-400",
  high:   "bg-orange-400/10 text-orange-400",
  medium: "bg-blue-400/10 text-blue-400",
  low:    "bg-slate-400/10 text-slate-400",
};

export function HomePage() {
  const { user } = useUser();
  const { hasFinance } = useModules();
  const qc = useQueryClient();
  const askSectionRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [taskWidgetInput, setTaskWidgetInput] = useState("");
  const [taskWidgetLoading, setTaskWidgetLoading] = useState(false);
  const [taskWidgetReply, setTaskWidgetReply] = useState<string | null>(null);
  const [thinkingStep, setThinkingStep] = useState(0);
  const taskWidgetInputRef = useRef<HTMLInputElement>(null);
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const [taskPromptPickerOpen, setTaskPromptPickerOpen] = useState(false);
  const taskPickerRef = useRef<HTMLDivElement>(null);
  const [scanReport, setScanReport] = useState<string | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanTimestamp, setScanTimestamp] = useState("");
  const [riskBanner, setRiskBanner] = useState<number | null>(null); // number of new risk alerts created
  const [streamingMsgIdx, setStreamingMsgIdx] = useState<number | null>(null);
  const [streamedUpTo, setStreamedUpTo] = useState(0);
  const streamRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const newTaskRef = useRef<HTMLInputElement>(null); // kept for compat
  const pickerRef = useRef<HTMLDivElement>(null);

  const startStreaming = useCallback((msgIdx: number, fullText: string) => {
    if (streamRef.current) clearInterval(streamRef.current);
    setStreamingMsgIdx(msgIdx);
    setStreamedUpTo(0);
    let pos = 0;
    streamRef.current = setInterval(() => {
      pos += Math.floor(Math.random() * 5) + 3; // 3–7 chars per frame — natural pace
      if (pos >= fullText.length) {
        pos = fullText.length;
        clearInterval(streamRef.current!);
        streamRef.current = null;
        setStreamingMsgIdx(null);
      }
      setStreamedUpTo(pos);
    }, 18);
  }, []);

  // Same request pipeline as the main Ask Mondaily page and the right-side
  // drawer: same endpoint, thread_id/history handling, agent inference, real
  // sources. Home's context is general workspace scope.
  const {
    messages, setMessages, currentThreadId, setCurrentThreadId, loading,
    suggestions, setSuggestions, messageMeta, doSend, buildChipText,
  } = useAskEngine({ context: { scope_label: "the Home dashboard (general workspace)" }, onAssistantMessage: startStreaming });

  useEffect(() => {
    if (!loading) { setThinkingStep(0); return; }
    const id = setInterval(() => setThinkingStep(s => Math.min(s + 1, GRAPH_REASONING_STEPS.length - 1)), 850);
    return () => clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (!promptPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPromptPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [promptPickerOpen]);

  useEffect(() => {
    if (!taskPromptPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (taskPickerRef.current && !taskPickerRef.current.contains(e.target as Node)) setTaskPromptPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [taskPromptPickerOpen]);
  const tasksQuery = useQuery({ queryKey: ["tasks", "home"], queryFn: () => apiClient.get<Task[]>("/tasks?filter=mine&sort=priority") });
  const membersQuery = useQuery({ queryKey: ["members"], queryFn: () => apiClient.get<Member[]>("/members") });
  const meetings = useQuery({ queryKey: ["meetings", "home"], queryFn: () => apiClient.get<Meeting[]>("/meetings/today") });
  const notificationsQuery = useQuery({
    queryKey: ["notifications", "risk"],
    queryFn: () => apiClient.get<{ id: string; type: string; is_read: boolean; title: string; body?: string; created_at?: string }[]>("/notifications?limit=50"),
    staleTime: 60_000,
  });
  // Real pending-decision count for the command room's telemetry strip —
  // same query/endpoint the Decision Queue panel itself uses below.
  const decisionsQuery = useDecisionQueue();

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
  const recentThreads = getThreads().slice(0, 3);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

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

  const send = () => { const t = input.trim(); if (t) { setInput(""); doSend(t); } };

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
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 48px auto; color: #1a1a1a; line-height: 1.7; font-size: 15px; }
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
    setScanTimestamp(new Date().toLocaleString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }));
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
      // Refresh task list in case AI created/updated tasks
      qc.invalidateQueries({ queryKey: ["tasks", "home"] });
    } catch (err: any) {
      setTaskWidgetReply(friendlyAskError(err));
    }
    setTaskWidgetLoading(false);
  };

  const TASK_PROMPTS = [
    { label: "What's overdue?",       prompt: "List all my overdue tasks and tell me what to do about each one." },
    { label: "What to focus on?",     prompt: "Which of my open tasks should I focus on right now and why?" },
    { label: "Create from notes",     prompt: "Based on my recent activity and notes, suggest 3 tasks I should create and create them for me." },
    { label: "Prep daily brief",      prompt: "Give me a quick brief on my tasks for today: what's urgent, what's due, and what I can defer." },
  ];

  const sendSuggestion = useCallback((text: string) => {
    setSuggestions([]);
    doSend(text);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doSend]);

  const firePrompt = useCallback((text: string) => {
    setPromptPickerOpen(false);
    sendSuggestion(text);
  }, [sendSuggestion]);

  // Route/context chips fill the input and focus it rather than auto-sending
  // — the user reviews and completes the question before it goes anywhere.
  const prefill = useCallback((text: string) => {
    setInput(text);
    inputRef.current?.focus();
  }, []);

  const todayLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const overdueCount = activeTasks.filter(t => t.due_date && new Date(t.due_date) < new Date()).length;
  const urgentCount  = activeTasks.filter(t => t.priority === "urgent").length;
  // Count unread AI risk alerts from notifications (persists across page loads, not just the one scan run)
  const unreadRiskCount = (notificationsQuery.data ?? []).filter(n => n.type === "ai_risk" && !n.is_read).length;
  const unreadCount = (notificationsQuery.data ?? []).filter(n => !n.is_read).length;
  const pendingDecisionsCount = decisionsQuery.data?.length ?? 0;
  const graphSynced = !tasksQuery.isError && !notificationsQuery.isError;
  const sourcesChecked = !notificationsQuery.isLoading && !notificationsQuery.isError;

  return (
    <div className="home-control-room mx-auto max-w-5xl px-4 py-8 sm:px-6">

      {/* ── Workspace Command Room — a full-width band, not a card. Bleeds
          past the page's own padding so it reads as the page's top zone,
          not another boxed panel stacked with the rest. Left-aligned, not
          centered — reads as a normal page header. ── */}
      <div className="command-room relative -mx-4 -mt-8 mb-6 px-4 pb-6 pt-7 sm:-mx-6 sm:px-8">
        <p className="text-xs font-medium uppercase tracking-widest mb-1" style={{ color: "var(--text-faint)" }}>{todayLabel}</p>
        <h1 className="text-[26px] font-semibold tracking-tight sm:text-[30px]" style={{ color: "var(--text-primary)" }}>{greeting}, {user?.firstName || "there"}.</h1>
        <p className="mt-1 max-w-xl text-[13px] sm:text-sm" style={{ color: "var(--text-muted)" }}>
          Your workspace graph is running. Agents are watching records, tasks, finance, and decisions.
        </p>

        {/* Metric pills — flat, transparent, each with its own soft
            colored border line. No "Ask Mondaily" button here — the
            console right below is the single entry point. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="metric-pill" data-tone="indigo"><ListChecks size={11}/>{activeTasks.length} open tasks</span>
          <span className="metric-pill" data-tone="amber"><FileText size={11}/>{pendingDecisionsCount} pending decisions</span>
          <span className="metric-pill" data-tone="cyan"><Inbox size={11}/>{unreadCount} unread</span>
        </div>

        {/* Live signs — clean, uncrowded, alongside the metrics rather
            than in their own separate row. No animation. */}
        <div className="relative mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="status-chip" data-tone={graphSynced ? "default" : "amber"}><span className="dot" style={{ animation: "none" }}/>Graph {graphSynced ? "synced" : "syncing"}</span>
          <span className="status-chip" data-tone="violet"><span className="dot" style={{ animation: "none" }}/>Agents active</span>
          <span className="status-chip" data-tone="cyan"><span className="dot" style={{ animation: "none" }}/>Sources {sourcesChecked ? "checked" : "checking…"}</span>
        </div>

        {/* Anything that actually needs attention — kept separate from
            the ambient live signs above so the two don't blur together. */}
        {(overdueCount > 0 || urgentCount > 0 || unreadRiskCount > 0 || riskBanner) && (
          <div className="relative mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            {overdueCount > 0 && (
              <Link to="/tasks" state={{ filter: "overdue" }} className="flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs text-indigo-700 hover:bg-indigo-100 transition-colors dark:border-indigo-500/20 dark:bg-indigo-500/[.07] dark:text-indigo-400 dark:hover:bg-indigo-500/[.12]">
                <Clock size={11}/>
                {overdueCount} overdue assigned to you
              </Link>
            )}
            {urgentCount > 0 && (
              <Link to="/tasks" state={{ filter: "mine", priority: "urgent" }} className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700 hover:bg-amber-100 transition-colors dark:border-amber-500/20 dark:bg-amber-500/[.07] dark:text-amber-400 dark:hover:bg-amber-500/[.12]">
                <Flag size={11}/>
                {urgentCount} urgent
              </Link>
            )}
            {(unreadRiskCount > 0 || (riskBanner !== null && riskBanner > 0)) && (
              <Link to="/notifications" className="flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs text-indigo-700 hover:bg-indigo-100 transition-colors dark:border-amber-500/25 dark:bg-amber-500/[.08] dark:text-amber-300 dark:hover:bg-amber-500/[.14]">
                <BellDot size={11}/>
                {unreadRiskCount || riskBanner} AI risk alert{((unreadRiskCount || riskBanner) ?? 0) > 1 ? "s" : ""}
              </Link>
            )}
          </div>
        )}
      </div>

      {/* ── Ask Mondaily — moved back to the top, right under the command
          room, since it's the primary entry point into the workspace
          graph. No boxed background — blends into the page; the input
          field itself keeps a subtle bordered pill. ── */}
      {(notificationsQuery.isError || decisionsQuery.isError) && (
        <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/[.07] px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          Could not load activity. Some agent and decision signals may be missing.
        </div>
      )}

      <section ref={askSectionRef} className="chat-console relative mx-auto mb-8 max-w-2xl rounded-3xl p-6 sm:p-8">
        {/* Live dot — small, top-right, no label clutter */}
        <div className="absolute right-5 top-5 flex items-center gap-1.5 text-[10.5px]" style={{ color: "var(--text-faint)" }}>
          <span className="relative flex h-1.5 w-1.5 rounded-full bg-emerald-500"/>
          Online
        </div>
        <div className="relative">
        {!isChatting && (
          <div className="mb-6 text-center">
            <h2 className="mx-auto max-w-sm text-[24px] font-semibold leading-tight tracking-tight sm:text-[28px]" style={{ color: "var(--text-primary)" }}>
              Your workspace,{" "}understood.
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-[13px]" style={{ color: "var(--text-faint)" }}>
              Ask anything — Mondaily turns it into an answer, a task, or a decision with sources.
            </p>
          </div>
        )}

        {isChatting && (
          <div className="mb-6 max-h-[480px] overflow-y-auto space-y-6 pr-1 scroll-smooth" style={{ scrollbarWidth: "none" }}>
            {(() => {
              // Colour palette that cycles per AI reply
              const ACCENTS = [
                { border: "border-l-violet-500/50", dot: "bg-violet-400", userBorder: "border-violet-500/30", userText: "text-violet-200" },
                { border: "border-l-blue-500/50",   dot: "bg-blue-400",   userBorder: "border-blue-500/30",   userText: "text-blue-200"   },
                { border: "border-l-emerald-500/50",dot: "bg-emerald-400",userBorder: "border-emerald-500/30",userText: "text-emerald-200"},
                { border: "border-l-rose-500/50",   dot: "bg-rose-400",   userBorder: "border-rose-500/30",   userText: "text-rose-200"   },
                { border: "border-l-amber-500/50",  dot: "bg-amber-400",  userBorder: "border-amber-500/30",  userText: "text-amber-200"  },
              ];
              // Count which AI reply index we're on to pick the colour
              let aiIdx = -1;
              return messages.map((m, i) => {
                if (m.role === "assistant") aiIdx++;
                const accent = ACCENTS[aiIdx % ACCENTS.length] ?? ACCENTS[0]!;
                const isStreaming = streamingMsgIdx === i;
                const displayText = isStreaming ? m.content.slice(0, streamedUpTo) : m.content;
                const meta = messageMeta[i];
                const AgentIcon = meta?.agent.icon;
                return (
                  <div key={i} className={m.role === "user" ? "flex justify-end" : "flex gap-3 items-start"}>
                    {m.role === "assistant" && (
                      <div className="mt-0.5 shrink-0 text-indigo-400">
                        <LogoMark size={16}/>
                      </div>
                    )}
                    {m.role === "user" ? (
                      <div className={`max-w-[72%] rounded-2xl rounded-tr-sm border bg-transparent px-3.5 py-2.5 text-sm leading-relaxed ${accent.userBorder} ${accent.userText}`}>
                        {m.content}
                      </div>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <div className={`border-l-2 pl-4 text-sm space-y-0.5 ${accent.border}`}>
                          {renderMarkdown(displayText)}
                          {isStreaming && <span className="inline-block w-0.5 h-4 bg-current animate-pulse ml-0.5 align-middle opacity-60"/>}
                        </div>
                        {!isStreaming && meta && AgentIcon && (
                          <div className="flex flex-wrap items-center gap-2 mt-2 pl-4">
                            <span className="agent-badge" data-status="draft_ready">
                              <AgentIcon size={10}/>
                              {meta.agent.name}
                            </span>
                            <EvidenceStrip sources={meta.sources}/>
                          </div>
                        )}
                        {!isStreaming && meta && meta.sources.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2 pl-4">
                            {meta.sources.map((s, si) => <SourceCard key={si} source={s}/>)}
                          </div>
                        )}
                        {/* Same action-chip set as the main Ask page and the right-side
                            drawer — built from buildChipText() so every surface embeds
                            the same real prior question/answer, not just "this". */}
                        {!isStreaming && !loading && i === messages.length - 1 && (
                          <div className="flex flex-wrap gap-1.5 mt-2.5 pl-4">
                            <button onClick={() => sendSuggestion(buildChipText("task", i))} className="btn-ai">
                              <Sparkles size={11}/> Create task from this
                            </button>
                            <button onClick={() => sendSuggestion(buildChipText("draft", i))} className="btn-ai">
                              <Sparkles size={11}/> Draft message
                            </button>
                            <button onClick={() => sendSuggestion(buildChipText("related", i))} className="btn-suggested">
                              Show related objects
                            </button>
                            <button onClick={() => sendSuggestion(buildChipText("explain", i))} className="btn-suggested">
                              Explain reasoning
                            </button>
                            <button onClick={() => sendSuggestion(buildChipText("decision", i))} className="btn-suggested">
                              Add to decision queue
                            </button>
                            <button onClick={() => sendSuggestion(buildChipText("workflow", i))} className="btn-suggested">
                              Draft workflow
                            </button>
                            <span title="Coming soon — no report-creation tool exists yet"
                              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium cursor-not-allowed opacity-50"
                              style={{ border: "1px solid var(--border-soft)", color: "var(--text-faint)" }}>
                              Create report
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
            {loading && (
              <div className="flex items-center gap-3 pl-1 text-slate-400">
                <LogoMark size={22} thinking />
                <span className="text-sm text-slate-500 italic tracking-wide">{GRAPH_REASONING_STEPS[thinkingStep]}…</span>
              </div>
            )}
            {!loading && streamingMsgIdx === null && suggestions.length > 0 && (
              <div className="flex flex-col gap-1.5 pl-9">
                {suggestions.map((s, i) => (
                  <button key={i} onClick={() => sendSuggestion(s)}
                    className="group flex items-center justify-between gap-3 rounded-xl border border-[#e5e7eb] bg-white px-4 py-2.5 text-left text-sm text-[#374151] hover:bg-[#f8fafc] hover:border-[#cbd5e1] transition-colors dark:border-white/[.07] dark:bg-white/[.03] dark:text-slate-300 dark:hover:bg-white/[.06] dark:hover:border-white/[.12]">
                    <span>{s}</span>
                    <CornerDownLeft size={12} className="shrink-0 text-[#9ca3af] group-hover:text-[#52525b] dark:text-slate-600 dark:group-hover:text-slate-400 transition-colors"/>
                  </button>
                ))}
              </div>
            )}
            <div ref={bottomRef}/>
          </div>
        )}

        {/* Input */}
        <div className="relative" ref={pickerRef}>
          {promptPickerOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-full rounded-xl border border-[#e5e7eb] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.10)] overflow-hidden z-50 dark:border-white/[.08] dark:bg-[#13151a] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
              <div className="px-4 py-2.5 border-b border-[#eef2f7] dark:border-white/[.06]">
                <p className="text-[10px] font-semibold text-[#9ca3af] dark:text-slate-600 uppercase tracking-widest">Quick prompts</p>
              </div>
              <div className="p-1.5 grid grid-cols-1 gap-px">
                {QUICK_PROMPTS.map(({ icon: Icon, label, description, prompt }) => (
                  <button key={label} onClick={() => firePrompt(prompt)}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[#f8fafc] dark:hover:bg-white/[.05] transition-colors group">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 group-hover:bg-indigo-100 dark:bg-indigo-500/10 dark:group-hover:bg-indigo-500/20 transition-colors">
                      <Icon size={13} className="text-indigo-600 dark:text-indigo-400"/>
                    </span>
                    <span>
                      <span className="block text-sm text-[#111827] group-hover:text-indigo-700 dark:text-slate-200 dark:group-hover:text-white transition-colors">{label}</span>
                      <span className="block text-[11px] text-[#9ca3af] dark:text-slate-600">{description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2.5 rounded-2xl px-4 py-4 transition-all focus-within:ring-2"
            style={{ background: "var(--surface-input)", border: "1px solid var(--border-soft)", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px color-mix(in srgb, var(--accent) 7%, transparent)" }}>
            <button onClick={() => setPromptPickerOpen(o => !o)} title="Quick prompts"
              className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${promptPickerOpen ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400" : ""}`}
              style={promptPickerOpen ? undefined : { color: "var(--text-faint)" }}>
              <Zap size={14}/>
            </button>
            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
              placeholder={isChatting ? "Continue the conversation…" : "Ask the workspace graph anything…"}
              className="flex-1 bg-transparent text-[14.5px] outline-none" style={{ color: "var(--text-primary)" }}/>
            {isChatting && (
              <button onClick={newChat} className="shrink-0 text-xs transition-colors mr-1" style={{ color: "var(--text-faint)" }}>Clear</button>
            )}
            <button disabled title="Voice coming soon" className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg cursor-not-allowed opacity-40" style={{ color: "var(--text-faint)" }}>
              <Mic size={13}/>
            </button>
            <button onClick={send} disabled={loading || !input.trim()}
              className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-150 ${input.trim() && !loading ? "bg-indigo-600 text-white hover:bg-indigo-700 dark:hover:bg-indigo-500 shadow-lg shadow-indigo-900/10 dark:shadow-indigo-900/30" : ""}`}
              style={input.trim() && !loading ? undefined : { background: "var(--surface-hover)", color: "var(--text-faint)" }}>
              {loading ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}
            </button>
          </div>
        </div>

        {/* A few clean example prompts, inside the box, right under the
            input — a small mix of a general question and an agent-routed
            one, not a wall of labeled categories. */}
        {!isChatting && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {[
              { label: "What needs my attention today?", action: () => sendSuggestion("What needs my attention today?") },
              { label: "Ask Operations about overdue work", action: () => prefill("Ask Operations Agent: ") },
              ...(hasFinance ? [{ label: "Ask Finance about overdue invoices", action: () => prefill("Ask Finance Agent: ") }] : []),
              { label: "What changed in the graph?", action: () => sendSuggestion("What changed in the graph?") },
            ].map(s => (
              <button key={s.label} onClick={s.action} className="rounded-full px-3 py-1.5 text-[11.5px] transition-colors" style={{ border: "1px solid var(--border-soft)", color: "var(--text-muted)" }}>
                {s.label}
              </button>
            ))}
          </div>
        )}

        {/* Recent threads */}
        {!isChatting && recentThreads.length > 0 && (
          <div className="mt-2.5 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-slate-700">Recent:</span>
            {recentThreads.map(t => (
              <Link key={t.id} to={`/ask/${t.id}`} className="text-[11px] text-slate-600 hover:text-indigo-400 transition-colors truncate max-w-[180px]">{t.title}</Link>
            ))}
            <span className="text-slate-800 text-xs">·</span>
            <Link to="/ask/new" className="text-[11px] text-slate-600 hover:text-indigo-400 transition-colors">Full chat →</Link>
          </div>
        )}
        {!isChatting && recentThreads.length === 0 && (
          <div className="mt-2 flex justify-end">
            <Link to="/ask/new" className="text-[11px] text-slate-600 hover:text-indigo-400 transition-colors">Open full chat →</Link>
          </div>
        )}
        </div>
      </section>

      {/* ── Agent Constellation — the visual identity piece, right after
          the console it's powering. ── */}
      <AgentConstellationPanel />

      {/* ── Needs you — the merged decision/risk/activity zone. One ranked
          list instead of two sections doing overlapping jobs. ── */}
      <NeedsYouPanel
        notifications={notificationsQuery.data ?? []}
        onAskMondaily={(prefill) => {
          askSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          if (prefill) doSend(prefill);
          else inputRef.current?.focus();
        }}
      />

      {/* ── Workspace Graph Pulse — a status strip, not a hero section. ── */}
      <WorkspaceGraphPulse />

      {/* ── Today's Flow — tasks and meetings, side by side. ── */}
      <section className="mb-8">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>Today's flow</p>
        <div className="grid gap-4 md:grid-cols-2">

        {/* Tasks card */}
        <section className="surface-card flow-panel flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#eef2f7] dark:border-white/[.05]">
            <div className="flex items-center gap-2">
              <CheckSquare size={13} className="text-emerald-400"/>
              <span className="text-sm font-medium text-[#111827] dark:text-white">Tasks</span>
              <span className="flex items-center gap-1 rounded-full bg-indigo-500/10 border border-indigo-500/15 px-1.5 py-px text-[9px] text-indigo-400">
                <Sparkles size={8}/> AI sorted
              </span>
            </div>
            <Link to="/tasks" className="flex items-center gap-0.5 text-[11px] text-[#6b7280] hover:text-[#111827] dark:text-slate-500 dark:hover:text-white transition-colors">
              View all <ArrowUpRight size={11}/>
            </Link>
          </div>

          <div className="flex-1">
            {tasksQuery.isLoading ? (
              <div className="p-4"><PageSkeleton rows={4} label="Loading tasks…"/></div>
            ) : tasksQuery.isError ? (
              <div className="p-4"><ErrorState error={tasksQuery.error as Error} onRetry={() => tasksQuery.refetch()}/></div>
            ) : activeTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                <Sparkles size={16} className="text-slate-700 mb-2"/>
                <p className="text-sm text-slate-500">No open tasks.</p>
                <p className="text-xs text-slate-700 mt-0.5">Ask AI to create tasks from your work.</p>
              </div>
            ) : (
              <ul className="divide-y divide-white/[.04]">
                {activeTasks.slice(0, 6).map(item => {
                  const isOverdue = item.due_date && new Date(item.due_date) < new Date();
                  const assigneeName = getMemberName(item);
                  const statusColor = item.status === "in_progress" ? "bg-blue-400" : item.status === "review" ? "bg-yellow-400" : item.status === "done" ? "bg-emerald-400" : "bg-slate-700";
                  return (
                    <li key={item.id} onClick={() => setDetailTask(item)}
                      className="group flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[.03] transition-colors">
                      <span className={`shrink-0 h-1.5 w-1.5 rounded-full ${statusColor}`}/>
                      <span className="flex-1 min-w-0 text-sm text-slate-300 group-hover:text-white truncate transition-colors">{item.title}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.priority && item.priority !== "low" && (
                          <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${PRIORITY_STYLE[item.priority]}`}>{item.priority}</span>
                        )}
                        {item.due_date && (
                          <span className={`flex items-center gap-0.5 text-[11px] ${isOverdue ? "text-indigo-400" : "text-slate-600"}`}>
                            <Clock size={9}/>
                            {new Date(item.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        )}
                        {assigneeName && (
                          <span className="hidden sm:flex items-center gap-0.5 text-[11px] text-slate-600">
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
          <div className="border-t border-white/[.05] px-3 py-2.5" ref={taskPickerRef}>
            <div className="relative flex items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.02] px-3 py-2 focus-within:border-white/[.12] transition-colors">
              <Sparkles size={11} className="text-indigo-400 shrink-0"/>
              <input ref={taskWidgetInputRef} value={taskWidgetInput}
                onChange={e => setTaskWidgetInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submitTaskWidgetInput(taskWidgetInput)}
                placeholder="Add task or ask AI…"
                className="flex-1 bg-transparent text-xs text-white placeholder-slate-600 outline-none min-w-0"/>
              {taskWidgetLoading ? (
                <Loader2 size={11} className="animate-spin text-slate-600 shrink-0"/>
              ) : (
                <>
                  <button onClick={runScan} disabled={scanLoading} title="AI scan report"
                    className="shrink-0 rounded-md border border-white/[.08] px-1.5 py-0.5 text-[10px] text-slate-600 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40">
                    {scanLoading ? <Loader2 size={9} className="animate-spin"/> : "Scan"}
                  </button>
                  <button onClick={() => submitTaskWidgetInput(taskWidgetInput)} disabled={!taskWidgetInput.trim()}
                    className="shrink-0 text-indigo-400 hover:text-indigo-300 disabled:opacity-30 transition-colors">
                    <Send size={11}/>
                  </button>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Meetings card */}
        <section className="surface-card flow-panel flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#eef2f7] dark:border-white/[.05]">
            <div className="flex items-center gap-2">
              <Calendar size={13} className="text-blue-400"/>
              <span className="text-sm font-medium text-[#111827] dark:text-white">Meetings</span>
            </div>
            <span className="text-[11px] text-[#9ca3af] dark:text-slate-600">Today</span>
          </div>
          <div className="flex-1">
            {meetings.isLoading ? (
              <div className="p-4"><PageSkeleton rows={3} label="Loading meetings…"/></div>
            ) : meetings.isError ? (
              <div className="p-4"><ErrorState error={meetings.error as Error} onRetry={() => meetings.refetch()}/></div>
            ) : meetings.data?.length ? (
              <ul className="divide-y divide-white/[.04]">
                {meetings.data.map(m => (
                  <li key={m.id} className="px-4 py-3">
                    <p className="text-sm text-slate-200">{m.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-600">{m.start_time}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center px-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[.03] border border-white/[.06] mb-3">
                  <Calendar size={16} className="text-slate-600"/>
                </div>
                <p className="text-sm text-slate-400 font-medium">No meetings today</p>
                <p className="mt-1 text-[11px] text-slate-600 max-w-[200px]">Connect your calendar to get automatic meeting briefs.</p>
                <div className="mt-4 flex gap-2">
                  <button className="rounded-lg border border-white/[.07] bg-white/[.03] px-3 py-1.5 text-[11px] text-slate-400 hover:text-white hover:border-white/[.12] transition-colors">Sync Google</button>
                  <button className="rounded-lg border border-white/[.07] bg-white/[.03] px-3 py-1.5 text-[11px] text-slate-400 hover:text-white hover:border-white/[.12] transition-colors">Sync Microsoft</button>
                </div>
              </div>
            )}
          </div>
        </section>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 dark:bg-black/60 backdrop-blur-sm" onClick={() => { if (!scanLoading) setScanReport(null); }}>
          <div className="relative w-full max-w-lg rounded-2xl border border-[#e0e7ff] bg-white shadow-2xl flex flex-col max-h-[80vh] dark:border-white/10 dark:bg-[#111419]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#eef2f7] dark:border-white/[.06] shrink-0">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/15">
                  <Sparkles size={11} className="text-indigo-600 dark:text-indigo-400"/>
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-[#111827] dark:text-inherit">AI Scan Report</p>
                    <span className="flex items-center gap-1 rounded-full bg-indigo-50 px-1.5 py-px text-[9px] font-medium text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                      <span className="relative flex h-1 w-1">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-60 animate-ping"/>
                        <span className="relative inline-flex h-1 w-1 rounded-full bg-indigo-500"/>
                      </span>
                      AI Signal
                    </span>
                  </div>
                  {scanTimestamp && <p className="text-[10px] text-[#9ca3af] dark:text-slate-600 mt-px">{scanTimestamp}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!scanLoading && scanReport && (
                  <button onClick={printReport} className="flex items-center gap-1.5 rounded-lg border border-[#e5e7eb] px-2.5 py-1.5 text-xs text-[#6b7280] hover:text-[#111827] hover:border-[#cbd5e1] transition-colors dark:border-white/10 dark:text-slate-400 dark:hover:text-white dark:hover:border-white/20">
                    <Printer size={11}/> Print
                  </button>
                )}
                {!scanLoading && (
                  <button onClick={() => setScanReport(null)} className="text-[#9ca3af] hover:text-[#111827] dark:text-slate-500 dark:hover:text-white transition-colors text-xl leading-none">×</button>
                )}
              </div>
            </div>
            <div className="overflow-y-auto px-5 py-5 text-sm space-y-1 flex-1 text-[#374151] dark:text-inherit">
              {scanLoading ? (
                <div className="flex items-center gap-3 text-[#6b7280] dark:text-slate-400 py-4">
                  <LogoMark size={22} thinking />
                  <span className="text-sm italic tracking-wide">Searching workspace…</span>
                </div>
              ) : scanReport ? renderMarkdown(scanReport) : null}
            </div>
            {!scanLoading && scanReport && (
              <div className="px-5 py-3 border-t border-[#eef2f7] dark:border-white/[.06] shrink-0">
                <button onClick={() => setScanReport(null)} className="w-full rounded-lg border border-[#e5e7eb] py-2 text-xs text-[#6b7280] hover:text-[#111827] hover:border-[#cbd5e1] transition-colors dark:border-white/10 dark:text-slate-400 dark:hover:text-white dark:hover:border-white/20">
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
