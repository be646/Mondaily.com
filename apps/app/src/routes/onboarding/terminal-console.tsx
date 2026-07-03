import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../lib/api-client";
import { PLAN_TIERS } from "@mondaily/shared/pricing";

/**
 * Guided AI Onboarding Console — a full-screen monospace terminal that runs a short, CLICKABLE
 * survey (no free-typing to stall on), compiles the answers into an inferred workspace profile,
 * then recommends the right license from the team size (Just me → Scout, small team → Operator,
 * 6+ → Command). Selecting a plan persists the tier + backfills ai_credits_ledger + marks
 * onboarded, then routes to the invite step and finally HARD-redirects to the dashboard.
 */
type Tone = "rule" | "boot" | "system" | "user" | "accent" | "amber" | "dim" | "ok";
interface Line { id: number; text: string; tone: Tone }
type PlanId = "scout" | "operator" | "command" | "sovereign";
type Phase = "survey" | "compiling" | "plans" | "committing" | "invite";

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
  { id: 5, text: "          A few quick questions and I'll compile your workspace.", tone: "system" },
];

// ── Survey ────────────────────────────────────────────────────────────────────
interface Choice { value: string; label: string }
interface Question { key: "purpose" | "team_size" | "goals"; prompt: string; multi?: boolean; choices: Choice[] }

const SURVEY: Question[] = [
  {
    key: "purpose",
    prompt: "What are you setting up Mondaily for?",
    choices: [
      { value: "Sales & Outreach", label: "Sales & outreach" },
      { value: "Recruiting & Talent", label: "Recruiting & talent" },
      { value: "Real Estate", label: "Real estate" },
      { value: "Agency & Client Work", label: "Agency / client work" },
      { value: "Operations & Admin", label: "Operations & admin" },
      { value: "General Operations", label: "Something else" },
    ],
  },
  {
    key: "team_size",
    prompt: "How many people will work inside this workspace?",
    choices: [
      { value: "1", label: "Just me" },
      { value: "2-5", label: "2–5 people" },
      { value: "6-15", label: "6–15 people" },
      { value: "16+", label: "16 or more" },
    ],
  },
  {
    key: "goals",
    prompt: "What should your agents focus on first? (pick any)",
    multi: true,
    choices: [
      { value: "find_leads", label: "Find new leads" },
      { value: "enrich", label: "Enrich & research" },
      { value: "follow_ups", label: "Automate follow-ups" },
      { value: "pipeline", label: "Manage the pipeline" },
      { value: "oversight", label: "Reports & oversight" },
    ],
  },
];

// Team size → the license we lead with. This is the fix for the "15 people → Operator (1 seat)"
// bug: teams of 6+ are recommended Command, not Operator.
function recommendPlan(teamSize: string): PlanId {
  if (teamSize === "1") return "scout";
  if (teamSize === "2-5") return "operator";
  return "command"; // 6-15 and 16+
}

