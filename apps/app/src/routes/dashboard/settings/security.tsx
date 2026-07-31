import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, LockKeyhole, Plus, Shield, Smartphone, X, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { apiClient } from "../../../lib/api-client";
import { EmptyState, PageSkeleton } from "../../../components/ui/page-state";
import { CommandPageHeader } from "../../../components/ui/controls";
import { FieldSelect } from "../../../components/ui/controls";

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
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</span>
      <div className="flex h-10 items-center rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)]">
        <code className="min-w-0 flex-1 truncate px-3 text-xs text-[var(--text-faint)]">{value}</code>
        <button onClick={onCopy} className="px-3 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          {copied ? <Check size={13} className="text-[#2f9e6b]" /> : <Copy size={13} />}
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


// ── Two-factor authentication (TOTP) — enroll, recovery codes, disable ─────────
function TwoFactorSection() {
  const [status, setStatus] = useState<{ available: boolean; enabled: boolean; recovery_codes_left?: number } | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => apiClient.get<{ available: boolean; enabled: boolean; recovery_codes_left?: number }>("/auth/2fa/status").then(setStatus).catch(() => setStatus(null));
  useEffect(() => { void load(); }, []);
  if (!status) return null;

  async function act(path: string, body: Record<string, unknown>, after: (r: never) => void) {
    setBusy(true); setErr(null);
    try { after(await apiClient.post(path, body) as never); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(false); }
  }

  return (
    <section className="settings-section">
      <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Two-factor authentication</h2>
      {!status.available ? (
        <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>Not available yet — the 2FA migration hasn't been applied to this deployment.</p>
      ) : status.enabled ? (
        <div className="mt-2 space-y-3">
          <p className="text-[12.5px]" style={{ color: "var(--text-secondary)" }}>
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: "var(--status-ok)" }} />
            Enabled — sign-in requires your authenticator code. {status.recovery_codes_left ?? 0} recovery code{(status.recovery_codes_left ?? 0) === 1 ? "" : "s"} remaining.
          </p>
          <div className="flex items-center gap-2">
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="Current code to disable" inputMode="numeric"
              className="key-input h-8 w-48 px-3 text-[12px]" />
            <button disabled={busy || code.trim().length < 6} onClick={() => void act("/auth/2fa/disable", { code: code.trim() }, () => { setCode(""); })}
              className="btn-secondary h-8 px-3 text-[12px] font-medium">Disable 2FA</button>
          </div>
        </div>
      ) : setup ? (
        <div className="mt-2 space-y-3">
          <p className="text-[12.5px]" style={{ color: "var(--text-secondary)" }}>Add this key to your authenticator app (Google Authenticator, 1Password, Aegis…):</p>
          <p className="rounded-md border px-3 py-2 font-mono text-[13px] tracking-wider" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }}>{setup.secret}</p>
          <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>Or open <a className="underline" href={setup.otpauth}>this otpauth link</a> on a device with your authenticator installed. Nothing is enforced until you verify below — abandoning setup can't lock you out.</p>
          <div className="flex items-center gap-2">
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" autoFocus
              className="key-input h-8 w-36 px-3 text-center font-mono text-[13px]" />
            <button disabled={busy || code.trim().length < 6}
              onClick={() => void act("/auth/2fa/enable", { code: code.trim() }, (r) => { setRecovery((r as { recovery_codes?: string[] }).recovery_codes ?? []); setSetup(null); setCode(""); })}
              className="btn-primary h-8 px-3 text-[12px] font-semibold">Verify &amp; enable</button>
            <button onClick={() => { setSetup(null); setCode(""); }} className="text-[12px]" style={{ color: "var(--text-muted)" }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>Add a 6-digit authenticator code to every sign-in. Built in-house (RFC 6238) — your secret never leaves this deployment.</p>
          <button disabled={busy} onClick={() => void act("/auth/2fa/setup", {}, (r) => setSetup(r as { secret: string; otpauth: string }))}
            className="btn-primary mt-2.5 h-8 px-3 text-[12px] font-semibold">Set up 2FA</button>
        </div>
      )}
      {recovery && (
        <div className="mt-3 rounded-md border px-4 py-3" style={{ borderColor: "var(--status-warn)", background: "color-mix(in srgb, var(--status-warn) 6%, transparent)" }}>
          <p className="text-[12.5px] font-semibold" style={{ color: "var(--text-primary)" }}>Recovery codes — shown once, save them now</p>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>Each works exactly once if you lose your authenticator. We store only hashes — these cannot be shown again.</p>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[12.5px]" style={{ color: "var(--text-primary)" }}>
            {recovery.map(rc => <span key={rc}>{rc}</span>)}
          </div>
          <button onClick={() => setRecovery(null)} className="btn-secondary mt-3 h-7 px-3 text-[11.5px] font-medium">I've saved them</button>
        </div>
      )}
      {err && <p className="mt-2 text-[12px]" style={{ color: "var(--status-error)" }}>{err}</p>}
    </section>
  );
}

