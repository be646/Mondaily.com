import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Link2, Plug, Plus, Radio, RotateCw, Trash2, X } from "lucide-react";
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
  ["gmail", "Gmail", "Sync inbox conversations and contacts."],
  ["outlook", "Outlook", "Sync Microsoft email and calendar."],
  ["google-calendar", "Google Calendar", "Import meetings and attendees."],
  ["slack", "Slack", "Send alerts and agent updates."],
  ["zapier", "Zapier", "Connect thousands of external apps."],
  ["typeform", "Typeform", "Create records from form responses."],
  ["segment", "Segment", "Stream customer events into Mondaily."],
  ["mailchimp", "Mailchimp", "Sync audiences and campaign engagement."]
] as const;
const webhookEvents = ["node.created", "node.updated", "node.deleted", "deal.stage_changed", "sequence.replied", "agent.completed", "invoice.paid", "invoice.overdue"];

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
  const integrations = useMemo(() => integrationCatalog.map(([id, name, description]) => ({ id, name, description, connected: data.integrations.find((item) => item.id === id)?.connected ?? false })), [data.integrations]);

  const toggleIntegration = useMutation({ mutationFn: ({ id, connected }: { id: string; connected: boolean }) => apiClient.patch(`/settings/integrations/${id}`, { connected }), onSuccess: refresh });
  const createKey = useMutation({
    mutationFn: () => apiClient.post<{ key?: string; secret?: string }>("/settings/integrations/api-keys", { name: keyName }),
    onSuccess: (result) => { setCreatedKey(result.key ?? result.secret ?? "Key created. Copy it from the API response."); refresh(); }
  });
  const revokeKey = useMutation({ mutationFn: (id: string) => apiClient.delete(`/settings/integrations/api-keys/${id}`), onSuccess: refresh });
  const createWebhook = useMutation({
    mutationFn: () => apiClient.post("/settings/integrations/webhooks", webhook),
    onSuccess: () => { setWebhookOpen(false); setWebhook({ url: "", events: ["node.created"], secret: crypto.randomUUID().replace(/-/g, "") }); refresh(); }
  });
  const deleteWebhook = useMutation({ mutationFn: (id: string) => apiClient.delete(`/settings/integrations/webhooks/${id}`), onSuccess: refresh });
  const generateMcp = useMutation({ mutationFn: () => apiClient.post<{ token: string }>("/settings/integrations/mcp-token", {}), onSuccess: refresh });

  if (query.isLoading) return <PageSkeleton rows={9} />;
  return (
    <div>
      <PageHeader title="Integrations & API" description="Connect business systems and manage programmatic access." />
      <section className="mb-5 rounded-lg border border-white/10 p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-medium"><Plug size={15} /> Connected integrations</h2>
        <div className="grid gap-3 sm:grid-cols-2">{integrations.map((item) => <article key={item.id} className="flex min-h-32 flex-col rounded-md border border-white/10 p-4"><div className="flex items-start gap-3"><div className="grid h-9 w-9 place-items-center rounded-md bg-white/5 font-semibold">{item.name.slice(0, 1)}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-sm font-medium">{item.name}</p><span className={`rounded-full px-2 py-0.5 text-[10px] ${item.connected ? "bg-emerald-500/10 text-emerald-400" : "bg-white/5 text-slate-500"}`}>{item.connected ? "Connected" : "Not connected"}</span></div><p className="mt-1 text-xs text-slate-500">{item.description}</p></div></div><button onClick={() => toggleIntegration.mutate({ id: item.id, connected: !item.connected })} className={`mt-auto self-start text-xs ${item.connected ? "text-red-400" : "text-emerald-400"}`}>{item.connected ? "Disconnect" : "Connect"}</button></article>)}</div>
      </section>

      <section className="mb-5 rounded-lg border border-white/10 p-5">
        <div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-medium"><KeyRound size={15} /> API keys</h2><button onClick={() => { setKeyOpen(true); setCreatedKey(""); }} className="flex items-center gap-1 rounded-md bg-red-600 px-3 py-2 text-xs"><Plus size={12} /> Create API key</button></div>
        {data.api_keys.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="pb-2">Name</th><th className="pb-2">Key</th><th className="pb-2">Created</th><th className="pb-2">Last used</th><th /></tr></thead><tbody>{data.api_keys.map((key) => <tr key={key.id} className="border-t border-white/10"><td className="py-3">{key.name}</td><td><code className="text-xs text-slate-500">{key.prefix}••••••••</code></td><td className="text-slate-500">{key.created_at ? new Date(key.created_at).toLocaleDateString() : "Recently"}</td><td className="text-slate-500">{key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : "Never"}</td><td className="text-right"><button onClick={() => revokeKey.mutate(key.id)} className="text-red-400" aria-label="Revoke key"><Trash2 size={13} /></button></td></tr>)}</tbody></table></div> : <EmptyState icon={KeyRound} title="No API keys" description="Create a key for secure workspace API access." />}
      </section>

      <section className="mb-5 rounded-lg border border-white/10 p-5">
        <div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-medium"><Radio size={15} /> Webhooks</h2><button onClick={() => setWebhookOpen(true)} className="flex items-center gap-1 text-xs text-red-400"><Plus size={12} /> Add webhook</button></div>
        {data.webhooks.length ? <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="pb-2">Endpoint URL</th><th className="pb-2">Events</th><th className="pb-2">Status</th><th /></tr></thead><tbody>{data.webhooks.map((hook) => <tr key={hook.id} className="border-t border-white/10"><td className="max-w-60 truncate py-3 font-mono text-xs">{hook.url}</td><td className="text-xs text-slate-500">{hook.events.join(", ")}</td><td><span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400">{hook.status ?? "Active"}</span></td><td className="text-right"><button onClick={() => deleteWebhook.mutate(hook.id)} className="text-red-400"><Trash2 size={13} /></button></td></tr>)}</tbody></table></div> : <EmptyState icon={Radio} title="No webhooks" description="Send Mondaily events to your own endpoints." />}
      </section>

      <section className="rounded-lg border border-white/10 p-5">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium"><Link2 size={15} /> MCP server</h2>
        <p className="mb-4 text-sm text-slate-500">Connect Mondaily to Claude, ChatGPT, and other approved AI tools.</p>
        <label className="mb-3 block text-xs text-slate-500">Server URL<div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-md bg-black/30 p-3 text-xs">wss://mcp.mondaily.com/workspace</code><CopyButton value="wss://mcp.mondaily.com/workspace" /></div></label>
        {data.mcp_token ? <div><label className="text-xs text-slate-500">Token<div className="mt-1 flex gap-2"><code className="min-w-0 flex-1 truncate rounded-md bg-black/30 p-3 text-xs text-slate-400">{data.mcp_token}</code><CopyButton value={data.mcp_token} /></div></label><div className="mt-3 flex gap-2"><button onClick={() => generateMcp.mutate()} className="flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs"><RotateCw size={12} /> Rotate token</button><button onClick={() => toggleIntegration.mutate({ id: "mcp", connected: false })} className="rounded-md border border-red-500/20 px-3 py-2 text-xs text-red-400">Revoke</button></div></div> : <button onClick={() => generateMcp.mutate()} className="rounded-md bg-red-600 px-3 py-2 text-sm">Generate token</button>}
      </section>

      {keyOpen ? <Modal title="Create API key" close={() => setKeyOpen(false)}>{createdKey ? <div><div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">This key is shown once. Store it securely.</div><div className="mt-3 flex gap-2"><code className="min-w-0 flex-1 break-all rounded-md bg-black/30 p-3 text-xs">{createdKey}</code><CopyButton value={createdKey} /></div></div> : <form onSubmit={(event) => { event.preventDefault(); if (keyName.trim()) createKey.mutate(); }}><label className="text-sm">Key name<input value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="Production integration" className="mt-2 h-10 w-full rounded-md border border-white/10 bg-transparent px-3" /></label><button className="mt-5 h-10 w-full rounded-md bg-red-600 text-sm">Generate key</button></form>}</Modal> : null}
      {webhookOpen ? <Modal title="Add webhook" close={() => setWebhookOpen(false)}><form onSubmit={(event) => { event.preventDefault(); if (webhook.url.startsWith("https://")) createWebhook.mutate(); }}><label className="text-sm">Endpoint URL<input value={webhook.url} onChange={(event) => setWebhook({ ...webhook, url: event.target.value })} placeholder="https://example.com/webhook" className="mt-2 h-10 w-full rounded-md border border-white/10 bg-transparent px-3" /></label><p className="mb-2 mt-4 text-sm">Events</p><div className="grid grid-cols-2 gap-2">{webhookEvents.map((eventName) => <label key={eventName} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={webhook.events.includes(eventName)} onChange={(event) => setWebhook({ ...webhook, events: event.target.checked ? [...webhook.events, eventName] : webhook.events.filter((item) => item !== eventName) })} />{eventName}</label>)}</div><label className="mt-4 block text-sm">Signing secret<div className="mt-2 flex gap-2"><code className="min-w-0 flex-1 truncate rounded-md bg-black/30 p-3 text-xs">{webhook.secret}</code><CopyButton value={webhook.secret} /></div></label><button disabled={!webhook.url.startsWith("https://")} className="mt-5 h-10 w-full rounded-md bg-red-600 text-sm disabled:opacity-40">Create webhook</button></form></Modal> : null}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <button onClick={() => { navigator.clipboard.writeText(value); setCopied(true); }} className="grid h-10 w-10 place-items-center rounded-md border border-white/10" aria-label="Copy">{copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}</button>;
}
function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6"><div className="w-full max-w-lg rounded-lg border border-white/10 bg-[#111419] p-5"><div className="mb-5 flex items-center justify-between"><h2 className="font-medium">{title}</h2><button onClick={close}><X size={16} /></button></div>{children}</div></div>;
}
