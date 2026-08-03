import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, KeyRound, Link2, Plug, Plus, Radio, RotateCw, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { apiClient } from "../../../lib/api-client";
import { EmptyState, PageSkeleton } from "../../../components/ui/page-state";
import { CommandPageHeader } from "../../../components/ui/controls";
import { Modal } from "@/components/ui/modal";

interface IntegrationProfile { account: string; connected_at?: string; scopes?: string[] }
interface IntegrationData {
  integrations: { id: string; name: string; connected: boolean; description?: string; profile?: IntegrationProfile | null }[];
  api_keys: { id: string; name: string; prefix: string; created_at?: string; last_used_at?: string }[];
  webhooks: { id: string; url: string; events: string[]; status?: string; created_at?: string }[];
  mcp_token?: string;
}

const integrationCatalog = [
  { id: "gmail", name: "Gmail", description: "Sync inbox conversations and contacts.", icon: "G" },
  { id: "outlook", name: "Outlook", description: "Sync Microsoft email and calendar.", icon: "O" },
  { id: "google-calendar", name: "Google Calendar", description: "Import meetings and attendees.", icon: "C" },
  { id: "slack", name: "Slack", description: "Send alerts and agent updates.", icon: "S" },
  { id: "zapier", name: "Zapier", description: "Connect thousands of external apps.", icon: "Z" },
  { id: "typeform", name: "Typeform", description: "Create records from form responses.", icon: "T" },
  { id: "segment", name: "Segment", description: "Stream customer events into Mondaily.", icon: "Sg" },
  { id: "mailchimp", name: "Mailchimp", description: "Sync audiences and campaign engagement.", icon: "M" },
] as const;

const webhookEvents = [
  "node.created", "node.updated", "node.deleted", "deal.stage_changed",
  "sequence.replied", "agent.completed", "invoice.paid", "invoice.overdue",
];

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="flex items-center gap-1.5 rounded-sm border border-[var(--border-soft)] px-2.5 py-1.5 text-xs text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
    >
      {copied ? <Check size={12} style={{ color: "var(--section-accent)" }} /> : <Copy size={12} />}
      <span className="font-mono">{label ?? (copied ? "COPIED ✓" : "COPY")}</span>
    </button>
  );
}

/**
 * Delegates to the shared <Modal>.
 *
 * This was a private copy of the dialog shell — its own overlay, its own header, no Escape key.
 * Kept as a thin wrapper so the call sites below are untouched, but the chrome, the hairlines and
 * the dismiss behaviour now come from the one place that owns them.
 */
