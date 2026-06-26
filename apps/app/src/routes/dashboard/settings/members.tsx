import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, MoreHorizontal, Plus, RefreshCw, UserPlus, Users, X } from "lucide-react";
import { useState } from "react";
import { apiClient } from "../../../lib/api-client";
import { EmptyState, PageHeader, PageSkeleton } from "../../../components/ui/page-state";

interface Member { id: string; name: string; email: string; role: string; status: string; image_url?: string; last_active?: string; invited_by?: string; created_at?: string }
interface Team { id: string; name: string; member_count: number; member_ids: string[] }
interface MembersData { members: Member[]; invitations: Member[]; teams: Team[] }

function Avatar({ member, small = false }: { member: Member; small?: boolean }) {
  const cls = small ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-sm";
  return member.image_url
    ? <img src={member.image_url} alt="" className={`${cls} shrink-0 rounded-full border border-[#141414] object-cover`} />
    : <div className={`${cls} grid shrink-0 place-items-center rounded-full border border-[#141414] bg-stone-500/10 font-medium text-stone-300`}>
        {(member.name || member.email).slice(0, 1).toUpperCase()}
      </div>;
}

function ModalShell({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={close} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[.09] bg-[#141414] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-semibold text-white">{title}</h2>
          <button onClick={close} className="rounded-md p-1 text-stone-500 hover:bg-white/[.05] hover:text-white transition-colors"><X size={15} /></button>
        </div>
        {children}
      </div>
    </>
  );
}

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-stone-500/10 text-stone-300 border-stone-500/20",
  admin: "bg-stone-500/10 text-stone-300 border-stone-500/20",
  member: "bg-white/[.05] text-stone-400 border-white/[.07]",
  viewer: "bg-white/[.03] text-stone-600 border-white/[.05]",
};

