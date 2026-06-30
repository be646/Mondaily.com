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
  viewer:  { export: false, api: false },
  member:  { export: false, api: false },
  admin:   { export: true,  api: true  },
  owner:   { export: true,  api: true  },
};

function CopyField({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">{label}</span>
      <div className="flex h-10 items-center rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)]">
        <code className="min-w-0 flex-1 truncate px-3 text-xs text-stone-400">{value}</code>
        <button onClick={onCopy} className="px-3 text-stone-500 hover:text-[var(--text-primary)] transition-colors">
          {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
        </button>
      </div>
    </label>
  );
}

function AccessToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex justify-center">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="md-toggle">
        <span className="md-toggle-thumb" />
      </button>
    </div>
  );
}

export function SecuritySettings() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["security"], queryFn: () => apiClient.get<SecurityData>("/settings/security") });
  const [data, setData] = useState<SecurityData>({ saml_enabled: false, export_restricted: false, protected_recipients: [], sessions: [] });
  const [domain, setDomain] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    if (query.data) setData({ ...query.data, access_controls: query.data.access_controls ?? defaultControls });
  }, [query.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["security"] });
  const update = useMutation({
    mutationFn: (body: Partial<SecurityData>) => apiClient.patch("/settings/security", body),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/settings/security/sessions/${id}`),
    onSuccess: refresh,
  });
  const revokeAll = useMutation({
    mutationFn: () => apiClient.delete(`/settings/security/sessions`),
    onSuccess: refresh,
  });

  function save(patch: Partial<SecurityData>) {
    const next = { ...data, ...patch };
    setData(next);
    update.mutate(patch);
  }

  function copy(label: string, value: string) {
    navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
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
    <div className="space-y-5">
      <PageHeader title="Security" description="Authentication, active sessions, recipient protection, and audit controls." />

      {/* ── SSO ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-stone-500" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Single Sign-On (SAML 2.0)</h2>
            <span className="rounded-full bg-stone-500/10 px-2 py-0.5 text-[10px] font-medium text-stone-300">Enterprise</span>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${data.saml_enabled ? "bg-emerald-500/10 text-emerald-400" : "bg-[var(--surface-hover)] text-stone-600"}`}>
            {data.saml_enabled ? "Configured" : "Not configured"}
          </span>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-sm text-stone-500">Configure your identity provider to enable SSO login for all workspace members.</p>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">Identity provider</span>
            <select value={data.saml_provider ?? "okta"} onChange={e => setData({ ...data, saml_provider: e.target.value })}
              className="key-input h-9 w-full px-3 text-sm">
              <option value="okta">Okta</option>
              <option value="azure">Azure AD / Entra ID</option>
              <option value="google">Google Workspace</option>
              <option value="other">Other SAML 2.0</option>
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <CopyField label="SP Entity ID" value={entityId} copied={copied === "entity"} onCopy={() => copy("entity", entityId)} />
            <CopyField label="ACS URL" value={acsUrl} copied={copied === "acs"} onCopy={() => copy("acs", acsUrl)} />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">IdP metadata URL or XML</span>
            <textarea value={data.saml_metadata ?? ""} onChange={e => setData({ ...data, saml_metadata: e.target.value })}
              placeholder="https://idp.example.com/metadata or paste XML here" rows={3}
              className="key-input w-full resize-none p-3 text-xs" />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => save({ saml_enabled: true, saml_provider: data.saml_provider, saml_metadata: data.saml_metadata })}
              className="flex items-center gap-2 rounded-xl border border-stone-500/30 bg-stone-600 px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-stone-500 transition-all">
              {data.saml_enabled ? "Update SSO" : "Configure SSO"}
            </button>
            <button className="rounded-lg border border-[var(--border-soft)] px-4 py-2 text-sm text-stone-400 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors">
              Test SSO
            </button>
            <label className="ml-auto flex items-center gap-2 text-sm text-stone-300 cursor-pointer">
              <button type="button" role="switch" aria-checked={data.enforce_sso ?? false}
                onClick={() => save({ enforce_sso: !(data.enforce_sso ?? false) })} className="md-toggle">
                <span className="md-toggle-thumb" />
              </button>
              Enforce SSO for all members
            </label>
          </div>
        </div>
      </section>

      {/* ── Active Sessions — console matrix ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><Smartphone size={14} /> Active sessions</h2>
          <button
            onClick={() => revokeAll.mutate()}
            disabled={revokeAll.isPending || data.sessions.filter(s => !s.current).length === 0}
            className="font-mono text-[10px] uppercase tracking-wider transition-colors disabled:opacity-40"
            style={{ color: "#fb7185" }}
          >
            {revokeAll.isPending ? "[ TERMINATING… ]" : "[ TERMINATE ALL OTHER NODES ]"}
          </button>
        </div>
        {data.sessions.length ? (
          <div className="overflow-x-auto font-mono">
            <table className="min-w-[650px] w-full text-left text-[12px]">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-soft)" }}>
                  {["Device", "Browser", "Location", "IP", "Last active", ""].map(h => (
                    <th key={h || "act"} className="px-4 py-2.5 text-[9px] font-semibold uppercase tracking-widest text-stone-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.sessions.map(s => (
                  <tr key={s.id} style={{ borderBottom: "1px solid var(--border-soft)", background: s.current ? "color-mix(in srgb, var(--accent) 5%, transparent)" : undefined }}>
                    <td className="px-4 py-3">
                      <span className="text-stone-200">{s.device}</span>
                      {s.current && <span className="ml-2 rounded-sm px-1.5 py-0.5 text-[9px] uppercase tracking-wide" style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)" }}>current</span>}
                    </td>
                    <td className="px-4 py-3 text-stone-500">{s.browser ?? "Browser"}</td>
                    <td className="px-4 py-3 text-stone-500">{s.location}</td>
                    <td className="px-4 py-3 tabular-nums text-stone-500">{s.ip ?? "Hidden"}</td>
                    <td className="px-4 py-3 tabular-nums text-stone-500">{s.last_active ?? "Now"}</td>
                    <td className="px-4 py-3 text-right">
                      {!s.current && (
                        <button onClick={() => revoke.mutate(s.id)} className="text-[10px] uppercase tracking-wider transition-colors hover:opacity-80" style={{ color: "#fb7185" }}>
                          [ REVOKE SYSTEM CLAIM ]
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-8">
            <EmptyState icon={Smartphone} title="No active sessions" description="Signed-in devices will appear here." />
          </div>
        )}
      </section>

      {/* ── Protected Recipients ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><LockKeyhole size={14} /> Protected recipients</h2>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-stone-500">Prevent AI sequences from emailing specific domains. Useful for blocking competitors, personal addresses, or internal teams.</p>
          {data.protected_recipients.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.protected_recipients.map(r => (
                <span key={r} className="flex items-center gap-1.5 rounded-full bg-[var(--surface-hover)] px-3 py-1.5 text-xs text-stone-400">
                  {r}
                  <button onClick={() => save({ protected_recipients: data.protected_recipients.filter(x => x !== r) })}
                    className="text-stone-600 hover:text-stone-400 transition-colors"><X size={10} /></button>
                </span>
              ))}
            </div>
          )}
          <form onSubmit={e => { e.preventDefault(); addDomain(); }} className="flex gap-2">
            <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="competitor.com"
              className="key-input h-9 flex-1 px-3 text-sm" />
            <button type="submit"
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] px-3 py-2 text-sm text-stone-300 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors">
              <Plus size={13} /> Add
            </button>
          </form>
          <div className="flex items-center gap-2 text-xs text-stone-600">
            Presets:
            {["gmail.com", "hotmail.com", "yahoo.com"].map(p => (
              <button key={p} onClick={() => setDomain(p)}
                className="rounded-md border border-[var(--border-soft)] px-2 py-1 hover:text-stone-300 transition-colors">{p}</button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Data & Export Controls ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Data & export controls</h2>
        </div>
        <div className="px-5 py-3">
          <div className="grid grid-cols-[1fr_96px_96px] items-center">
            <div className="py-2.5 text-[10px] font-semibold uppercase tracking-widest text-stone-700">Role</div>
            <div className="py-2.5 text-center text-[10px] font-semibold uppercase tracking-widest text-stone-700">CSV export</div>
            <div className="py-2.5 text-center text-[10px] font-semibold uppercase tracking-widest text-stone-700">API access</div>
            {Object.entries(data.access_controls ?? defaultControls).map(([role, controls]) => (
              <div key={role} className="contents">
                <div className="border-t border-[var(--border-soft)] py-3.5 text-sm capitalize text-stone-300">{role}</div>
                <div className="border-t border-[var(--border-soft)] py-3.5 flex justify-center">
                  <AccessToggle
                    checked={controls.export}
                    onChange={v => save({ access_controls: { ...(data.access_controls ?? defaultControls), [role]: { ...controls, export: v } } })}
                  />
                </div>
                <div className="border-t border-[var(--border-soft)] py-3.5 flex justify-center">
                  <AccessToggle
                    checked={controls.api}
                    onChange={v => save({ access_controls: { ...(data.access_controls ?? defaultControls), [role]: { ...controls, api: v } } })}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Audit Log ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Audit log</h2>
            <span className="rounded-full bg-stone-500/10 px-2 py-0.5 text-[10px] font-medium text-stone-300">Enterprise</span>
          </div>
          <button className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-300 transition-colors">
            <Download size={12} /> Export CSV
          </button>
        </div>
        {(data.audit_log ?? []).length ? (
          <div className="overflow-x-auto">
            <table className="minimal-table min-w-[600px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border-soft)] bg-[var(--surface-hover)]">
                  {["Actor", "Action", "Target", "Timestamp", "IP"].map(h => (
                    <th key={h} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-stone-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.audit_log?.map(entry => (
                  <tr key={entry.id} className="border-b border-[var(--border-soft)] last:border-0">
                    <td className="px-4 py-3 text-stone-200">{entry.actor}</td>
                    <td className="px-4 py-3 font-mono text-xs text-stone-400">{entry.action}</td>
                    <td className="px-4 py-3 text-stone-600">{entry.target}</td>
                    <td className="px-4 py-3 text-stone-600">{entry.timestamp}</td>
                    <td className="px-4 py-3 text-stone-600">{entry.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-8">
            <EmptyState icon={Shield} title="No audit events" description="Administrative actions will appear here." />
          </div>
        )}
      </section>
    </div>
  );
}
