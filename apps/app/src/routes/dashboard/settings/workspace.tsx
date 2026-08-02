import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, Building2, Check, Download, Globe, ImagePlus, Shield, Trash2, Users, X, Zap, Plus, Copy, CheckCircle2,
  CalendarClock,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../../lib/api-client";
import { downscaleImageToDataUrl } from "../../../lib/image-resize";
import { PageSkeleton } from "../../../components/ui/page-state";
import { FieldSelect } from "../../../components/ui/controls";
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
type Section = "general" | "profile" | "modules" | "periods" | "danger";

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
  { key: "periods",  label: "Reporting periods", icon: CalendarClock },
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
            className="flex items-center gap-2 rounded-sm border border-[var(--border-soft)] px-3 py-2 text-[12px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-50 transition-colors"
          >
            <ImagePlus size={13} /> {logoBusy ? "Saving…" : (logoPreview || organization?.imageUrl) ? "Change logo" : "Upload logo"}
          </button>
          <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">Square PNG or JPG, at least 256×256px, under 2 MB. Saves instantly.</p>
          {logoError && <p className="mt-1 text-[11px] text-[#d1524a]">{logoError}</p>}
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
          <div className="flex h-9 items-center rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)]">
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
          <FieldSelect value={form.currency ?? "USD"} onChange={v => setForm({ ...form, currency: v })}
            ariaLabel="Default currency" options={currencies.map(c => ({ value: c, label: c }))} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] text-[var(--text-faint)]">Default timezone</span>
          <FieldSelect value={form.timezone} onChange={v => setForm({ ...form, timezone: v })}
            ariaLabel="Default timezone" options={timezones.map(tz => ({ value: tz, label: tz }))} />
        </label>
      </div>

      <div className="flex justify-end">
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className={`flex items-center gap-2 rounded-sm px-5 py-2.5 text-[12px] font-semibold text-[var(--text-primary)] transition-all disabled:opacity-50 ${
            saved
              ? "border border-[var(--section-accent)] bg-[var(--section-accent-soft)]"
              : "border border-[var(--border-strong)] bg-[var(--section-accent-soft)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)]"
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
          className="flex items-center gap-2 rounded-sm border border-[var(--border-strong)] bg-[var(--section-accent-soft)] px-5 py-2.5 text-[12px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] disabled:opacity-50">
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
  const [exportedOnce, setExportedOnce] = useState(false);
  const [skipExport, setSkipExport] = useState(false);
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // REAL export — the full server bundle (records, tasks, decisions, goals, activities with a
  // manifest), not the settings form the old button downloaded.
  async function exportData() {
    setBusy("export"); setMsg(null);
    try {
      const bundle = await apiClient.get<Record<string, unknown>>("/settings/export");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
      a.download = `${form.slug || "workspace"}-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(a.href);
      setExportedOnce(true);
    } catch { setMsg("Export failed — owner/admin role required."); }
    finally { setBusy(null); }
  }

  async function deleteWorkspace() {
    if (deleteText !== form.name) return;
    setBusy("delete"); setMsg(null);
    try {
      const r = await apiClient.post<{ ok?: boolean; erase_after?: string; error?: string }>("/settings/workspace/delete", { confirm_name: deleteText });
      if (r.ok) { window.location.assign("/workspaces"); return; }
      setMsg(r.error ?? "Could not schedule deletion.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not schedule deletion."); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-faint)] mb-0.5">Danger Zone</h2>
        <p className="text-[11px] text-[var(--text-muted)]">Deleting is owner-only, needs the workspace name typed exactly, and keeps a 14-day restore window before anything is permanently erased.</p>
      </div>

      <div className="border border-[var(--border-soft)] rounded-sm p-6 space-y-4">
        <p className="text-[12px] text-[var(--text-muted)]">Export a portable copy of all workspace data, or schedule this workspace for deletion.</p>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => void exportData()} disabled={busy === "export"}
            className="flex items-center gap-2 rounded-sm border border-[var(--border-soft)] px-3 py-2 text-[12px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50">
            <Download size={13} /> {busy === "export" ? "Preparing…" : "Export all data"}
          </button>
          <button onClick={() => setDeleteOpen(true)}
            className="flex items-center gap-2 rounded-sm border border-[var(--border-strong)] px-3 py-2 text-[12px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] transition-colors">
            <Trash2 size={13} /> Delete workspace
          </button>
        </div>
        {msg && <p className="text-[11.5px]" style={{ color: "var(--status-error)" }}>{msg}</p>}
      </div>

      {deleteOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={() => setDeleteOpen(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-[var(--text-primary)]">Delete {form.name}</h2>
              <button onClick={() => setDeleteOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"><X size={15} /></button>
            </div>
            <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
              The workspace goes inert for every member immediately, and all data is <strong style={{ color: "var(--text-secondary)" }}>permanently erased after 14 days</strong>.
              You (the owner) can restore it any time inside that window — you'll get an email with the restore link.
            </p>

            {/* EXPORT-FIRST: deleting without a copy of your data requires an explicit opt-out. */}
            {!exportedOnce && !skipExport && (
              <div className="mt-4 rounded-sm border px-3 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
                <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>Take a copy first — it's one click.</p>
                <div className="mt-2 flex items-center gap-3">
                  <button onClick={() => void exportData()} disabled={busy === "export"}
                    className="btn-primary h-7 gap-1.5 px-3 text-[12px] font-semibold">
                    <Download size={12} /> {busy === "export" ? "Preparing…" : "Download export"}
                  </button>
                  <label className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                    <input type="checkbox" checked={skipExport} onChange={e => setSkipExport(e.target.checked)} /> delete without exporting
                  </label>
                </div>
              </div>
            )}

            <p className="mt-4 text-[12px]" style={{ color: "var(--text-muted)" }}>Type <strong style={{ color: "var(--text-secondary)" }}>{form.name}</strong> to confirm.</p>
            <input value={deleteText} onChange={e => setDeleteText(e.target.value)} placeholder={form.name} className="key-input mt-2 h-10 w-full px-3 text-[12px]" />
            {msg && <p className="mt-2 text-[11.5px]" style={{ color: "var(--status-error)" }}>{msg}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDeleteOpen(false)} className="rounded-sm border border-[var(--border-soft)] px-4 py-2 text-[12px] text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors">Cancel</button>
              <button onClick={() => void deleteWorkspace()}
                disabled={deleteText !== form.name || busy != null || (!exportedOnce && !skipExport)}
                className="rounded-sm border border-[#d1524a] bg-[color-mix(in_srgb,#d1524a_16%,transparent)] px-4 py-2 text-[12px] font-semibold text-[#d1524a] hover:bg-[color-mix(in_srgb,#d1524a_24%,transparent)] disabled:opacity-40 transition-colors">
                {busy === "delete" ? "Scheduling…" : "Schedule deletion (14-day window)"}
              </button>
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

  const field = "w-full rounded-sm border px-3 py-2 text-[13px] bg-transparent";
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
          className="btn-primary text-[13px] font-semibold">
          {save.isPending ? "Saving…" : "Save profile"}
        </button>
        {saved && <span className="flex items-center gap-1.5 text-[12px] text-[#2f9e6b]"><Check size={13} /> Saved</span>}
      </div>

      {/* Live preview — generated from the CURRENT edits (before save), so admins see the effect. */}
      <div className="mt-6 rounded-md border p-4" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card-2)" }}>
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


// ─── Reporting periods ───────────────────────────────────────────────────────

interface PeriodPreview {
  period_type: string; period_key: string; period_start: string; period_end: string;
  already_closed: boolean;
  metrics: Record<string, number | string>;
  inputs: Record<string, number | string>;
}

/**
 * The period close, from the operator's side.
 *
 * Deliberately NOT a "simulate rollover" button that mutates and hopes. Closing a period is
 * evidence-taking, so the default action is a PREVIEW: it computes exactly what would be filed and
 * shows it, and writing is a separate, explicit decision. It is also worth saying plainly on the
 * page that nothing is reset or deleted — the fear this panel has to answer is "will this wipe my
 * numbers", and the honest answer is that a period "resets" because a date filter moved, not
 * because anything was destroyed.
 */
function PeriodsSection() {
  const [type, setType] = useState("MONTHLY");
  const [preview, setPreview] = useState<PeriodPreview[] | null>(null);
  const [written, setWritten] = useState<{ period_type: string; period_key: string; status: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = useQuery<{ time_zone: string; week_start: number; periods: Record<string, { key: string; start: string; end: string; previous_key: string }> }>({
    queryKey: ["periods-current"],
    queryFn: () => apiClient.get("/periods/current"),
  });

  const snapshots = useQuery<{ snapshots: { period_type: string; period_key: string; closed_at: string; closed_by: string; metrics: Record<string, number> }[] }>({
    queryKey: ["period-snapshots"],
    queryFn: () => apiClient.get("/periods/snapshots?limit=12"),
  });

  const verify = useQuery<{ ok: boolean; checked: number; broken: { period_key: string; reason: string }[] }>({
    queryKey: ["period-verify", type],
    queryFn: () => apiClient.get(`/periods/verify?period_type=${type}`),
  });

  const dryRun = useMutation({
    mutationFn: () => apiClient.post<{ preview: PeriodPreview[] }>("/periods/close", { period_type: type, dry_run: true }),
    onSuccess: r => { setPreview(r.preview); setWritten(null); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  const qc = useQueryClient();
  const commit = useMutation({
    mutationFn: () => apiClient.post<{ results: { period_type: string; period_key: string; status: string }[] }>("/periods/close", { period_type: type, dry_run: false }),
    onSuccess: r => {
      setWritten(r.results); setPreview(null); setError(null);
      qc.invalidateQueries({ queryKey: ["period-snapshots"] });
      qc.invalidateQueries({ queryKey: ["period-verify"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const cur = current.data?.periods?.[type];

  return (
    <div className="max-w-2xl">
      <h3 className="text-[14px] font-medium text-[var(--text-primary)]">Reporting periods</h3>
      <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
        Closing a period files an immutable snapshot of what it held. It never deletes or resets
        anything — a new period reads as zero because the date filter moved, not because history went
        anywhere.
      </p>

      {current.data && (
        <div className="mt-4 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] p-3 text-[12px]">
          <div style={{ color: "var(--text-muted)" }}>
            Boundaries are computed in <span className="font-mono" style={{ color: "var(--text-secondary)" }}>{current.data.time_zone}</span>,
            weeks start {current.data.week_start === 1 ? "Monday" : "Sunday"}.
          </div>
          {cur && (
            <div className="mt-1.5 font-mono text-[11px]" style={{ color: "var(--text-secondary)" }}>
              current {cur.key} · previous {cur.previous_key}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[180px]">
          <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>Period type</label>
          <FieldSelect
            value={type}
            onChange={v => { setType(v); setPreview(null); setWritten(null); }}
            options={["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"].map(v => ({ value: v, label: v }))}
          />
        </div>
        <button
          onClick={() => dryRun.mutate()}
          disabled={dryRun.isPending || commit.isPending}
          className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"
        >
          {dryRun.isPending ? "Computing…" : "Preview close"}
        </button>
      </div>

      {error && (
        <p className="mt-3 text-[12px]" style={{ color: "var(--status-warn)" }}>{error}</p>
      )}

      {preview && (
        <div className="mt-4 rounded-sm border p-4" style={{ borderColor: "var(--section-accent-line)", background: "color-mix(in srgb, var(--section-accent) 4%, transparent)" }}>
          <h4 className="text-[12px] font-medium text-[var(--text-primary)]">Preview · nothing has been written</h4>
          {preview.map(p => (
            <div key={p.period_key} className="mt-3">
              <div className="font-mono text-[11px]" style={{ color: "var(--text-secondary)" }}>
                {p.period_type} {p.period_key}
                {p.already_closed && <span style={{ color: "var(--text-muted)" }}> · already on file</span>}
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[11px] tabular-nums sm:grid-cols-3">
                {Object.entries(p.metrics).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span style={{ color: "var(--text-muted)" }}>{k}</span>
                    <span style={{ color: "var(--text-primary)" }}>{String(v)}</span>
                  </div>
                ))}
              </div>
              {Number(p.inputs.unconverted ?? 0) > 0 && (
                <p className="mt-1 text-[11px]" style={{ color: "var(--status-warn)" }}>
                  {String(p.inputs.unconverted)} row(s) valued at today's rate — they predate the money model,
                  so this figure mixes frozen and live values.
                </p>
              )}
            </div>
          ))}
          <button
            onClick={() => commit.mutate()}
            disabled={commit.isPending}
            className="mt-4 rounded-sm px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
            style={{ background: "var(--section-accent)" }}
          >
            {commit.isPending ? "Filing…" : "File this snapshot"}
          </button>
        </div>
      )}

      {written && (
        <div className="mt-4 rounded-sm border px-4 py-3 text-[12px]" style={{ borderColor: "#2f9e6b", color: "var(--text-secondary)" }}>
          {written.filter(w => w.status === "written").length} snapshot(s) filed
          {written.some(w => w.status === "already_closed") && ", the rest were already on file"}.
        </div>
      )}

      {verify.data && verify.data.checked > 0 && (
        <p className="mt-4 text-[11px]" style={{ color: verify.data.ok ? "var(--text-muted)" : "var(--status-warn)" }}>
          {verify.data.ok
            ? `Hash chain intact across ${verify.data.checked} ${type.toLowerCase()} snapshot(s).`
            : `Chain broken: ${verify.data.broken.map(b => `${b.period_key} — ${b.reason}`).join("; ")}`}
        </p>
      )}

      {snapshots.data && snapshots.data.snapshots.length > 0 && (
        <div className="mt-5">
          <h4 className="mb-1.5 text-[12px] font-medium text-[var(--text-primary)]">Closed periods</h4>
          <ul className="divide-y divide-[var(--border-faint)] rounded-sm border border-[var(--border-soft)]">
            {snapshots.data.snapshots.map(s => (
              <li key={`${s.period_type}-${s.period_key}`} className="flex items-center justify-between gap-3 px-3 py-1.5 font-mono text-[11px]">
                <span style={{ color: "var(--text-secondary)" }}>{s.period_type} {s.period_key}</span>
                <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>
                  net {s.metrics?.net_margin ?? "—"} · {s.closed_by}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
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
    if (file.size > 10 * 1024 * 1024) { setLogoError("That image is too large — please use one under 10 MB."); return; }
    setLogoBusy(true);
    try {
      // SVGs stay vector (already tiny); raster logos downscale to a 256px thumbnail (~20–40 KB)
      // so logo_url doesn't ship a multi-MB base64 blob everywhere the sidebar reads it.
      const dataUrl = file.type === "image/svg+xml"
        ? await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(file); })
        : await downscaleImageToDataUrl(file, { max: 256, quality: 0.88 });
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
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-sm text-[12px] mb-0.5 transition-colors ${
              section === item.key ? "bg-[var(--surface-hover)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-faint)] hover:bg-[var(--surface-hover)]"
            } ${item.danger ? (section === item.key ? "text-[var(--text-faint)]" : "text-[#d1524a] hover:text-[var(--text-faint)]") : ""}`}
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
        {section === "periods" && <PeriodsSection />}
        {section === "danger" && <DangerZoneSection form={form} />}
      </div>
    </div>
  );
}
