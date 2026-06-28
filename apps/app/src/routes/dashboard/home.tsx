import { useUser } from "@clerk/react";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, CheckSquare, Send, Loader2, User, Clock, ArrowUpRight, ArrowUp, Flag, Plus, Zap, MailCheck, Brain, TrendingUp, ListChecks, BellDot, CornerDownLeft, Printer, Mic, GitBranch, Inbox, FileText } from "lucide-react";
import { LogoMark } from "../../components/logo";
import { NeedsYouPanel, WorkspaceGraphPulse } from "../../components/ai/command-center";
import { AgentConstellationPanel } from "../../components/ai/agent-constellation";
import { useDecisionQueue } from "../../components/ai/decision-queue";
import {
  GRAPH_REASONING_STEPS, EvidenceStrip, SourceCard, friendlyAskError, TokenLedger,
} from "../../components/ai/ask-shared";
import { useAskEngine } from "../../components/ai/use-ask-engine";
import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { PageSkeleton } from "../../components/ui/page-state";
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
          <li key={i} className="flex gap-2.5" style={{ color: "var(--text-secondary)" }}>
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--text-faint)" }}/>
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
      nodes.push(<p key={i} className="mt-4 mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{t}</p>);
      return;
    }
    // horizontal rule
    if (/^---+$/.test(trimmed)) {
      flushList(`l${i}`);
      nodes.push(<hr key={i} className="my-3" style={{ borderColor: "var(--border-soft)" }}/>);
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
    nodes.push(<p key={i} className="leading-7" style={{ color: "var(--text-secondary)" }}>{inlineFormat(trimmed)}</p>);
  });
  flushList("end");
  return <>{nodes}</>;
}

