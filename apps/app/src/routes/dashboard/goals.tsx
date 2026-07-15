import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Target, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { CommandPageHeader } from "../../components/ui/controls";
import { AIButton, SuggestionHints } from "../../components/ui/ai-button";

interface Step { order: number; title: string; detail: string; risk_level: string }
const RISK_TONE: Record<string, string> = { high: "#d1524a", medium: "#c6892e", low: "#2f9e6b" };

const EXAMPLES = [
  "Recover overdue accounts receivable this month",
  "Warm up cold deals that have gone quiet",
  "Tidy up records missing key contact info",
];

export function GoalsPage() {
  const navigate = useNavigate();
  const [goal, setGoal] = useState("");
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<{ goal: string; agent_name: string; steps: Step[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [dispatched, setDispatched] = useState<number | null>(null);

  async function generate() {
    if (!goal.trim()) return;
    setPlanning(true); setError(null); setPlan(null); setDispatched(null);
    try {
      const res = await apiClient.post<{ goal: string; agent_name: string; steps: Step[]; error?: string }>("/decisions/plan-goal", { goal: goal.trim() });
      if (res.error) { setError(res.error); return; }
      setPlan(res);
    } catch { setError("Couldn't plan that goal — please try again."); }
    finally { setPlanning(false); }
  }

  async function dispatch() {
    if (!plan?.steps.length) return;
    setDispatching(true);
    let n = 0;
    for (const s of plan.steps) {
      try {
        await apiClient.post("/decisions", {
          agent_name: plan.agent_name || "planner",
          source_type: "goal_step",
          title: s.title,
          summary: s.detail || `Goal: ${plan.goal}`,
          recommended_action: s.title,
          risk_level: s.risk_level,
          evidence: [{ type: "goal", title: plan.goal, match_reason: `Step ${s.order} of the plan` }],
        });
        n++;
      } catch { /* skip failed step */ }
    }
    setDispatched(n);
    setDispatching(false);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <CommandPageHeader
        icon={Target}
        callsign="GOALS"
        title="Goal-directed agents"
        subtitle="Give a goal — an agent drafts the plan; you dispatch it to the approval queue."
        status={[{ label: "you stay in control", kind: "complete" }]}
      />

      {/* Composer */}
      <div className="rounded-sm border p-4" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
        <textarea
          value={goal} onChange={e => setGoal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void generate(); } }}
          placeholder="What should the agent achieve? e.g. Recover overdue AR this month"
          rows={2} className="key-input w-full resize-none text-[13px]"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <SuggestionHints label="Try" items={EXAMPLES} onPick={setGoal} />
          <AIButton size="sm" loading={planning} disabled={!goal.trim()} onClick={generate}>Plan it</AIButton>
        </div>
        {error && <p className="mt-2 text-[11.5px]" style={{ color: "#d1524a" }}>{error}</p>}
      </div>

      {/* Plan */}
      {plan && (
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Proposed plan · {plan.steps.length} steps</p>
            <span className="text-[11px] capitalize" style={{ color: "var(--text-faint)" }}>{plan.agent_name.replace(/_/g, " ")}</span>
          </div>
          <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
            {plan.steps.map(s => (
              <div key={s.order} className="flex items-start gap-3 border-b px-4 py-3 last:border-0" style={{ borderColor: "var(--border-soft)" }}>
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold tabular-nums" style={{ background: "var(--surface-hover)", color: "var(--text-muted)" }}>{s.order}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{s.title}</span>
                    <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide" style={{ background: `color-mix(in srgb, ${RISK_TONE[s.risk_level]} 14%, transparent)`, color: RISK_TONE[s.risk_level] }}>{s.risk_level}</span>
                  </div>
                  {s.detail && <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--text-muted)" }}>{s.detail}</p>}
                </div>
              </div>
            ))}
          </div>

          {dispatched == null ? (
            <div className="mt-3 flex items-center justify-between">
              <p className="text-[11.5px]" style={{ color: "var(--text-faint)" }}>Dispatching adds each step to the decision queue — low-risk ones may auto-run if autonomy is on; the rest wait for you.</p>
              <button onClick={dispatch} disabled={dispatching}
                className="flex shrink-0 items-center gap-2 rounded-sm border px-4 py-1.5 text-[12px] font-semibold text-[var(--text-primary)] transition-colors disabled:opacity-50"
                style={{ borderColor: "var(--section-accent-line)", background: "var(--section-accent-soft)" }}>
                {dispatching ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />} Dispatch {plan.steps.length} steps
              </button>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between rounded-sm border px-4 py-2.5 text-[12px]" style={{ borderColor: "var(--section-accent-line)", background: "color-mix(in srgb, var(--section-accent) 5%, transparent)", color: "var(--text-secondary)" }}>
              <span className="flex items-center gap-2"><CheckCircle2 size={14} style={{ color: "#2f9e6b" }} /> Dispatched <strong style={{ color: "var(--text-primary)" }}>{dispatched}</strong> step{dispatched === 1 ? "" : "s"} to the decision queue.</span>
              <button onClick={() => navigate("/decisions")} className="inline-flex items-center gap-1 font-medium hover:underline" style={{ color: "var(--section-accent)" }}>Review in Decisions <ArrowRight size={12} /></button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
