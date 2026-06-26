import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, KeyRound, Link2, Plus, Radio, RotateCw, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { apiClient } from "../../../lib/api-client";
import { EmptyState, PageHeader, PageSkeleton } from "../../../components/ui/page-state";

interface IntegrationData {
  integrations: { id: string; name: string; connected: boolean; description?: string }[];
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
      className="flex items-center gap-1.5 rounded-lg border border-white/[.08] px-2.5 py-1.5 text-xs text-stone-400 hover:bg-white/[.04] hover:text-white transition-colors"
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
      {label ?? (copied ? "Copied!" : "Copy")}
    </button>
  );
}

function ModalShell({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={close} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[.09] bg-[#141414] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-semibold text-white">{title}</h2>
          <button onClick={close} className="rounded-md p-1 text-stone-500 hover:bg-white/[.05] hover:text-white transition-colors"><X size={15} /></button>
        </div>
        {children}
      </div>
    </>
  );
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

  const integrations = useMemo(() => integrationCatalog.map(cat => ({
    ...cat,
    connected: data.integrations.find(i => i.id === cat.id)?.connected ?? false,
  })), [data.integrations]);

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
      <PageHeader title="Integrations & API" description="Connect business systems and manage programmatic access." />

      {/* ── Integrations ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-white">Connected integrations</h2>
        </div>
        <div className="grid gap-px bg-white/[.04] sm:grid-cols-2">
          {integrations.map(item => (
            <article key={item.id} className="flex flex-col bg-[#141414] p-4">
              <div className="mb-3 flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[.05] text-sm font-bold text-stone-300">
                  {item.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-stone-200">{item.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${item.connected ? "bg-emerald-500/10 text-emerald-400" : "bg-white/[.04] text-stone-600"}`}>
                      {item.connected ? "Connected" : "Not connected"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-stone-600">{item.description}</p>
                </div>
              </div>
              <button
                onClick={() => toggleIntegration.mutate({ id: item.id, connected: !item.connected })}
                className={`mt-auto self-start text-xs transition-colors ${item.connected ? "text-stone-400 hover:text-stone-300" : "text-emerald-400 hover:text-emerald-300"}`}
              >
                {item.connected ? "Disconnect" : "Connect"}
              </button>
            </article>
          ))}
        </div>
      </section>

      {/* ── API Keys ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><KeyRound size={14} /> API keys</h2>
          <button onClick={() => { setKeyOpen(true); setCreatedKey(""); }}
            className="flex items-center gap-1.5 rounded-lg border border-white/[.08] px-3 py-1.5 text-xs text-stone-300 hover:bg-white/[.04] hover:text-white transition-colors">
            <Plus size={12} /> Create key
          </button>
        </div>
        {data.api_keys.length ? (
          <div className="overflow-x-auto">
            <table className="minimal-table min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[.05] bg-white/[.015]">
                  {["Name", "Key", "Created", "Last used", ""].map(h => (
                    <th key={h} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-stone-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.api_keys.map(key => (
                  <tr key={key.id} className="border-b border-white/[.04] last:border-0 hover:bg-white/[.015] transition-colors">
                    <td className="px-4 py-3 font-medium text-stone-200">{key.name}</td>
                    <td className="px-4 py-3"><code className="text-xs text-stone-600">{key.prefix}••••••••</code></td>
                    <td className="px-4 py-3 text-stone-600">{key.created_at ? new Date(key.created_at).toLocaleDateString() : "Recently"}</td>
                    <td className="px-4 py-3 text-stone-600">{key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : "Never"}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => revokeKey.mutate(key.id)} className="text-xs text-stone-400 hover:text-stone-300 transition-colors">Revoke</button>
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
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><Radio size={14} /> Webhooks</h2>
          <button onClick={() => setWebhookOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-white/[.08] px-3 py-1.5 text-xs text-stone-300 hover:bg-white/[.04] hover:text-white transition-colors">
            <Plus size={12} /> Add webhook
          </button>
        </div>
        {data.webhooks.length ? (
          <div className="divide-y divide-white/[.04] px-5">
            {data.webhooks.map(hook => (
              <div key={hook.id} className="flex items-start justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-stone-300">{hook.url}</p>
                  <p className="mt-1 text-xs text-stone-600">{hook.events.slice(0, 3).join(", ")}{hook.events.length > 3 ? ` +${hook.events.length - 3}` : ""}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-400">{hook.status ?? "Active"}</span>
                  <button onClick={() => deleteWebhook.mutate(hook.id)} className="text-stone-400 hover:text-stone-300 transition-colors"><Trash2 size={13} /></button>
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
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><Link2 size={14} /> MCP server</h2>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-stone-500">Connect Mondaily to Claude, ChatGPT, and other AI tools via the Model Context Protocol.</p>
          <div>
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">Server URL</span>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-white/[.07] bg-white/[.02] px-3 py-2.5 text-xs text-stone-400">wss://mcp.mondaily.com/workspace</code>
              <CopyButton value="wss://mcp.mondaily.com/workspace" />
            </div>
          </div>
          {data.mcp_token ? (
            <>
              <div>
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">Token</span>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-white/[.07] bg-white/[.02] px-3 py-2.5 text-xs text-stone-400">{data.mcp_token}</code>
                  <CopyButton value={data.mcp_token} />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => generateMcp.mutate()}
                  className="flex items-center gap-2 rounded-lg border border-white/[.08] px-3 py-2 text-xs text-stone-400 hover:bg-white/[.04] hover:text-white transition-colors">
                  <RotateCw size={12} /> Rotate token
                </button>
                <button onClick={() => toggleIntegration.mutate({ id: "mcp", connected: false })}
                  className="rounded-lg border border-stone-500/20 px-3 py-2 text-xs text-stone-400 hover:bg-stone-500/[.08] transition-colors">
                  Revoke
                </button>
              </div>
            </>
          ) : (
            <button onClick={() => generateMcp.mutate()}
              className="flex items-center gap-2 rounded-xl border border-stone-400/40 bg-stone-500 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-400 transition-all">
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
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[.05] p-3 text-xs text-amber-300">
                This key is shown once. Store it securely — you won't be able to see it again.
              </div>
              <div>
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">Your new key</span>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-lg border border-white/[.07] bg-white/[.02] p-3 text-xs text-stone-300">{createdKey}</code>
                  <CopyButton value={createdKey} />
                </div>
              </div>
              <button onClick={() => setKeyOpen(false)}
                className="w-full rounded-xl bg-white/[.06] py-2.5 text-sm font-medium text-stone-300 hover:bg-white/[.09] transition-colors">
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={e => { e.preventDefault(); if (keyName.trim()) createKey.mutate(); }} className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">Key name</span>
                <input autoFocus value={keyName} onChange={e => setKeyName(e.target.value)} placeholder="e.g. Production, CI/CD" className="key-input h-10 w-full px-3 text-sm" />
              </label>
              <button type="submit" disabled={!keyName.trim() || createKey.isPending}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-stone-400/40 bg-stone-500 py-2.5 text-sm font-semibold text-white hover:bg-stone-400 disabled:opacity-40 transition-all">
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
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">Endpoint URL</span>
              <input autoFocus value={webhook.url} onChange={e => setWebhook({ ...webhook, url: e.target.value })}
                placeholder="https://example.com/webhook" className="key-input h-10 w-full px-3 text-sm" />
            </label>
            <div>
              <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-stone-500">Events to send</span>
              <div className="grid grid-cols-2 gap-1.5">
                {webhookEvents.map(ev => (
                  <label key={ev} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-white/[.03] transition-colors">
                    <input type="checkbox" checked={webhook.events.includes(ev)}
                      onChange={e => setWebhook({ ...webhook, events: e.target.checked ? [...webhook.events, ev] : webhook.events.filter(x => x !== ev) })}
                      className="accent-red-500" />
                    <span className="text-stone-400">{ev}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">Signing secret</span>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-white/[.07] bg-white/[.02] px-3 py-2.5 text-xs text-stone-400">{webhook.secret}</code>
                <CopyButton value={webhook.secret} />
              </div>
            </div>
            <button type="submit" disabled={!webhook.url.startsWith("https://") || createWebhook.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-stone-400/40 bg-stone-500 py-2.5 text-sm font-semibold text-white hover:bg-stone-400 disabled:opacity-40 transition-all">
              {createWebhook.isPending ? "Creating…" : "Create webhook"}
            </button>
          </form>
        </ModalShell>
      )}
    </div>
  );
}
