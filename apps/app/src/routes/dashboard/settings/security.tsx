import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, LockKeyhole, Plus, Shield, Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { apiClient } from "../../../lib/api-client";
import { EmptyState, PageHeader, PageSkeleton } from "../../../components/ui/page-state";

interface Session { id: string; device: string; browser?: string; location: string; ip?: string; last_active?: string; current: boolean }
interface AuditEntry { id: string; actor: string; action: string; target: string; timestamp: string; ip?: string }
interface SecurityData {
  saml_enabled: boolean;
  saml_domain?: string;
  saml_provider?: string;
  saml_metadata?: string;
  enforce_sso?: boolean;
  export_restricted: boolean;
  protected_recipients: string[];
  sessions: Session[];
  access_controls?: Record<string, { export: boolean; api: boolean }>;
  audit_log?: AuditEntry[];
}

const defaultControls = {
  viewer: { export: false, api: false },
  member: { export: false, api: false },
  admin: { export: true, api: true },
  owner: { export: true, api: true }
};

export function SecuritySettings() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["security"], queryFn: () => apiClient.get<SecurityData>("/settings/security") });
  const [data, setData] = useState<SecurityData>({ saml_enabled: false, export_restricted: false, protected_recipients: [], sessions: [] });
  const [domain, setDomain] = useState("");
  const [copied, setCopied] = useState("");
  useEffect(() => { if (query.data) setData({ ...query.data, access_controls: query.data.access_controls ?? defaultControls }); }, [query.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["security"] });
  const update = useMutation({ mutationFn: (body: Partial<SecurityData>) => apiClient.patch("/settings/security", body), onSuccess: refresh });
  const revoke = useMutation({ mutationFn: (id: string) => apiClient.delete(`/settings/security/sessions/${id}`), onSuccess: refresh });

  function save(patch: Partial<SecurityData>) {
    const next = { ...data, ...patch };
    setData(next);
    update.mutate(patch);
  }
  function copy(label: string, value: string) {
    navigator.clipboard.writeText(value);
    setCopied(label);
  }
  function addDomain() {
    const value = domain.trim().replace(/^@/, "").toLowerCase();
    if (!value || data.protected_recipients.includes(value)) return;
    save({ protected_recipients: [...data.protected_recipients, value] });
    setDomain("");
  }

  if (query.isLoading) return <PageSkeleton rows={9} />;
  const entityId = "https://api.mondaily.com/saml/metadata";
  const acsUrl = "https://api.mondaily.com/saml/callback";
  return (
    <div>
      <PageHeader title="Security" description="Authentication, active sessions, recipient protection, and audit controls." />
      <section className="mb-5 rounded-xl border border-white/[.07] p-5">
        <div className="mb-2 flex items-center gap-2"><Shield size={15} /><h2 className="text-sm font-medium">Single Sign-On</h2><span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-300">Enterprise</span><span className={`ml-auto rounded-full px-2 py-1 text-xs ${data.saml_enabled ? "bg-emerald-500/10 text-emerald-400" : "bg-white/5 text-slate-500"}`}>{data.saml_enabled ? "Configured" : "Not configured"}</span></div>
        <p className="mb-4 text-sm text-slate-500">Configure SAML 2.0 with your identity provider.</p>
        <label className="block text-sm">Provider<select value={data.saml_provider ?? "okta"} onChange={(event) => setData({ ...data, saml_provider: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-white/[.06] bg-[#0d0f13] px-3 text-white outline-none"><option value="okta">Okta</option><option value="azure">Azure AD</option><option value="google">Google Workspace</option><option value="other">Other SAML 2.0</option></select></label>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><CopyField label="SP Entity ID" value={entityId} copied={copied === "entity"} copy={() => copy("entity", entityId)} /><CopyField label="ACS URL" value={acsUrl} copied={copied === "acs"} copy={() => copy("acs", acsUrl)} /></div>
        <label className="mt-4 block text-sm">IdP metadata URL or XML<textarea value={data.saml_metadata ?? ""} onChange={(event) => setData({ ...data, saml_metadata: event.target.value })} placeholder="https://idp.example.com/metadata or paste XML" className="key-input mt-2 min-h-24 w-full p-3 text-xs" /></label>
        <div className="mt-4 flex flex-wrap items-center gap-3"><button onClick={() => save({ saml_enabled: true, saml_provider: data.saml_provider, saml_metadata: data.saml_metadata })} className="rounded-md bg-red-600 px-3 py-2 text-sm">{data.saml_enabled ? "Update SSO" : "Configure SSO"}</button><button className="rounded-md border border-white/[.06] px-3 py-2 text-sm">Test SSO</button><label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={data.enforce_sso ?? false} onChange={(event) => save({ enforce_sso: event.target.checked })} /> Enforce SSO</label></div>
      </section>

      <section className="mb-5 rounded-xl border border-white/[.07] p-5">
        <div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-medium"><Smartphone size={15} /> Active sessions</h2><button onClick={() => Promise.all(data.sessions.filter((session) => !session.current).map((session) => revoke.mutateAsync(session.id)))} className="text-xs text-red-400">Revoke all other sessions</button></div>
        {data.sessions.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="pb-2">Device</th><th className="pb-2">Browser</th><th className="pb-2">Location</th><th className="pb-2">IP</th><th className="pb-2">Last active</th><th /></tr></thead><tbody>{data.sessions.map((session) => <tr key={session.id} className={`border-t border-white/[.06] ${session.current ? "bg-emerald-500/[.03]" : ""}`}><td className="py-3">{session.device}{session.current ? <span className="ml-2 text-xs text-emerald-400">Current</span> : null}</td><td className="text-slate-500">{session.browser ?? "Browser"}</td><td className="text-slate-500">{session.location}</td><td className="text-slate-500">{session.ip ?? "Hidden"}</td><td className="text-slate-500">{session.last_active ?? "Now"}</td><td className="text-right">{!session.current ? <button onClick={() => revoke.mutate(session.id)} className="text-xs text-red-400">Revoke</button> : null}</td></tr>)}</tbody></table></div> : <EmptyState icon={Smartphone} title="No active sessions" description="Signed-in devices will appear here." />}
      </section>

      <section className="mb-5 rounded-xl border border-white/[.07] p-5">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium"><LockKeyhole size={15} /> Protected recipients</h2>
        <p className="mb-4 text-sm text-slate-500">Prevent sequences from emailing protected domains.</p>
        <div className="mb-3 flex flex-wrap gap-2">{data.protected_recipients.map((item) => <span key={item} className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-xs">{item}<button onClick={() => save({ protected_recipients: data.protected_recipients.filter((value) => value !== item) })}><X size={11} /></button></span>)}</div>
        <form onSubmit={(event) => { event.preventDefault(); addDomain(); }} className="flex gap-2"><input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="competitor.com" className="key-input h-9 flex-1" /><button className="flex items-center gap-1 rounded-md border border-white/[.06] px-3 text-sm"><Plus size={13} /> Add domain</button></form>
        <div className="mt-3 flex gap-2 text-xs text-slate-500">Presets: {["gmail.com", "hotmail.com"].map((preset) => <button key={preset} onClick={() => { setDomain(preset); }} className="rounded border border-white/[.06] px-2 py-1">{preset}</button>)}</div>
      </section>

      <section className="mb-5 rounded-xl border border-white/[.07] p-5">
        <h2 className="mb-4 text-sm font-medium">Data & export controls</h2>
        <div className="grid grid-cols-[1fr_80px_80px] gap-y-3 text-sm"><span className="text-xs text-slate-500">Role</span><span className="text-center text-xs text-slate-500">CSV export</span><span className="text-center text-xs text-slate-500">API access</span>{Object.entries(data.access_controls ?? defaultControls).map(([role, controls]) => <div key={role} className="contents"><span className="capitalize">{role}</span>{(["export", "api"] as const).map((key) => <label key={key} className="flex justify-center"><input type="checkbox" checked={controls[key]} onChange={(event) => save({ access_controls: { ...(data.access_controls ?? defaultControls), [role]: { ...controls, [key]: event.target.checked } } })} /></label>)}</div>)}</div>
      </section>

      <section className="rounded-xl border border-white/[.07] p-5">
        <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><h2 className="text-sm font-medium">Audit log</h2><span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-300">Enterprise</span></div><button className="flex items-center gap-1 text-xs text-red-400"><Download size={12} /> Export CSV</button></div>
        {(data.audit_log ?? []).length ? <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="pb-2">Actor</th><th className="pb-2">Action</th><th className="pb-2">Target</th><th className="pb-2">Timestamp</th><th className="pb-2">IP</th></tr></thead><tbody>{data.audit_log?.map((entry) => <tr key={entry.id} className="border-t border-white/[.06]"><td className="py-3">{entry.actor}</td><td>{entry.action}</td><td className="text-slate-500">{entry.target}</td><td className="text-slate-500">{entry.timestamp}</td><td className="text-slate-500">{entry.ip ?? "-"}</td></tr>)}</tbody></table></div> : <EmptyState icon={Shield} title="No audit events" description="Administrative actions will appear here." />}
      </section>
    </div>
  );
}

function CopyField({ label, value, copied, copy }: { label: string; value: string; copied: boolean; copy: () => void }) {
  return <label className="text-xs text-slate-500">{label}<div className="mt-1 flex h-10 items-center rounded-md border border-white/[.06] px-3"><code className="min-w-0 flex-1 truncate text-xs text-white">{value}</code><button onClick={copy} className="text-slate-500" aria-label={`Copy ${label}`}>{copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}</button></div></label>;
}