function ModalShell({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return <Modal title={title} onClose={close} width="lg">{children}</Modal>;
}

export function IntegrationsSettings() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["integrations"], queryFn: () => apiClient.get<IntegrationData>("/settings/integrations") });
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState("");
  const [webhookOpen, setWebhookOpen] = useState(false);
  const [webhook, setWebhook] = useState({ url: "", events: ["node.created"], secret: crypto.randomUUID().replace(/-/g, "") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["integrations"] });
  const data = query.data ?? { integrations: [], api_keys: [], webhooks: [] };

  const integrations = useMemo(() => integrationCatalog.map(cat => {
    const live = data.integrations.find(i => i.id === cat.id);
    return { ...cat, connected: live?.connected ?? false, profile: live?.profile ?? null };
  }), [data.integrations]);

  const toggleIntegration = useMutation({
    mutationFn: ({ id, connected }: { id: string; connected: boolean }) =>
      apiClient.patch(`/settings/integrations/${id}`, { connected }),
    onSuccess: refresh,
  });
  const createKey = useMutation({
    mutationFn: () => apiClient.post<{ key?: string; secret?: string }>("/settings/integrations/api-keys", { name: keyName }),
    onSuccess: result => { setCreatedKey(result.key ?? result.secret ?? ""); refresh(); },
  });
  const revokeKey = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/settings/integrations/api-keys/${id}`),
    onSuccess: refresh,
  });
  const createWebhook = useMutation({
    mutationFn: () => apiClient.post("/settings/integrations/webhooks", webhook),
    onSuccess: () => { setWebhookOpen(false); setWebhook({ url: "", events: ["node.created"], secret: crypto.randomUUID().replace(/-/g, "") }); refresh(); },
  });
  const deleteWebhook = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/settings/integrations/webhooks/${id}`),
    onSuccess: refresh,
  });
  const generateMcp = useMutation({
    mutationFn: () => apiClient.post<{ token: string }>("/settings/integrations/mcp-token", {}),
    onSuccess: refresh,
  });

  if (query.isLoading) return <PageSkeleton rows={9} />;

  return (
    <div className="space-y-5">
      <CommandPageHeader
        variant="bar" icon={Plug} callsign="INTEGRATIONS" title="Integrations & API" subtitle="Connect business systems and manage programmatic access." />

      {/* ── Integrations ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Connected integrations</h2>
        </div>
        <div className="grid gap-px bg-[var(--surface-hover)] sm:grid-cols-2">
          {integrations.map(item => (
            <article key={item.id} className="flex flex-col bg-[var(--surface-card)] p-4">
              <div className="mb-3 flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-[var(--surface-hover)] text-sm font-bold text-[var(--text-faint)]">
                  {item.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-[var(--text-primary)]">{item.name}</p>
                    <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                      Coming soon
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">{item.description}</p>
                </div>
              </div>
              {/* Honest state: these don't connect yet (no fake "connected"). Email connect
                  is real and lives in Settings → Email (direct Google OAuth, read-only). */}
              <span className="mt-auto self-start text-xs text-[var(--text-muted)]">
                {item.id === "gmail" ? "Connect in Settings → Email" : "Not available yet"}
              </span>
            </article>
          ))}
        </div>
      </section>

      {/* ── API Keys ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><KeyRound size={14} /> API keys</h2>
          <button onClick={() => { setKeyOpen(true); setCreatedKey(""); }}
            className="flex items-center gap-1.5 rounded-sm border border-[var(--border-soft)] px-3 py-1.5 text-xs text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors">
            <Plus size={12} /> Create key
          </button>
        </div>
        {data.api_keys.length ? (
          <div className="overflow-x-auto">
            <table className="minimal-table min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border-soft)] bg-[var(--surface-hover)]">
                  {["Name", "Key", "Created", "Last used", ""].map(h => (
                    <th key={h} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.api_keys.map(key => (
                  <tr key={key.id} className="border-b border-[var(--border-soft)] last:border-0 hover:bg-[var(--surface-hover)] transition-colors">
                    <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                      {key.name}
                      <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wider" style={{ color: "var(--section-accent)" }}>[ STATE: ACTIVE · LATENCY: 0MS ]</div>
                    </td>
                    <td className="px-4 py-3"><code className="font-mono text-xs text-[var(--text-muted)]">{key.prefix}••••••••</code></td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{key.created_at ? new Date(key.created_at).toLocaleDateString() : "Recently"}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : "Never"}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => revokeKey.mutate(key.id)} className="text-xs text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors">Revoke</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-8 text-center">
            <EmptyState icon={KeyRound} title="No API keys" description="Create a key for secure programmatic access." />
          </div>
        )}
      </section>

      {/* ── Webhooks ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><Radio size={14} /> Webhooks</h2>
          <button onClick={() => setWebhookOpen(true)}
            className="flex items-center gap-1.5 rounded-sm border border-[var(--border-soft)] px-3 py-1.5 text-xs text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors">
            <Plus size={12} /> Add webhook
          </button>
        </div>
        {data.webhooks.length ? (
          <div className="divide-y divide-[var(--border-soft)] px-5">
            {data.webhooks.map(hook => (
              <div key={hook.id} className="flex items-start justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-[var(--text-faint)]">{hook.url}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{hook.events.slice(0, 3).join(", ")}{hook.events.length > 3 ? ` +${hook.events.length - 3}` : ""}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="rounded-full bg-[#2f9e6b]/10 px-2 py-1 text-[10px] font-medium text-[#2f9e6b]">{hook.status ?? "Active"}</span>
                  <button onClick={() => deleteWebhook.mutate(hook.id)} className="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-8 text-center">
            <EmptyState icon={Radio} title="No webhooks" description="Send Mondaily events to your own endpoints." />
          </div>
        )}
      </section>

      {/* ── MCP Server ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><Link2 size={14} /> MCP server</h2>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-[var(--text-muted)]">Connect Mondaily to Claude, ChatGPT, and other AI tools via the Model Context Protocol.</p>
          <div>
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Server URL</span>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2.5 text-xs text-[var(--text-faint)]">wss://mcp.mondaily.com/workspace</code>
              <CopyButton value="wss://mcp.mondaily.com/workspace" />
            </div>
          </div>
          {data.mcp_token ? (
            <>
              <div>
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Token</span>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2.5 text-xs text-[var(--text-faint)]">{data.mcp_token}</code>
                  <CopyButton value={data.mcp_token} />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => generateMcp.mutate()}
                  className="flex items-center gap-2 rounded-sm border border-[var(--border-soft)] px-3 py-2 text-xs text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors">
                  <RotateCw size={12} /> Rotate token
                </button>
                <button onClick={() => toggleIntegration.mutate({ id: "mcp", connected: false })}
                  className="rounded-sm border border-[var(--border-soft)] px-3 py-2 text-xs text-[var(--text-faint)] hover:bg-[var(--surface-hover)] transition-colors">
                  Revoke
                </button>
              </div>
            </>
          ) : (
            <button onClick={() => generateMcp.mutate()}
              className="flex items-center gap-2 rounded-sm border border-[var(--border-strong)] bg-[var(--section-accent-soft)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] transition-all">
              <ExternalLink size={13} /> Generate token
            </button>
          )}
        </div>
      </section>

      {/* ── Create API key modal ── */}
      {keyOpen && (
        <ModalShell title="Create API key" close={() => setKeyOpen(false)}>
          {createdKey ? (
            <div className="space-y-4">
              <div className="rounded-sm border border-[#c6892e]/20 bg-[#c6892e]/[.05] p-3 text-xs text-[#c6892e]">
                This key is shown once. Store it securely — you won't be able to see it again.
              </div>
              <div>
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Your new key</span>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] p-3 text-xs text-[var(--text-faint)]">{createdKey}</code>
                  <CopyButton value={createdKey} />
                </div>
              </div>
              <button onClick={() => setKeyOpen(false)}
                className="w-full rounded-sm bg-[var(--surface-hover)] py-2.5 text-sm font-medium text-[var(--text-faint)] hover:bg-[var(--surface-hover)] transition-colors">
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={e => { e.preventDefault(); if (keyName.trim()) createKey.mutate(); }} className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Key name</span>
                <input autoFocus value={keyName} onChange={e => setKeyName(e.target.value)} placeholder="e.g. Production, CI/CD" className="key-input h-10 w-full px-3 text-sm" />
              </label>
              <button type="submit" disabled={!keyName.trim() || createKey.isPending}
                className="flex w-full items-center justify-center gap-2 rounded-sm border border-[var(--border-strong)] bg-[var(--section-accent-soft)] py-2.5 text-sm font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] disabled:opacity-40 transition-all">
                {createKey.isPending ? "Generating…" : "Generate key"}
              </button>
            </form>
          )}
        </ModalShell>
      )}

      {/* ── Add webhook modal ── */}
      {webhookOpen && (
        <ModalShell title="Add webhook" close={() => setWebhookOpen(false)}>
          <form onSubmit={e => { e.preventDefault(); if (webhook.url.startsWith("https://")) createWebhook.mutate(); }} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Endpoint URL</span>
              <input autoFocus value={webhook.url} onChange={e => setWebhook({ ...webhook, url: e.target.value })}
                placeholder="https://example.com/webhook" className="key-input h-10 w-full px-3 text-sm" />
            </label>
            <div>
              <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Events to send</span>
              <div className="grid grid-cols-2 gap-1.5">
                {webhookEvents.map(ev => (
                  <label key={ev} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-[var(--surface-hover)] transition-colors">
                    <input type="checkbox" checked={webhook.events.includes(ev)}
                      onChange={e => setWebhook({ ...webhook, events: e.target.checked ? [...webhook.events, ev] : webhook.events.filter(x => x !== ev) })}
                      className="accent-[#d1524a]" />
                    <span className="text-[var(--text-faint)]">{ev}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Signing secret</span>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2.5 text-xs text-[var(--text-faint)]">{webhook.secret}</code>
                <CopyButton value={webhook.secret} />
              </div>
            </div>
            <button type="submit" disabled={!webhook.url.startsWith("https://") || createWebhook.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-sm border border-[var(--border-strong)] bg-[var(--section-accent-soft)] py-2.5 text-sm font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] disabled:opacity-40 transition-all">
              {createWebhook.isPending ? "Creating…" : "Create webhook"}
            </button>
          </form>
        </ModalShell>
      )}
    </div>
  );
}
