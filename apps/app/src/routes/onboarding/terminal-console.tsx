import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../lib/api-client";

/**
 * Conversational AI Onboarding Console — a full-screen monospace terminal that interviews the
 * operator, runs Cerebras semantic analysis on their description, prints the inferred workspace
 * architecture with typewriter delays, then transitions to a dual-card plan selector. Selecting a
 * plan persists the tier + backfills ai_credits_ledger + marks onboarded, then HARD-redirects to
 * the dashboard (window.location) so there is zero SPA loop-back potential.
 */
type Tone = "rule" | "boot" | "system" | "user" | "accent" | "amber" | "dim" | "ok";
interface Line { id: number; text: string; tone: Tone }
interface Profile { account_tier: "personal" | "business"; industry_vertical: string; target_concurrency: number }
type Phase = "await_input" | "processing" | "plans" | "committing";

const TONE: Record<Tone, string> = {
  rule: "#27272a",
  boot: "#a1a1aa",
  system: "#e4e4e7",
  user: "var(--accent)",
  accent: "var(--accent)",
  amber: "#fbbf24",
  dim: "#52525b",
  ok: "var(--accent)",
};

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const BOOT: Line[] = [
  { id: 1, text: "-------------------------------------------------------------------", tone: "rule" },
  { id: 2, text: "MONDAILY NETWORKS INC. // INITIALIZING ADAPTIVE SEED ROUTINE...", tone: "boot" },
  { id: 3, text: "-------------------------------------------------------------------", tone: "rule" },
  { id: 4, text: "[SYSTEM]: Welcome, Operator. I am the Mondaily Workspace Architect.", tone: "system" },
  { id: 5, text: "          Describe the automated operations team, data pipelines, or", tone: "system" },
  { id: 6, text: "          company infrastructure scale you are deploying today.", tone: "system" },
];

export function TerminalOnboardingPage() {
  const [lines, setLines] = useState<Line[]>([]);
  const [phase, setPhase] = useState<Phase>("await_input");
  const [input, setInput] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const idRef = useRef(100);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  const push = (text: string, tone: Tone = "dim") =>
    setLines(prev => [...prev, { id: ++idRef.current, text, tone }]);

  // Boot sequence — print the init banner line-by-line on mount.
  useEffect(() => {
    mounted.current = true;
    (async () => {
      for (const l of BOOT) {
        if (!mounted.current) return;
        setLines(prev => [...prev, l]);
        await sleep(180);
      }
      inputRef.current?.focus();
    })();
    return () => { mounted.current = false; };
  }, []);

  // Keep the terminal pinned to the latest line.
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [lines, phase]);

  async function submit() {
    const value = input.trim();
    if (!value || phase !== "await_input") return;
    setInput("");
    setPhase("processing");
    push(`operator@mondaily:~$ ${value}`, "user");
    push("[...PROCESSING SECTOR COMPILATION VECTORS...]", "amber");

    let result: Profile;
    try {
      result = await apiClient.post<Profile>("/onboarding/analyze", { description: value });
    } catch {
      result = { account_tier: "personal", industry_vertical: "General Operations", target_concurrency: 1 };
    }
    if (!mounted.current) return;
    setProfile(result);

    await sleep(420);
    if (!mounted.current) return;
    // Drop the transient processing indicator, then type the inferred config.
    setLines(prev => prev.filter(l => l.text !== "[...PROCESSING SECTOR COMPILATION VECTORS...]"));
    const tier = result.account_tier === "business" ? "BUSINESS // MULTI-OPERATOR" : "PERSONAL // SOLO DEVELOPER";
    const out: Line[] = [
      { id: ++idRef.current, text: `-> Account Tier Resolved: ${tier}`, tone: "dim" },
      { id: ++idRef.current, text: `-> Sector Matrix Inferred: ${result.industry_vertical}`, tone: "accent" },
      { id: ++idRef.current, text: `-> Concurrency Allocation: Approved at Scale ${result.target_concurrency}`, tone: "accent" },
      { id: ++idRef.current, text: "[✓ ENVIRONMENT COMPILED — WORKSPACE INITIALIZED]", tone: "ok" },
    ];
    for (const l of out) {
      if (!mounted.current) return;
      setLines(prev => [...prev, l]);
      await sleep(550);
    }
    await sleep(400);
    if (!mounted.current) return;
    push("[SYSTEM]: Select an operational license to finalize deployment.", "system");
    setPhase("plans");
  }

  async function choosePlan(tier: "personal" | "business") {
    if (phase === "committing") return;
    setPhase("committing");
    push(`> Provisioning ${tier === "business" ? "BUSINESS PRO" : "PERSONAL DEVELOPER"} license...`, "amber");
    try {
      await apiClient.post("/onboarding/complete", {
        account_tier: tier,
        industry: profile?.industry_vertical,
        concurrency: profile?.target_concurrency,
      });
    } catch { /* even if persistence hiccups, do not trap the user in onboarding */ }
    // Belt-and-suspenders against the old loop defect: clear the trigger flag, then HARD-redirect.
    localStorage.removeItem("mondaily_needs_onboarding");
    window.location.assign("/");
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-[#09090b] font-mono text-[13px] text-zinc-300">
      {/* terminal chrome bar */}
      <div className="flex items-center gap-2 border-b border-[#27272a] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#3f3f46]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#3f3f46]" />
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--accent)" }} />
        <span className="ml-2 text-[11px] uppercase tracking-[0.2em] text-zinc-600">mondaily — workspace architect</span>
      </div>

      {/* scrolling log */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 leading-relaxed">
        {lines.map(l => (
          <pre key={l.id} className="whitespace-pre-wrap break-words" style={{ color: TONE[l.tone] }}>{l.text}</pre>
        ))}

        {phase === "plans" && profile && (
          <PlanCards recommended={profile.account_tier} onSelect={choosePlan} />
        )}
      </div>

      {/* command input */}
      <form
        onSubmit={e => { e.preventDefault(); submit(); }}
        className="flex items-center gap-2 border-t border-[#27272a] bg-[#0e0e10] px-5 py-3.5"
      >
        <span style={{ color: "var(--accent)" }}>operator@mondaily:~$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={phase !== "await_input"}
          autoComplete="off"
          spellCheck={false}
          placeholder={phase === "await_input" ? "describe your operation, then press Enter…" : ""}
          className="flex-1 bg-transparent text-zinc-100 caret-[color:var(--accent)] outline-none placeholder:text-zinc-700 disabled:opacity-40"
        />
        {phase === "processing" && <span className="animate-pulse text-[#fbbf24]">▍ compiling</span>}
        {phase === "await_input" && <span className="animate-pulse" style={{ color: "var(--accent)" }}>▍</span>}
      </form>
    </div>
  );
}

