import { Activity, ArrowRight, ShieldCheck } from "lucide-react";
import { SourceCard, type SourceCardData } from "./ask-shared";
import { LogoMark } from "@/components/logo";

/**
 * Universal AI Intelligence layer — reusable components shown on record and
 * task detail pages so AI is visibly attached to every object, not bolted
 * on as a separate "Ask" box. Every component reads real fields already
 * written by real jobs (relationship_health/health_signals from
 * relationship-health.ts, ai_summary from enrichment/activity, lead_score
 * from lead scoring) and falls back to an honest empty state — never a
 * fabricated score, signal, or action.
 */

const EMPTY_SCORE_COPY = "AI will start scoring this once more activity exists.";

// ── AIInsightBadge — a single-line AI summary, when one exists ─────────────
export function AIInsightBadge({ summary }: { summary?: string | null }) {
  if (!summary) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]" style={{ color: "var(--text-faint)", border: "1px solid var(--border-soft)" }}>
        <LogoMark size={10}/> No AI summary yet
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]" style={{ color: "var(--text-secondary)", background: "var(--surface-hover)" }}>
      <LogoMark size={10} className="text-stone-500 dark:text-stone-400 shrink-0"/>
      <span className="truncate max-w-[260px]">{summary}</span>
    </span>
  );
}

// ── AIHealthScore — relationship_health, lead_score, or any 0–100 score ────
export function AIHealthScore({ score, label = "AI health score", updatedAt }: { score?: number | null; label?: string; updatedAt?: string | null }) {
  if (score == null) {
    return (
      <div className="rounded-sm p-3" style={{ background: "var(--surface-hover)" }}>
        <p className="text-[11px] font-medium" style={{ color: "var(--text-faint)" }}>{label}</p>
        <p className="mt-1 text-[12px]" style={{ color: "var(--text-faint)" }}>{EMPTY_SCORE_COPY}</p>
      </div>
    );
  }
  const color = score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#dc2626";
  return (
    <div className="rounded-sm p-3" style={{ background: "var(--surface-hover)" }}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium" style={{ color: "var(--text-faint)" }}>{label}</p>
        {updatedAt && <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>Updated {new Date(updatedAt).toLocaleDateString()}</p>}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>{score}</span>
        <div className="h-1.5 flex-1 rounded-full overflow-hidden" style={{ background: "var(--surface-card)" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }}/>
        </div>
      </div>
    </div>
  );
}

/** Compact inline variant for table cells / board cards — same honest
 * null-handling as AIHealthScore, just sized for a row instead of a panel. */
export function AIHealthScoreCompact({ score, label = "Health" }: { score?: number | null; label?: string }) {
  if (score == null) return null;
  const colors = score >= 70
    ? { text: "text-[#5f8169]", bg: "bg-[#5f8169]/10 border-[#5f8169]/20" }
    : score >= 40
    ? { text: "text-[#97824f]", bg: "bg-[#97824f]/10 border-[#97824f]/20" }
    : { text: "text-[#9c6b72]", bg: "bg-[#9c6b72]/10 border-[#9c6b72]/20" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${colors.bg} ${colors.text}`} title={`${label}: ${score}/100`}>
      <Activity size={9}/>{score}
    </span>
  );
}

// ── AISignalList — health_signals or any detected-signal record ───────────
export function AISignalList({ signals }: { signals?: Record<string, number | string> | null }) {
  const entries = signals ? Object.entries(signals) : [];
  if (!entries.length) {
    return <p className="text-[11.5px]" style={{ color: "var(--text-faint)" }}>No signals detected yet.</p>;
  }
  return (
    <ul className="space-y-1">
      {entries.map(([key, value]) => (
        <li key={key} className="flex items-center justify-between text-[11.5px]">
          <span className="flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
            <Activity size={10} className="shrink-0" style={{ color: "var(--text-faint)" }}/>
            {key.replace(/_/g, " ")}
          </span>
          <span className="font-medium" style={{ color: "var(--text-primary)" }}>{value}</span>
        </li>
      ))}
    </ul>
  );
}

// ── AINextAction — a concrete suggested next step, or an honest null ──────
export function AINextAction({ action, reason }: { action?: string | null; reason?: string }) {
  if (!action) {
    return <p className="text-[11.5px]" style={{ color: "var(--text-faint)" }}>No action needed right now.</p>;
  }
  return (
    <div className="flex items-start gap-2">
      <ArrowRight size={12} className="mt-0.5 shrink-0" style={{ color: "var(--accent)" }}/>
      <div>
        <p className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{action}</p>
        {reason && <p className="text-[10.5px]" style={{ color: "var(--text-faint)" }}>{reason}</p>}
      </div>
    </div>
  );
}

// ── AIEvidenceTray — reuses the same SourceCard the Ask engine renders, so
// "evidence" looks identical whether it came from a chat answer or a
// record page. ──────────────────────────────────────────────────────────
export function AIEvidenceTray({ sources }: { sources: SourceCardData[] }) {
  if (!sources.length) {
    return <p className="text-[11.5px]" style={{ color: "var(--text-faint)" }}>No evidence returned yet — needs more linked activity.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {sources.map((s, i) => <SourceCard key={i} source={s}/>)}
    </div>
  );
}

// ── AIAgentOwnerChip — which agent is watching this object, derived
// deterministically from object type (matches the real Agent Registry
// categories), never a random/fabricated assignment. ──────────────────────
const OWNER_BY_OBJECT_TYPE: Record<string, string> = {
  task: "Operations Agent",
  deal: "Relationship Agent",
  contact: "Relationship Agent",
  company: "Relationship Agent",
  person: "Relationship Agent",
  invoice: "Finance Agent",
  credit_note: "Finance Agent",
};

export function AIAgentOwnerChip({ objectType }: { objectType: string }) {
  const owner = OWNER_BY_OBJECT_TYPE[objectType.toLowerCase()];
  if (!owner) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px]" style={{ color: "var(--text-faint)", border: "1px solid var(--border-soft)" }}>
        No agent watching this object type yet
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px]" style={{ color: "var(--text-secondary)", background: "var(--surface-hover)" }}>
      <ShieldCheck size={10} className="text-stone-500 dark:text-stone-400"/>
      Watched by {owner}
    </span>
  );
}
