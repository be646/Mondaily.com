import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Target, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { CommandPageHeader } from "../../components/ui/controls";
import { AIButton, SuggestionHints } from "../../components/ui/ai-button";
import { errorText } from "../../lib/alerts";

interface Step { order: number; title: string; detail: string; risk_level: string }
interface GoalProgress { id: string; title: string; agent_name: string; created_at: string; total: number; done: number; rejected: number; pending: number; progress: number; status: "active" | "complete" }
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
    } catch (e) {
      // apiClient throws with the raw response body on non-2xx — surface the honest
      // server message (e.g. "AI service unavailable") rather than a generic line.
      setError(errorText(e, "Couldn't plan that goal — please try again."));
    }
    finally { setPlanning(false); }
  }

  const qc = useQueryClient();
  const goalsQ = useQuery({
    queryKey: ["goals-progress"],
    queryFn: () => apiClient.get<{ goals: GoalProgress[] }>("/decisions/goals"),
    retry: false, staleTime: 30_000,
  });

  async function dispatch() {
    if (!plan?.steps.length) return;
    setDispatching(true);
    try {
      // One call: persists the goal + creates every linked step-decision, so progress is trackable.
      const res = await apiClient.post<{ dispatched: number }>("/decisions/dispatch-plan", {
        goal: plan.goal, agent_name: plan.agent_name || "planner", steps: plan.steps,
      });
      setDispatched(res.dispatched);
      qc.invalidateQueries({ queryKey: ["goals-progress"] });
    } catch (e) {
      // Was `setDispatched(0)`, which rendered the GREEN success panel reading
      // "Dispatched 0 steps to the decision queue" — a fabricated success for a failed call.
      setError(e instanceof Error ? e.message : "Could not dispatch this plan. Nothing was created.");
    }
    finally { setDispatching(false); }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pt-2 pb-8 sm:px-6">
      <CommandPageHeader
        variant="bar"
        icon={Target}
        callsign="GOALS"
        title="Goal-directed agents"
        subtitle="Give a goal — an agent drafts the plan; you dispatch it to the approval queue."
        status={[{ label: "you stay in control", kind: "complete" }]}
      />

      {/* Composer — a clean, focused text box (Claude-style), with the suggestions
          stacked in order below it. */}
      <div className="ai-composer">
        <textarea
          value={goal} onChange={e => setGoal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void generate(); } }}
          placeholder="What should the agent achieve? e.g. Recover overdue AR this month"
          rows={2} className="ai-composer-input text-[13.5px]"
        />
        <div className="mt-1 flex items-center justify-end">
          <AIButton size="sm" loading={planning} disabled={!goal.trim()} onClick={generate}>Plan it</AIButton>
        </div>
      </div>
      {error && <p className="mt-2 text-[11.5px]" style={{ color: "#d1524a" }}>{error}</p>}
      {!plan && <SuggestionHints className="mt-4" label="Try" items={EXAMPLES} onPick={setGoal} />}

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

      {/* Active goals — real progress from each goal's linked step-decisions (done / total). */}
      {goalsQ.isError && (
        <div role="alert" className="mt-6 rounded-sm border border-[var(--border-soft)] px-4 py-3 text-[12px] text-[var(--text-secondary)]">
          Couldn&rsquo;t load your goals. They may still exist — this is a loading problem, not an empty list.
        </div>
      )}
      {(goalsQ.data?.goals.length ?? 0) > 0 && (
        <div className="mt-10">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Your goals · progress</p>
          <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
            {goalsQ.data!.goals.map(g => (
              <button key={g.id} onClick={() => navigate("/decisions")}
                className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)" }}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{g.title}</span>
                    {g.status === "complete" && <CheckCircle2 size={13} className="shrink-0" style={{ color: "#2f9e6b" }} />}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 w-32 overflow-hidden rounded-full" style={{ background: "var(--surface-hover)" }}>
                      <div className="h-full rounded-full" style={{ width: `${g.progress}%`, background: g.status === "complete" ? "#2f9e6b" : "var(--section-accent)" }} />
                    </div>
                    <span className="text-[10.5px]" style={{ color: "var(--text-faint)" }}>
                      {g.done}/{g.total} done{g.pending > 0 ? ` · ${g.pending} pending` : ""}{g.rejected > 0 ? ` · ${g.rejected} skipped` : ""}
                    </span>
                  </div>
                </div>
                <ArrowRight size={13} className="shrink-0" style={{ color: "var(--text-faint)" }} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
