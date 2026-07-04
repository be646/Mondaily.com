import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, Building2, Check, Download, Globe, ImagePlus, Shield, Trash2, Users, X, Zap, Plus, Copy, CheckCircle2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../../lib/api-client";
import { PageSkeleton } from "../../../components/ui/page-state";
import { EMPTY_PROFILE, discoverySuggestions, askStarterPrompts, profileRecommendations, type WorkspaceProfile } from "@mondaily/shared/profile";

interface WorkspaceData {
  name: string;
  timezone: string;
  slug?: string;
  currency?: string;
  logo_url?: string;
  modules?: string[];
  profile?: WorkspaceProfile;
}

interface InviteResult {
  invite_link?: string;
}

// ids persisted/referenced elsewhere — keep stable; only labels/descriptions carry the rebrand.
const AVAILABLE_MODULES = [
  { id: "finance", label: "Finance & Billing", description: "Invoices, credit notes, payments, approval workflows" },
  { id: "investments", label: "Quantitative Asset Systems", description: "Track asset portfolios, rounds, and returns" },
  { id: "hr", label: "Autonomous Workforce", description: "Headcount, contracts, operational intelligence vectors" },
];

const timezones = [
  "UTC", "Europe/London", "Europe/Paris", "Europe/Warsaw",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
];
const currencies = ["USD", "GBP", "EUR", "CAD", "AUD", "PLN", "AED", "SGD", "JPY"];

// Members & finance access were consolidated into the dedicated Members page (Settings → Members)
// to remove the duplicate people/roles surface. Workspace settings = identity + modules + danger.
type Section = "general" | "profile" | "modules" | "danger";

interface NavItem {
  key: Section;
  label: string;
  icon: React.ElementType;
  danger?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { key: "general",  label: "General",     icon: Building2 },
  { key: "profile",  label: "Workspace profile", icon: Globe },
  { key: "modules",  label: "Modules",     icon: Zap },
  { key: "danger",   label: "Danger Zone", icon: AlertCircle, danger: true },
];

// ─── General ─────────────────────────────────────────────────────────────────