export function MembersSettings() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"members" | "teams" | "invitations">("members");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ emails: "", role: "member" });
  const [teamOpen, setTeamOpen] = useState(false);
  const [expandedTeam, setExpandedTeam] = useState<string>();
  const [team, setTeam] = useState({ name: "", member_ids: [] as string[] });
  const [copied, setCopied] = useState(false);

  const query = useQuery({
    queryKey: ["members"],
    queryFn: () => apiClient.get<MembersData>("/settings/members"),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["members"] });

  const sendInvite = useMutation({
    mutationFn: async () => {
      const emails = invite.emails.split(/[\s,]+/).filter(e => e.includes("@"));
      await Promise.all(emails.map(email => apiClient.post("/invites", { email, role: invite.role })));
    },
    onSuccess: () => { setInvite({ emails: "", role: "member" }); setInviteOpen(false); refresh(); },
  });
  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => apiClient.patch(`/settings/members/${id}`, { role }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/settings/members/${id}`),
    onSuccess: refresh,
  });
  const createTeam = useMutation({
    mutationFn: () => apiClient.post("/settings/teams", team),
    onSuccess: () => { setTeamOpen(false); setTeam({ name: "", member_ids: [] }); refresh(); },
  });

  const data = query.data ?? { members: [], teams: [], invitations: [] };

  function copyInviteLink() {
    const workspaceId = localStorage.getItem("mondaily_workspace_id") ?? "";
    navigator.clipboard.writeText(`${window.location.origin}/invite/${workspaceId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function addToTeam(teamId: string, memberId: string) {
    qc.setQueryData<MembersData>(["members"], cur => cur ? {
      ...cur,
      teams: cur.teams.map(t => t.id === teamId
        ? { ...t, member_ids: [...t.member_ids, memberId], member_count: t.member_count + 1 }
        : t),
    } : cur);
  }

  function removeTeamMember(teamId: string, memberId: string) {
    qc.setQueryData<MembersData>(["members"], cur => cur ? {
      ...cur,
      teams: cur.teams.map(t => t.id === teamId
        ? { ...t, member_ids: t.member_ids.filter(id => id !== memberId), member_count: Math.max(0, t.member_count - 1) }
        : t),
    } : cur);
  }

  return (
    <div>
      <PageHeader title="Members & teams" description="Manage workspace access, team structure, and invitations." />

      {/* ── Toolbar ── */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-0.5 rounded-lg border border-white/[.06] bg-white/[.02] p-0.5">
          {(["members", "teams", "invitations"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm capitalize transition-colors ${tab === t ? "bg-white/[.08] text-white" : "text-stone-500 hover:text-stone-300"}`}>
              {t}
              {t === "invitations" && data.invitations.length > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-400">{data.invitations.length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {tab === "members" && (
            <>
              <button onClick={copyInviteLink}
                className="flex items-center gap-2 rounded-lg border border-white/[.08] px-3 py-2 text-sm text-stone-400 hover:bg-white/[.04] hover:text-white transition-colors">
                {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                {copied ? "Copied!" : "Copy invite link"}
              </button>
              <button onClick={() => setInviteOpen(true)}
                className="flex items-center gap-2 rounded-xl border border-stone-500/30 bg-stone-600 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-500 transition-all">
                <UserPlus size={14} /> Invite member
              </button>
            </>
          )}
          {tab === "teams" && (
            <button onClick={() => setTeamOpen(true)}
              className="flex items-center gap-2 rounded-xl border border-stone-500/30 bg-stone-600 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-500 transition-all">
              <Plus size={14} /> Create team
            </button>
          )}
        </div>
      </div>

      {query.isLoading ? <PageSkeleton rows={7} /> : (
        <>
          {/* ── Members ── */}
          {tab === "members" && (
            data.members.length ? (
              <div className="minimal-sheet overflow-x-auto">
                <table className="minimal-table min-w-[680px] text-left text-sm">
                  <thead>
                    <tr>
                      {["Member", "Role", "Last active", "Status", ""].map(h => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.members.map(m => (
                      <tr key={m.id} className="transition-colors">
                        <td>
                          <div className="flex items-center gap-3">
                            <Avatar member={m} />
                            <div>
                              <p className="font-medium text-stone-200">{m.name || m.email}</p>
                              <p className="text-xs text-stone-600">{m.email}</p>
                            </div>
                          </div>
                        </td>
                        <td>
                          <select value={m.role} disabled={m.role === "owner"}
                            onChange={e => changeRole.mutate({ id: m.id, role: e.target.value })}
                            className={`rounded-full border px-2.5 py-1 text-xs capitalize outline-none disabled:opacity-60 cursor-pointer ${ROLE_COLORS[m.role] ?? ROLE_COLORS.member} bg-transparent`}>
                            <option value="owner">Owner</option>
                            <option value="admin">Admin</option>
                            <option value="member">Member</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        </td>
                        <td className="text-sm text-stone-400 dark:text-stone-600">{m.last_active ?? "Recently"}</td>
                        <td>
                          <span className={`rounded-full px-2 py-1 text-[10px] font-medium capitalize ${m.status === "active" ? "bg-emerald-500/10 text-emerald-400" : "bg-white/[.03] text-stone-600"}`}>
                            {m.status}
                          </span>
                        </td>
                        <td className="text-right">
                          {m.role !== "owner"
                            ? <button onClick={() => remove.mutate(m.id)} className="text-xs text-stone-400 hover:text-stone-300 transition-colors">Remove</button>
                            : <MoreHorizontal size={15} className="ml-auto text-stone-700" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={Users} title="No members yet" description="Invite your first teammate to collaborate." />
            )
          )}

          {/* ── Teams ── */}
          {tab === "teams" && (
            data.teams.length ? (
              <div className="space-y-3">
                {data.teams.map(t => {
                  const tMembers = data.members.filter(m => t.member_ids.includes(m.id));
                  const isOpen = expandedTeam === t.id;
                  const available = data.members.filter(m => !t.member_ids.includes(m.id));
                  return (
                    <article key={t.id} className="settings-section">
                      <button onClick={() => setExpandedTeam(isOpen ? undefined : t.id)}
                        className="flex w-full items-center gap-3 px-4 py-4 text-left">
                        <div className="flex -space-x-2">
                          {tMembers.slice(0, 5).map(m => <Avatar key={m.id} member={m} small />)}
                          {tMembers.length === 0 && <div className="grid h-7 w-7 place-items-center rounded-full bg-white/[.05]"><Users size={12} /></div>}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-stone-200">{t.name}</p>
                          <p className="text-xs text-stone-600">{t.member_count} member{t.member_count !== 1 ? "s" : ""}</p>
                        </div>
                        <ChevronDown size={14} className={`text-stone-600 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </button>
                      {isOpen && (
                        <div className="border-t border-white/[.06] px-4 pb-4 pt-3 space-y-4">
                          <div className="space-y-1.5">
                            {tMembers.map(m => (
                              <div key={m.id} className="flex items-center gap-3 rounded-lg bg-white/[.025] px-3 py-2.5">
                                <Avatar member={m} small />
                                <span className="flex-1 text-sm text-stone-300">{m.name || m.email}</span>
                                <button onClick={() => removeTeamMember(t.id, m.id)} className="text-xs text-stone-400 hover:text-stone-300 transition-colors">Remove</button>
                              </div>
                            ))}
                            {tMembers.length === 0 && <p className="text-sm text-stone-600">No members yet.</p>}
                          </div>
                          {available.length > 0 && (
                            <div>
                              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-stone-700">Add members</p>
                              <div className="flex flex-wrap gap-1.5">
                                {available.slice(0, 8).map(m => (
                                  <button key={m.id} onClick={() => addToTeam(t.id, m.id)}
                                    className="flex items-center gap-1.5 rounded-lg border border-white/[.08] px-2.5 py-1.5 text-xs text-stone-400 hover:bg-white/[.04] hover:text-white transition-colors">
                                    <Plus size={10} /> {m.name?.split(" ")[0] || m.email}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={Users} title="No teams yet" description="Create a team to group members by function." />
            )
          )}

          {/* ── Invitations ── */}
          {tab === "invitations" && (
            data.invitations.length ? (
              <div className="minimal-sheet overflow-x-auto">
                <table className="minimal-table min-w-[620px] text-left text-sm">
                  <thead>
                    <tr>
                      {["Email", "Role", "Invited by", "Sent", "Status", ""].map(h => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.invitations.map(inv => (
                      <tr key={inv.id} className="border-b border-white/[.04] last:border-0">
                        <td className="px-4 py-3.5 text-stone-300">{inv.email}</td>
                        <td className="px-4 py-3.5 capitalize text-stone-500">{inv.role}</td>
                        <td className="px-4 py-3.5 text-stone-600">{inv.invited_by ?? "Workspace admin"}</td>
                        <td className="px-4 py-3.5 text-stone-600">{inv.created_at ? new Date(inv.created_at).toLocaleDateString() : "Recently"}</td>
                        <td>
                          <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-medium capitalize text-amber-400">{inv.status}</span>
                        </td>
                        <td>
                          <div className="flex justify-end gap-3">
                            <button onClick={() => apiClient.post("/invites", { email: inv.email, role: inv.role })}
                              className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-300 transition-colors">
                              <RefreshCw size={11} /> Resend
                            </button>
                            <button
                              onClick={async () => {
                                // Actually revoke on the server (was cache-only,
                                // so the invite reappeared on refresh).
                                await apiClient.delete(`/invites/${inv.id}`).catch(() => {});
                                qc.setQueryData<MembersData>(["members"], cur => cur
                                  ? { ...cur, invitations: cur.invitations.filter(i => i.id !== inv.id) }
                                  : cur);
                                qc.invalidateQueries({ queryKey: ["members"] });
                              }}
                              className="text-xs text-stone-400 hover:text-stone-300 transition-colors">
                              Revoke
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={UserPlus} title="No pending invitations" description="Invitations awaiting acceptance appear here." />
            )
          )}
        </>
      )}

      {/* ── Invite modal ── */}
      {inviteOpen && (
        <ModalShell title="Invite members" close={() => setInviteOpen(false)}>
          <form onSubmit={e => { e.preventDefault(); sendInvite.mutate(); }} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">Email addresses</span>
              <textarea autoFocus value={invite.emails} onChange={e => setInvite({ ...invite, emails: e.target.value })}
                placeholder="alex@company.com, sam@company.com" rows={3}
                className="key-input w-full resize-none p-3 text-sm" />
              <p className="mt-1 text-xs text-stone-600">Separate multiple emails with commas or newlines.</p>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">Role</span>
              <select value={invite.role} onChange={e => setInvite({ ...invite, role: e.target.value })}
                className="key-input h-10 w-full px-3 text-sm">
                <option value="admin">Admin — full access, manage members</option>
                <option value="member">Member — read and edit records</option>
                <option value="viewer">Viewer — read-only access</option>
              </select>
            </label>
            <button type="submit" disabled={!invite.emails.includes("@") || sendInvite.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-stone-500/30 bg-stone-600 py-2.5 text-sm font-semibold text-white hover:bg-stone-500 transition-all disabled:opacity-40">
              <UserPlus size={14} /> {sendInvite.isPending ? "Sending…" : "Send invitation"}
            </button>
          </form>
        </ModalShell>
      )}

      {/* ── Create team modal ── */}
      {teamOpen && (
        <ModalShell title="Create team" close={() => setTeamOpen(false)}>
          <form onSubmit={e => { e.preventDefault(); if (team.name.trim()) createTeam.mutate(); }} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">Team name</span>
              <input autoFocus value={team.name} onChange={e => setTeam({ ...team, name: e.target.value })}
                placeholder="e.g. Sales, Engineering, Support" className="key-input h-10 w-full px-3 text-sm" />
            </label>
            {data.members.length > 0 && (
              <div>
                <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-stone-500">Add members</span>
                <div className="max-h-48 space-y-0.5 overflow-auto rounded-lg border border-white/[.07]">
                  {data.members.map(m => (
                    <label key={m.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-white/[.03] transition-colors">
                      <input type="checkbox" checked={team.member_ids.includes(m.id)}
                        onChange={e => setTeam({ ...team, member_ids: e.target.checked ? [...team.member_ids, m.id] : team.member_ids.filter(id => id !== m.id) })}
                        className="h-4 w-4 rounded accent-red-500" />
                      <Avatar member={m} small />
                      <span className="text-sm text-stone-300">{m.name || m.email}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <button type="submit" disabled={!team.name.trim() || createTeam.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-stone-500/30 bg-stone-600 py-2.5 text-sm font-semibold text-white hover:bg-stone-500 transition-all disabled:opacity-40">
              {createTeam.isPending ? "Creating…" : "Create team"}
            </button>
          </form>
        </ModalShell>
      )}
    </div>
  );
}