export function TerminalOnboardingPage() {
  const [lines, setLines] = useState<Line[]>([]);
  const [phase, setPhase] = useState<Phase>("survey");
  const [step, setStep] = useState(0);                    // survey question index
  const [answers, setAnswers] = useState<{ purpose?: string; team_size?: string; goals: string[] }>({ goals: [] });
  const [recommended, setRecommended] = useState<PlanId>("operator");
  const [aiModules, setAiModules] = useState<string[]>([]);   // AI-recommended product modules
  const [freeText, setFreeText] = useState("");                // optional "anything else" input
  const [inviteText, setInviteText] = useState("");
  const [sending, setSending] = useState(false);
  const [inviteLinks, setInviteLinks] = useState<{ email: string; link: string | null }[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const idRef = useRef(100);
  const scrollRef = useRef<HTMLDivElement>(null);
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
        await sleep(160);
      }
    })();
    return () => { mounted.current = false; };
  }, []);

  // Keep the terminal pinned to the latest line.
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [lines, phase, step]);

  function toggleGoal(value: string) {
    setAnswers(a => ({ ...a, goals: a.goals.includes(value) ? a.goals.filter(g => g !== value) : [...a.goals, value] }));
  }

  // Record a single-choice answer, echo it, advance the survey.
  function answerChoice(q: Question, choice: Choice) {
    push(`operator@mondaily:~$ ${choice.label}`, "user");
    setAnswers(a => ({ ...a, [q.key]: choice.value }));
    advance(step + 1);
  }

  function advance(next: number) {
    if (next < SURVEY.length) { setStep(next); return; }
    void compile();
  }

  // Compile the survey into a profile + recommendation via the AI architect, then reveal plan cards.
  async function compile() {
    setPhase("compiling");
    push("[...MONDAILY ARCHITECT ANALYZING YOUR OPERATION...]", "amber");

    // Smart step: Cerebras infers the sector, a tailored summary, and which product modules to
    // switch on — from the survey answers + any free text. Falls back gracefully if it errors.
    let ai: { industry_vertical?: string; recommended_modules?: string[]; summary?: string } = {};
    try {
      ai = await apiClient.post("/onboarding/analyze", {
        purpose: answers.purpose, team_size: answers.team_size, goals: answers.goals, description: freeText.trim(),
      });
    } catch { /* heuristic-free fallback below */ }
    if (!mounted.current) return;
    setLines(prev => prev.filter(l => l.text !== "[...MONDAILY ARCHITECT ANALYZING YOUR OPERATION...]"));

    const sector = ai.industry_vertical || answers.purpose || "General Operations";
    const mods = Array.isArray(ai.recommended_modules) ? ai.recommended_modules : [];
    setAiModules(mods);

    // A plan chosen on the marketing pricing page (/sign-up?plan=operator) wins over the team-size
    // heuristic — the operator explicitly picked it, so honor that instead of second-guessing them.
    const preselect = localStorage.getItem("mondaily_preselect_plan") as PlanId | null;
    localStorage.removeItem("mondaily_preselect_plan");
    const validPreselect = preselect && ["scout", "operator", "command", "sovereign"].includes(preselect) ? preselect : null;
    const rec = validPreselect ?? recommendPlan(answers.team_size ?? "1");
    setRecommended(rec);

    const PLAN_LABEL: Record<PlanId, string> = { scout: "Scout", operator: "Operator", command: "Command", sovereign: "Sovereign" };
    const MOD_LABEL: Record<string, string> = { finance: "Finance & Billing", investments: "Quantitative Asset Systems", hr: "Autonomous Workforce" };
    const out: Line[] = [
      { id: ++idRef.current, text: `-> Sector Inferred: ${sector}`, tone: "accent" },
      { id: ++idRef.current, text: `-> Team Size: ${answers.team_size ?? "1"} operator(s)`, tone: "accent" },
      ...(mods.length ? [{ id: ++idRef.current, text: `-> Modules Recommended: ${mods.map(m => MOD_LABEL[m] ?? m).join(", ")}`, tone: "accent" as Tone }] : []),
      ...(ai.summary ? [{ id: ++idRef.current, text: `   ${ai.summary}`, tone: "system" as Tone }] : []),
      ...(validPreselect ? [{ id: ++idRef.current, text: `-> Using your selected plan: ${PLAN_LABEL[validPreselect]}`, tone: "accent" as Tone }] : []),
      { id: ++idRef.current, text: "[✓ ENVIRONMENT COMPILED — WORKSPACE INITIALIZED]", tone: "ok" },
    ];
    for (const l of out) {
      if (!mounted.current) return;
      setLines(prev => [...prev, l]);
      await sleep(420);
    }
    await sleep(300);
    if (!mounted.current) return;
    push("[SYSTEM]: Select an operational license to finalize deployment.", "system");
    setPhase("plans");
  }

  async function choosePlan(plan: PlanId) {
    if (phase === "committing") return;
    setPhase("committing");
    const LABEL: Record<PlanId, string> = { scout: "SCOUT", operator: "OPERATOR", command: "COMMAND", sovereign: "SOVEREIGN" };
    push(`> Provisioning ${LABEL[plan]} workspace...`, "amber");
    try {
      await apiClient.post("/onboarding/complete", {
        plan,
        industry: answers.purpose,
        team_size: answers.team_size,
        goals: answers.goals,
        modules: aiModules,   // switch on the AI-recommended product modules
      });
    } catch { /* even if persistence hiccups, do not trap the user in onboarding */ }
    push("[✓ WORKSPACE PROVISIONED]", "ok");
    await sleep(300);
    if (!mounted.current) return;
    // Invites only make sense on multi-operator tiers. Scout/Operator are single-operator — skip
    // the invite step and go straight into the workspace.
    const isTeamPlan = plan === "command" || plan === "sovereign";
    if (isTeamPlan) {
      push("[SYSTEM]: Invite your operators, or skip and bring them later.", "system");
      setPhase("invite");
    } else {
      push("[SYSTEM]: Single-operator workspace ready. Entering...", "system");
      await sleep(600);
      enterWorkspace();
    }
  }

  function enterWorkspace() {
    localStorage.removeItem("mondaily_needs_onboarding");
    localStorage.removeItem("mondaily_prev_workspace_id");
    localStorage.setItem("mondaily_first_run", "1");
    window.location.assign("/");
  }

  // Abandon onboarding — if we came here from "create workspace", restore the workspace the user
  // was in before, so they're never trapped in setup for a workspace they changed their mind about.
  function exitSetup() {
    localStorage.removeItem("mondaily_needs_onboarding");
    const prev = localStorage.getItem("mondaily_prev_workspace_id");
    if (prev) {
      localStorage.setItem("mondaily_workspace_id", prev);
      localStorage.removeItem("mondaily_prev_workspace_id");
    }
    window.location.assign("/");
  }
  const canExit = typeof localStorage !== "undefined" && !!localStorage.getItem("mondaily_prev_workspace_id");

  // Create the invites and SHOW their shareable links (works with zero email config — the link
  // is the invite). Email is also attempted, but the link is what guarantees delivery today.
  async function finishOnboarding() {
    if (sending) return;
    const list = inviteText.split(/[\s,]+/).map(e => e.trim()).filter(e => e.includes("@"));
    if (!list.length) { enterWorkspace(); return; }
    setSending(true);
    push(`> Creating ${list.length} invite${list.length === 1 ? "" : "s"}...`, "amber");
    const links: { email: string; link: string | null }[] = [];
    for (const email of list) {
      try {
        const r = await apiClient.post<{ invite_link?: string }>("/invites", { email, role: "member" });
        links.push({ email, link: r.invite_link ?? null });
        push(`  ✓ ${email}`, "ok");
      } catch {
        links.push({ email, link: null });
        push(`  ✕ ${email} — could not create invite`, "amber");
      }
    }
    setInviteLinks(links);
    setSending(false);
  }

  const q = SURVEY[step];

  return (
    <div className="fixed inset-0 flex flex-col bg-[#09090b] font-mono text-[13px] text-zinc-300">
      {/* terminal chrome bar */}
      <div className="flex items-center gap-2 border-b border-[#27272a] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#3f3f46]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#3f3f46]" />
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--accent)" }} />
        <span className="ml-2 text-[11px] uppercase tracking-[0.2em] text-zinc-600">mondaily — workspace architect</span>
        {canExit && (
          <button onClick={exitSetup} className="ml-auto rounded-sm border border-[#27272a] px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:text-zinc-200">
            ✕ Cancel &amp; go back
          </button>
        )}
      </div>

      {/* scrolling log */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 leading-relaxed">
        {lines.map(l => (
          <pre key={l.id} className="whitespace-pre-wrap break-words" style={{ color: TONE[l.tone] }}>{l.text}</pre>
        ))}

        {/* Survey — clickable choices, so the user decides fast without typing. */}
        {phase === "survey" && q && (
          <div className="mt-5 max-w-2xl">
            <div className="text-[13px] text-zinc-100">
              <span style={{ color: "var(--accent)" }}>?</span> {q.prompt}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {q.choices.map(c => {
                const active = q.multi && answers.goals.includes(c.value);
                return (
                  <button
                    key={c.value}
                    onClick={() => (q.multi ? toggleGoal(c.value) : answerChoice(q, c))}
                    className="rounded-sm border px-3 py-1.5 text-[12px] transition-colors"
                    style={active
                      ? { borderColor: "var(--accent)", color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 12%, transparent)" }
                      : { borderColor: "#27272a", color: "#d4d4d8" }}
                  >
                    {active ? "✓ " : ""}{c.label}
                  </button>
                );
              })}
            </div>
            {q.multi && (
              <>
                <input
                  value={freeText}
                  onChange={e => setFreeText(e.target.value)}
                  placeholder="Anything specific about your operation? (optional — helps the AI tailor your setup)"
                  className="mt-4 w-full rounded-sm border bg-[#0e0e10] px-3 py-2 text-[12px] text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-[color:var(--accent)]"
                  style={{ borderColor: "#27272a" }}
                />
                <button
                  onClick={() => advance(step + 1)}
                  className="mt-3 rounded-sm px-4 py-1.5 text-[12px] font-semibold text-black"
                  style={{ background: "var(--accent)" }}
                >
                  {answers.goals.length || freeText.trim() ? "Compile with AI ›" : "Skip ›"}
                </button>
              </>
            )}
          </div>
        )}

        {phase === "plans" && (
          <PlanCards recommended={recommended} onSelect={choosePlan} />
        )}

        {phase === "invite" && (
          <div className="mt-6 max-w-xl rounded-sm border border-[#27272a] bg-[#18181b] p-5">
            <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--accent)" }}>// FINAL STEP · INVITE OPERATORS</div>

            {inviteLinks.length === 0 ? (
              <>
                <p className="mt-2 text-[13px] text-zinc-300">Add teammates by email — each gets a secure invite link (and an email once your domain is verified). You can always do this later in Settings → Members.</p>
                <textarea
                  autoFocus
                  value={inviteText}
                  onChange={e => setInviteText(e.target.value)}
                  placeholder="alex@company.com, sam@company.com"
                  rows={3}
                  className="mt-3 w-full resize-none rounded-sm border border-[#27272a] bg-[#0e0e10] px-3 py-2 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-[color:var(--accent)]"
                />
                <div className="mt-4 flex items-center gap-3">
                  <button onClick={finishOnboarding} disabled={sending}
                    className="rounded-sm px-4 py-2 text-[12px] font-semibold text-black disabled:opacity-60" style={{ background: "var(--accent)" }}>
                    {sending ? "Creating…" : inviteText.includes("@") ? "Create invite links ›" : "Enter workspace ›"}
                  </button>
                  {inviteText.includes("@") && (
                    <button onClick={enterWorkspace} disabled={sending} className="text-[12px] text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-60">Skip for now</button>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="mt-2 text-[13px] text-zinc-300">Invites created. Share each link with your teammate — it works right now, no email needed:</p>
                <div className="mt-3 space-y-2">
                  {inviteLinks.map((iv) => (
                    <div key={iv.email} className="flex items-center gap-2 rounded-sm border border-[#27272a] bg-[#0e0e10] px-3 py-2">
                      <span className="w-40 shrink-0 truncate text-[12px] text-zinc-400">{iv.email}</span>
                      {iv.link ? (
                        <>
                          <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">{iv.link}</span>
                          <button onClick={() => { navigator.clipboard.writeText(iv.link!); setCopied(iv.email); setTimeout(() => setCopied(null), 1500); }}
                            className="shrink-0 rounded-sm border border-[#34343a] px-2 py-0.5 text-[11px] text-zinc-300 hover:border-[color:var(--accent)]">
                            {copied === iv.email ? "Copied ✓" : "Copy link"}
                          </button>
                        </>
                      ) : <span className="text-[11px] text-amber-400">failed — retry in Settings → Members</span>}
                    </div>
                  ))}
                </div>
                <button onClick={enterWorkspace} className="mt-4 rounded-sm px-4 py-2 text-[12px] font-semibold text-black" style={{ background: "var(--accent)" }}>
                  Enter workspace ›
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* status footer — no free-text input; the survey drives everything */}
      <div className="flex items-center gap-2 border-t border-[#27272a] bg-[#0e0e10] px-5 py-3.5">
        <span style={{ color: "var(--accent)" }}>operator@mondaily:~$</span>
        <span className="flex-1 text-zinc-600">
          {phase === "survey" ? "select an option above…"
            : phase === "compiling" ? "compiling…"
            : phase === "plans" ? "choose a license…"
            : phase === "committing" ? "provisioning…"
            : "invite your team…"}
        </span>
        {(phase === "compiling" || phase === "committing") && <span className="animate-pulse text-[#fbbf24]">▍ working</span>}
        {phase !== "compiling" && phase !== "committing" && <span className="animate-pulse" style={{ color: "var(--accent)" }}>▍</span>}
      </div>
    </div>
  );
}

// ── Plan cards ─────────────────────────────────────────────────────────────────
interface PlanMeta { id: PlanId; name: string; price: string; sub: string; blurb: string }
// Numbers + seats come from the shared catalog; onboarding copy stays here.
const fmtCr = (n: number | null) => n === null ? "custom" : n >= 1_000_000 ? `${n % 1_000_000 === 0 ? n / 1_000_000 : (n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1_000)}k`;
const BLURB: Record<string, string> = { scout: "Solo. Get moving free.", operator: "Small teams up to 5.", command: "Growing teams, flat rate." };
const PLANS: PlanMeta[] = (["scout", "operator", "command"] as const).map((id) => {
  const t = PLAN_TIERS[id];
  return {
    id, name: t.name,
    price: t.priceMonthly === 0 ? "$0" : `$${t.priceMonthly}`,
    sub: `${t.seats} seat${t.seats === 1 ? "" : "s"} · ${fmtCr(t.monthlyCredits)} AI credits / mo`,
    blurb: BLURB[id] ?? "",
  };
});

function PlanCards({ recommended, onSelect }: { recommended: PlanId; onSelect: (p: PlanId) => void }) {
  return (
    <div className="mt-6 max-w-3xl">
      <div className="grid gap-4 sm:grid-cols-3">
        {PLANS.map(p => {
          const isRec = recommended === p.id || (recommended === "sovereign" && p.id === "command");
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className="group flex flex-col rounded-sm border bg-[#18181b] p-5 text-left transition-all hover:border-zinc-600"
              style={isRec
                ? { borderColor: "var(--accent)", boxShadow: "0 0 0 1px var(--accent), 0 0 28px color-mix(in srgb, var(--accent) 20%, transparent)" }
                : { borderColor: "#27272a" }}
            >
              <div className="text-[11px] uppercase tracking-widest" style={isRec ? { color: "var(--accent)" } : { color: "#52525b" }}>Tier · {p.name}</div>
              <div className="mt-1 text-base text-zinc-100">{p.name}</div>
              <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">{p.price}<span className="text-sm text-zinc-600"> / month</span></div>
              <span className="mt-4 inline-block w-fit rounded border border-[#27272a] bg-[#0e0e10] px-2.5 py-1 text-[11px] text-zinc-400">{p.sub}</span>
              <span className="mt-2 text-[11px] text-zinc-600">{p.blurb}</span>
              <span className="mt-5 text-[12px] font-semibold tracking-wide" style={{ color: "var(--accent)" }}>
                {isRec ? `› RECOMMENDED — CHOOSE ${p.name.toUpperCase()}` : `› CHOOSE ${p.name.toUpperCase()}`}
              </span>
            </button>
          );
        })}
      </div>
      {/* Sovereign — large teams / custom, routed to Command credits + a talk-to-us note. */}
      <div className="mt-3 flex items-center justify-between rounded-sm border border-[#27272a] bg-[#101012] px-4 py-2.5 text-[12px] text-zinc-400">
        <span><span className="text-zinc-200">Sovereign</span> — 10+ operators, dedicated infra & custom limits.</span>
        <a href="mailto:sales@mondaily.com?subject=Sovereign%20plan" className="shrink-0 rounded-sm border border-[#34343a] px-2.5 py-1 text-[11px] text-zinc-300 hover:border-[color:var(--accent)]">Talk to us</a>
      </div>
    </div>
  );
}