function GeneralSection({
  form, setForm, save, saved, organization, logoPreview, onUploadLogo, logoRef, logoError, logoBusy,
}: {
  form: WorkspaceData;
  setForm: (f: WorkspaceData) => void;
  save: { mutate: () => void; isPending: boolean };
  saved: boolean;
  organization: { name?: string; imageUrl?: string } | null;
  logoPreview: string;
  onUploadLogo: (file?: File) => void;
  logoRef: React.RefObject<HTMLInputElement | null>;
  logoError: string;
  logoBusy: boolean;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-0.5">General</h2>
        <p className="text-[11px] text-[var(--text-muted)]">Workspace identity and regional settings.</p>
      </div>

      {/* Logo */}
      <div className="flex items-center gap-4">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)]">
          {logoPreview || organization?.imageUrl
            ? <img src={logoPreview || organization?.imageUrl} alt="" className="h-full w-full object-cover" />
            : <span className="text-xl font-bold text-[var(--text-faint)]">{(form.name || "W").slice(0, 1).toUpperCase()}</span>}
        </div>
        <div>
          <button
            onClick={() => logoRef.current?.click()}
            disabled={logoBusy}
            className="flex items-center gap-2 rounded-lg border border-[var(--border-soft)] px-3 py-2 text-[12px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-50 transition-colors"
          >
            <ImagePlus size={13} /> {logoBusy ? "Saving…" : (logoPreview || organization?.imageUrl) ? "Change logo" : "Upload logo"}
          </button>
          <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">Square PNG or JPG, at least 256×256px, under 2 MB. Saves instantly.</p>
          {logoError && <p className="mt-1 text-[11px] text-rose-400">{logoError}</p>}
        </div>
        <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => onUploadLogo(e.target.files?.[0])} />
      </div>

      {/* Fields */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[11px] text-[var(--text-faint)]">Workspace name</span>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="key-input h-9 w-full px-3 text-[12px]" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] text-[var(--text-faint)]">Workspace URL</span>
          <div className="flex h-9 items-center rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)]">
            <span className="border-r border-[var(--border-soft)] px-3 text-[11px] text-[var(--text-muted)]">app.mondaily.com/</span>
            <input
              value={form.slug ?? ""}
              onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
              className="min-w-0 flex-1 bg-transparent px-3 text-[12px] outline-none text-[var(--text-primary)]"
            />
          </div>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] text-[var(--text-faint)]">Default currency</span>
          <select value={form.currency ?? "USD"} onChange={e => setForm({ ...form, currency: e.target.value })}
            className="key-input h-9 w-full px-3 text-[12px]">
            {currencies.map(c => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] text-[var(--text-faint)]">Default timezone</span>
          <select value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })}
            className="key-input h-9 w-full px-3 text-[12px]">
            {timezones.map(tz => <option key={tz}>{tz}</option>)}
          </select>
        </label>
      </div>

      <div className="flex justify-end">
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className={`flex items-center gap-2 rounded-sm px-5 py-2.5 text-[12px] font-semibold text-[var(--text-primary)] transition-all disabled:opacity-50 ${
            saved
              ? "border border-[var(--section-accent)] bg-stone-700"
              : "border border-stone-500/30 bg-stone-600 hover:bg-stone-500"
          }`}>
          {saved ? <><Check size={13} /> Saved</> : save.isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
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
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-0.5">Modules</h2>
        <p className="text-[11px] text-[var(--text-muted)]">Enable or disable product modules for your workspace.</p>
      </div>

      {AVAILABLE_MODULES.map(mod => {
        const enabled = (form.modules ?? ["crm"]).includes(mod.id);
        return (
          <div key={mod.id} className="flex items-center justify-between rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-4 py-3">
            <div>
              <p className="text-[12px] font-medium text-[var(--text-primary)]">{mod.label}</p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{mod.description}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                const current = form.modules ?? ["crm"];
                const next = enabled
                  ? current.filter(m => m !== mod.id)
                  : [...current, mod.id];
                setForm({ ...form, modules: next });
                // Instant persist — toggle updates the workspace scope immediately (no Save needed).
                apiClient.patch("/settings/workspace", { modules: next }).catch(() => {});
              }}
              className="relative h-5 w-9 shrink-0 rounded-full border transition-colors"
              style={{
                // off-state must NOT match the row bg (surface-hover) or it vanishes — use a distinct
                // track + border; on-state uses the sage accent.
                background: enabled ? "var(--section-accent)" : "var(--surface-card)",
                borderColor: enabled ? "transparent" : "var(--border-strong, var(--border-soft))",
              }}
            >
              <span
                className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white shadow transition-all"
                style={{ left: enabled ? "calc(100% - 0.875rem - 3px)" : "3px" }}
              />
            </button>
          </div>
        );
      })}

      <div className="flex items-center justify-end gap-3 pt-2">
        <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>toggles persist instantly</span>
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="flex items-center gap-2 rounded-sm border border-stone-500/30 bg-stone-700 px-5 py-2.5 text-[12px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-stone-600 disabled:opacity-50">
          {saved ? <><Check size={13} /> Saved</> : save.isPending ? "Saving…" : "Save all"}
        </button>
      </div>
    </div>
  );
}

// ─── Danger Zone ──────────────────────────────────────────────────────────────

