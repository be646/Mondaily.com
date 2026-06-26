import { useOrganization } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, Building2, Check, Download, Globe, ImagePlus, Shield, Trash2, Users, X, Zap, Plus, Copy, CheckCircle2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../../lib/api-client";
import { PageSkeleton } from "../../../components/ui/page-state";
import { useWorkspaceMembers, type WorkspaceMember } from "../../../hooks/useModules";

interface WorkspaceData {
  name: string;
  timezone: string;
  slug?: string;
  currency?: string;
  logo_url?: string;
  modules?: string[];
}

interface InviteResult {
  invite_link?: string;
}

const AVAILABLE_MODULES = [
  { id: "finance", label: "Finance & Billing", description: "Invoices, credit notes, payments, approval workflows" },
  { id: "investments", label: "Investments", description: "Track investment portfolios, rounds, and returns" },
  { id: "hr", label: "HR & People Ops", description: "Headcount, contracts, onboarding workflows" },
];

const timezones = [
  "UTC", "Europe/London", "Europe/Paris", "Europe/Warsaw",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
];
const currencies = ["USD", "GBP", "EUR", "CAD", "AUD", "PLN", "AED", "SGD", "JPY"];

const FINANCE_ROLE_OPTIONS: { value: WorkspaceMember["finance_role"]; label: string }[] = [
  { value: "none",     label: "None" },
  { value: "viewer",   label: "Viewer" },
  { value: "member",   label: "Member" },
  { value: "reviewer", label: "Reviewer" },
  { value: "approver", label: "Approver" },
];

type Section = "general" | "members" | "modules" | "finance" | "danger";

interface NavItem {
  key: Section;
  label: string;
  icon: React.ElementType;
  danger?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { key: "general",  label: "General",        icon: Building2 },
  { key: "members",  label: "Members & Roles", icon: Users },
  { key: "modules",  label: "Modules",         icon: Zap },
  { key: "finance",  label: "Finance Access",  icon: Shield },
  { key: "danger",   label: "Danger Zone",     icon: AlertCircle, danger: true },
];

// ─── General ─────────────────────────────────────────────────────────────────

