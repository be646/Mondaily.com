import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot, Check, ChevronLeft, Clipboard, Clock3, Pause, Play, Search, Volume2, X } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageSkeleton } from "../../components/ui/page-state";
import { apiClient, getAuthHeaders } from "../../lib/api-client";

interface TranscriptLine { speaker: string; text: string; start_time: number }
interface Participant { id?: string; name: string; email?: string; object_type?: string }
interface LinkedRecord { id: string; name: string; object_type: string }
interface CallDetail {
  id: string;
  contact_name: string;
  occurred_at: string;
  duration_seconds: number;
  direction: "inbound" | "outbound";
  status: string;
  audio_url?: string;
  ai_summary?: string;
  overview?: string;
  key_topics: string[];
  action_items: string[];
  buyer_signals: { type: "positive" | "objection"; text: string }[];
  next_steps: string[];
  participants: Participant[];
  linked_records: LinkedRecord[];
  transcript: TranscriptLine[];
}

interface WaveSurferInstance {
  playPause(): void;
  setPlaybackRate(rate: number): void;
  setVolume(volume: number): void;
  setTime(seconds: number): void;
  destroy(): void;
  on(event: string, callback: (value?: unknown) => void): void;
}

declare global {
  interface Window {
    WaveSurfer?: { create(options: Record<string, unknown>): WaveSurferInstance };
  }
}

const templates = [
  ["objections", "Extract all objections raised"],
  ["quality", "Score discovery call quality"],
  ["upsell", "Identify upsell opportunities"],
  ["competitors", "Summarise competitor mentions"],
  ["commitments", "List all commitments made"]
] as const;

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "ig"));
  return <>{parts.map((part, index) => part.toLowerCase() === query.toLowerCase() ? <mark key={index} className="bg-amber-400/30 text-amber-100">{part}</mark> : part)}</>;
}

function useWaveSurfer(audioUrl?: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<WaveSurferInstance | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!audioUrl || !containerRef.current) return;
    let cancelled = false;
    const initialize = () => {
      if (cancelled || !window.WaveSurfer || !containerRef.current) return;
      waveRef.current = window.WaveSurfer.create({
        container: containerRef.current,
        url: audioUrl,
        waveColor: "#334155",
        progressColor: "#ef4444",
        cursorColor: "#f8fafc",
        height: 72,
        barWidth: 2,
        barGap: 2,
        barRadius: 2
      });
      waveRef.current.on("ready", () => setReady(true));
      waveRef.current.on("play", () => setPlaying(true));
      waveRef.current.on("pause", () => setPlaying(false));
      waveRef.current.on("finish", () => setPlaying(false));
    };
    if (window.WaveSurfer) initialize();
    else {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/wavesurfer.js/7.8.6/wavesurfer.min.js";
      script.async = true;
      script.onload = initialize;
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
      waveRef.current?.destroy();
      waveRef.current = null;
    };
  }, [audioUrl]);

  return { containerRef, waveRef, playing, ready };
}

