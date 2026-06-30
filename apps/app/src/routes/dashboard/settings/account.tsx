import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, KeyRound, LogOut, Loader2, Monitor, Moon, Sun, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../../lib/api-client";
import { PageHeader, PageSkeleton } from "../../../components/ui/page-state";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
import { useSovereignAuthOptional } from "../../../components/auth/sovereign-auth-context";

type Appearance = "dark" | "light" | "system";
type NotificationChannel = { in_app: boolean; email: boolean };

interface Preferences {
  appearance: Appearance;
  job_title?: string;
  connected_accounts: { id: string; provider: string; email: string }[];
  notifications?: Record<string, NotificationChannel>;
  email_notifications?: boolean;
  agent_notifications?: boolean;
  task_notifications?: boolean;
  // AI personalization — how the assistant tailors itself to this operator.
  ai_expertise?: "novice" | "intermediate" | "expert";
  ai_response_length?: "concise" | "balanced" | "detailed";
  ai_address?: string;
  ai_context?: string;
}

type Expertise = "novice" | "intermediate" | "expert";
type ResponseLength = "concise" | "balanced" | "detailed";

const notificationTypes: [string, string][] = [
  ["mentions", "@mentions"],
  ["task_assigned", "Task assigned"],
  ["record_changed", "Followed record changed"],
  ["workflow_completed", "Workflow completed"],
  ["agent_completed", "Agent completed"],
  ["sequence_replied", "Sequence replied"],
  ["member_joined", "New team member joined"],
  ["billing_alerts", "Billing alerts"],
];

const shortcuts = [
  ["Open command palette", "⌘ K"],
  ["Search", "/"],
  ["Toggle sidebar", "["],
  ["New record", "N"],
  ["Edit focused record", "E"],
  ["Close modal or panel", "Esc"],
  ["Save in forms", "⌘ Enter"],
  ["Open AI chat", "⌘ ."],
];

export function applyTheme(appearance: Appearance) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = appearance === "dark" || (appearance === "system" && prefersDark);
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  document.documentElement.classList.toggle("dark", isDark);
}

function defaultNotifications(data?: Preferences) {
  return Object.fromEntries(notificationTypes.map(([key]) => [
    key,
    {
      in_app: data?.notifications?.[key]?.in_app ?? true,
      email: data?.notifications?.[key]?.email
        ?? (key === "agent_completed" ? data?.agent_notifications
          : key === "task_assigned" ? data?.task_notifications
          : data?.email_notifications) ?? true,
    },
  ])) as Record<string, NotificationChannel>;
}