function DangerZoneSection({ form }: { form: WorkspaceData }) {
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
    if (deleteText !== form.name) return;
    await apiClient.delete("/settings/workspace");
    window.location.assign("/workspaces");
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-faint)] mb-0.5">Danger Zone</h2>
        <p className="text-[11px] text-[var(--text-muted)]">Irreversible actions. Proceed with caution.</p>
      </div>

      <div className="border border-stone-500/20 rounded-sm p-6 space-y-4">
        <p className="text-[12px] text-[var(--text-muted)]">Export a portable copy of all workspace data, or permanently delete this workspace.</p>
        <div className="flex flex-wrap gap-3">
          <button onClick={exportData}
            className="flex items-center gap-2 rounded-lg border border-[var(--border-soft)] px-3 py-2 text-[12px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors">
            <Download size={13} /> Export all data
          </button>
          <button onClick={() => setDeleteOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-stone-500/30 px-3 py-2 text-[12px] text-[var(--text-faint)] hover:bg-stone-500/[.08] transition-colors">
            <Trash2 size={13} /> Delete workspace
          </button>
        </div>
      </div>

      {deleteOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={() => setDeleteOpen(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] p-6 shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-semibold text-[var(--text-primary)]">Delete {form.name}</h2>
              <button onClick={() => setDeleteOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"><X size={15} /></button>
            </div>
            <p className="text-[12px] text-[var(--text-muted)]">All records, members, and activity in this workspace will be permanently removed. This cannot be undone. Type the workspace name to confirm.</p>
            <input value={deleteText} onChange={e => setDeleteText(e.target.value)} placeholder={form.name} className="key-input mt-4 h-10 w-full px-3 text-[12px]" />
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDeleteOpen(false)} className="rounded-lg border border-[var(--border-soft)] px-4 py-2 text-[12px] text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors">Cancel</button>
              <button onClick={deleteWorkspace} disabled={deleteText !== form.name} className="rounded-lg bg-stone-600 px-4 py-2 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-stone-500 disabled:opacity-40 transition-colors">Delete workspace</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

// ─── Workspace profile ───────────────────────────────────────────────────────
// Industry-aware personalization. Only tunes examples, terminology and defaults across Discovery,
// Ask and suggestions — Mondaily stays a general autonomous workspace + asset-graph engine.
function ProfileSection({ initial }: { initial: WorkspaceProfile }) {
  const qc = useQueryClient();
  const [p, setP] = useState<WorkspaceProfile>(initial);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setP(initial); }, [initial]);

  const set = <K extends keyof WorkspaceProfile>(k: K, v: WorkspaceProfile[K]) => setP(prev => ({ ...prev, [k]: v }));
  const rec = profileRecommendations(p);   // live recommendations from the current edits

  const save = useMutation({
    mutationFn: () => apiClient.patch("/settings/workspace", { profile: p }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace-settings"] });
      qc.invalidateQueries({ queryKey: ["workspace-suggestions"] });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    },
    onError: (e: unknown) => alert(e instanceof Error ? e.message : "Could not save the workspace profile."),
  });

  const field = "w-full rounded-lg border px-3 py-2 text-[13px] bg-transparent";
  const style = { borderColor: "var(--border-soft)", color: "var(--text-primary)" } as const;
  const Label = ({ children }: { children: React.ReactNode }) =>
    <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">{children}</label>;

  return (
    <div className="max-w-2xl">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-0.5">Workspace profile</h2>
        <p className="text-[12px] text-[var(--text-muted)]">Tell Mondaily about your business so Discovery examples, Ask prompts and AI context adapt to you. This only changes examples and wording — never your data.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><Label>Industry</Label><input className={field} style={style} value={p.industry} onChange={e => set("industry", e.target.value)} placeholder="e.g. Aesthetic clinics" /></div>
        <div><Label>Region</Label><input className={field} style={style} value={p.region} onChange={e => set("region", e.target.value)} placeholder="e.g. London, Poland" /></div>
        <div className="sm:col-span-2"><Label>Target customers</Label><input className={field} style={style} value={p.target_customers} onChange={e => set("target_customers", e.target.value)} placeholder="Who you sell to / serve" /></div>
        <div className="sm:col-span-2"><Label>Discovery focus</Label><input className={field} style={style} value={p.discovery_focus} onChange={e => set("discovery_focus", e.target.value)} placeholder="e.g. clinics with poor reviews" /></div>
        <div><Label>Language</Label><input className={field} style={style} value={p.language} onChange={e => set("language", e.target.value)} placeholder="en" /></div>
        <div><Label>Business model</Label><input className={field} style={style} value={p.business_model} onChange={e => set("business_model", e.target.value)} placeholder="e.g. B2B services" /></div>
        <div className="sm:col-span-2"><Label>Primary goals <span className="text-[var(--text-faint)]">(comma-separated)</span></Label>
          <input className={field} style={style} value={p.primary_goals.join(", ")} onChange={e => set("primary_goals", e.target.value.split(",").map(s => s.trim()).filter(Boolean))} placeholder="book more consultations, reduce no-shows" /></div>
        <div className="sm:col-span-2"><Label>Preferred terms <span className="text-[var(--text-faint)]">(one per line, generic = yours)</span></Label>
          <textarea className={`${field} min-h-[70px] font-mono text-[12px]`} style={style}
            value={Object.entries(p.preferred_terms).map(([k, v]) => `${k} = ${v}`).join("\n")}
            onChange={e => set("preferred_terms", Object.fromEntries(e.target.value.split("\n").map(l => l.split("=").map(s => s.trim())).filter(pair => pair.length === 2 && pair[0] && pair[1]) as [string, string][]))}
            placeholder={"contact = patient\ndeal = case"} /></div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="rounded-lg bg-stone-950 px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-black">
          {save.isPending ? "Saving…" : "Save profile"}
        </button>
        {saved && <span className="flex items-center gap-1.5 text-[12px] text-emerald-500"><Check size={13} /> Saved</span>}
      </div>

      {/* Live preview — generated from the CURRENT edits (before save), so admins see the effect. */}
      <div className="mt-6 rounded-xl border p-4" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card-2)" }}>
        <p className="text-[12px] font-medium text-[var(--text-primary)]">Preview</p>
        <p className="mb-3 text-[11px] text-[var(--text-muted)]">These update Discovery examples and Ask AI context. Saving applies them across the app.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PreviewList title="Discovery examples" items={discoverySuggestions(p, 3)} />
          <PreviewList title="Ask prompts" items={askStarterPrompts(p, 3)} />
          <PreviewList title="Suggested agents" items={rec.agents} />
          <PreviewList title="Suggested automations" items={rec.automations} />
        </div>
        <p className="mt-2 text-[10.5px] text-[var(--text-faint)]">Suggestions are recommendations only — nothing is created automatically.</p>
      </div>
    </div>
  );
}

