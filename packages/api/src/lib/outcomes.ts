import { supabase } from "@mondaily/db/client";
import { compareWindows, type BaselineComparison } from "@mondaily/shared/baseline";
import { makeBaseConverter } from "./currency-store";
import { dealStage as moneyDealStage, dealOwner as moneyDealOwner, dealValue as moneyDealValue, isWon as moneyIsWon, wonDate as moneyWonDate } from "./money";

/**
 * Business-outcomes engine — THE deal-value computation shared by GET /activities/outcomes and the
 * scheduled executive brief. One implementation so the Sales strip, the member dossier, the member
 * report, and the autonomous brief can never disagree about "value won this month".
 *
 * Contracts (guarded by tests):
 *   • every amount converts to the workspace base currency; unconvertible rows are COUNTED and
 *     disclosed, never silently face-valued into a total
 *   • open pipeline is a BALANCE (as of now), not a windowed flow
 *   • deltas vs the previous window go through the shared baseline engine (honest new/raw/pct)
 */
export interface OutcomeWindow { won: number; won_n: number; lost: number; lost_n: number; unconverted: number; cycles: number[] }
export interface OutcomesResult {
  base_currency: string;
  team: {
    value_won: number; deals_won: number; value_lost: number; deals_lost: number;
    pipeline_value: number; pipeline_deals: number;
    win_rate_pct: number | null; avg_deal_size: number | null; avg_cycle_days: number | null;
    unconverted: number; pipeline_unconverted: number;
    deltas: null | { value_won: BaselineComparison; deals_won: BaselineComparison; value_lost: BaselineComparison };
  };
  members: { user_id: string; value_won: number; deals_won: number; value_lost: number; deals_lost: number; win_rate_pct: number | null; unconverted: number; pipeline_value: number; pipeline_deals: number }[];
}

export async function computeOutcomes(ws: string, start: number, end: number, prevStart?: number, prevEnd?: number): Promise<OutcomesResult> {
  const hasPrev = Number.isFinite(prevStart) && Number.isFinite(prevEnd) && (prevEnd as number) > (prevStart as number);
  const [{ data: deals }, { base, toBase }] = await Promise.all([
    supabase.from("nodes").select("id, object_type, data, created_by, created_at, updated_at").eq("workspace_id", ws)
      .or("object_type.ilike.%deal%,object_type.ilike.%opportunit%").limit(20000),
    makeBaseConverter(ws),
  ]);

  const emptyWin = (): OutcomeWindow => ({ won: 0, won_n: 0, lost: 0, lost_n: 0, unconverted: 0, cycles: [] });
  const inWin = (ms: number, s0: number, e0: number) => ms >= s0 && ms <= e0;

  const teamNow = emptyWin(); const teamPrev = emptyWin();
  const byMember = new Map<string, OutcomeWindow>();
  let pipelineValue = 0, pipelineN = 0, pipelineUnconverted = 0;
  const pipelineByMember = new Map<string, { value: number; n: number }>();

  for (const row of deals ?? []) {
    const d = (row.data ?? {}) as Record<string, unknown>;
    const stage = moneyDealStage(d);
    const owner = moneyDealOwner(d) || String(row.created_by ?? "");
    const cur = (d.currency as string | undefined) ?? null;
    const face = moneyDealValue(d);
    const val = toBase(face, cur);
    const convertible = !(face > 0 && val === 0 && cur && cur.toUpperCase() !== base);

    if (moneyIsWon(stage) || /lost/i.test(stage)) {
      const closedAt = Date.parse(moneyWonDate(row as never) || String(row.updated_at ?? row.created_at ?? ""));
      const target = inWin(closedAt, start, end) ? "now" : hasPrev && inWin(closedAt, prevStart as number, prevEnd as number) ? "prev" : null;
      if (!target) continue;
      const bucket = target === "now" ? teamNow : teamPrev;
      const mine = target === "now" && owner ? (byMember.get(owner) ?? (byMember.set(owner, emptyWin()), byMember.get(owner)!)) : null;
      if (moneyIsWon(stage)) {
        bucket.won += convertible ? val : 0; bucket.won_n += 1;
        if (!convertible) bucket.unconverted += 1;
        const created = Date.parse(String(row.created_at ?? ""));
        if (Number.isFinite(created) && closedAt > created) bucket.cycles.push((closedAt - created) / 86_400_000);
        if (mine) { mine.won += convertible ? val : 0; mine.won_n += 1; if (!convertible) mine.unconverted += 1; }
      } else {
        bucket.lost += convertible ? val : 0; bucket.lost_n += 1;
        if (!convertible) bucket.unconverted += 1;
        if (mine) { mine.lost += convertible ? val : 0; mine.lost_n += 1; if (!convertible) mine.unconverted += 1; }
      }
    } else if (!/closed/i.test(stage)) {
      // open pipeline — a BALANCE (as of now), not a windowed flow
      pipelineValue += convertible ? val : 0; pipelineN += 1;
      if (!convertible) pipelineUnconverted += 1;
      if (owner) { const pm = pipelineByMember.get(owner) ?? { value: 0, n: 0 }; pm.value += convertible ? val : 0; pm.n += 1; pipelineByMember.set(owner, pm); }
    }
  }

  const winRate = (w: OutcomeWindow) => (w.won_n + w.lost_n > 0 ? Math.round((w.won_n / (w.won_n + w.lost_n)) * 100) : null);
  const avg = (w: OutcomeWindow) => (w.won_n > 0 ? Math.round(w.won / w.won_n) : null);
  const cycle = (w: OutcomeWindow) => (w.cycles.length > 0 ? Math.round(w.cycles.reduce((a, b) => a + b, 0) / w.cycles.length) : null);

  return {
    base_currency: base,
    team: {
      value_won: Math.round(teamNow.won), deals_won: teamNow.won_n,
      value_lost: Math.round(teamNow.lost), deals_lost: teamNow.lost_n,
      pipeline_value: Math.round(pipelineValue), pipeline_deals: pipelineN,
      win_rate_pct: winRate(teamNow), avg_deal_size: avg(teamNow), avg_cycle_days: cycle(teamNow),
      unconverted: teamNow.unconverted, pipeline_unconverted: pipelineUnconverted,
      deltas: hasPrev ? {
        value_won: compareWindows(Math.round(teamNow.won), Math.round(teamPrev.won)),
        deals_won: compareWindows(teamNow.won_n, teamPrev.won_n),
        value_lost: compareWindows(Math.round(teamNow.lost), Math.round(teamPrev.lost)),
      } : null,
    },
    members: [...byMember.entries()].map(([user_id, w]) => ({
      user_id, value_won: Math.round(w.won), deals_won: w.won_n, value_lost: Math.round(w.lost), deals_lost: w.lost_n,
      win_rate_pct: winRate(w), unconverted: w.unconverted,
      pipeline_value: Math.round(pipelineByMember.get(user_id)?.value ?? 0), pipeline_deals: pipelineByMember.get(user_id)?.n ?? 0,
    })).sort((a, b) => b.value_won - a.value_won),
  };
}
