import { useClerk, useUser } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, KeyRound, LogOut, Monitor, Moon, Sun, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiClient, BASE_URL } from "../../../lib/api-client";
import { PageHeader, PageSkeleton } from "../../../components/ui/page-state";

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
}

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
  const { user } = useUser();
  const { signOut, openUserProfile } = useClerk();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const query = useQuery({
    queryKey: ["account-settings"],
    queryFn: () => apiClient.get<Preferences>("/settings/account"),
  });

  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [appearance, setAppearance] = useState<Appearance>(
    () => (localStorage.getItem("mondaily_appearance") as Appearance | null) ?? "dark",
  );
  const [notifications, setNotifications] = useState<Record<string, NotificationChannel>>({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!query.data) return;
    setName(user?.fullName ?? "");
    setJobTitle(query.data.job_title ?? "");
    if (!localStorage.getItem("mondaily_appearance")) {
      setAppearance(query.data.appearance ?? "dark");
    }
    setNotifications(defaultNotifications(query.data));
  }, [query.data, user?.fullName]);

  // Apply theme on change and on mount
  useEffect(() => {
    localStorage.setItem("mondaily_appearance", appearance);
    applyTheme(appearance);
  }, [appearance]);

  const save = useMutation({
    mutationFn: async () => {
      const [firstName, ...rest] = name.trim().split(/\s+/);
      await user?.update({ firstName, lastName: rest.join(" ") });
      return apiClient.patch("/settings/account", {
        job_title: jobTitle,
        appearance,
        notifications,
        connected_accounts: query.data?.connected_accounts ?? [],
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account-settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const disconnect = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/settings/account/connections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account-settings"] }),
  });

  async function uploadAvatar(file?: File) {
    if (!file || !user) return;
    await user.setProfileImage({ file });
  }

  function connect(provider: "gmail" | "outlook") {
    window.open(`${BASE_URL}/api/v1/integrations/${provider}/connect`, "_blank", "width=520,height=680");
  }

  async function deleteAccount() {
    if (deleteText !== "DELETE" || !user) return;
    await user.delete();
    await signOut({ redirectUrl: "/sign-up" });
  }

  function toggleNotif(key: string, channel: "in_app" | "email", value: boolean) {
    setNotifications(cur => ({
      ...cur,
      [key]: { in_app: cur[key]?.in_app ?? true, email: cur[key]?.email ?? true, [channel]: value },
    }));
  }

  if (query.isLoading) return <PageSkeleton rows={8} />;
  const accounts = query.data?.connected_accounts ?? [];
  const hasPassword = (user?.externalAccounts.length ?? 0) === 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Account" description="Manage your profile, preferences, and personal security." />

      {/* ── Profile ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-white">Profile</h2>
        </div>
        <div className="p-5">
          <div className="mb-5 flex items-center gap-4">
            <div className="relative">
              <img src={user?.imageUrl} alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-white/[.07]" />
              <button
                onClick={() => fileRef.current?.click()}
                className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full border border-white/[.09] bg-[#141414] text-stone-400 hover:text-white transition-colors"
              >
                <Camera size={12} />
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => uploadAvatar(e.target.files?.[0])} />
            </div>
            <div>
              <p className="text-sm font-medium text-white">{user?.fullName}</p>
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
              <div className="flex h-9 items-center rounded-lg border border-white/[.09] bg-white/[.02] px-3">
                <span className="min-w-0 flex-1 truncate text-sm text-stone-400">{user?.primaryEmailAddress?.emailAddress}</span>
                <button onClick={() => openUserProfile()} className="text-xs text-stone-400 hover:text-stone-300 transition-colors">Change</button>
              </div>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">Job title</span>
              <input value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="Founder, Head of Sales…" className="key-input h-9 w-full px-3 text-sm" />
            </label>
          </div>
        </div>
      </section>

      {/* ── Appearance ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-[#111827] dark:text-white">Appearance</h2>
          <span className="text-xs text-[#9ca3af] dark:text-stone-600">Changes apply instantly</span>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-3 gap-3">
            {([["light", Sun, "Light"], ["dark", Moon, "Dark"], ["system", Monitor, "System"]] as const).map(([mode, Icon, label]) => (
              <button
                key={mode}
                onClick={() => setAppearance(mode)}
                className={`relative flex flex-col items-center gap-2.5 rounded-xl border py-5 transition-all ${
                  appearance === mode
                    ? "border-[var(--accent)] bg-[#eef2ff] text-[#312e81] dark:border-stone-500/50 dark:bg-stone-500/[.06] dark:text-white"
                    : "border-[#e5e7eb] bg-white text-[#52525b] hover:bg-[#f9fafb] dark:border-white/[.07] dark:bg-transparent dark:text-stone-500 dark:hover:border-white/[.14] dark:hover:text-stone-300"
                }`}
              >
                <Icon size={18} className={appearance === mode ? "text-[var(--accent)] dark:text-white" : ""}/>
                <span className="text-xs font-medium capitalize">{label}</span>
                {appearance === mode && <Check size={11} className="absolute right-2.5 top-2.5 text-[var(--accent)] dark:text-stone-400" />}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Password ── */}
      {hasPassword && (
        <section className="settings-section">
          <div className="settings-section-header">
            <h2 className="text-sm font-semibold text-white">Password</h2>
          </div>
          <div className="p-5">
            <p className="mb-4 text-sm text-stone-500">Update your password through the secure identity profile.</p>
            <button
              onClick={() => openUserProfile()}
              className="flex items-center gap-2 rounded-lg border border-white/[.09] px-3 py-2 text-sm text-stone-300 hover:bg-white/[.04] hover:text-white transition-colors"
            >
              <KeyRound size={14} /> Change password
            </button>
          </div>
        </section>
      )}

      {/* ── Connected accounts ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-white">Connected accounts</h2>
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
                  <button onClick={() => disconnect.mutate(account.id)} className="text-xs text-stone-400 hover:text-stone-300 transition-colors">Disconnect</button>
                ) : (
                  <button onClick={() => connect(provider)} className="rounded-lg border border-white/[.09] px-3 py-1.5 text-xs text-stone-300 hover:bg-white/[.04] hover:text-white transition-colors">Connect</button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Notifications ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-white">Notification preferences</h2>
        </div>
        <div className="px-5">
          {/* Header row */}
          <div className="grid grid-cols-[1fr_76px_76px] items-center border-b border-white/[.05] py-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-700">Notification</span>
            <span className="text-center text-[10px] font-semibold uppercase tracking-widest text-stone-700">In-app</span>
            <span className="text-center text-[10px] font-semibold uppercase tracking-widest text-stone-700">Email</span>
          </div>
          {notificationTypes.map(([key, label]) => (
            <div key={key} className="grid grid-cols-[1fr_76px_76px] items-center border-b border-white/[.04] py-3 last:border-0">
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
          <h2 className="text-sm font-semibold text-white">Keyboard shortcuts</h2>
        </div>
        <div className="divide-y divide-white/[.04] px-5">
          {shortcuts.map(([label, keys]) => (
            <div key={label} className="flex items-center justify-between py-3">
              <span className="text-sm text-stone-400">{label}</span>
              <kbd className="rounded-md border border-white/[.09] bg-white/[.03] px-2.5 py-1 font-mono text-[11px] text-stone-400">{keys}</kbd>
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
            onClick={() => signOut({ redirectUrl: "/sign-in" })}
            className="flex items-center gap-2 rounded-lg border border-white/[.09] px-3 py-2 text-sm text-stone-300 hover:bg-white/[.04] hover:text-white transition-colors"
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
          className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-50 ${
            saved
              ? "bg-emerald-600 border border-emerald-500/30"
              : "border border-stone-400/40 bg-stone-500 hover:bg-stone-400"
          }`}
        >
          {saved ? <><Check size={14} /> Saved</> : save.isPending ? "Saving…" : "Save changes"}
        </button>
      </div>

      {/* ── Delete confirm modal ── */}
      {deleteOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={() => setDeleteOpen(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[.09] bg-[#141414] p-6 shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
            <h2 className="font-semibold text-white">Delete account</h2>
            <p className="mt-2 text-sm text-stone-500">This permanently deletes your account and all data. Type <strong className="text-white">DELETE</strong> to confirm.</p>
            <input value={deleteText} onChange={e => setDeleteText(e.target.value)} placeholder="DELETE" className="key-input mt-4 h-10 w-full px-3 text-sm" />
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDeleteOpen(false)} className="rounded-lg border border-white/[.08] px-4 py-2 text-sm text-stone-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={deleteAccount} disabled={deleteText !== "DELETE"} className="rounded-lg bg-stone-600 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-500 disabled:opacity-40 transition-colors">Delete account</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