function PlanCards({ recommended, onSelect }: { recommended: "personal" | "business"; onSelect: (t: "personal" | "business") => void }) {
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2">
      {/* Card A — Personal */}
      <button
        onClick={() => onSelect("personal")}
        className="group flex flex-col rounded-sm border border-[#27272a] bg-[#18181b] p-5 text-left transition-all hover:border-zinc-600"
        style={recommended === "personal" ? { borderColor: "var(--accent)" } : undefined}
      >
        <div className="text-[11px] uppercase tracking-widest text-zinc-600">License A</div>
        <div className="mt-1 text-base text-zinc-100">Personal Developer</div>
        <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">$0<span className="text-sm text-zinc-600"> / month</span></div>
        <span className="mt-4 inline-block w-fit rounded border border-[#27272a] bg-[#0e0e10] px-2.5 py-1 text-[11px] text-zinc-400">
          50,000 baseline credits included
        </span>
        <span className="mt-5 text-[12px] font-semibold tracking-wide" style={{ color: "var(--accent)" }}>
          {recommended === "personal" ? "› RECOMMENDED — DEPLOY" : "› SELECT"}
        </span>
      </button>

      {/* Card B — Business Pro */}
      <button
        onClick={() => onSelect("business")}
        className="group flex flex-col rounded-sm border bg-[#18181b] p-5 text-left transition-all"
        style={{
          borderColor: "var(--accent)",
          boxShadow: recommended === "business" ? "0 0 0 1px var(--accent), 0 0 28px color-mix(in srgb, var(--accent) 22%, transparent)" : undefined,
        }}
      >
        <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--accent)" }}>License B</div>
        <div className="mt-1 text-base text-zinc-100">Business Pro</div>
        <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">$49<span className="text-sm text-zinc-600"> / month</span></div>
        <span
          className="mt-4 inline-block w-fit rounded-full px-2.5 py-1 text-[11px] font-medium"
          style={{ color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 45%, transparent)" }}
        >
          Activate 14-Day Free Trial + 500,000 Pre-Paid Credits Applied
        </span>
        <span className="mt-5 text-[12px] font-semibold tracking-wide" style={{ color: "var(--accent)" }}>
          {recommended === "business" ? "› RECOMMENDED — START TRIAL" : "› START TRIAL"}
        </span>
      </button>
    </div>
  );
}
