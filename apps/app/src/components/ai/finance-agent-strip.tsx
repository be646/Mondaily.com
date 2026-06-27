import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { apiClient } from "../../lib/api-client";

interface Decision {
  id: string; source_type: string; source_id: string | null; agent_name: string;
  title: string; summary: string | null; recommended_action: string | null;
  risk_level: "low" | "medium" | "high";
}

/**
 * Finance Agent activity — real pending Decision Queue rows scoped to
 * invoices (and, on an invoice detail page, to that one invoice). Reads
 * the same /api/v1/decisions data the Home Decision Queue panel shows, so
 * "approve" here and on Home are the exact same backend action.
 */
export function FinanceAgentStrip({ invoiceId }: { invoiceId?: string }) {
  const qc = useQueryClient();
  const { data, isError } = useQuery({
    queryKey: ["decisions", "pending", "finance"],
    queryFn: () => apiClient.get<Decision[]>("/decisions?status=pending"),
    staleTime: 30_000,
    retry: false,
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      apiClient.post(`/decisions/${id}/${action}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["decisions"] }),
  });

  if (isError) return null; // decision_queue migration not applied — fail quiet

  const financeDecisions = (data ?? []).filter(d =>
    (d.source_type === "invoice" || d.source_type === "credit_note") &&
    (!invoiceId || d.source_id === invoiceId)
  );

  if (financeDecisions.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl p-3" style={{ background: "var(--surface-hover)" }}>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>
        <LogoMark size={11} className="text-stone-500"/> Finance Agent — {financeDecisions.length} awaiting your approval
      </div>
      <ul className="space-y-1.5">
        {financeDecisions.map(d => (
          <li key={d.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>{d.title}</p>
              {d.recommended_action && <p className="truncate text-[10.5px]" style={{ color: "var(--text-faint)" }}>{d.recommended_action}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={() => act.mutate({ id: d.id, action: "approve" })} disabled={act.isPending}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10.5px] font-medium text-[var(--text-primary)] disabled:opacity-50" style={{ background: "#10b981" }}>
                <CheckCircle2 size={10}/> Approve
              </button>
              <button onClick={() => act.mutate({ id: d.id, action: "reject" })} disabled={act.isPending}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10.5px] font-medium disabled:opacity-50" style={{ border: "1px solid var(--border-strong)", color: "var(--text-secondary)" }}>
                <XCircle size={10}/> Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
