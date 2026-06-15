import { TrendingUp } from "lucide-react";

interface Props {
  score: number | null | undefined;
  size?: "sm" | "md";
}

function scoreColor(score: number) {
  if (score >= 70) return { text: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", bar: "bg-emerald-500" };
  if (score >= 40) return { text: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", bar: "bg-amber-500" };
  return { text: "text-slate-500", bg: "bg-white/[.04] border-white/[.08]", bar: "bg-slate-600" };
}

function scoreLabel(score: number) {
  if (score >= 70) return "Hot";
  if (score >= 40) return "Warm";
  return "Cold";
}

export function LeadScoreBadge({ score, size = "sm" }: Props) {
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

  return (
    <div className={`rounded-xl border ${colors.bg} px-4 py-3`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <TrendingUp size={13} className={colors.text} />
          <span className="text-xs font-semibold text-white">Lead Score</span>
        </div>
        <span className={`text-xl font-bold ${colors.text}`}>{score}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[.06] overflow-hidden">
        <div className={`h-full rounded-full transition-all ${colors.bar}`} style={{ width: `${score}%` }} />
      </div>
      <p className={`mt-1.5 text-[10px] font-medium ${colors.text}`}>{scoreLabel(score)}</p>
    </div>
  );
}