function PreviewList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{title}</p>
      <ul className="space-y-0.5">
        {items.map(i => <li key={i} className="truncate text-[12px] text-[var(--text-secondary)]" title={i}>· {i}</li>)}
      </ul>
    </div>
  );
}

export function WorkspaceSettings() {
  const qc = useQueryClient();
  const logoRef = useRef<HTMLInputElement>(null);
  const [section, setSection] = useState<Section>("general");

  const query = useQuery({
    queryKey: ["workspace-settings"],
    queryFn: () => apiClient.get<WorkspaceData>("/settings/workspace"),
  });
  const [form, setForm] = useState<WorkspaceData>({ name: "", slug: "", currency: "USD", timezone: "UTC", modules: ["crm"] });
  const [logoPreview, setLogoPreview] = useState("");
  const [logoError, setLogoError] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (query.data) setForm({
      ...query.data,
      slug: query.data.slug ?? "",
      currency: query.data.currency ?? "USD",
      modules: query.data.modules ?? ["crm"],
    });
  }, [query.data]);

  const save = useMutation({
    mutationFn: async () => {
      return apiClient.patch("/settings/workspace", form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace-settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    // Surface the backend's slug-uniqueness 409 (or any save failure) instead of failing silently.
    onError: (e: unknown) => alert(e instanceof Error ? e.message : "Could not save workspace settings."),
  });

  async function uploadLogo(file?: File) {
    setLogoError("");
    if (!file) return;
    // Validate with FEEDBACK — the old code silently returned on a too-large file, so re-uploading
    // a bigger logo looked like "nothing happened".
    if (!file.type.startsWith("image/")) { setLogoError("Please choose an image file (PNG, JPG, SVG…)."); return; }
    if (file.size > 2 * 1024 * 1024) { setLogoError("That image is too large — please use one under 2 MB."); return; }
    setLogoBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      setLogoPreview(dataUrl);
      const next = { ...form, logo_url: dataUrl };
      setForm(next);
      // Persist IMMEDIATELY (don't wait for the separate Save button) and invalidate the shared
      // workspace-settings cache so the sidebar + this page update live — no manual refresh needed.
      await apiClient.patch("/settings/workspace", next);
      await qc.invalidateQueries({ queryKey: ["workspace-settings"] });
    } catch {
      setLogoError("Couldn't save the logo — please try again.");
    } finally {
      setLogoBusy(false);
      if (logoRef.current) logoRef.current.value = ""; // reset so re-selecting the SAME file re-fires onChange
    }
  }

  if (query.isLoading) return <PageSkeleton rows={6} />;

  return (
    <div className="flex gap-8">
      {/* Left sidebar */}
      <div className="w-48 shrink-0 pt-1">
        {NAV_ITEMS.map(item => (
          <button
            key={item.key}
            onClick={() => setSection(item.key)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] mb-0.5 transition-colors ${
              section === item.key ? "bg-[var(--surface-hover)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-faint)] hover:bg-[var(--surface-hover)]"
            } ${item.danger ? (section === item.key ? "text-[var(--text-faint)]" : "text-red-500 hover:text-[var(--text-faint)]") : ""}`}
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
            organization={form.logo_url ? { name: form.name, imageUrl: form.logo_url } : null}
            logoPreview={logoPreview}
            onUploadLogo={uploadLogo}
            logoRef={logoRef}
            logoError={logoError}
            logoBusy={logoBusy}
          />
        )}
        {section === "profile" && (
          <ProfileSection initial={query.data?.profile ?? EMPTY_PROFILE} />
        )}
        {section === "modules" && (
          <ModulesSection form={form} setForm={setForm} save={save} saved={saved} />
        )}
        {section === "danger" && <DangerZoneSection form={form} />}
      </div>
    </div>
  );
}
