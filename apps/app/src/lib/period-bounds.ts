import { useQuery } from "@tanstack/react-query";
import { apiClient } from "./api-client";
import { periodRange, previousRange, type Period, type CustomRange, type DateRange } from "./period";

/**
 * Reporting windows resolved by the WORKSPACE, not by the browser.
 *
 * Until now every surface computed "this month" from `new Date()` in the browser, which means the
 * window was a fact about the reader's laptop: a user in Warsaw and a user in New York looking at
 * the same workspace saw months that started at different instants, and neither necessarily matched
 * the month the close worker would file. With snapshots on disk, that stops being a cosmetic
 * disagreement and becomes a report that disagrees with the audit trail.
 *
 * The previous window is fetched from the same call on purpose. Resolving "this month" on the
 * server and "last month" in the browser would compare a workspace-timezone window against a
 * browser-timezone one, and every period-over-period delta would be wrong by the offset — a small,
 * plausible, permanent error, which is the worst kind.
 */

export type Timeframe = "TODAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR" | "ALL_TIME";

interface BoundsResponse {
  timeframe: Timeframe;
  time_zone: string;
  week_start: number;
  bounds: { start: string; end: string } | null;
  previous: { start: string; end: string } | null;
}

const TIMEFRAME_OF: Record<Exclude<Period, "custom">, Timeframe> = {
  today: "TODAY", week: "WEEK", month: "MONTH", quarter: "QUARTER", year: "YEAR", all: "ALL_TIME",
};

export interface ResolvedPeriod {
  range: DateRange;
  previous: DateRange | null;
  /** Where the window came from. Surfaces can disclose it rather than implying one authority. */
  source: "workspace" | "browser";
  timeZone: string | null;
}

/**
 * Resolve a period into an actual window.
 *
 * FAIL-SOFT by design: while the request is in flight, or if it fails, this falls back to the local
 * computation and says so via `source`. A reporting page that blanks because a bounds lookup was
 * slow is worse than one showing a window computed a few hours off — and unlike a blank page, the
 * fallback is visible and explainable.
 *
 * A CUSTOM range stays local: it is a span the user typed, not a calendar period, so the server has
 * nothing to add and a round trip would only add latency.
 */
export function useResolvedPeriod(period: Period, custom?: CustomRange): ResolvedPeriod {
  const timeframe = period === "custom" ? null : TIMEFRAME_OF[period];

  const q = useQuery<BoundsResponse>({
    queryKey: ["period-bounds", timeframe],
    queryFn: () => apiClient.get<BoundsResponse>(`/periods/bounds?timeframe=${timeframe}`),
    enabled: timeframe != null,
    // A calendar window is stable for minutes at a time; re-asking on every mount is pure latency.
    staleTime: 60_000,
  });

  const localRange = periodRange(period, new Date(), custom);
  const localPrev = previousRange(period);

  if (timeframe == null || !q.data) {
    return { range: localRange, previous: localPrev, source: "browser", timeZone: null };
  }

  const b = q.data.bounds;
  return {
    // A null `bounds` is ALL_TIME — no filter. The local "all" range (epoch → now) is the
    // equivalent for the in-memory `inRange` these surfaces use, so the shape stays uniform.
    range: b ? { start: new Date(b.start), end: new Date(b.end) } : localRange,
    previous: q.data.previous ? { start: new Date(q.data.previous.start), end: new Date(q.data.previous.end) } : null,
    source: "workspace",
    timeZone: q.data.time_zone,
  };
}
