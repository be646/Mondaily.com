import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Copy, MoreHorizontal, Plus, RefreshCw, Trash2, UserPlus, Users, X } from "lucide-react";
import { useState } from "react";
import { apiClient } from "../../../lib/api-client";
import { EmptyState, PageHeader, PageSkeleton } from "../../../components/ui/page-state";

interface Member { id: string; name: string; email: string; role: string; status: string; image_url?: string; last_active?: string; invited_by?: string; created_at?: string }
interface Team { id: string; name: string; member_count: number; member_ids: string[] }
interface MembersData { members: Member[]; invitations: Member[]; teams: Team[] }

export function MembersSettings() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"members" | "teams" | "invitations">("members");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ emails: "", role: "member" });
  const [teamOpen, setTeamOpen] = useState(false);
  const [expandedTeam, setExpandedTeam] = useState<string>();
  const [team, setTeam] = useState({ name: "", member_ids: [] as string[] });
  const query = useQuery({ queryKey: ["members"], queryFn: () => apiClient.get<MembersData>("/settings/members") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["members"] });
  const sendInvite = useMutation({
    mutationFn: async () => {
      const emails = invite.emails.split(/[\s,]+/).filter((email) => email.includes("@"));
      await Promise.all(emails.map((email) => apiClient.post("/invites", { email, role: invite.role })));
    },
    onSuccess: () => { setInvite({ emails: "", role: "member" }); setInviteOpen(false); refresh(); }
  });
  const changeRole = useMutation({ mutationFn: ({ id, role }: { id: string; role: string }) => apiClient.patch(`/settings/members/${id}`, { role }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => apiClient.delete(`/settings/members/${id}`), onSuccess: refresh });
  const createTeam = useMutation({ mutationFn: () => apiClient.post("/settings/teams", team), onSuccess: () => { setTeamOpen(false); setTeam({ name: "", member_ids: [] }); refresh(); } });
  const data = query.data ?? { members: [], teams: [], invitations: [] };

  function copyInviteLink() {
    navigator.clipboard.writeText(`${window.location.origin}/invite/workspace`);
  }

  function removeTeamMember(teamId: string, memberId: string) {
    qc.setQueryData<MembersData>(["members"], (current) => current ? {
      ...current,
      teams: current.teams.map((item) => item.id === teamId ? { ...item, member_ids: item.member_ids.filter((id) => id !== memberId), member_count: Math.max(0, item.member_count - 1) } : item)
    } : current);
  }

  return (
    <div>
      <PageHeader title="Members & teams" description="Manage workspace access, team structure, and invitations." />
      <div className="mb-5 flex items-center justify-between">
        <div className="flex gap-0.5 rounded-lg border border-white/[.06] bg-white/[.02] p-0.5">{(["members", "teams", "invitations"] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`rounded-md px-3 py-1.5 text-sm capitalize transition-colors ${tab === item ? "bg-white/[.08] text-white" : "text-slate-500 hover:text-slate-300"}`}>{item}</button>)}</div>
        {tab === "members" ? <div className="flex gap-2"><button onClick={copyInviteLink} className="flex items-center gap-2 rounded-md border border-white/[.06] px-3 py-2 text-sm"><Copy size={13} /> Copy link</button><button onClick={() => setInviteOpen(true)} className="flex items-center gap-2 rounded-lg border-x border-t border-red-500/40 border-b-[3px] border-b-red-700 bg-red-500 px-3 py-2 text-sm font-semibold text-white hover:bg-red-400 active:translate-y-[1px] transition-all"><UserPlus size={14} /> Invite member</button></div> : tab === "teams" ? <button onClick={() => setTeamOpen(true)} className="flex items-center gap-2 rounded-lg border-x border-t border-red-500/40 border-b-[3px] border-b-red-700 bg-red-500 px-3 py-2 text-sm font-semibold text-white hover:bg-red-400 active:translate-y-[1px] transition-all"><Plus size={14} /> Create team</button> : null}
      </div>

      {query.isLoading ? <PageSkeleton rows={7} /> : tab === "members" ? (
        data.members.length ? <div className="overflow-x-auto rounded-xl border border-white/[.07]"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-white/[.03] text-xs text-slate-500"><tr><th className="p-3">Member</th><th className="p-3">Role</th><th className="p-3">Last active</th><th className="p-3">Status</th><th className="p-3" /></tr></thead><tbody>{data.members.map((member) => <tr key={member.id} className="border-t border-white/[.06]"><td className="p-3"><div className="flex items-center gap-3"><Avatar member={member} /><div><p>{member.name || member.email}</p><p className="text-xs text-slate-500">{member.email}</p></div></div></td><td className="p-3"><select value={member.role} disabled={member.role === "owner"} onChange={(event) => changeRole.mutate({ id: member.id, role: event.target.value })} className="rounded-md border border-white/[.06] bg-[#0d0f13] px-2 py-1.5 text-xs outline-none disabled:opacity-50"><option value="owner">Owner</option><option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option></select></td><td className="p-3 text-slate-500">{member.last_active ?? "Recently"}</td><td className="p-3 capitalize text-slate-500">{member.status}</td><td className="p-3 text-right">{member.role !== "owner" ? <button onClick={() => remove.mutate(member.id)} className="text-xs text-red-400">Remove</button> : <MoreHorizontal size={15} className="ml-auto text-slate-600" />}</td></tr>)}</tbody></table></div> : <EmptyState icon={Users} title="No members" description="Invite your first teammate to collaborate." />
      ) : tab === "teams" ? (
        data.teams.length ? <div className="space-y-3">{data.teams.map((item) => {
          const members = data.members.filter((member) => item.member_ids.includes(member.id));
          const open = expandedTeam === item.id;
          return <article key={item.id} className="rounded-xl border border-white/[.07]">
            <button onClick={() => setExpandedTeam(open ? undefined : item.id)} className="flex w-full items-center gap-3 p-4 text-left"><div className="flex -space-x-2">{members.slice(0, 5).map((member) => <Avatar key={member.id} member={member} small />)}{members.length === 0 ? <div className="grid h-8 w-8 place-items-center rounded-full bg-white/5"><Users size={13} /></div> : null}</div><div className="flex-1"><p className="text-sm font-medium">{item.name}</p><p className="text-xs text-slate-500">{item.member_count} members</p></div><ChevronDown size={14} className={open ? "rotate-180" : ""} /></button>
            {open ? <div className="border-t border-white/[.06] p-4">{members.length ? <div className="space-y-2">{members.map((member) => <div key={member.id} className="flex items-center gap-3 rounded-md bg-white/[.03] p-3"><Avatar member={member} small /><span className="flex-1 text-sm">{member.name || member.email}</span><button onClick={() => removeTeamMember(item.id, member.id)} className="text-xs text-red-400">Remove</button></div>)}</div> : <p className="text-sm text-slate-500">No members in this team yet.</p>}<div className="mt-3 flex flex-wrap gap-2">{data.members.filter((member) => !item.member_ids.includes(member.id)).slice(0, 4).map((member) => <button key={member.id} onClick={() => qc.setQueryData<MembersData>(["members"], (current) => current ? { ...current, teams: current.teams.map((teamItem) => teamItem.id === item.id ? { ...teamItem, member_ids: [...teamItem.member_ids, member.id], member_count: teamItem.member_count + 1 } : teamItem) } : current)} className="rounded-md border border-white/[.06] px-2 py-1 text-xs">+ {member.name || member.email}</button>)}</div></div> : null}
          </article>;
        })}</div> : <EmptyState icon={Users} title="No teams" description="Create a team and group members by function." />
      ) : data.invitations.length ? <div className="overflow-x-auto rounded-xl border border-white/[.07]"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-white/[.03] text-xs text-slate-500"><tr><th className="p-3">Email</th><th className="p-3">Role</th><th className="p-3">Invited by</th><th className="p-3">Sent</th><th className="p-3">Status</th><th className="p-3" /></tr></thead><tbody>{data.invitations.map((item) => <tr key={item.id} className="border-t border-white/[.06]"><td className="p-3">{item.email}</td><td className="p-3 capitalize">{item.role}</td><td className="p-3 text-slate-500">{item.invited_by ?? "Workspace admin"}</td><td className="p-3 text-slate-500">{item.created_at ? new Date(item.created_at).toLocaleDateString() : "Recently"}</td><td className="p-3"><span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs capitalize text-amber-400">{item.status}</span></td><td className="p-3"><div className="flex justify-end gap-3"><button onClick={() => apiClient.post("/invites", { email: item.email, role: item.role })} className="flex items-center gap-1 text-xs text-slate-400"><RefreshCw size={11} /> Resend</button><button onClick={() => qc.setQueryData<MembersData>(["members"], (current) => current ? { ...current, invitations: current.invitations.filter((inviteItem) => inviteItem.id !== item.id) } : current)} className="text-xs text-red-400">Revoke</button></div></td></tr>)}</tbody></table></div> : <EmptyState icon={UserPlus} title="No pending invitations" description="Invitations awaiting acceptance will appear here." />}

      {inviteOpen ? <Modal title="Invite members" close={() => setInviteOpen(false)}><form onSubmit={(event) => { event.preventDefault(); sendInvite.mutate(); }}><label className="text-sm">Email addresses<textarea value={invite.emails} onChange={(event) => setInvite({ ...invite, emails: event.target.value })} placeholder="alex@company.com, sam@company.com" className="key-input mt-2 min-h-24 w-full p-3" /></label><label className="mt-4 block text-sm">Role<select value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-white/[.06] bg-[#0d0f13] px-3 text-white outline-none"><option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option></select></label><button disabled={!invite.emails.includes("@")} className="mt-5 h-10 w-full rounded-lg border-x border-t border-red-500/40 border-b-[3px] border-b-red-700 bg-red-500 text-sm font-semibold text-white hover:bg-red-400 active:translate-y-[1px] transition-all disabled:opacity-40">Send invitations</button></form></Modal> : null}
      {teamOpen ? <Modal title="Create team" close={() => setTeamOpen(false)}><form onSubmit={(event) => { event.preventDefault(); if (team.name.trim()) createTeam.mutate(); }}><input value={team.name} onChange={(event) => setTeam({ ...team, name: event.target.value })} placeholder="Team name" className="key-input h-10 w-full" /><p className="mb-2 mt-4 text-xs text-slate-500">Add members</p><div className="max-h-48 space-y-2 overflow-auto">{data.members.map((member) => <label key={member.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={team.member_ids.includes(member.id)} onChange={(event) => setTeam({ ...team, member_ids: event.target.checked ? [...team.member_ids, member.id] : team.member_ids.filter((id) => id !== member.id) })} />{member.name || member.email}</label>)}</div><button className="mt-5 h-10 w-full rounded-lg border-x border-t border-red-500/40 border-b-[3px] border-b-red-700 bg-red-500 text-sm font-semibold text-white hover:bg-red-400 active:translate-y-[1px] transition-all">Create team</button></form></Modal> : null}
    </div>
  );
}

function Avatar({ member, small = false }: { member: Member; small?: boolean }) {
  const size = small ? "h-8 w-8 text-xs" : "h-9 w-9 text-sm";
  return member.image_url ? <img src={member.image_url} alt="" className={`${size} rounded-full border border-[#0d0f13] object-cover`} /> : <div className={`${size} grid place-items-center rounded-full border border-[#0d0f13] bg-red-500/10 font-medium text-red-300`}>{(member.name || member.email).slice(0, 1).toUpperCase()}</div>;
}

function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-[2px] p-6"><div className="w-full max-w-md rounded-2xl border border-white/[.09] bg-[#0d0f13] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.7)]"><div className="mb-5 flex items-center justify-between"><h2 className="font-medium">{title}</h2><button onClick={close} aria-label="Close"><X size={16} /></button></div>{children}</div></div>;
}