export function AccountSettings() {
  const me = useCurrentUser();
  const sov = useSovereignAuthOptional();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const query = useQuery({
    queryKey: ["account-settings"],
    queryFn: () => apiClient.get<Preferences>("/settings/account"),
  });
  // Lightweight telemetry for the header stats strip.
  const walletQuery = useQuery({
    queryKey: ["credits-balance"],
    queryFn: () => apiClient.get<{ balance: number; granted: number; account_tier: string; trial_ends_at: string | null }>("/credits/balance"),
    staleTime: 60_000,
  });

  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function changePassword() {
    if (pwNext.length < 8 || pwBusy) { setPwMsg({ ok: false, text: "New password must be at least 8 characters." }); return; }
    setPwBusy(true); setPwMsg(null);
    try {
      await apiClient.post("/auth/change-password", { currentPassword: pwCurrent, newPassword: pwNext });
      setPwMsg({ ok: true, text: "Password updated." }); setPwCurrent(""); setPwNext(""); setPwOpen(false);
    } catch (e) {
      setPwMsg({ ok: false, text: e instanceof Error ? e.message : "Could not change password." });
    } finally { setPwBusy(false); }
  }
  const [appearance, setAppearance] = useState<Appearance>(
    () => (localStorage.getItem("mondaily_appearance") as Appearance | null) ?? "dark",
  );
  const [btnStyle, setBtnStyle] = useState<"dark" | "accent">(
    () => (localStorage.getItem("mondaily_btnstyle") as "dark" | "accent" | null) ?? "dark",
  );
  function chooseBtnStyle(s: "dark" | "accent") {
    setBtnStyle(s);
    localStorage.setItem("mondaily_btnstyle", s);
    if (s === "accent") document.documentElement.dataset.btnstyle = "accent";
    else delete document.documentElement.dataset.btnstyle;
  }
  const [notifications, setNotifications] = useState<Record<string, NotificationChannel>>({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [saved, setSaved] = useState(false);
  // AI personalization
  const [aiExpertise, setAiExpertise] = useState<Expertise>("intermediate");
  const [aiLength, setAiLength] = useState<ResponseLength>("balanced");
  const [aiAddress, setAiAddress] = useState("");
  const [aiContext, setAiContext] = useState("");

  useEffect(() => {
    if (!query.data) return;
    setName(me.name ?? "");
    setJobTitle(query.data.job_title ?? "");
    if (!localStorage.getItem("mondaily_appearance")) {
      setAppearance(query.data.appearance ?? "dark");
    }
    setNotifications(defaultNotifications(query.data));
    setAiExpertise(query.data.ai_expertise ?? "intermediate");
    setAiLength(query.data.ai_response_length ?? "balanced");
    setAiAddress(query.data.ai_address ?? "");
    setAiContext(query.data.ai_context ?? "");
  }, [query.data, me.name]);

  // Apply theme on change and on mount
  useEffect(() => {
    localStorage.setItem("mondaily_appearance", appearance);
    applyTheme(appearance);
  }, [appearance]);

  const save = useMutation({
    mutationFn: async () => {
      await apiClient.post("/members/sync", { name, email: me.email });
      return apiClient.patch("/settings/account", {
        job_title: jobTitle,
        appearance,
        notifications,
        connected_accounts: query.data?.connected_accounts ?? [],
        ai_expertise: aiExpertise,
        ai_response_length: aiLength,
        ai_address: aiAddress,
        ai_context: aiContext,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account-settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  // Notification toggles persist instantly (no need to hit Save) — the backend merges, so sending
  // only { notifications } is safe and won't clobber other prefs.
  const autosaveNotif = useMutation({
    mutationFn: (next: Record<string, NotificationChannel>) => apiClient.patch("/settings/account", { notifications: next }),
  });

  const disconnect = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/settings/account/connections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account-settings"] }),
  });

  async function uploadAvatar(file?: File) {
    if (!file || file.size > 2 * 1024 * 1024) return; // cap at 2 MB (stored as a data URL)
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    await apiClient.patch("/settings/profile", { avatar_url: dataUrl });
    await sov?.reloadProfile(); // profile header reflects the new avatar immediately
  }

  async function connect(provider: "gmail" | "outlook") {
    try {
      const { auth_url } = await apiClient.post<{ auth_url: string }>("/integrations/connect", { provider, login_hint: me.email ?? undefined });
      window.open(auth_url, "_blank", "width=520,height=680");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not start email connection.");
    }
  }

  async function deleteAccount() {
    if (deleteText !== "DELETE") return;
    await apiClient.delete("/auth/account").catch(() => {}); // purges data + clears cookies server-side
    localStorage.removeItem("mondaily_workspace_id");
    navigate("/auth/register");
  }

  function toggleNotif(key: string, channel: "in_app" | "email", value: boolean) {
    const cur = notifications;
    const next = {
      ...cur,
      [key]: { in_app: cur[key]?.in_app ?? true, email: cur[key]?.email ?? true, [channel]: value },
    };
    setNotifications(next);          // optimistic
    autosaveNotif.mutate(next);      // persist immediately
  }

  if (query.isLoading) return <PageSkeleton rows={8} />;
  const accounts = query.data?.connected_accounts ?? [];
  const hasPassword = true;

  return (
    <div className="space-y-5">
      <div className="mb-1">
        <p className="text-[11px] uppercase tracking-[0.2em]" style={{ color: "var(--accent)" }}>// OPERATOR PROFILE</p>
        <h1 className="mt-1 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Account</h1>
        <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>Your profile, AI personalization, preferences, and personal security.</p>
      </div>

      {/* ── Hero identity card ── */}
      <div className="relative overflow-hidden rounded-2xl border p-6"
        style={{ borderColor: "color-mix(in srgb, var(--accent) 25%, var(--border-soft))", background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, var(--surface-card)) 0%, var(--surface-card) 55%)" }}>
        {/* glow */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full" style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%)" }} />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="relative shrink-0">
            <img src={me.imageUrl ?? undefined} alt="" className="h-20 w-20 rounded-2xl object-cover ring-2" style={{ boxShadow: "0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent)" }} />
            <button onClick={() => fileRef.current?.click()} className="absolute -bottom-1.5 -right-1.5 grid h-7 w-7 place-items-center rounded-full border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}>
              <Camera size={12} />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => uploadAvatar(e.target.files?.[0])} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>{me.name || "Operator"}</h2>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 14%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)" }}>Verified ✓</span>
            </div>
            <p className="mt-0.5 text-[12.5px] text-stone-500">{me.email}</p>
            {jobTitle && <p className="text-[12px] text-stone-600">{jobTitle}</p>}
          </div>
          {/* stat chips */}
          <div className="flex shrink-0 gap-2">
            {([
              ["PLAN", walletQuery.data?.account_tier === "business" ? "Pro" : "Personal"],
              ["AI CREDITS", (walletQuery.data?.balance ?? 0).toLocaleString()],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-xl border px-3.5 py-2.5 text-center" style={{ borderColor: "var(--border-soft)", background: "color-mix(in srgb, var(--surface-card) 60%, transparent)" }}>
                <div className="text-[8.5px] uppercase tracking-widest text-stone-500">{label}</div>
                <div className="mt-0.5 text-[15px] font-semibold tabular-nums" style={{ color: "var(--accent)" }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Profile ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Profile</h2>
        </div>
        <div className="p-5">
          <div className="mb-5 flex items-center gap-4">
            <div className="relative">
              <img src={me.imageUrl ?? undefined} alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-white/[.07]" />
              <button
                onClick={() => fileRef.current?.click()}
                className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full border border-[var(--border-soft)] bg-[var(--surface-card)] text-stone-400 hover:text-[var(--text-primary)] transition-colors"
              >
                <Camera size={12} />
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => uploadAvatar(e.target.files?.[0])} />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">{me.name ?? ""}</p>
              <p className="text-xs text-stone-500">Click the camera to update your photo · JPG, PNG, WebP</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">Full name</span>
              <input value={name} onChange={e => setName(e.target.value)} className="key-input h-9 w-full px-3 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">Email</span>
              <div className="flex h-9 items-center rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3">
                <span className="min-w-0 flex-1 truncate text-sm text-stone-400">{me.email ?? ""}</span>
              </div>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">Job title</span>
              <input value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="Founder, Head of Sales…" className="key-input h-9 w-full px-3 text-sm" />
            </label>
          </div>
        </div>
      </section>

      {/* ── AI Personalization ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">AI personalization</h2>
          <span className="text-xs text-stone-500">How Mondaily tailors itself to you</span>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">Address me as</span>
              <div className="flex h-9 items-center rounded-sm border px-2.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-input)" }}>
                <span className="mr-1.5 font-mono text-sm" style={{ color: "var(--accent)" }}>&gt;</span>
                <input value={aiAddress} onChange={e => setAiAddress(e.target.value)} placeholder={me.name?.split(" ")[0] || "first_name"} className="h-full flex-1 bg-transparent font-mono text-sm outline-none" style={{ color: "var(--text-primary)" }} />
              </div>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">Expertise level</span>
              <select value={aiExpertise} onChange={e => setAiExpertise(e.target.value as Expertise)} className="key-input h-9 w-full px-3 font-mono text-sm">
                <option value="novice">Novice — explain thoroughly</option>
                <option value="intermediate">Intermediate — balanced</option>
                <option value="expert">Expert — terse, assume fluency</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">Preferred response length</span>
              <select value={aiLength} onChange={e => setAiLength(e.target.value as ResponseLength)} className="key-input h-9 w-full px-3 text-sm">
                <option value="concise">Concise</option>
                <option value="balanced">Balanced</option>
                <option value="detailed">Detailed</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">Context for the assistant</span>
            <textarea value={aiContext} onChange={e => setAiContext(e.target.value)} rows={3} placeholder="e.g. I run a B2B SaaS sales team; prioritize pipeline and revenue framing." className="key-input w-full resize-none p-3 text-sm" />
            <p className="mt-1.5 text-[11px] text-stone-600">Mondaily uses this to personalize how it reasons, addresses you, and frames answers across the workspace.</p>
          </label>
        </div>
      </section>

      {/* ── Appearance ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Appearance</h2>
          <span className="text-xs text-stone-500">Changes apply instantly</span>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-3 gap-3">
            {([["light", Sun, "Light"], ["dark", Moon, "Dark"], ["system", Monitor, "System"]] as const).map(([mode, Icon, label]) => {
              const active = appearance === mode;
              return (
                <button
                  key={mode}
                  onClick={() => setAppearance(mode)}
                  className="relative flex flex-col items-center gap-2.5 rounded-xl border py-5 transition-all"
                  style={{
                    borderColor: active ? "var(--accent)" : "var(--border-soft)",
                    background: active ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent",
                    color: active ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  <Icon size={18} style={{ color: active ? "var(--accent)" : "var(--text-muted)" }}/>
                  <span className="text-xs font-medium capitalize">{label}</span>
                  {active && <Check size={11} className="absolute right-2.5 top-2.5" style={{ color: "var(--accent)" }} />}
                </button>
              );
            })}
          </div>

          <div className="mt-5 border-t pt-5" style={{ borderColor: "var(--border-soft)" }}>
            <p className="mb-2.5 text-xs font-medium text-stone-400">Primary button style</p>
            <div className="grid grid-cols-2 gap-3">
              {([["dark", "Dark"], ["accent", "Sage green"]] as const).map(([s, label]) => (
                <button
                  key={s}
                  onClick={() => chooseBtnStyle(s)}
                  className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-all"
                  style={{
                    borderColor: btnStyle === s ? "var(--accent)" : "var(--border-soft)",
                    background: btnStyle === s ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent",
                  }}
                >
                  <span className="text-xs font-medium text-stone-300">{label}</span>
                  <span className="inline-flex h-6 items-center rounded-lg px-3 text-[11px] font-medium text-white" style={{ background: s === "accent" ? "var(--accent)" : "#18181b" }}>Save</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Password ── */}
      {hasPassword && (
        <section className="settings-section">
          <div className="settings-section-header">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Password</h2>
          </div>
          <div className="p-5">
            {!pwOpen ? (
              <button
                onClick={() => { setPwOpen(true); setPwMsg(null); }}
                className="flex items-center gap-2 rounded-lg border border-[var(--border-soft)] px-3 py-2 text-sm text-stone-300 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
              >
                <KeyRound size={14} /> Change password
              </button>
            ) : (
              <div className="max-w-sm space-y-3">
                <input type="password" autoComplete="current-password" placeholder="Current password" value={pwCurrent} onChange={e => setPwCurrent(e.target.value)} className="key-input h-9 w-full px-3 text-sm" />
                <input type="password" autoComplete="new-password" placeholder="New password (8+ chars)" value={pwNext} onChange={e => setPwNext(e.target.value)} className="key-input h-9 w-full px-3 text-sm" />
                <div className="flex items-center gap-2">
                  <button onClick={changePassword} disabled={pwBusy || !pwCurrent || pwNext.length < 8}
                    className="flex items-center gap-2 rounded-lg border border-[var(--border-soft)] px-3 py-2 text-sm text-stone-300 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50">
                    {pwBusy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Update password
                  </button>
                  <button onClick={() => { setPwOpen(false); setPwCurrent(""); setPwNext(""); setPwMsg(null); }} className="text-sm text-stone-500 hover:text-stone-300">Cancel</button>
                </div>
              </div>
            )}
            {pwMsg && <p className={`mt-3 text-xs ${pwMsg.ok ? "text-emerald-400" : "text-rose-400"}`}>{pwMsg.text}</p>}
          </div>
        </section>
      )}

      {/* ── Connected accounts ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Connected accounts</h2>
        </div>
        <div className="divide-y divide-white/[.05] px-5">
          {(["gmail", "outlook"] as const).map(provider => {
            const account = accounts.find(a => a.provider.toLowerCase().includes(provider));
            return (
              <div key={provider} className="flex items-center justify-between py-3.5">
                <div>
                  <p className="text-sm font-medium text-stone-200">{provider === "gmail" ? "Google" : "Outlook"}</p>
                  <p className="mt-0.5 text-xs text-stone-500">{account?.email ?? "Not connected"}</p>
                </div>
                {account ? (
                  <button onClick={() => disconnect.mutate(account.id)} className="font-mono text-[10.5px] uppercase tracking-wider text-stone-500 transition-colors hover:text-rose-400">[ TERMINATE LINK ]</button>
                ) : (
                  <button onClick={() => connect(provider)} className="rounded-sm border px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-wider text-stone-400 transition-colors hover:text-[var(--text-primary)]" style={{ borderColor: "var(--border-soft)" }} onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--accent)")} onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border-soft)")}>[ ESTABLISH SECURE HANDSHAKE ]</button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Notifications ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Notification preferences</h2>
          <span className="text-xs text-stone-500">{autosaveNotif.isPending ? "Saving…" : "Saves automatically"}</span>
        </div>
        <div className="px-5">
          {/* Header row */}
          <div className="grid grid-cols-[1fr_76px_76px] items-center border-b border-[var(--border-soft)] py-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-700">Notification</span>
            <span className="text-center text-[10px] font-semibold uppercase tracking-widest text-stone-700">In-app</span>
            <span className="text-center text-[10px] font-semibold uppercase tracking-widest text-stone-700">Email</span>
          </div>
          {notificationTypes.map(([key, label]) => (
            <div key={key} className="grid grid-cols-[1fr_76px_76px] items-center border-b border-[var(--border-soft)] py-3 last:border-0">
              <span className="text-sm text-stone-300">{label}</span>
              {(["in_app", "email"] as const).map(channel => (
                <div key={channel} className="flex justify-center">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={notifications[key]?.[channel] ?? true}
                    onClick={() => toggleNotif(key, channel, !(notifications[key]?.[channel] ?? true))}
                    className="md-toggle"
                  >
                    <span className="md-toggle-thumb" />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ── Keyboard shortcuts ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Keyboard shortcuts</h2>
        </div>
        <div className="divide-y divide-white/[.04] px-5">
          {shortcuts.map(([label, keys]) => (
            <div key={label} className="flex items-center justify-between py-3">
              <span className="text-sm text-stone-400">{label}</span>
              <kbd className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2.5 py-1 font-mono text-[11px] text-stone-400">{keys}</kbd>
            </div>
          ))}
        </div>
      </section>

      {/* ── Danger zone ── */}
      <section className="settings-section border-stone-500/[.15]">
        <div className="settings-section-header border-stone-500/[.08]">
          <h2 className="text-sm font-semibold text-stone-400">Danger zone</h2>
        </div>
        <div className="flex flex-wrap gap-3 p-5">
          <button
            onClick={() => { (async () => { await sov?.logout(); localStorage.removeItem("mondaily_workspace_id"); navigate("/auth/shadow-login"); })(); }}
            className="flex items-center gap-2 rounded-lg border border-[var(--border-soft)] px-3 py-2 text-sm text-stone-300 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            <LogOut size={14} /> Sign out
          </button>
          <button
            onClick={() => setDeleteOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-stone-500/30 px-3 py-2 text-sm text-stone-400 hover:bg-stone-500/[.08] transition-colors"
          >
            <Trash2 size={14} /> Delete account
          </button>
        </div>
      </section>

      {/* ── Save ── */}
      <div className="flex justify-end pt-1 pb-4">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-[var(--text-primary)] transition-all disabled:opacity-50 ${
            saved
              ? "border border-[var(--accent)] bg-stone-700"
              : "border border-stone-500/30 bg-stone-600 hover:bg-stone-500"
          }`}
        >
          {saved ? <><Check size={14} /> Saved</> : save.isPending ? "Saving…" : "Save changes"}
        </button>
      </div>

      {/* ── Delete confirm modal ── */}
      {deleteOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={() => setDeleteOpen(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-card)] p-6 shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
            <h2 className="font-semibold text-[var(--text-primary)]">Delete account</h2>
            <p className="mt-2 text-sm text-stone-500">This permanently deletes your account and all data. Type <strong className="text-[var(--text-primary)]">DELETE</strong> to confirm.</p>
            <input value={deleteText} onChange={e => setDeleteText(e.target.value)} placeholder="DELETE" className="key-input mt-4 h-10 w-full px-3 text-sm" />
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDeleteOpen(false)} className="rounded-lg border border-[var(--border-soft)] px-4 py-2 text-sm text-stone-400 hover:text-[var(--text-primary)] transition-colors">Cancel</button>
              <button onClick={deleteAccount} disabled={deleteText !== "DELETE"} className="rounded-lg bg-stone-600 px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-stone-500 disabled:opacity-40 transition-colors">Delete account</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
