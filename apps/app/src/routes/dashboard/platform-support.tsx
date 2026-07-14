import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, Loader2, X, Send, ShieldAlert } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { MenuSelect } from "../../components/ui/controls";

/**
 * MONDAILY PLATFORM SUPPORT — the internal dashboard where ticket status/review/close actually
 * happen. Visible only to PLATFORM_ADMIN_EMAILS operators (capability probe below; the API is
 * hard-gated server-side regardless). Cross-workspace by design: this is Mondaily triaging its
 * customers' tickets, not a workspace feature. Flat-line system throughout.
 */
const STATUSES = ["open", "in_review", "waiting_on_user", "resolved", "closed"] as const;
type Status = (typeof STATUSES)[number];
const label = (s: string) => s.replace(/_/g, " ");
const STATUS_TONE: Record<Status, string> = { open: "#c6892e", in_review: "#717784", waiting_on_user: "#c6892e", resolved: "#2f9e6b", closed: "#8a8f99" };

interface TicketRow { id: string; workspace_id: string; workspace_name: string; subject: string; category: string; status: Status; created_at: string; last_updated: string; comment_count: number }
interface Comment { author_id: string; author_role: "admin" | "requester" | "mondaily"; body: string; at: string }
interface TicketDetail extends TicketRow { message: string; comments: Comment[]; status_history: { status: string; at: string; by: string }[] }