export function SecuritySettings() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["security"], queryFn: () => apiClient.get<SecurityData>("/settings/security") });
  const [data, setData] = useState<SecurityData>({ saml_enabled: false, export_restricted: false, protected_recipients: [], sessions: [] });
  const [domain, setDomain] = useState("");
  const [copied, setCopied] = useState("");
  const [exporting, setExporting] = useState(false);

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
      <CommandPageHeader
        variant="bar" icon={Shield} callsign="SECURITY" title="Security" subtitle="Authentication, active sessions, recipient protection, and audit controls." />

      {/* ── Two-factor authentication ── */}
      <TwoFactorSection />

      {/* ── SSO ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Single Sign-On (SAML 2.0)</h2>
            <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-faint)]">Enterprise</span>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${data.saml_enabled ? "bg-[#2f9e6b]/10 text-[#2f9e6b]" : "bg-[var(--surface-hover)] text-[var(--text-muted)]"}`}>
            {data.saml_enabled ? "Configured" : "Not configured"}
          </span>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-sm text-[var(--text-muted)]">Configure your identity provider to enable SSO login for all workspace members.</p>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Identity provider</span>
            <FieldSelect value={data.saml_provider ?? "okta"} onChange={v => setData({ ...data, saml_provider: v })}
              ariaLabel="Identity provider" options={[
                { value: "okta", label: "Okta" },
                { value: "azure", label: "Azure AD / Entra ID" },
                { value: "google", label: "Google Workspace" },
                { value: "other", label: "Other SAML 2.0" },
              ]} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <CopyField label="SP Entity ID" value={entityId} copied={copied === "entity"} onCopy={() => copy("entity", entityId)} />
            <CopyField label="ACS URL" value={acsUrl} copied={copied === "acs"} onCopy={() => copy("acs", acsUrl)} />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">IdP metadata URL or XML</span>
            <textarea value={data.saml_metadata ?? ""} onChange={e => setData({ ...data, saml_metadata: e.target.value })}
              placeholder="https://idp.example.com/metadata or paste XML here" rows={3}
              className="key-input w-full resize-none p-3 text-xs" />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => save({ saml_enabled: true, saml_provider: data.saml_provider, saml_metadata: data.saml_metadata })}
              disabled={update.isPending}
              className="flex items-center gap-2 rounded-sm border border-[var(--border-strong)] bg-[var(--section-accent-soft)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] disabled:opacity-70">
              {update.isPending ? <span className="font-mono text-xs tracking-wider">[ RUNNING CRYPTO EXCHANGER... ]</span> : (data.saml_enabled ? "Update SSO" : "Configure SSO")}
            </button>
            <button className="rounded-sm border px-4 py-2 text-sm text-[var(--text-faint)] transition-colors hover:text-[var(--text-primary)]"
              style={{ borderColor: "var(--border-soft)" }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--section-accent)")}
              onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border-soft)")}>
              Test SSO
            </button>
            <label className="ml-auto flex items-center gap-2 text-sm text-[var(--text-faint)] cursor-pointer">
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
                    <th key={h || "act"} className="px-4 py-2.5 text-[9px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.sessions.map(s => (
                  <tr key={s.id} style={{ borderBottom: "1px solid var(--border-soft)", background: s.current ? "color-mix(in srgb, var(--section-accent) 5%, transparent)" : undefined }}>
                    <td className="px-4 py-3">
                      <span className="text-[var(--text-primary)]">{s.device}</span>
                      {s.current && <span className="ml-2 rounded-sm px-1.5 py-0.5 text-[9px] uppercase tracking-wide" style={{ background: "color-mix(in srgb, var(--section-accent) 14%, transparent)", color: "var(--section-accent)" }}>current</span>}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{s.browser ?? "Browser"}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{s.location}</td>
                    <td className="px-4 py-3 tabular-nums text-[var(--text-muted)]">{s.ip ?? "Hidden"}</td>
                    <td className="px-4 py-3 tabular-nums text-[var(--text-muted)]">{s.last_active ?? "Now"}</td>
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
          <p className="text-sm text-[var(--text-muted)]">Prevent AI sequences from emailing specific domains. Useful for blocking competitors, personal addresses, or internal teams.</p>
          {data.protected_recipients.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.protected_recipients.map(r => (
                <span key={r} className="flex items-center gap-1.5 rounded-full bg-[var(--surface-hover)] px-3 py-1.5 text-xs text-[var(--text-faint)]">
                  {r}
                  <button onClick={() => save({ protected_recipients: data.protected_recipients.filter(x => x !== r) })}
                    className="text-[var(--text-muted)] hover:text-[var(--text-faint)] transition-colors"><X size={10} /></button>
                </span>
              ))}
            </div>
          )}
          <form onSubmit={e => { e.preventDefault(); addDomain(); }} className="flex gap-2">
            <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="competitor.com"
              className="key-input h-9 flex-1 px-3 text-sm" />
            <button type="submit"
              className="flex items-center gap-1.5 rounded-sm border border-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors">
              <Plus size={13} /> Add
            </button>
          </form>
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            Presets:
            {["gmail.com", "hotmail.com", "yahoo.com"].map(p => (
              <button key={p} onClick={() => setDomain(p)}
                className="rounded-sm border border-[var(--border-soft)] px-2 py-1 hover:text-[var(--text-faint)] transition-colors">{p}</button>
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
            <div className="py-2.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Role</div>
            <div className="py-2.5 text-center text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">CSV export</div>
            <div className="py-2.5 text-center text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">API access</div>
            {Object.entries(data.access_controls ?? defaultControls).map(([role, controls]) => (
              <div key={role} className="contents">
                <div className="border-t border-[var(--border-soft)] py-3.5 text-sm capitalize text-[var(--text-faint)]">{role}</div>
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
            <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-faint)]">Enterprise</span>
          </div>
          <button className="flex items-center gap-1.5 text-xs text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors">
            <Download size={12} /> Export CSV
          </button>
        </div>
        {(data.audit_log ?? []).length ? (
          <div className="overflow-x-auto">
            <table className="minimal-table min-w-[600px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border-soft)] bg-[var(--surface-hover)]">
                  {["Actor", "Action", "Target", "Timestamp", "IP"].map(h => (
                    <th key={h} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.audit_log?.map(entry => (
                  <tr key={entry.id} className="border-b border-[var(--border-soft)] last:border-0">
                    <td className="px-4 py-3 text-[var(--text-primary)]">{entry.actor}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--text-faint)]">{entry.action}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{entry.target}</td>
                    <td className="px-4 py-3 font-mono text-[var(--text-muted)]">{entry.timestamp}</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-[var(--text-muted)]">{entry.ip ?? "—"}</td>
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

      {/* ── Workspace data export — sovereignty: your data leaves whenever YOU say so ── */}
      <section className="settings-section">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Export workspace data</h2>
            <p className="mt-1 max-w-xl text-[12px]" style={{ color: "var(--text-muted)" }}>
              One JSON bundle of this workspace's records, tasks, decisions, goals and activity log — with a manifest
              that discloses per-table caps and exclusions (DMs, attachments, credentials are never included).
              Owner/admin only.
            </p>
          </div>
          <button
            onClick={async () => {
              setExporting(true);
              try {
                const bundle = await apiClient.get<Record<string, unknown>>("/settings/export");
                const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
                const a = document.createElement("a");
                a.href = url; a.download = `mondaily-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
                URL.revokeObjectURL(url);
              } catch { setCopied("export-failed"); setTimeout(() => setCopied(""), 3000); }
              finally { setExporting(false); }
            }}
            disabled={exporting}
            className="btn-secondary h-8 shrink-0 gap-1.5 px-3 text-[12px] font-medium"
          >
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {exporting ? "Preparing…" : "Download JSON"}
          </button>
        </div>
        {copied === "export-failed" && <p className="mt-2 text-[11px]" style={{ color: "var(--status-error)" }}>Export failed — owner/admin role is required.</p>}
      </section>
    </div>
  );
}
