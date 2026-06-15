import { useOrganization } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, ImagePlus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../../lib/api-client";
import { PageHeader, PageSkeleton } from "../../../components/ui/page-state";

interface WorkspaceData {
  name: string;
  timezone: string;
  slug?: string;
  currency?: string;
  logo_url?: string;
  modules?: string[];
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

export function WorkspaceSettings() {
  const { organization } = useOrganization();
  const qc = useQueryClient();
  const logoRef = useRef<HTMLInputElement>(null);

  const query = useQuery({
    queryKey: ["workspace-settings"],
    queryFn: () => apiClient.get<WorkspaceData>("/settings/workspace"),
  });
  const [form, setForm] = useState<WorkspaceData>({ name: "", slug: "", currency: "USD", timezone: "UTC", modules: ["crm"] });
  const [logoPreview, setLogoPreview] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
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

  if (query.isLoading) return <PageSkeleton rows={6} />;

  return (
    <div className="space-y-5">
      <PageHeader title="Workspace" description="Organization identity, location, and operating defaults." />

      {/* ── General ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-white">General</h2>
        </div>
        <div className="p-5">
          {/* Logo */}
          <div className="mb-5 flex items-center gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/[.08] bg-white/[.03]">
              {logoPreview || organization?.imageUrl
                ? <img src={logoPreview || organization?.imageUrl} alt="" className="h-full w-full object-cover" />
                : <span className="text-xl font-bold text-slate-400">{form.name.slice(0, 1).toUpperCase()}</span>}
            </div>
            <div>
              <button
                onClick={() => logoRef.current?.click()}
                className="flex items-center gap-2 rounded-lg border border-white/[.09] px-3 py-2 text-sm text-slate-300 hover:bg-white/[.04] hover:text-white transition-colors"
              >
                <ImagePlus size={14} /> Upload logo
              </button>
              <p className="mt-1.5 text-xs text-slate-600">Square PNG or JPG, at least 256×256px recommended.</p>
            </div>
            <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => uploadLogo(e.target.files?.[0])} />
          </div>

          {/* Fields */}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Workspace name</span>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="key-input h-9 w-full px-3 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Workspace URL</span>
              <div className="flex h-9 items-center rounded-lg border border-white/[.09] bg-white/[.03]">
                <span className="border-r border-white/[.07] px-3 text-xs text-slate-600">app.mondaily.com/</span>
                <input
                  value={form.slug}
                  onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                  className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none text-slate-200"
                />
              </div>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Default currency</span>
              <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}
                className="key-input h-9 w-full px-3 text-sm">
                {currencies.map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Default timezone</span>
              <select value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })}
                className="key-input h-9 w-full px-3 text-sm">
                {timezones.map(tz => <option key={tz}>{tz}</option>)}
              </select>
            </label>
          </div>

          <div className="mt-6 flex justify-end">
            <button onClick={() => save.mutate()} disabled={save.isPending}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-50 ${
                saved
                  ? "bg-emerald-600 border border-emerald-500/30"
                  : "border-x border-t border-red-500/40 border-b-[3px] border-b-red-700 bg-red-500 hover:bg-red-400 active:translate-y-[1px]"
              }`}>
              {saved ? <><Check size={14} /> Saved</> : save.isPending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </section>

      {/* ── Modules ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-white">Modules</h2>
          <p className="text-xs text-slate-600 mt-0.5">Enable or disable product modules for your workspace.</p>
        </div>
        <div className="p-5 space-y-3">
          {AVAILABLE_MODULES.map(mod => {
            const enabled = (form.modules ?? ["crm"]).includes(mod.id);
            return (
              <div key={mod.id} className="flex items-center justify-between rounded-xl border border-white/[.06] bg-white/[.02] px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-white">{mod.label}</p>
                  <p className="text-xs text-slate-600 mt-0.5">{mod.description}</p>
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
                  className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${enabled ? "bg-red-500" : "bg-white/[.10]"}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`}/>
                </button>
              </div>
            );
          })}
          <div className="flex justify-end pt-2">
            <button onClick={() => save.mutate()} disabled={save.isPending}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-50 ${
                saved
                  ? "bg-emerald-600 border border-emerald-500/30"
                  : "border-x border-t border-red-500/40 border-b-[3px] border-b-red-700 bg-red-500 hover:bg-red-400 active:translate-y-[1px]"
              }`}>
              {saved ? <><Check size={14} /> Saved</> : save.isPending ? "Saving…" : "Save modules"}
            </button>
          </div>
        </div>
      </section>

      {/* ── Danger zone ── */}
      <section className="settings-section border-red-500/[.15]">
        <div className="settings-section-header border-red-500/[.08]">
          <h2 className="text-sm font-semibold text-red-400">Danger zone</h2>
        </div>
        <div className="p-5">
          <p className="mb-4 text-sm text-slate-500">Export a portable copy of all workspace data, or permanently delete this workspace.</p>
          <div className="flex flex-wrap gap-3">
            <button onClick={exportData}
              className="flex items-center gap-2 rounded-lg border border-white/[.09] px-3 py-2 text-sm text-slate-300 hover:bg-white/[.04] hover:text-white transition-colors">
              <Download size={14} /> Export all data
            </button>
            <button onClick={() => setDeleteOpen(true)}
              className="flex items-center gap-2 rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-400 hover:bg-red-500/[.08] transition-colors">
              <Trash2 size={14} /> Delete workspace
            </button>
          </div>
        </div>
      </section>

      {/* ── Delete confirm ── */}
      {deleteOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={() => setDeleteOpen(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[.09] bg-[#0d0f13] p-6 shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-semibold text-white">Delete {form.name}</h2>
              <button onClick={() => setDeleteOpen(false)} className="text-slate-500 hover:text-white transition-colors"><X size={15} /></button>
            </div>
            <p className="text-sm text-slate-500">All records, members, and activity in this workspace will be permanently removed. This cannot be undone. Type the workspace name to confirm.</p>
            <input value={deleteText} onChange={e => setDeleteText(e.target.value)} placeholder={form.name} className="key-input mt-4 h-10 w-full px-3 text-sm" />
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDeleteOpen(false)} className="rounded-lg border border-white/[.08] px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={deleteWorkspace} disabled={deleteText !== form.name} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40 transition-colors">Delete workspace</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