export function CallDetailPage() {
  const { id = "" } = useParams();
  const query = useQuery({ queryKey: ["call", id], queryFn: () => apiClient.get<CallDetail>(`/calls/${id}`) });
  const call = query.data;
  const { containerRef, waveRef, playing, ready } = useWaveSurfer(call?.audio_url);
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [completedActions, setCompletedActions] = useState<number[]>([]);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<string>();
  const [analysisResults, setAnalysisResults] = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const createTask = useMutation({ mutationFn: (title: string) => apiClient.post("/tasks", { title, node_id: id }) });

  const visibleTranscript = useMemo(() => call?.transcript ?? [], [call?.transcript]);

  async function runAnalysis(templateId: string) {
    setActiveTemplate(templateId);
    setAnalysisResults((current) => ({ ...current, [templateId]: "" }));
    setAnalyzing(true);
    const API_URL = (import.meta.env.VITE_API_URL || "/api/v1").replace(/\/$/, "");
    const response = await fetch(`${API_URL}/calls/${id}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...await getAuthHeaders()
      },
      body: JSON.stringify({ template_id: templateId })
    });
    if (!response.ok || !response.body) {
      setAnalysisResults((current) => ({ ...current, [templateId]: "Analysis could not be completed." }));
      setAnalyzing(false);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      setAnalysisResults((current) => ({ ...current, [templateId]: (current[templateId] ?? "") + chunk }));
    }
    setAnalyzing(false);
  }

  async function completeAction(item: string, index: number) {
    if (completedActions.includes(index)) return;
    await createTask.mutateAsync(item);
    setCompletedActions((current) => [...current, index]);
  }

  if (query.isLoading) return <div className="p-8"><PageSkeleton rows={7} /></div>;
  if (!call) return <div className="grid h-full place-items-center text-sm text-stone-500">Call not found.</div>;

  return (
    <div className="relative min-h-full">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border-soft)] px-4 py-4 sm:px-6">
        <Link to="/calls" title="Back to calls" className="grid h-8 w-8 place-items-center rounded hover:bg-[var(--surface-hover)]"><ChevronLeft size={17} /></Link>
        <div className="min-w-0 flex-1"><h1 className="truncate text-lg font-semibold">{call.contact_name}</h1><p className="mt-0.5 text-xs text-stone-500">{new Date(call.occurred_at).toLocaleString()} · {Math.max(1, Math.round(call.duration_seconds / 60))} min</p></div>
        <button onClick={() => setAnalysisOpen(true)} className="flex h-9 items-center gap-2 rounded-md bg-stone-600 px-3 text-sm font-medium"><LogoMark size={14} /> Run analysis</button>
      </header>
      <div className="grid min-h-[calc(100vh-74px)] lg:grid-cols-[minmax(320px,0.8fr)_minmax(480px,1.2fr)]">
        <section className="border-b border-[var(--border-soft)] p-4 sm:p-6 lg:border-b-0 lg:border-r">
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--border-soft)] p-4 text-sm">
            <div><p className="text-xs text-stone-600">Date</p><p className="mt-1">{new Date(call.occurred_at).toLocaleDateString()}</p></div>
            <div><p className="text-xs text-stone-600">Time</p><p className="mt-1">{new Date(call.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p></div>
            <div><p className="text-xs text-stone-600">Duration</p><p className="mt-1">{Math.max(1, Math.round(call.duration_seconds / 60))} minutes</p></div>
            <div><p className="text-xs text-stone-600">Direction</p><p className="mt-1 capitalize">{call.direction}</p></div>
          </div>
          <h2 className="mb-3 mt-6 text-xs font-semibold uppercase text-stone-500">Participants</h2>
          <div className="space-y-2">{call.participants.map((person) => person.id ? <Link key={person.id} to={`/objects/${person.object_type || "people"}/${person.id}`} className="flex items-center gap-3 rounded-md border border-[var(--border-soft)] p-3 hover:bg-[var(--surface-hover)]"><div className="grid h-8 w-8 place-items-center rounded-full bg-[var(--surface-hover)] text-xs">{person.name.slice(0, 2).toUpperCase()}</div><div><p className="text-sm">{person.name}</p><p className="text-xs text-stone-600">{person.email}</p></div></Link> : <div key={person.email || person.name} className="flex items-center gap-3 rounded-md border border-[var(--border-soft)] p-3"><div className="grid h-8 w-8 place-items-center rounded-full bg-[var(--surface-hover)] text-xs">{person.name.slice(0, 2).toUpperCase()}</div><div><p className="text-sm">{person.name}</p><p className="text-xs text-stone-600">{person.email}</p></div></div>)}</div>
          {call.linked_records.length ? <div className="mt-3 flex flex-wrap gap-2">{call.linked_records.map((record) => <Link key={record.id} to={`/objects/${record.object_type}/${record.id}`} className="rounded-full border border-[var(--border-soft)] px-2.5 py-1 text-xs text-stone-400">{record.name}</Link>)}</div> : null}
          <SummarySection title="Overview"><p className="text-sm leading-6 text-stone-300">{call.overview || call.ai_summary || "No summary generated yet."}</p></SummarySection>
          <SummarySection title="Key topics">{call.key_topics.length ? <ul className="space-y-2 text-sm text-stone-300">{call.key_topics.map((topic) => <li key={topic}>• {topic}</li>)}</ul> : <p className="text-sm text-stone-500">No key topics extracted.</p>}</SummarySection>
          <SummarySection title="Action items">{call.action_items.length ? <div className="space-y-2">{call.action_items.map((item, index) => <button key={item} onClick={() => completeAction(item, index)} className="flex w-full items-start gap-2 rounded-md p-2 text-left text-sm hover:bg-[var(--surface-hover)]"><span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${completedActions.includes(index) ? "border-emerald-500 bg-emerald-500 text-black" : "border-[var(--border-soft)]"}`}>{completedActions.includes(index) ? <Check size={10} /> : null}</span><span className={completedActions.includes(index) ? "text-stone-600 line-through" : "text-stone-300"}>{item}</span></button>)}</div> : <p className="text-sm text-stone-500">No action items identified.</p>}</SummarySection>
          <SummarySection title="Buyer signals"><div className="space-y-2">{call.buyer_signals.map((signal) => <div key={signal.text} className={`rounded-md border px-3 py-2 text-sm ${signal.type === "positive" ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300" : "border-stone-500/30 bg-stone-600/5 text-stone-300"}`}>{signal.text}</div>)}</div></SummarySection>
          <SummarySection title="Next steps">{call.next_steps.length ? <ul className="space-y-2 text-sm text-stone-300">{call.next_steps.map((step) => <li key={step}>• {step}</li>)}</ul> : <p className="text-sm text-stone-500">No next steps recommended.</p>}</SummarySection>
        </section>
        <section className="min-w-0 p-4 sm:p-6">
          <div className="rounded-lg border border-[var(--border-soft)] p-4">
            {call.audio_url ? <>
              <div ref={containerRef} />
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button disabled={!ready} onClick={() => waveRef.current?.playPause()} className="grid h-9 w-9 place-items-center rounded-full bg-stone-600 text-[var(--text-primary)] disabled:opacity-40">{playing ? <Pause size={15} /> : <Play size={15} />}</button>
                <Clock3 size={14} className="text-stone-600" />
                <select onChange={(event) => waveRef.current?.setPlaybackRate(Number(event.target.value))} className="h-8 rounded-md border border-[var(--border-soft)] bg-[var(--surface-page)] px-2 text-xs"><option value="0.75">0.75x</option><option value="1" selected>1x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2">2x</option></select>
                <Volume2 size={14} className="ml-auto text-stone-600" /><input aria-label="Volume" type="range" min="0" max="1" step="0.05" defaultValue="1" onChange={(event) => waveRef.current?.setVolume(Number(event.target.value))} className="w-28 accent-red-500" />
              </div>
            </> : <div className="flex h-24 items-center justify-center text-sm text-stone-500">Audio recording unavailable.</div>}
          </div>
          <div className="mb-4 mt-6 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Transcript</h2><label className="relative w-56 max-w-full"><Search className="absolute left-3 top-2.5 text-stone-600" size={13} /><input value={transcriptSearch} onChange={(event) => setTranscriptSearch(event.target.value)} placeholder="Search transcript" className="h-9 w-full rounded-md border border-[var(--border-soft)] bg-transparent pl-9 pr-3 text-sm outline-none" /></label></div>
          {visibleTranscript.length ? <div className="space-y-1">{visibleTranscript.map((line, index) => <div key={`${line.start_time}-${index}`} className="group flex gap-3 rounded-lg p-3 hover:bg-[var(--surface-hover)]"><button onClick={() => waveRef.current?.setTime(line.start_time)} className="shrink-0 font-mono text-xs text-stone-400">{formatTime(line.start_time)}</button><div className="min-w-0 flex-1"><p className="mb-1 text-xs font-semibold text-stone-500">{line.speaker}</p><p className="text-sm leading-6 text-stone-300"><HighlightedText text={line.text} query={transcriptSearch} /></p></div><button title="Copy transcript paragraph" onClick={() => navigator.clipboard.writeText(line.text)} className="grid h-7 w-7 shrink-0 place-items-center rounded text-stone-600 opacity-0 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] group-hover:opacity-100"><Clipboard size={12} /></button></div>)}</div> : <p className="rounded-lg border border-dashed border-[var(--border-soft)] p-8 text-center text-sm text-stone-500">Transcript unavailable.</p>}
        </section>
      </div>
      {analysisOpen ? <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setAnalysisOpen(false)}><aside onClick={(event) => event.stopPropagation()} className="ml-auto flex h-full w-full max-w-md flex-col border-l border-[var(--border-soft)] bg-[#111419] shadow-2xl"><div className="flex items-center justify-between border-b border-[var(--border-soft)] p-5"><div><h2 className="font-medium">AI insight templates</h2><p className="mt-1 text-xs text-stone-500">Run focused analysis on this transcript.</p></div><button onClick={() => setAnalysisOpen(false)} className="grid h-8 w-8 place-items-center rounded hover:bg-[var(--surface-hover)]"><X size={16} /></button></div><div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">{templates.map(([templateId, label]) => <article key={templateId} className="rounded-lg border border-[var(--border-soft)] p-4"><button onClick={() => runAnalysis(templateId)} disabled={analyzing} className="flex w-full items-center gap-3 text-left"><div className="grid h-8 w-8 place-items-center rounded bg-stone-500/10 text-stone-400"><Bot size={14} /></div><span className="flex-1 text-sm font-medium">{label}</span><LogoMark size={14} className="text-stone-400" /></button>{analysisResults[templateId] !== undefined ? <div className="mt-4 whitespace-pre-wrap border-t border-[var(--border-soft)] pt-4 text-sm leading-6 text-stone-300">{analysisResults[templateId]}{analyzing && activeTemplate === templateId ? <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-stone-400" /> : null}</div> : null}</article>)}</div></aside></div> : null}
    </div>
  );
}

function SummarySection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-7"><h2 className="mb-3 text-xs font-semibold uppercase text-stone-500">{title}</h2>{children}</section>;
}