function GeneralSection({
  form, setForm, save, saved, organization, logoPreview, onUploadLogo, logoRef,
}: {
  form: WorkspaceData;
  setForm: (f: WorkspaceData) => void;
  save: { mutate: () => void; isPending: boolean };
  saved: boolean;
  organization: ReturnType<typeof useOrganization>["organization"];
  logoPreview: string;
  onUploadLogo: (file?: File) => void;
  logoRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-white mb-0.5">General</h2>
        <p className="text-[11px] text-stone-500">Workspace identity and regional settings.</p>
      </div>

      {/* Logo */}
      <div className="flex items-center gap-4">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/[.08] bg-white/[.03]">
          {logoPreview || organization?.imageUrl
            ? <img src={logoPreview || organization?.imageUrl} alt="" className="h-full w-full object-cover" />
            : <span className="text-xl font-bold text-stone-400">{(form.name || "W").slice(0, 1).toUpperCase()}</span>}
        </div>
        <div>
          <button
            onClick={() => logoRef.current?.click()}
            className="flex items-center gap-2 rounded-lg border border-white/[.09] px-3 py-2 text-[12px] text-stone-300 hover:bg-white/[.04] hover:text-white transition-colors"
          >
            <ImagePlus size={13} /> Upload logo
          </button>
          <p className="mt-1.5 text-[11px] text-stone-600">Square PNG or JPG, at least 256×256px.</p>
        </div>
        <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => onUploadLogo(e.target.files?.[0])} />
      </div>

      {/* Fields */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[11px] text-stone-400">Workspace name</span>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="key-input h-9 w-full px-3 text-[12px]" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] text-stone-400">Workspace URL</span>
          <div className="flex h-9 items-center rounded-lg border border-white/[.09] bg-white/[.03]">
            <span className="border-r border-white/[.07] px-3 text-[11px] text-stone-600">app.mondaily.com/</span>
            <input
              value={form.slug ?? ""}
              onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
              className="min-w-0 flex-1 bg-transparent px-3 text-[12px] outline-none text-stone-200"
            />
          </div>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] text-stone-400">Default currency</span>
          <select value={form.currency ?? "USD"} onChange={e => setForm({ ...form, currency: e.target.value })}
            className="key-input h-9 w-full px-3 text-[12px]">
            {currencies.map(c => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] text-stone-400">Default timezone</span>
          <select value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })}
            className="key-input h-9 w-full px-3 text-[12px]">
            {timezones.map(tz => <option key={tz}>{tz}</option>)}
          </select>
        </label>
      </div>

      <div className="flex justify-end">
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-[12px] font-semibold text-white transition-all disabled:opacity-50 ${
            saved
              ? "bg-emerald-600 border border-emerald-500/30"
              : "border border-stone-400/40 bg-stone-500 hover:bg-stone-400"
          }`}>
          {saved ? <><Check size={13} /> Saved</> : save.isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

// ─── Members ─────────────────────────────────────────────────────────────────

interface MemberRecord { id: string; email: string; name?: string; role: string; finance_role?: string }
interface InviteRecord { id: string; email: string; role: string; created_at?: string }
interface MembersPayload { members: MemberRecord[]; invitations: InviteRecord[] }

function MembersSection() {
  const qc = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteLink, setInviteLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [inviting, setInviting] = useState(false);

  const { data, isLoading } = useQuery<MembersPayload>({
    queryKey: ["ws-members-full"],
    queryFn: () => apiClient.get("/workspace/members-full"),
    staleTime: 30_000,
  });

  async function sendInvite() {
    if (!inviteEmail.includes("@")) return;
    setInviting(true);
    try {
      const res = await apiClient.post<InviteResult>("/invites", { email: inviteEmail, role: inviteRole });
      if (res?.invite_link) setInviteLink(res.invite_link);
      setInviteEmail("");
      qc.invalidateQueries({ queryKey: ["ws-members-full"] });
    } finally {
      setInviting(false);
    }
  }

  async function cancelInvite(id: string) {
    await apiClient.delete(`/invites/${id}`);
    qc.invalidateQueries({ queryKey: ["ws-members-full"] });
  }

  async function changeRole(id: string, role: string) {
    await apiClient.patch(`/workspace/members/${id}/role`, { role });
    qc.invalidateQueries({ queryKey: ["ws-members-full"] });
  }

  async function changeFinanceRole(id: string, finance_role: string) {
    await apiClient.patch(`/workspace/members/${id}/finance-role`, { finance_role });
    qc.invalidateQueries({ queryKey: ["ws-members-full"] });
  }

  async function removeMember(id: string) {
    await apiClient.delete(`/workspace/members/${id}`);
    qc.invalidateQueries({ queryKey: ["ws-members-full"] });
  }

  function copyLink() {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const members = data?.members ?? [];
  const invitations = data?.invitations ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-white mb-0.5">Members & Roles</h2>
        <p className="text-[11px] text-stone-500">Manage workspace access and permissions.</p>
      </div>

      {/* Invite */}
      <div className="premium-panel p-4">
        <p className="text-[11px] text-stone-400 mb-3">Invite someone</p>
        <div className="flex gap-2">
          <input
            className="key-input flex-1 text-[12px]"
            type="email"
            placeholder="colleague@company.com"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendInvite()}
          />
          <select className="key-input w-28 text-[12px]" value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            onClick={sendInvite}
            disabled={inviting || !inviteEmail.includes("@")}
            className="px-3 py-2 bg-stone-500 hover:bg-stone-600 text-white text-[12px] rounded-lg font-medium flex items-center gap-1.5 disabled:opacity-50"
          >
            <Plus size={13} /> Send
          </button>
        </div>
        {inviteLink && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/[.06] border border-emerald-500/20">
            <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
            <span className="text-[11px] text-emerald-400 flex-1 truncate">{inviteLink}</span>
            <button onClick={copyLink} className="text-[11px] text-stone-400 hover:text-white flex items-center gap-1">
              {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
      </div>

      {/* Members table */}
      {isLoading ? <PageSkeleton rows={4} /> : (
        <div className="minimal-sheet overflow-hidden">
          <table className="minimal-table text-left text-[12px]">
            <thead>
              <tr className="border-b border-stone-200 dark:border-stone-800 bg-white/[.015]">
                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-stone-600">Member</th>
                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-stone-600">Workspace Role</th>
                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-stone-600">Finance Role</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.id} className="border-b border-white/[.04] last:border-0 hover:bg-white/[.015] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-full bg-stone-700 flex items-center justify-center text-[11px] font-semibold text-stone-200 shrink-0">
                        {(m.name || m.email).slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-stone-200">{m.name || m.email}</p>
                        {m.name && <p className="text-[11px] text-stone-600">{m.email}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={m.role}
                      disabled={m.role === "owner"}
                      onChange={e => changeRole(m.id, e.target.value)}
                      className="key-input h-7 px-2 text-[11px] capitalize disabled:opacity-60"
                    >
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                      <option value="guest">Guest</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    {["admin", "owner"].includes(m.role) ? (
                      <span className="text-[11px] text-stone-600 italic">auto (approver)</span>
                    ) : (
                      <select
                        value={m.finance_role ?? "none"}
                        onChange={e => changeFinanceRole(m.id, e.target.value)}
                        className="key-input h-7 px-2 text-[11px]"
                      >
                        {FINANCE_ROLE_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {m.role !== "owner" && (
                      <button onClick={() => removeMember(m.id)} className="text-stone-600 hover:text-stone-400 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pending invites */}
      {invitations.length > 0 && (
        <div>
          <p className="text-[11px] text-stone-500 mb-2">Pending Invites</p>
          <div className="rounded-xl border border-white/[.06] overflow-hidden">
            {invitations.map(inv => (
              <div key={inv.id} className="flex items-center justify-between px-4 py-2.5 border-b border-white/[.04] last:border-0">
                <div className="flex items-center gap-2.5">
                  <div className="h-6 w-6 rounded-full bg-stone-800 flex items-center justify-center text-[10px] text-stone-500">
                    {inv.email.slice(0, 1).toUpperCase()}
                  </div>
                  <span className="text-[12px] text-stone-300">{inv.email}</span>
                  <span className="text-[11px] text-stone-600 capitalize">{inv.role}</span>
                </div>
                <button onClick={() => cancelInvite(inv.id)} className="text-stone-600 hover:text-stone-400 transition-colors">
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Modules ─────────────────────────────────────────────────────────────────

function ModulesSection({
  form, setForm, save, saved,
}: {
  form: WorkspaceData;
  setForm: (f: WorkspaceData) => void;
  save: { mutate: () => void; isPending: boolean };
  saved: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white mb-0.5">Modules</h2>
        <p className="text-[11px] text-stone-500">Enable or disable product modules for your workspace.</p>
      </div>

      {AVAILABLE_MODULES.map(mod => {
        const enabled = (form.modules ?? ["crm"]).includes(mod.id);
        return (
          <div key={mod.id} className="flex items-center justify-between rounded-xl border border-white/[.06] bg-white/[.02] px-4 py-3">
            <div>
              <p className="text-[12px] font-medium text-white">{mod.label}</p>
              <p className="text-[11px] text-stone-500 mt-0.5">{mod.description}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                const current = form.modules ?? ["crm"];
                const next = enabled
                  ? current.filter(m => m !== mod.id)
                  : [...current, mod.id];
                setForm({ ...form, modules: next });
              }}
              className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${enabled ? "bg-stone-500" : "bg-white/[.10]"}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`} />
            </button>
          </div>
        );
      })}

      <div className="flex justify-end pt-2">
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-[12px] font-semibold text-white transition-all disabled:opacity-50 ${
            saved
              ? "bg-emerald-600 border border-emerald-500/30"
              : "border border-stone-400/40 bg-stone-500 hover:bg-stone-400"
          }`}>
          {saved ? <><Check size={13} /> Saved</> : save.isPending ? "Saving…" : "Save modules"}
        </button>
      </div>
    </div>
  );
}

// ─── Finance Access ───────────────────────────────────────────────────────────

function FinanceAccessSection({ hasFinance }: { hasFinance: boolean }) {
  const qc = useQueryClient();
  const { data: members = [], isLoading } = useWorkspaceMembers();
  const [saving, setSaving] = useState<string | null>(null);

  async function setFinanceRole(userId: string, finance_role: string) {
    setSaving(userId);
    try {
      await apiClient.patch(`/workspace/members/${userId}/finance-role`, { finance_role });
      qc.invalidateQueries({ queryKey: ["workspace-members"] });
    } finally {
      setSaving(null);
    }
  }

  if (!hasFinance) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white mb-0.5">Finance Access</h2>
          <p className="text-[11px] text-stone-500">Enable the Finance module first to manage finance roles.</p>
        </div>
        <div className="rounded-xl border border-white/[.06] bg-white/[.02] px-4 py-8 text-center">
          <Globe size={20} className="text-stone-600 mx-auto mb-2" />
          <p className="text-[12px] text-stone-500">Finance module is not enabled</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white mb-0.5">Finance Access</h2>
        <p className="text-[11px] text-stone-500">Control each member's access to Finance &amp; Billing features.</p>
      </div>

      {isLoading ? <PageSkeleton rows={3} /> : (
        <div className="minimal-sheet overflow-hidden">
          <table className="minimal-table text-[12px]">
            <thead>
              <tr className="border-b border-stone-200 dark:border-stone-800 bg-white/[.015]">
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-stone-600">Member</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-stone-600">Workspace Role</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-stone-600">Finance Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
              {members.map(m => (
                <tr key={m.user_id} className="hover:bg-white/[.01]">
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-full bg-stone-700 flex items-center justify-center text-[11px] font-semibold text-stone-200">
                        {m.user_id.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-stone-300 font-mono text-[11px]">{m.user_id.slice(0, 12)}…</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="inline-flex items-center rounded-full bg-white/[.05] border border-white/[.06] px-2 py-0.5 text-[11px] text-stone-400 capitalize">
                      {m.role}
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    {["admin", "owner"].includes(m.role) ? (
                      <span className="text-[11px] text-stone-600 italic">auto (approver)</span>
                    ) : (
                      <select
                        value={m.finance_role ?? "none"}
                        disabled={saving === m.user_id}
                        onChange={e => setFinanceRole(m.user_id, e.target.value)}
                        className="key-input h-8 px-2 text-[11px] disabled:opacity-50"
                      >
                        {FINANCE_ROLE_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Danger Zone ──────────────────────────────────────────────────────────────

function DangerZoneSection({ form, organization }: { form: WorkspaceData; organization: ReturnType<typeof useOrganization>["organization"] }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  function exportData() {
    const blob = new Blob([JSON.stringify({ workspace: form, exported_at: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${form.slug || "workspace"}-export.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function deleteWorkspace() {
    if (deleteText !== form.name || !organization) return;
    await organization.destroy();
    window.location.assign("/workspaces");
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-stone-400 mb-0.5">Danger Zone</h2>
        <p className="text-[11px] text-stone-500">Irreversible actions. Proceed with caution.</p>
      </div>

      <div className="border border-stone-500/20 rounded-xl p-6 space-y-4">
        <p className="text-[12px] text-stone-500">Export a portable copy of all workspace data, or permanently delete this workspace.</p>
        <div className="flex flex-wrap gap-3">
          <button onClick={exportData}
            className="flex items-center gap-2 rounded-lg border border-white/[.09] px-3 py-2 text-[12px] text-stone-300 hover:bg-white/[.04] hover:text-white transition-colors">
            <Download size={13} /> Export all data
          </button>
          <button onClick={() => setDeleteOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-stone-500/30 px-3 py-2 text-[12px] text-stone-400 hover:bg-stone-500/[.08] transition-colors">
            <Trash2 size={13} /> Delete workspace
          </button>
        </div>
      </div>

      {deleteOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={() => setDeleteOpen(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[.09] bg-[#141414] p-6 shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-semibold text-white">Delete {form.name}</h2>
              <button onClick={() => setDeleteOpen(false)} className="text-stone-500 hover:text-white transition-colors"><X size={15} /></button>
            </div>
            <p className="text-[12px] text-stone-500">All records, members, and activity in this workspace will be permanently removed. This cannot be undone. Type the workspace name to confirm.</p>
            <input value={deleteText} onChange={e => setDeleteText(e.target.value)} placeholder={form.name} className="key-input mt-4 h-10 w-full px-3 text-[12px]" />
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDeleteOpen(false)} className="rounded-lg border border-white/[.08] px-4 py-2 text-[12px] text-stone-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={deleteWorkspace} disabled={deleteText !== form.name} className="rounded-lg bg-stone-600 px-4 py-2 text-[12px] font-semibold text-white hover:bg-stone-500 disabled:opacity-40 transition-colors">Delete workspace</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function WorkspaceSettings() {
  const { organization } = useOrganization();
  const qc = useQueryClient();
  const logoRef = useRef<HTMLInputElement>(null);
  const [section, setSection] = useState<Section>("general");

  const query = useQuery({
    queryKey: ["workspace-settings"],
    queryFn: () => apiClient.get<WorkspaceData>("/settings/workspace"),
  });
  const [form, setForm] = useState<WorkspaceData>({ name: "", slug: "", currency: "USD", timezone: "UTC", modules: ["crm"] });
  const [logoPreview, setLogoPreview] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (query.data) setForm({
      ...query.data,
      slug: query.data.slug ?? organization?.slug ?? "",
      currency: query.data.currency ?? "USD",
      modules: query.data.modules ?? ["crm"],
    });
  }, [organization?.slug, query.data]);

  const save = useMutation({
    mutationFn: async () => {
      await organization?.update({ name: form.name, slug: form.slug || undefined });
      return apiClient.patch("/settings/workspace", form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace-settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  async function uploadLogo(file?: File) {
    if (!file || !organization) return;
    setLogoPreview(URL.createObjectURL(file));
    await organization.setLogo({ file });
  }

  if (query.isLoading) return <PageSkeleton rows={6} />;

  const hasFinance = (form.modules ?? ["crm"]).includes("finance");

  return (
    <div className="flex gap-8">
      {/* Left sidebar */}
      <div className="w-48 shrink-0 pt-1">
        {NAV_ITEMS.map(item => (
          <button
            key={item.key}
            onClick={() => setSection(item.key)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] mb-0.5 transition-colors ${
              section === item.key ? "bg-white/[.05] text-stone-200" : "text-stone-500 hover:text-stone-300 hover:bg-white/[.03]"
            } ${item.danger ? (section === item.key ? "text-stone-400" : "text-red-500 hover:text-stone-400") : ""}`}
          >
            <item.icon size={13} />
            {item.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {section === "general" && (
          <GeneralSection
            form={form}
            setForm={setForm}
            save={save}
            saved={saved}
            organization={organization}
            logoPreview={logoPreview}
            onUploadLogo={uploadLogo}
            logoRef={logoRef}
          />
        )}
        {section === "members" && <MembersSection />}
        {section === "modules" && (
          <ModulesSection form={form} setForm={setForm} save={save} saved={saved} />
        )}
        {section === "finance" && <FinanceAccessSection hasFinance={hasFinance} />}
        {section === "danger" && <DangerZoneSection form={form} organization={organization} />}
      </div>
    </div>
  );
}
