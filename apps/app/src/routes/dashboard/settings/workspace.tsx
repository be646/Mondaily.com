import { useOrganization } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ImagePlus, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../../lib/api-client";
import { PageHeader, PageSkeleton } from "../../../components/ui/page-state";

interface WorkspaceData {
  name: string;
  timezone: string;
  slug?: string;
  currency?: string;
  logo_url?: string;
}

const timezones = ["UTC", "Europe/London", "Europe/Warsaw", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Singapore", "Australia/Sydney"];

export function WorkspaceSettings() {
  const { organization } = useOrganization();
  const qc = useQueryClient();
  const logoRef = useRef<HTMLInputElement>(null);
  const query = useQuery({ queryKey: ["workspace-settings"], queryFn: () => apiClient.get<WorkspaceData>("/settings/workspace") });
  const [form, setForm] = useState<WorkspaceData>({ name: "", slug: "", currency: "USD", timezone: "UTC" });
  const [logoPreview, setLogoPreview] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  useEffect(() => {
    if (query.data) setForm({
      ...query.data,
      slug: query.data.slug ?? organization?.slug ?? "",
      currency: query.data.currency ?? "USD"
    });
  }, [organization?.slug, query.data]);

  const save = useMutation({
    mutationFn: async () => {
      await organization?.update({ name: form.name, slug: form.slug || undefined });
      return apiClient.patch("/settings/workspace", form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspace-settings"] })
  });

  async function uploadLogo(file?: File) {
    if (!file || !organization) return;
    setLogoPreview(URL.createObjectURL(file));
    await organization.setLogo({ file });
  }

  function exportData() {
    const blob = new Blob([JSON.stringify({ workspace: form, exported_at: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${form.slug || "workspace"}-export.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function deleteWorkspace() {
    if (deleteText !== form.name || !organization) return;
    await organization.destroy();
    window.location.assign("/workspaces");
  }

  if (query.isLoading) return <PageSkeleton rows={6} />;
  return (
    <div>
      <PageHeader title="Workspace" description="Organization identity, location, and operating defaults." />
      <section className="rounded-lg border border-white/10 p-5">
        <h2 className="mb-5 text-sm font-medium">General</h2>
        <div className="mb-5 flex items-center gap-4">
          <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-md border border-white/10 bg-white/[.03]">
            {logoPreview || organization?.imageUrl ? <img src={logoPreview || organization?.imageUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-xl font-semibold">{form.name.slice(0, 1)}</span>}
          </div>
          <div><button onClick={() => logoRef.current?.click()} className="flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm"><ImagePlus size={14} /> Upload logo</button><p className="mt-2 text-xs text-slate-500">Square PNG or JPG recommended.</p></div>
          <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(event) => uploadLogo(event.target.files?.[0])} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Workspace name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
          <label className="text-sm">Workspace URL<div className="mt-2 flex h-10 items-center rounded-md border border-white/10 px-3"><span className="text-xs text-slate-500">app.mondaily.com/</span><input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></div></label>
          <label className="text-sm">Default currency<select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-white/10 bg-[#0b0d10] px-3"><option>USD</option><option>GBP</option><option>EUR</option><option>CAD</option><option>AUD</option><option>PLN</option></select></label>
          <label className="text-sm">Default timezone<select value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-white/10 bg-[#0b0d10] px-3">{timezones.map((zone) => <option key={zone}>{zone}</option>)}</select></label>
        </div>
        <button onClick={() => save.mutate()} disabled={save.isPending} className="mt-6 flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm disabled:opacity-50"><Save size={14} /> {save.isPending ? "Saving..." : "Save changes"}</button>
      </section>

      <section className="mt-5 rounded-lg border border-red-500/20 p-5">
        <h2 className="mb-2 text-sm font-medium text-red-400">Danger zone</h2>
        <p className="mb-4 text-sm text-slate-500">Export a portable copy or permanently remove this workspace and its data.</p>
        <div className="flex flex-wrap gap-3"><button onClick={exportData} className="flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm"><Download size={14} /> Export all data</button><button onClick={() => setDeleteOpen(true)} className="flex items-center gap-2 rounded-md border border-red-500/30 px-3 py-2 text-sm text-red-400"><Trash2 size={14} /> Delete workspace</button></div>
      </section>

      {deleteOpen ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6"><div className="w-full max-w-md rounded-lg border border-white/10 bg-[#111419] p-5"><h2 className="font-medium">Delete {form.name}</h2><p className="mt-2 text-sm text-slate-500">Type the workspace name to confirm. All records and activity will be removed.</p><input value={deleteText} onChange={(event) => setDeleteText(event.target.value)} className="mt-4 h-10 w-full rounded-md border border-white/10 bg-transparent px-3" /><div className="mt-5 flex justify-end gap-2"><button onClick={() => setDeleteOpen(false)} className="rounded-md border border-white/10 px-3 py-2 text-sm">Cancel</button><button onClick={deleteWorkspace} disabled={deleteText !== form.name} className="rounded-md bg-red-600 px-3 py-2 text-sm disabled:opacity-40">Delete workspace</button></div></div></div> : null}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-sm">{label}<input value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-white/10 bg-transparent px-3" /></label>;
}