function inlineFormat(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__)/g);
  return parts.map((p, i) => {
    if (/^\*\*/.test(p) || /^__/.test(p))
      return <strong key={i} className="font-semibold" style={{ color: "var(--text-primary)" }}>{p.slice(2, -2)}</strong>;
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
interface WorkspaceSummary {
  workspace_id: string;
  name: string;
  role: string;
  counts: { tasks: number; lists: number; nodes: number; deals: number };
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_STYLE: Record<string, string> = {
  urgent: "border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  high:   "border border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300",
  medium: "border border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300",
  low:    "border border-stone-200 bg-stone-50 text-stone-500 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-500",
};

export function HomePage() {
  const { user } = useUser();
  const { hasFinance } = useModules();
  const qc = useQueryClient();
  const askSectionRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [taskScope, setTaskScope] = useState<"mine" | "all">("mine");
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
  const messagesRef = useRef<HTMLDivElement>(null);
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
  const tasksQuery = useQuery({
    queryKey: ["tasks", "home", taskScope],
    queryFn: () => apiClient.get<Task[]>(`/tasks?filter=${taskScope}&sort=priority`),
  });
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
  const recentThreads = getThreads().slice(0, 3);
  const inputRef = useRef<HTMLInputElement>(null);

  // Bottom-anchored streaming: keep the newest line at the BOTTOM so the answer
  // types upward (older text pushes up, the end stays visible). Instant set
  // (scroll-behavior:auto) so there's no smooth-scroll tussle; only follows while
  // a turn is active AND the user is near the bottom, so scrolling up to re-read
  // isn't yanked. The unified element means the thinking→text swap no longer jumps.
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const active = loading || streamingMsgIdx !== null;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 240;
    if (active && nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages, loading, streamedUpTo, streamingMsgIdx]);

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
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 48px auto; color: var(--surface-card-2); line-height: 1.7; font-size: 15px; }
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
  const graphSynced = !tasksQuery.isError && !notificationsQuery.isError && !decisionsQuery.isError;
  const sourcesChecked = !notificationsQuery.isLoading && !notificationsQuery.isError;
  const currentWorkspaceId = typeof window !== "undefined" ? localStorage.getItem("mondaily_workspace_id") : null;
  const workspaceSummaries = workspacesQuery.data?.workspaces ?? [];
  const currentWorkspace = workspaceSummaries.find(w => w.workspace_id === currentWorkspaceId);
  const currentDataCount = currentWorkspace ? currentWorkspace.counts.tasks + currentWorkspace.counts.lists + currentWorkspace.counts.nodes : null;
  const populatedWorkspace = workspaceSummaries.find(w => w.workspace_id !== currentWorkspaceId && (w.counts.tasks + w.counts.lists + w.counts.nodes) > Math.max(currentDataCount ?? 0, 0));
  const showWorkspaceRecovery = Boolean(populatedWorkspace && (currentDataCount === 0 || currentDataCount === null));

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
          <div className={`welcome-info min-w-0 ${isChatting ? "is-hidden" : ""}`}>
            <div className="flex flex-col gap-1.5">
              <p className="home-section-kicker">{todayLabel}</p>
              <h1 className="home-hero-title">{greeting}, {user?.firstName || "there"}.</h1>
            </div>
            <div className="mt-5 flex flex-col items-start gap-px">
              <span className="status-line">
                <span className="live-dot" style={{ background: graphSynced ? "var(--accent)" : "#d97706" }}/>
                Graph {graphSynced ? "synced" : "syncing"}
              </span>
              <span className="status-line">
                <span className="live-dot" style={{ background: sourcesChecked ? "var(--accent)" : "#d97706" }}/>
                Sources {sourcesChecked ? "checked" : "checking…"}
              </span>
            </div>
          </div>

          {/* Right — signals bar, top-right (always renders; not inside the
              collapsing welcome) */}
          <div className="flex flex-col gap-2 lg:items-end">
            <div className="home-telemetry-strip">
              <Link to="/tasks" state={{ filter: taskScope === "mine" ? "mine" : "all" }}><ListChecks size={13}/><strong>{activeTasks.length}</strong>{taskScope === "mine" ? "my open tasks" : "open tasks"}</Link>
              <Link to="/decisions"><FileText size={13}/><strong>{pendingDecisionsCount}</strong>pending decisions</Link>
              <Link to="/notifications"><Inbox size={13}/><strong>{unreadCount}</strong>unread</Link>
            </div>

            {(overdueCount > 0 || urgentCount > 0 || unreadRiskCount > 0 || riskBanner) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:justify-end">
                {overdueCount > 0 && (
                  <Link to="/tasks" state={{ filter: "overdue" }} className="attention-chip">
                    <Clock size={11}/>
                    {overdueCount} overdue assigned to you
                  </Link>
                )}
                {urgentCount > 0 && (
                  <Link to="/tasks" state={{ filter: "mine", priority: "urgent" }} className="attention-chip">
                    <Flag size={11}/>
                    {urgentCount} urgent
                  </Link>
                )}
                {(unreadRiskCount > 0 || (riskBanner !== null && riskBanner > 0)) && (
                  <Link to="/notifications" className="attention-chip">
                    <BellDot size={11}/>
                    {unreadRiskCount || riskBanner} AI risk alert{((unreadRiskCount || riskBanner) ?? 0) > 1 ? "s" : ""}
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showWorkspaceRecovery && populatedWorkspace && (
        <div className="mb-4 rounded-2xl px-4 py-3 sm:flex sm:items-center sm:justify-between sm:gap-4" style={{ background: "color-mix(in srgb, #d97706 8%, var(--surface-card))", border: "1px solid color-mix(in srgb, #d97706 25%, var(--border-soft))" }}>
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>You may be viewing an empty workspace.</p>
            <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
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
      {(notificationsQuery.isError || decisionsQuery.isError) && (
        <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/[.07] px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          Could not load activity. Some agent and decision signals may be missing.
        </div>
      )}

      <section ref={askSectionRef} className="home-section relative mx-auto mt-6 max-w-4xl sm:mt-8">
        <div className={`relative w-full min-w-0 ${isChatting ? "flex flex-col overflow-hidden" : ""}`} style={isChatting ? { height: "min(70vh, 640px)" } : undefined}>
        {!isChatting && (
          <div className="chat-suggestion-stack mx-auto mb-4 max-w-2xl">
            {[
              { label: "What needs my attention today?", action: () => sendSuggestion("What needs my attention today?") },
              { label: "Ask Operations about overdue work", action: () => prefill("Ask Operations Agent: ") },
              ...(hasFinance ? [{ label: "Ask Finance about overdue invoices", action: () => prefill("Ask Finance Agent: ") }] : []),
              { label: "What changed in the graph?", action: () => sendSuggestion("What changed in the graph?") },
            ].map(s => (
              <button key={s.label} onClick={s.action} className="chat-suggestion-row group">
                <span className="flex-1 truncate">{s.label}</span>
                <CornerDownLeft size={12} className="shrink-0 opacity-45 transition-opacity group-hover:opacity-100"/>
              </button>
            ))}
          </div>
        )}

        {isChatting && (
          <div ref={messagesRef} className="chat-stick-bottom relative w-full min-w-0 min-h-0 flex-1 space-y-6 overflow-y-auto overflow-x-hidden overscroll-contain pb-3 pt-2 pr-1" style={{ scrollbarWidth: "none", overflowAnchor: "none", scrollBehavior: "auto" }}>
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
                const AgentIcon = meta?.agent.icon;
                const showThinking = !!m.pending || (isStreaming && !displayText);
                return (
                  <div key={i} data-role={m.role} className={`mx-auto w-full max-w-3xl min-w-0 ${m.role === "user" ? "flex justify-end" : "flex gap-3 items-start"}`}>
                    {m.role === "assistant" && (
                      <div className="mt-0.5 shrink-0" style={{ color: "var(--text-muted)" }}>
                        <LogoMark size={16} thinking={showThinking}/>
                      </div>
                    )}
                    {m.role === "user" ? (
                      <div className="ask-user-bubble max-w-[72%] min-w-0 break-words whitespace-pre-wrap rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-sm leading-relaxed">
                        {m.content}
                      </div>
                    ) : (
                      <div className="flex-1 min-w-0">
                        {/* UNIFIED slot — thinking, streaming, and final markdown all
                            render inside the SAME tags/indent; only the inner text swaps.
                            The top-edge never moves. */}
                        <div className="ask-assistant-line min-w-0 break-words whitespace-pre-wrap pl-4 text-sm space-y-0.5">
                          {showThinking
                            ? <span className="italic animate-pulse" style={{ color: "var(--text-faint)" }}>{GRAPH_REASONING_STEPS[thinkingStep]}…</span>
                            : isStreaming
                              ? <p className="whitespace-pre-wrap break-words leading-7" style={{ color: "var(--text-secondary)" }}>{displayText.replace(/[*_`#>|]/g, "")}</p>
                              : renderMarkdown(displayText)}
                          {isStreaming && displayText && <span className="inline-block w-0.5 h-4 bg-current animate-pulse ml-0.5 align-middle opacity-60"/>}
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
                        {!isStreaming && meta?.usage && (
                          <div className="pl-4"><TokenLedger usage={meta.usage}/></div>
                        )}
                        {!isStreaming && meta && meta.sources.length > 0 && (
                          <div className="mt-2.5 grid grid-cols-1 gap-1.5 pl-4 sm:grid-cols-2">
                            {meta.sources.map((s, si) => <SourceCard key={si} source={s}/>)}
                          </div>
                        )}
                        {/* Unified actions tray — one consistent pill style, grouped in a
                            subtle bordered panel attached under the answer. */}
                        {!isStreaming && !loading && i === messages.length - 1 && (
                          <div className="mt-3 pl-4">
                            <div className="rounded-xl border p-2" style={{ borderColor: "var(--border-soft)", background: "color-mix(in srgb, var(--surface-card) 55%, transparent)" }}>
                              <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>Suggested actions</p>
                              <div className="flex flex-wrap gap-1.5">
                                {([
                                  { key: "task", label: "Create task", mark: true },
                                  { key: "draft", label: "Draft message", mark: true },
                                  { key: "related", label: "Show related" },
                                  { key: "explain", label: "Explain reasoning" },
                                  { key: "decision", label: "Add to decision queue" },
                                  { key: "workflow", label: "Draft workflow" },
                                ] as { key: "task" | "draft" | "related" | "explain" | "decision" | "workflow"; label: string; mark?: boolean }[]).map(a => (
                                  <button key={a.key} onClick={() => sendSuggestion(buildChipText(a.key, i))} className="chat-action">
                                    {a.mark && <LogoMark size={11}/>}{a.label}
                                  </button>
                                ))}
                                <span title="Coming soon — no report-creation tool exists yet" className="chat-action chat-action-disabled">Create report</span>
                              </div>
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
                    key={i}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.28, delay: i * 0.06 }}
                    onClick={() => sendSuggestion(s)}
                    className="group inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-all hover:-translate-y-px"
                    style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}
                  >
                    <span>{s}</span>
                    <CornerDownLeft size={11} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: "var(--accent)" }}/>
                  </motion.button>
                ))}
              </div>
            )}
            <div ref={bottomRef}/>
          </div>
        )}

        {/* Input — pinned at the bottom of the chat column while chatting */}
        <div className={`relative mx-auto w-full max-w-3xl ${isChatting ? "mt-3 shrink-0" : ""}`} ref={pickerRef}>
          {promptPickerOpen && (
            <div className="absolute bottom-full left-0 z-50 mb-2 w-full overflow-hidden rounded-xl border shadow-[0_8px_24px_rgba(15,23,42,0.08)]" style={{ background: "var(--surface-card)", borderColor: "var(--border-soft)" }}>
              <div className="border-b px-4 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>Quick prompts</p>
              </div>
              <div className="p-1.5 grid grid-cols-1 gap-px">
                {QUICK_PROMPTS.map(({ icon: Icon, label, description, prompt }) => (
                  <button key={label} onClick={() => firePrompt(prompt)}
                    className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-stone-100 dark:hover:bg-stone-900">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-stone-100 transition-colors group-hover:bg-stone-200 dark:bg-stone-900 dark:group-hover:bg-stone-800">
                      <Icon size={13} className="text-stone-500 dark:text-stone-400"/>
                    </span>
                    <span>
                      <span className="block text-sm transition-colors" style={{ color: "var(--text-primary)" }}>{label}</span>
                      <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>{description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="ask-input chat-input-bar chat-input-orbit flex items-center gap-2 rounded-full px-2.5 py-2 transition-all sm:px-3">
            <button onClick={() => setPromptPickerOpen(o => !o)} title="Quick prompts"
              className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-full transition-colors ${promptPickerOpen ? "bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-200" : "hover:bg-stone-100 dark:hover:bg-stone-900"}`}
              style={promptPickerOpen ? undefined : { color: "var(--text-muted)" }}>
              <Plus size={18}/>
            </button>
            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
              placeholder={isChatting ? "Continue the conversation…" : "What do you want to know?"}
              className="flex-1 bg-transparent px-1 text-[15px] outline-none" style={{ color: "var(--text-primary)" }}/>
            {isChatting && (
              <button onClick={newChat} className="shrink-0 text-xs transition-colors mr-0.5" style={{ color: "var(--text-faint)" }}>Clear</button>
            )}
            <button disabled title="Voice coming soon" className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full cursor-not-allowed opacity-40" style={{ color: "var(--text-faint)" }}>
              <Mic size={15}/>
            </button>
            {/* Send — circular accent button with an arrow */}
            <button onClick={send} disabled={loading || !input.trim()}
              className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150 disabled:cursor-not-allowed"
              style={input.trim() && !loading
                ? { background: "var(--accent)", color: "#fff" }
                : { background: "var(--surface-hover)", color: "var(--text-faint)" }}>
              {loading ? <Loader2 size={15} className="animate-spin"/> : <ArrowUp size={17} strokeWidth={2.5}/>}
            </button>
          </div>
        </div>

        {/* Recent threads */}
        {!isChatting && recentThreads.length > 0 && (
          <div className="mx-auto mt-2.5 flex max-w-3xl flex-wrap items-center gap-2">
            <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>Recent:</span>
            {recentThreads.map(t => (
              <Link key={t.id} to={`/ask/${t.id}`} className="truncate max-w-[180px] text-[11px] transition-colors hover:text-stone-900 dark:hover:text-stone-100" style={{ color: "var(--text-muted)" }}>{t.title}</Link>
            ))}
            <span className="text-xs" style={{ color: "var(--text-faint)" }}>·</span>
            <Link to="/ask/new" className="text-[11px] transition-colors hover:text-stone-900 dark:hover:text-stone-100" style={{ color: "var(--text-muted)" }}>Full chat →</Link>
          </div>
        )}
        {!isChatting && recentThreads.length === 0 && (
          <div className="mx-auto mt-2 flex max-w-3xl justify-end">
            <Link to="/ask/new" className="text-[11px] transition-colors hover:text-stone-900 dark:hover:text-stone-100" style={{ color: "var(--text-muted)" }}>Open full chat →</Link>
          </div>
        )}
        </div>
      </section>

      {/* ── Operating Picture — graph telemetry and the agent map share one
          continuous control-room zone. The components keep their own data
          and actions; this wrapper only gives the page a clearer hierarchy. ── */}
      <section className="home-section home-operating-picture">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />
          <p className="home-section-kicker !mb-0">Live operations</p>
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

      {/* ── Needs you — the merged decision/risk/activity zone. One ranked
          list instead of two sections doing overlapping jobs. ── */}
      <NeedsYouPanel
        notifications={notificationsQuery.data ?? []}
        notificationsError={notificationsQuery.isError}
      />

      {/* ── Today's Flow — tasks and meetings, side by side. ── */}
      <section className="home-section">
        <div className="today-flow-header flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="home-section-kicker">Today's work</p>
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
              <CheckSquare size={13} className="text-stone-500 dark:text-stone-400"/>
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Tasks</span>
              <span className="flow-micro-badge">
                <LogoMark size={8}/> AI sorted
              </span>
            </div>
            <Link to="/tasks" className="flex items-center gap-0.5 text-[11px] transition-colors hover:text-stone-900 dark:hover:text-stone-100" style={{ color: "var(--text-muted)" }}>
              View all <ArrowUpRight size={11}/>
            </Link>
          </div>

          <div className="flex-1">
            {tasksQuery.isLoading ? (
              <div className="py-4"><PageSkeleton rows={4} label="Loading tasks…"/></div>
            ) : tasksQuery.isError ? (
              <div className="py-4">
                <div className="rounded-xl px-4 py-5 text-center" style={{ background: "color-mix(in srgb, #d97706 7%, var(--surface-card))", border: "1px solid color-mix(in srgb, #d97706 24%, var(--border-soft))" }}>
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Could not load tasks</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{(tasksQuery.error as Error)?.message || "The tasks API did not return data."}</p>
                  <button onClick={() => tasksQuery.refetch()} className="btn-suggested mt-3 !px-2.5 !py-1 !text-[11px]">Retry</button>
                </div>
              </div>
            ) : activeTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                <LogoMark size={16} className="mb-2" style={{ color: "var(--text-faint)" }}/>
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No open tasks.</p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--text-faint)" }}>Ask AI to create tasks from your work.</p>
              </div>
            ) : (
              <ul className="flow-list">
                {activeTasks.slice(0, 6).map(item => {
                  const isOverdue = item.due_date && new Date(item.due_date) < new Date();
                  const assigneeName = getMemberName(item);
                  const statusColor = item.status === "review" ? "bg-amber-500" : item.status === "done" ? "btn-solid dark:bg-stone-100" : item.status === "in_progress" ? "bg-stone-500 dark:bg-stone-400" : "bg-stone-300 dark:bg-stone-700";
                  return (
                    <li key={item.id} onClick={() => setDetailTask(item)}
                      className="flow-list-row group flex cursor-pointer items-center gap-3 transition-colors">
                      <span className={`shrink-0 h-1.5 w-1.5 rounded-full ${statusColor}`}/>
                      <span className="flex-1 min-w-0 truncate text-sm transition-colors" style={{ color: "var(--text-secondary)" }}>{item.title}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.priority && item.priority !== "low" && (
                          <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${PRIORITY_STYLE[item.priority]}`}>{item.priority}</span>
                        )}
                        {item.due_date && (
                          <span className="flex items-center gap-0.5 text-[11px]" style={{ color: isOverdue ? "#d97706" : "var(--text-faint)" }}>
                            <Clock size={9}/>
                            {new Date(item.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
            <div className="relative flex items-center gap-2 rounded-xl px-3 py-2 transition-colors" style={{ background: "color-mix(in srgb, var(--surface-hover) 48%, transparent)" }}>
              <LogoMark size={11} className="shrink-0" style={{ color: "var(--text-muted)" }}/>
              <input ref={taskWidgetInputRef} value={taskWidgetInput}
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
                    className="shrink-0 text-stone-500 transition-colors hover:text-stone-900 disabled:opacity-30 dark:text-stone-400 dark:hover:text-stone-100">
                    <Send size={11}/>
                  </button>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Meetings card */}
        <section className="flow-panel-clean flex flex-col overflow-hidden">
          <div className="flow-panel-heading flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar size={13} className="text-stone-500 dark:text-stone-400"/>
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Meetings</span>
            </div>
            <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>Today</span>
          </div>
          <div className="flex-1">
            {meetings.isLoading ? (
              <div className="py-4"><PageSkeleton rows={3} label="Loading meetings…"/></div>
            ) : meetings.isError ? (
              <div className="py-4">
                <div className="rounded-xl px-4 py-5 text-center" style={{ background: "color-mix(in srgb, #d97706 7%, var(--surface-card))", border: "1px solid color-mix(in srgb, #d97706 24%, var(--border-soft))" }}>
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Could not load meetings</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{(meetings.error as Error)?.message || "Calendar data did not return."}</p>
                  <button onClick={() => meetings.refetch()} className="btn-suggested mt-3 !px-2.5 !py-1 !text-[11px]">Retry</button>
                </div>
              </div>
            ) : meetings.data?.length ? (
              <ul className="flow-list">
                {meetings.data.map(m => (
                  <li key={m.id} className="flow-list-row">
                    <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{m.title}</p>
                    <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-faint)" }}>{m.start_time}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center px-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl mb-3" style={{ background: "var(--surface-hover)", border: "1px solid var(--border-soft)" }}>
                  <Calendar size={16} style={{ color: "var(--text-faint)" }}/>
                </div>
                <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>No meetings today</p>
                <p className="mt-1 text-[11px] max-w-[200px]" style={{ color: "var(--text-faint)" }}>Connect your calendar to get automatic meeting briefs.</p>
                <div className="mt-4 flex gap-2">
                  <button className="btn-secondary !px-3 !py-1.5 !text-[11px]">Sync Google</button>
                  <button className="btn-secondary !px-3 !py-1.5 !text-[11px]">Sync Microsoft</button>
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
          <div className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border shadow-2xl" style={{ background: "var(--surface-modal)", borderColor: "var(--border-soft)" }} onClick={e => e.stopPropagation()}>
            <div className="flex shrink-0 items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border-soft)" }}>
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: "var(--surface-hover)" }}>
                  <LogoMark size={11} style={{ color: "var(--text-muted)" }}/>
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>AI Scan Report</p>
                    <span className="flex items-center gap-1 rounded-full px-1.5 py-px text-[9px] font-medium" style={{ background: "var(--surface-hover)", color: "var(--text-muted)" }}>
                      <span className="relative flex h-1 w-1">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-40" style={{ background: "var(--text-muted)" }}/>
                        <span className="relative inline-flex h-1 w-1 rounded-full" style={{ background: "var(--text-muted)" }}/>
                      </span>
                      AI Signal
                    </span>
                  </div>
                  {scanTimestamp && <p className="mt-px text-[10px]" style={{ color: "var(--text-faint)" }}>{scanTimestamp}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!scanLoading && scanReport && (
                  <button onClick={printReport} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors hover:bg-stone-100 dark:hover:bg-stone-900" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
                    <Printer size={11}/> Print
                  </button>
                )}
                {!scanLoading && (
                  <button onClick={() => setScanReport(null)} className="text-xl leading-none transition-colors hover:opacity-70" style={{ color: "var(--text-muted)" }}>×</button>
                )}
              </div>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto px-5 py-5 text-sm" style={{ color: "var(--text-secondary)" }}>
              {scanLoading ? (
                <div className="flex items-center gap-3 py-4" style={{ color: "var(--text-muted)" }}>
                  <LogoMark size={22} thinking />
                  <span className="text-sm italic tracking-wide">Searching workspace…</span>
                </div>
              ) : scanReport ? renderMarkdown(scanReport) : null}
            </div>
            {!scanLoading && scanReport && (
              <div className="shrink-0 border-t px-5 py-3" style={{ borderColor: "var(--border-soft)" }}>
                <button onClick={() => setScanReport(null)} className="w-full rounded-lg border py-2 text-xs transition-colors hover:bg-stone-100 dark:hover:bg-stone-900" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
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
