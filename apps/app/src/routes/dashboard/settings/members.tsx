import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
import { Check, Copy, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { apiClient } from "../../../lib/api-client";
import { PageHeader, PageSkeleton } from "../../../components/ui/page-state";

/**
 * Members & Teams — a single, atomic, crash-proof table. Deliberately flat: no tabs, no nested
 * team/modal child views, no unguarded iterations. Every field is read with optional chaining and
 * a fallback string, and the row iterator is wrapped in an explicit Array.isArray + length guard,
 * so a malformed/empty member row can never throw and unmount the page (the old pitch-black bug).
 */
interface Member { id?: string; name?: string | null; email?: string | null; role?: string | null; status?: string | null }
interface MembersData { members?: Member[] }

const roleLabel = (r?: string | null): string =>
  r === "owner" ? "Owner" : r === "admin" ? "Admin" : r === "viewer" ? "Viewer" : "Member";

export function MembersSettings() {
  const qc = useQueryClient();
  const me = useCurrentUser();
  const [copied, setCopied] = useState(false);
  const [emails, setEmails] = useState("");

  const query = useQuery({ queryKey: ["members"], queryFn: () => apiClient.get<MembersData>("/settings/members") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["members"] });

  const members: Member[] = Array.isArray(query.data?.members) ? query.data!.members! : [];
  const myEmail = me.email?.toLowerCase();
  const myRole = members.find(m => m?.email?.toLowerCase() === myEmail)?.role ?? "member";
  const isAdmin = myRole === "owner" || myRole === "admin";

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => apiClient.patch(`/settings/members/${id}`, { role }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/settings/members/${id}`),
    onSuccess: refresh,
  });
  const sendInvite = useMutation({
    mutationFn: async () => {
      const list = emails.split(/[\s,]+/).filter(e => e.includes("@"));
      await Promise.all(list.map(email => apiClient.post("/invites", { email, role: "member" })));
    },
    onSuccess: () => { setEmails(""); refresh(); },
  });

  // "Copy invite link" — bound to the native tokenized-link endpoint (never the raw workspace id).
  async function copyInviteLink() {
    try {
      const { invite_link } = await apiClient.post<{ invite_link: string }>("/invites/link", {});
      await navigator.clipboard.writeText(invite_link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("[invite-link]", e);
    }
  }

  if (query.isLoading) return <PageSkeleton />;

  return (
    <div className="font-mono">
      <PageHeader title="Members & teams" description="Manage who can access this workspace." />

      {isAdmin && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <input
            value={emails}
            onChange={e => setEmails(e.target.value)}
            placeholder="teammate@company.com"
            className="min-w-[220px] flex-1 rounded-xl border bg-transparent px-3 py-2 text-sm outline-none focus:border-stone-500"
            style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }}
          />
          <button
            onClick={() => sendInvite.mutate()}
            disabled={!emails.includes("@") || sendInvite.isPending}
            className="flex items-center gap-2 rounded-xl border border-stone-500/30 bg-stone-600 px-3.5 py-2 text-sm font-semibold text-[var(--text-primary)] transition-all hover:bg-stone-500 disabled:opacity-50"
          >
            <UserPlus size={14} /> Invite
          </button>
          <button
            onClick={copyInviteLink}
            className="flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors hover:text-[var(--text-primary)]"
            style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}
          >
            {copied ? <><Check size={14} className="text-emerald-400" /> Copied</> : <><Copy size={14} /> Copy invite link</>}
          </button>
        </div>
      )}

      <div className="minimal-sheet overflow-x-auto">
        <table className="minimal-table min-w-[560px] text-left text-sm">
          <thead>
            <tr>
              {["Name", "Email", "Role", ""].map(h => (
                <th key={h || "actions"} className={`text-xs uppercase tracking-wider text-stone-500 ${h === "" ? "text-right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.isArray(members) && members.length > 0 ? members.map((m, i) => (
              <tr key={m?.id ?? `row-${i}`} className="border-t" style={{ borderColor: "var(--border-soft)" }}>
                <td className="py-3 font-medium text-stone-200">{m?.name || m?.email || "Unknown Operator"}</td>
                <td className="py-3 text-stone-500">{m?.email || "—"}</td>
                <td className="py-3">
                  {isAdmin && m?.role !== "owner" && m?.id ? (
                    <select
                      value={m?.role ?? "member"}
                      onChange={e => changeRole.mutate({ id: m.id!, role: e.target.value })}
                      className="rounded-lg border bg-transparent px-2 py-1 text-xs outline-none"
                      style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}
                    >
                      {["admin", "member", "viewer"].map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                    </select>
                  ) : (
                    <span className="rounded-full border px-2.5 py-1 text-xs" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                      {roleLabel(m?.role)}
                    </span>
                  )}
                </td>
                <td className="py-3 text-right">
                  {isAdmin && m?.role !== "owner" && m?.id && (
                    <button onClick={() => remove.mutate(m.id!)} className="text-stone-600 transition-colors hover:text-rose-400" title="Remove member">
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            )) : (
              <tr><td colSpan={4} className="p-4 font-mono text-zinc-500">No team operators registered.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
