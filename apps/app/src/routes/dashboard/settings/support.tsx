import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LifeBuoy, X, MessageSquare, Send, Plus } from "lucide-react";
import { apiClient } from "../../../lib/api-client";
import { PageHeader, PageSkeleton } from "../../../components/ui/page-state";
import { useLanguage } from "../../../hooks/useLanguage";
import { useModules } from "../../../hooks/useModules";
import { useHelp } from "../../../components/help/help-panel";

/**
 * Support — role-branched. ADMIN/OWNER see the workspace queue (all tickets) with status controls.
 * Normal members see "My support requests" — only their own tickets, read + reply, NO status control
 * (the PATCH endpoint is admin-gated server-side; the UI hides the control so it's not misleading).
 */
const STATUSES = ["open", "in_review", "waiting_on_user", "resolved", "closed"] as const;
type Status = (typeof STATUSES)[number];

interface TicketRow { id: string; category: string; subject: string; status: Status; created_by: string; created_at: string; last_updated: string; comment_count: number }
interface Comment { author_id: string; author_role: "admin" | "requester"; body: string; at: string }
interface TicketDetail { id: string; category: string; subject: string; message: string; status: Status; created_by: string; created_at: string; comments: Comment[] }

const CATEGORY_LABEL: Record<string, string> = {
  billing: "Billing", credits: "Credits", onboarding: "Onboarding", discovery: "Discovery",
  integrations: "Integrations", data_privacy: "Data & privacy", bug_report: "Bug report", feature_request: "Feature request",
};

export function SupportSettings() {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const help = useHelp();
  const { role } = useModules();
  const isAdmin = ["owner", "admin"].includes(role ?? "");
  const [openId, setOpenId] = useState<string | null>(null);
  const statusLabel = (s: string) => t(`support.status.${s}`);

  // Admins → the whole workspace queue; members → only their own requests.
  const query = useQuery<{ tickets: TicketRow[] }>({
    queryKey: isAdmin ? ["support-tickets"] : ["my-support-tickets"],
    queryFn: () => apiClient.get(isAdmin ? "/support/tickets" : "/support/my-tickets"),
    retry: false,
  });

  if (query.isLoading) return <PageSkeleton rows={5} />;
  const tickets = query.data?.tickets ?? [];
  const title = isAdmin ? t("support.title") : t("support.my_requests");
  const description = isAdmin ? "All support requests from this workspace. Update status and reply." : "Your support requests. Track status and reply.";

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <PageHeader title={title} description={description} />
        <button onClick={() => help.open()} className="mt-1 flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors hover:border-[color:var(--section-accent)]"
          style={{ borderColor: "var(--border-soft)", color: "var(--section-accent)" }}>
          <Plus size={13} /> {t("support.new_request")}
        </button>
      </div>
      {tickets.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-sm border py-12 text-center" style={{ borderColor: "var(--border-soft)" }}>
          <LifeBuoy size={22} style={{ color: "var(--text-faint)" }} />
          <p className="text-sm text-[var(--text-muted)]">{t("support.empty")}</p>
        </div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b text-[11px] uppercase tracking-wide text-[var(--text-muted)]" style={{ borderColor: "var(--border-soft)" }}>
                <th className="px-4 py-2.5">Subject</th>
                <th className="px-3 py-2.5">Category</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Updated</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(tk => (
                <tr key={tk.id} onClick={() => setOpenId(tk.id)}
                  className="cursor-pointer border-b transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)" }}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--text-primary)]">{tk.subject}</div>
                    {tk.comment_count > 0 && <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--text-faint)]"><MessageSquare size={10} /> {tk.comment_count}</div>}
                  </td>
                  <td className="px-3 py-3 text-[var(--text-muted)]">{CATEGORY_LABEL[tk.category] ?? tk.category}</td>
                  <td className="px-3 py-3"><StatusBadge status={tk.status} label={statusLabel(tk.status)} /></td>
                  <td className="px-3 py-3 text-[12px] text-[var(--text-faint)]">{new Date(tk.last_updated).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openId && <TicketPanel id={openId} onClose={() => setOpenId(null)} onChanged={() => qc.invalidateQueries({ queryKey: isAdmin ? ["support-tickets"] : ["my-support-tickets"] })} statusLabel={statusLabel} />}
    </div>
  );
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const tone: Record<string, string> = {
    open: "#3f8f6e", in_review: "#7f93b0", waiting_on_user: "#a3946b", resolved: "#5fae8b", closed: "#9ca3af",
  };
  const c = tone[status] ?? "#9ca3af";
  return <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c }}>{label}</span>;
}

function TicketPanel({ id, onClose, onChanged, statusLabel }: { id: string; onClose: () => void; onChanged: () => void; statusLabel: (s: string) => string }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const detail = useQuery<TicketDetail>({ queryKey: ["support-ticket", id], queryFn: () => apiClient.get(`/support/tickets/${id}`) });

  const addComment = useMutation({
    mutationFn: (body: string) => apiClient.post(`/support/tickets/${id}/comments`, { body }),
    onSuccess: () => { setReply(""); qc.invalidateQueries({ queryKey: ["support-ticket", id] }); onChanged(); },
  });

  const d = detail.data;
  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-[201] flex h-full w-full max-w-lg flex-col border-l shadow-lg" style={{ background: "var(--surface-page)", borderColor: "var(--border-soft)" }}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <span className="truncate text-[14px] font-semibold text-[var(--text-primary)]">{d?.subject ?? "…"}</span>
          <button onClick={onClose} className="btn-icon h-7 w-7"><X size={15} /></button>
        </div>
        {!d ? <div className="p-5"><PageSkeleton rows={4} /></div> : (
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <div className="flex items-center gap-2">
              {/* Status is READ-ONLY for every workspace user (incl. workspace admins) — tickets are
                  handled BY Mondaily support, so status/review/close controls live only in Mondaily's
                  own support dashboard, never in a customer workspace. */}
              <StatusBadge status={d.status} label={statusLabel(d.status)} />
              <span className="text-[11px] text-[var(--text-faint)]">{CATEGORY_LABEL[d.category] ?? d.category}</span>
            </div>
            <div className="rounded-sm border p-3 text-[13px] whitespace-pre-wrap" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}>{d.message}</div>
            <div className="space-y-2">
              {(d.comments ?? []).map((cm, i) => (
                <div key={i} className={`max-w-[85%] rounded-md px-3.5 py-2.5 text-[13px] ${cm.author_role === "admin" ? "ml-auto rounded-br-sm" : "rounded-bl-sm"}`}
                  style={{ background: cm.author_role === "admin" ? "var(--surface-selected)" : "var(--surface-card)", border: "1px solid var(--border-soft)", color: "var(--text-primary)" }}>
                  <p className="whitespace-pre-wrap">{cm.body}</p>
                  <p className="mt-1 text-[10px] text-[var(--text-faint)]">{cm.author_role} · {new Date(cm.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="border-t p-3" style={{ borderColor: "var(--border-soft)" }}>
          <div className="flex items-end gap-2">
            <textarea value={reply} onChange={e => setReply(e.target.value)} rows={1} placeholder={t("support.reply")}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (reply.trim()) addComment.mutate(reply.trim()); } }}
              className="max-h-28 flex-1 resize-none rounded-lg border bg-transparent px-3 py-2 text-[13px] outline-none" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }} />
            <button onClick={() => reply.trim() && addComment.mutate(reply.trim())} disabled={!reply.trim() || addComment.isPending}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white disabled:opacity-40" style={{ background: "var(--section-accent)" }}><Send size={15} /></button>
          </div>
        </div>
      </aside>
    </>
  );
}