export function usePlatformAdmin() {
  return useQuery<{ platform_admin: boolean }>({
    queryKey: ["platform-admin-probe"],
    queryFn: () => apiClient.get("/platform/support/me"),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function PlatformSupportPage() {
  const probe = usePlatformAdmin();
  const [statusFilter, setStatusFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const qc = useQueryClient();

  const list = useQuery<{ tickets: TicketRow[] }>({
    queryKey: ["platform-tickets", statusFilter],
    queryFn: () => apiClient.get(`/platform/support/tickets${statusFilter ? `?status=${statusFilter}` : ""}`),
    enabled: probe.data?.platform_admin === true,
  });

  if (probe.isLoading) return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin" style={{ color: "var(--text-muted)" }} /></div>;
  if (!probe.data?.platform_admin) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
        <ShieldAlert size={22} style={{ color: "var(--text-faint)" }} />
        <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>Mondaily operators only</p>
        <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>This is Mondaily's internal support dashboard. Your account isn't on the platform-admin allowlist.</p>
      </div>
    );
  }

  const tickets = list.data?.tickets ?? [];
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-[19px] font-semibold" style={{ color: "var(--text-primary)" }}><LifeBuoy size={17} style={{ color: "var(--text-muted)" }} /> Platform support</h1>
        <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>All workspaces' tickets — status changes and Mondaily replies happen here, never inside a customer workspace.</p>
      </div>

      <div className="mb-3 flex items-center gap-3 border-b pb-3" style={{ borderColor: "var(--border-soft)" }}>
        <MenuSelect label="Status" value={statusFilter} onChange={setStatusFilter} maxWidth={180}
          options={STATUSES.map(s => ({ value: s, label: label(s), dot: STATUS_TONE[s] }))} />
        <span className="text-[11.5px] tabular-nums" style={{ color: "var(--text-faint)" }}>{tickets.length} ticket(s)</span>
      </div>

      {list.isLoading ? (
        <div className="flex items-center gap-2 rounded-sm border px-4 py-10 text-[13px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : list.isError ? (
        <div className="rounded-sm border py-10 text-center text-[13px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>Couldn't load tickets. <button onClick={() => list.refetch()} className="underline">Retry</button></div>
      ) : tickets.length === 0 ? (
        <div className="rounded-sm border py-14 text-center text-[13px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>No tickets{statusFilter ? ` with status “${label(statusFilter)}”` : ""}.</div>
      ) : (
        <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
          {tickets.map((t, i) => (
            <button key={t.id} onClick={() => setOpenId(t.id)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
              style={i > 0 ? { borderTop: "1px solid var(--border-soft)" } : undefined}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_TONE[t.status] ?? "var(--text-faint)" }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{t.subject}</span>
                <span className="block truncate text-[11px]" style={{ color: "var(--text-faint)" }}>{t.workspace_name} · {t.category} · {t.comment_count} repl{t.comment_count === 1 ? "y" : "ies"}</span>
              </span>
              <span className="shrink-0 text-[11px] capitalize" style={{ color: STATUS_TONE[t.status] ?? "var(--text-muted)" }}>{label(t.status)}</span>
              <span className="shrink-0 text-[11px] tabular-nums" style={{ color: "var(--text-faint)" }}>{new Date(t.last_updated).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            </button>
          ))}
        </div>
      )}

      {openId && <PlatformTicketPanel id={openId} onClose={() => setOpenId(null)} onChanged={() => qc.invalidateQueries({ queryKey: ["platform-tickets"] })} />}
    </div>
  );
}

function PlatformTicketPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const detail = useQuery<TicketDetail>({ queryKey: ["platform-ticket", id], queryFn: () => apiClient.get(`/platform/support/tickets/${id}`) });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["platform-ticket", id] }); onChanged(); };
  const setStatus = useMutation({ mutationFn: (status: Status) => apiClient.patch(`/platform/support/tickets/${id}`, { status }), onSuccess: invalidate });
  const addReply = useMutation({ mutationFn: (body: string) => apiClient.post(`/platform/support/tickets/${id}/comments`, { body }), onSuccess: () => { setReply(""); invalidate(); } });
  const d = detail.data;

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/30" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-[201] flex h-full w-full max-w-lg flex-col border-l shadow-lg" style={{ background: "var(--surface-page)", borderColor: "var(--border-soft)" }}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <div className="min-w-0">
            <span className="block truncate text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>{d?.subject ?? "…"}</span>
            {d && <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{d.workspace_name} · {d.category}</span>}
          </div>
          <button onClick={onClose} className="btn-icon h-7 w-7"><X size={15} /></button>
        </div>
        {!d ? <div className="p-5"><Loader2 size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} /></div> : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {/* THE status control — lives here and only here. */}
              <div className="flex items-center gap-2">
                <MenuSelect label="Status" value={d.status} allLabel={label(d.status)} maxWidth={190}
                  options={STATUSES.filter(s => s !== d.status).map(s => ({ value: s, label: label(s), dot: STATUS_TONE[s] }))}
                  onChange={(v) => v && setStatus.mutate(v as Status)} />
                {setStatus.isPending && <Loader2 size={13} className="animate-spin" style={{ color: "var(--text-muted)" }} />}
              </div>
              <div className="rounded-sm border p-3 text-[13px] whitespace-pre-wrap" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}>{d.message}</div>
              <div className="space-y-2">
                {d.comments.map((cm, i) => (
                  <div key={i} className={`max-w-[85%] rounded-md px-3.5 py-2.5 text-[13px] ${cm.author_role === "requester" ? "rounded-bl-sm" : "ml-auto rounded-br-sm"}`}
                    style={{ background: cm.author_role === "requester" ? "var(--surface-card)" : "var(--surface-selected)", border: "1px solid var(--border-soft)", color: "var(--text-primary)" }}>
                    <p className="whitespace-pre-wrap">{cm.body}</p>
                    <p className="mt-1 text-[10px]" style={{ color: "var(--text-faint)" }}>{cm.author_role === "mondaily" ? "Mondaily Support" : cm.author_role} · {new Date(cm.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                ))}
              </div>
              {d.status_history.length > 0 && (
                <div className="border-t pt-3" style={{ borderColor: "var(--border-soft)" }}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>Status history</p>
                  {d.status_history.map((h, i) => (
                    <p key={i} className="text-[11px]" style={{ color: "var(--text-muted)" }}>{label(h.status)} · {new Date(h.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-end gap-2 border-t px-3 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={1} placeholder="Reply as Mondaily Support…"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (reply.trim()) addReply.mutate(reply.trim()); } }}
                className="flex-1 resize-none bg-transparent text-[13px] outline-none" style={{ color: "var(--text-primary)", maxHeight: 120 }} />
              <button onClick={() => reply.trim() && addReply.mutate(reply.trim())} disabled={!reply.trim() || addReply.isPending}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
                style={{ borderColor: "var(--border-strong)", background: "var(--surface-card-2)", color: "var(--text-primary)" }}>
                {addReply.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Reply
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
