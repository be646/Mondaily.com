import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bold, Calendar, CheckCircle, Clock, Italic, Mail, Plus, Save, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { apiClient, BASE_URL } from "../../../lib/api-client";
import { EmptyState, PageHeader, PageSkeleton } from "../../../components/ui/page-state";

interface Provider {
  id: string;
  name: string;
  connected: boolean;
  email?: string;
  connected_as?: string;
  last_sync?: string;
  sync_status?: "syncing" | "synced" | "error";
  sync_scope?: "all" | "inbox" | "starred";
  sharing?: "private" | "subject" | "full";
  signature?: string;
}
interface EmailData {
  providers: Provider[];
  default_from?: string;
  auto_label?: boolean;
  ai_summaries?: boolean;
  unsubscribe_link?: boolean;
  calendars?: { id: string; name: string; provider: string; enabled: boolean }[];
  auto_create_contacts?: boolean;
  meeting_prep?: boolean;
}

export function EmailSettings() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["email-settings"], queryFn: () => apiClient.get<EmailData>("/settings/email") });
  const [data, setData] = useState<EmailData>({ providers: [] });
  const [signatureAccount, setSignatureAccount] = useState("");

  useEffect(() => {
    if (!query.data) return;
    const providers = query.data.providers.map((provider) => ({
      ...provider,
      sync_status: provider.sync_status ?? (provider.connected ? "synced" : undefined),
      sync_scope: provider.sync_scope ?? "all",
      sharing: provider.sharing ?? "private"
    }));
    setData({ ...query.data, providers });
    setSignatureAccount(providers.find((provider) => provider.connected)?.id ?? "");
  }, [query.data]);

  const save = useMutation({
    mutationFn: () => apiClient.patch("/settings/email", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-settings"] })
  });

  async function connect(provider: string) {
    try {
      const { auth_url } = await apiClient.post<{ auth_url: string }>("/integrations/connect", { provider });
      window.open(auth_url, "_blank", "width=520,height=680");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not start email connection.");
    }
  }
  function updateProvider(id: string, patch: Partial<Provider>) {
    setData((current) => ({ ...current, providers: current.providers.map((provider) => provider.id === id ? { ...provider, ...patch } : provider) }));
  }

  if (query.isLoading) return <PageSkeleton rows={8} />;
  const connected = data.providers.filter((provider) => provider.connected);
  const calendars = data.calendars ?? connected.map((provider) => ({ id: `${provider.id}-calendar`, name: `${provider.name} calendar`, provider: provider.name, enabled: true }));
  return (
    <div>
      <PageHeader title="Email & calendar" description="Control inbox synchronization, sending, signatures, and meeting context." />
      <p className="mb-4 text-[12px] leading-relaxed text-[var(--text-muted)]">
        Google and Outlook are optional, client-authorized connectors. Email and calendar data is only
        accessed after you connect an account, remains workspace-scoped, is never used for AI training
        unless you explicitly approve it, and can be disconnected at any time.
      </p>
      <section className="premium-panel mb-5 p-5">
        <div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-medium"><Mail size={15} /> Connected email accounts</h2><div className="flex gap-2">{data.providers.filter((provider) => !provider.connected).map((provider) => <button key={provider.id} onClick={() => connect(provider.id)} className="flex items-center gap-1 rounded-md border border-[var(--border-soft)] px-2 py-1.5 text-xs"><Plus size={11} /> {provider.name}</button>)}</div></div>
        {connected.length ? <div className="space-y-3">{connected.map((provider) => <article key={provider.id} className="rounded-md border border-[var(--border-soft)] p-4">
          <div className="flex items-start gap-3"><div className="grid h-9 w-9 place-items-center rounded-md bg-stone-500/10 text-[var(--text-faint)]"><Mail size={16} /></div><div className="min-w-0 flex-1"><p className="text-sm font-medium">{provider.email ?? `${provider.name} account`}</p><p className="mt-0.5 text-xs text-[var(--text-muted)]">Connected as {provider.connected_as ?? provider.name}</p></div><span className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs ${provider.sync_status === "error" ? "bg-stone-500/10 text-[var(--text-faint)]" : provider.sync_status === "syncing" ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400"}`}><CheckCircle size={11} /> {provider.sync_status === "syncing" ? "Syncing" : provider.sync_status === "error" ? "Error" : `Synced ${provider.last_sync ?? "recently"}`}</span></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs text-[var(--text-muted)]">Sync scope<select value={provider.sync_scope} onChange={(event) => updateProvider(provider.id, { sync_scope: event.target.value as Provider["sync_scope"] })} className="mt-1 h-9 w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-card)] px-3 text-sm text-[var(--text-primary)]"><option value="all">All mail</option><option value="inbox">Inbox only</option><option value="starred">Starred only</option></select></label><label className="text-xs text-[var(--text-muted)]">Email sharing<select value={provider.sharing} onChange={(event) => updateProvider(provider.id, { sharing: event.target.value as Provider["sharing"] })} className="mt-1 h-9 w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-card)] px-3 text-sm text-[var(--text-primary)]"><option value="private">Private</option><option value="subject">Subject only</option><option value="full">Full email</option></select></label></div>
          <button onClick={() => updateProvider(provider.id, { connected: false })} className="mt-4 flex items-center gap-1 text-xs text-[var(--text-faint)]"><Unplug size={11} /> Disconnect</button>
        </article>)}</div> : <EmptyState icon={Mail} title="No email connected" description="Connect Gmail or Outlook to sync conversations and calendars." aiHint="Connect email to let AI build context automatically." action={<button onClick={() => connect("gmail")} className="rounded-md bg-stone-600 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-stone-700">Connect Gmail</button>} />}
      </section>

      <SovereignInbox />

      <section className="premium-panel mb-5 p-5">
        <h2 className="mb-4 text-sm font-medium">Email preferences</h2>
        <label className="mb-5 block text-sm">Default send from<select value={data.default_from ?? connected[0]?.id ?? ""} onChange={(event) => setData({ ...data, default_from: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-card)] px-3"><option value="">No account selected</option>{connected.map((provider) => <option key={provider.id} value={provider.id}>{provider.email ?? provider.name}</option>)}</select></label>
        {connected.length ? <div className="mb-5"><div className="mb-2 flex gap-1">{connected.map((provider) => <button key={provider.id} onClick={() => setSignatureAccount(provider.id)} className={`rounded-md px-3 py-1.5 text-xs ${signatureAccount === provider.id ? "bg-[var(--surface-hover)]" : "text-[var(--text-muted)]"}`}>{provider.email ?? provider.name}</button>)}</div><SignatureEditor key={signatureAccount} content={connected.find((provider) => provider.id === signatureAccount)?.signature ?? ""} onChange={(signature) => updateProvider(signatureAccount, { signature })} /></div> : null}
        <div className="space-y-3"><Toggle label="Auto-label synced email in Gmail" checked={data.auto_label ?? false} change={(checked) => setData({ ...data, auto_label: checked })} /><Toggle label="AI email summaries" checked={data.ai_summaries ?? true} change={(checked) => setData({ ...data, ai_summaries: checked })} /><Toggle label="Add unsubscribe link to sequences" checked={data.unsubscribe_link ?? true} change={(checked) => setData({ ...data, unsubscribe_link: checked })} /></div>
      </section>

      <section className="premium-panel p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-medium"><Calendar size={15} /> Calendar sync</h2>
        {calendars.length ? <div className="mb-5 space-y-2">{calendars.map((calendar) => <label key={calendar.id} className="flex items-center justify-between rounded-md bg-[var(--surface-hover)] p-3"><div><p className="text-sm">{calendar.name}</p><p className="text-xs text-[var(--text-muted)]">{calendar.provider}</p></div><input type="checkbox" checked={calendar.enabled} onChange={(event) => setData({ ...data, calendars: calendars.map((item) => item.id === calendar.id ? { ...item, enabled: event.target.checked } : item) })} /></label>)}</div> : <p className="mb-5 text-sm text-[var(--text-muted)]">Connect an email account to discover calendars.</p>}
        <div className="space-y-3"><Toggle label="Auto-create contacts from meeting attendees" checked={data.auto_create_contacts ?? true} change={(checked) => setData({ ...data, auto_create_contacts: checked })} /><Toggle label="Show meeting prep suggestions" checked={data.meeting_prep ?? true} change={(checked) => setData({ ...data, meeting_prep: checked })} /></div>
      </section>
      <div className="mt-5 flex justify-end"><button onClick={() => save.mutate()} className="flex items-center gap-2 rounded-md bg-stone-600 px-4 py-2 text-sm"><Save size={14} /> Save email settings</button></div>
    </div>
  );
}

/** Sovereign inbox — the workspace's own self-hosted email address. Rendered only when the
 *  deployment has native mail configured (SOVEREIGN_MAIL_DOMAIN); otherwise it stays hidden rather
 *  than showing a dead address. No third-party provider — this is Mondaily's own MX. */
function SovereignInbox() {
  const q = useQuery({ queryKey: ["email-inbound-address"], queryFn: () => apiClient.get<{ address: string | null; enabled: boolean }>("/emails/inbound-address"), staleTime: 300_000, retry: false });
  const [copied, setCopied] = useState(false);
  if (!q.data?.enabled || !q.data.address) return null;
  const address = q.data.address;
  return (
    <section className="premium-panel mb-5 p-5">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-medium"><Mail size={15} /> Sovereign inbox</h2>
      <p className="mb-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
        Your workspace has its own self-hosted address — no third-party provider. Forward mail to it,
        or point your domain's MX here, and messages land in the inbox above.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-md border border-[var(--border-soft)] bg-[var(--surface-card)] px-3 py-2 text-[13px] text-[var(--text-primary)]">{address}</code>
        <button onClick={() => { void navigator.clipboard?.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="rounded-md border border-[var(--border-soft)] px-3 py-2 text-xs text-[var(--text-secondary)]">{copied ? "Copied" : "Copy"}</button>
      </div>
    </section>
  );
}

function SignatureEditor({ content, onChange }: { content: string; onChange: (content: string) => void }) {
  const editor = useEditor({ extensions: [StarterKit], content, onUpdate: ({ editor: instance }) => onChange(instance.getHTML()) });
  return <div className="overflow-hidden rounded-md border border-[var(--border-soft)]"><div className="flex gap-1 border-b border-[var(--border-soft)] p-2"><button onClick={() => editor?.chain().focus().toggleBold().run()} className="grid h-7 w-7 place-items-center rounded hover:bg-[var(--surface-hover)]"><Bold size={13} /></button><button onClick={() => editor?.chain().focus().toggleItalic().run()} className="grid h-7 w-7 place-items-center rounded hover:bg-[var(--surface-hover)]"><Italic size={13} /></button></div><EditorContent editor={editor} className="min-h-28 p-3 text-sm [&_.ProseMirror]:min-h-24 [&_.ProseMirror]:outline-none" /></div>;
}
function Toggle({ label, checked, change }: { label: string; checked: boolean; change: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[var(--text-faint)]">{label}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => change(!checked)} className="md-toggle">
        <span className="md-toggle-thumb" />
      </button>
    </div>
  );
}
