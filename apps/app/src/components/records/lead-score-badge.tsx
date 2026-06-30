import { TrendingUp } from "lucide-react";

interface Props {
  score: number | null | undefined;
  size?: "sm" | "md";
  /** lead_score_signals from the scoring engine — drives the "why" breakdown. */
  signals?: Record<string, unknown> | null;
}

function scoreColor(score: number) {
  if (score >= 70) return { text: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", bar: "bg-emerald-500" };
  if (score >= 40) return { text: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", bar: "bg-amber-500" };
  return { text: "text-stone-500", bg: "bg-[var(--surface-hover)] border-[var(--border-soft)]", bar: "bg-stone-600" };
}

function scoreLabel(score: number) {
  if (score >= 70) return "Hot";
  if (score >= 40) return "Warm";
  return "Cold";
}

/** Turn raw signals into readable, signed factor rows. The +/- hint mirrors the
 *  backend weighting (runLeadScoring) — a directional cue, not the exact points. */
function factorsFrom(signals: Record<string, unknown>): { label: string; value: string; tone: "up" | "down" | "flat" }[] {
  const out: { label: string; value: string; tone: "up" | "down" | "flat" }[] = [];
  const num = (v: unknown) => (typeof v === "number" ? v : null);

  const aiIntent = num(signals.ai_intent);
  if (aiIntent != null) out.push({ label: "AI intent read", value: `${aiIntent}/100`, tone: aiIntent >= 60 ? "up" : aiIntent < 40 ? "down" : "flat" });

  if (signals.stage != null) {
    const intent = num(signals.stage_intent) ?? 0;
    out.push({ label: "Stage", value: String(signals.stage), tone: intent > 0 ? "up" : intent < 0 ? "down" : "flat" });
  }
  const val = num(signals.deal_value);
  if (val != null) out.push({ label: "Deal value", value: `$${val.toLocaleString()}`, tone: val >= 5000 ? "up" : "flat" });

  const days = num(signals.days_since_update);
  if (days != null) out.push({ label: "Last update", value: days <= 1 ? "today" : `${days}d ago`, tone: days <= 7 ? "up" : days > 30 ? "down" : "flat" });

  const act = num(signals.recent_activity_30d);
  if (act != null) out.push({ label: "Activity (30d)", value: `${act} touch${act === 1 ? "" : "es"}`, tone: act >= 3 ? "up" : act === 0 ? "down" : "flat" });

  const tasks = num(signals.open_tasks);
  if (tasks != null && tasks > 0) out.push({ label: "Open tasks", value: String(tasks), tone: "up" });

  if (signals.enriched === true) out.push({ label: "Enriched", value: "yes", tone: "up" });
  return out;
}

export function LeadScoreBadge({ score, size = "sm", signals }: Props) {
  if (score == null) return null;
  const colors = scoreColor(score);

  if (size === "sm") {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${colors.bg} ${colors.text}`}>
        <TrendingUp size={9} />
        {score}
      </span>
    );
  }

  const factors = signals ? factorsFrom(signals) : [];

  return (
    <div className={`rounded-sm border ${colors.bg} px-4 py-3`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <TrendingUp size={13} className={colors.text} />
          <span className="text-xs font-semibold text-[var(--text-primary)]">AI Lead Score</span>
        </div>
        <span className={`text-xl font-bold ${colors.text}`}>{score}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--surface-hover)] overflow-hidden">
        <div className={`h-full rounded-full transition-all ${colors.bar}`} style={{ width: `${score}%` }} />
      </div>
      <p className={`mt-1.5 text-[10px] font-medium ${colors.text}`}>{scoreLabel(score)}</p>

      {factors.length > 0 && (
        <div className="mt-3 border-t pt-2.5 space-y-1" style={{ borderColor: "var(--border-soft)" }}>
          <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>What's driving this</p>
          {factors.map((f) => (
            <div key={f.label} className="flex items-center justify-between gap-2 text-[11px]">
              <span style={{ color: "var(--text-muted)" }}>{f.label}</span>
              <span className="inline-flex items-center gap-1 font-medium" style={{ color: "var(--text-secondary)" }}>
                {f.value}
                {f.tone === "up" && <span className="text-emerald-400">↑</span>}
                {f.tone === "down" && <span className="text-rose-400">↓</span>}
              </span>
            </div>
          ))}
          {typeof signals?.ai_reason === "string" && signals.ai_reason && (
            <p className="mt-2 text-[10.5px] italic leading-snug" style={{ color: "var(--text-muted)" }}>
              <span className="not-italic font-semibold" style={{ color: "var(--text-faint)" }}>AI: </span>
              {signals.ai_reason as string}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
