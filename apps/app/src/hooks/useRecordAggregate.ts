import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/api-client";

/**
 * useRecordAggregate — the single frontend adapter over POST /records/aggregate (the same endpoint the
 * record-table footer uses). Reports consume this so their KPIs are computed from REAL records on the
 * server (currency-aware, fail-closed) instead of a client-side pass over a capped page.
 *
 * Honesty is carried through verbatim: the response's `truncated` / `unconverted` / `currency` fields
 * are surfaced as scope notes by `aggScopeNotes` — a total is never presented as more complete than it is.
 * Nothing here recomputes finance concepts; it only aggregates a generic record column.
 */
export type AggOp = "count" | "sum" | "avg" | "min" | "max" | "filled" | "checked";
export interface AggResp {
  op: string; column: string; group_by: string; object_type: string;
  value?: number;
  groups?: { label: string; value: number; count: number; unconverted: number }[];
  total_rows: number; truncated: boolean; unconverted: number; currency: string | null;
}

export type AggFilter = { column: string; value: string };
export type AggDateFilter = { field: "created_at" | "updated_at"; from?: string; to?: string };

export function useRecordAggregate(args: {
  objectType: string; column: string; op: AggOp; groupBy?: string; currency?: boolean; enabled?: boolean;
  filters?: AggFilter[]; dateFilter?: AggDateFilter | null;
}) {
  const { objectType, column, op, groupBy = "none", currency = false, enabled = true, filters, dateFilter } = args;
  return useQuery<AggResp>({
    queryKey: ["records-agg", objectType, column, op, groupBy, currency, JSON.stringify(filters ?? []), JSON.stringify(dateFilter ?? null)],
    queryFn: () => apiClient.post<AggResp>("/records/aggregate", {
      object_type: objectType, column, op, group_by: groupBy, currency,
      ...(filters?.length ? { filters } : {}),
      ...(dateFilter ? { date_filter: dateFilter } : {}),
    }),
    enabled: enabled && !!objectType && !!column,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * Honest scope notes for an aggregate response — the SAME vocabulary the record table uses:
 *  • full table → "over N"    • truncated → "first N" (warn)    • "K unconverted" (warn)
 * `count` is exact (head count) so it carries no "over N" note.
 */
export function aggScopeNotes(resp: AggResp, op: AggOp): { text: string; warn?: boolean }[] {
  const notes: { text: string; warn?: boolean }[] = [];
  if (op !== "count") {
    notes.push(resp.truncated
      ? { text: `first ${resp.total_rows.toLocaleString()}`, warn: true }
      : { text: `over ${resp.total_rows.toLocaleString()}` });
  }
  if (resp.unconverted > 0) notes.push({ text: `${resp.unconverted} unconverted`, warn: true });
  return notes;
}

// Pick the largest group from a grouped count response (the "top status/stage" KPI). Honest: skips the
// "—" (missing-value) bucket so a top group is a real category, not "unset".
export function topGroup(resp: AggResp | undefined): { label: string; count: number } | null {
  const real = (resp?.groups ?? []).filter(g => g.label && g.label !== "—");
  if (!real.length) return null;
  const top = real.reduce((a, b) => (b.count >= a.count ? b : a), real[0]!);
  return { label: top.label, count: top.count };
}
