import { useClerk, useUser } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  Check,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  Save,
  Sun,
  Trash2
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../../lib/api-client";
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

const notificationTypes = [
  ["mentions", "@mentions"],
  ["task_assigned", "Task assigned"],
  ["record_changed", "Followed record changed"],
  ["workflow_completed", "Workflow completed"],
  ["agent_completed", "Agent completed"],
  ["sequence_replied", "Sequence replied"],
  ["member_joined", "New team member joined"],
  ["billing_alerts", "Billing alerts"]
] as const;

const shortcuts = [
  ["Open command palette", "Cmd K"],
  ["Search", "/"],
  ["Toggle sidebar", "["],
  ["New record", "N"],
  ["Edit focused record", "E"],
  ["Close modal or panel", "Esc"],
  ["Save in forms", "Cmd Enter"],
  ["Open AI chat", "Cmd ."]
];

function defaultNotifications(data?: Preferences) {
  return Object.fromEntries(notificationTypes.map(([key]) => [
    key,
    {
      in_app: data?.notifications?.[key]?.in_app ?? true,
      email: data?.notifications?.[key]?.email ??
        (key === "agent_completed" ? data?.agent_notifications :
          key === "task_assigned" ? data?.task_notifications : data?.email_notifications) ?? true
    }
  ])) as Record<string, NotificationChannel>;
}

export function AccountSettings() {
  const { user } = useUser();
  const { signOut, openUserProfile } = useClerk();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const query = useQuery({
    queryKey: ["account-settings"],
    queryFn: () => apiClient.get<Preferences>("/settings/account")
  });
  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [appearance, setAppearance] = useState<Appearance>(
    () => (localStorage.getItem("mondaily_appearance") as Appearance | null) ?? "system"
  );
  const [notifications, setNotifications] = useState<Record<string, NotificationChannel>>({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  useEffect(() => {
    if (!query.data) return;
    setName(user?.fullName ?? "");
    setJobTitle(query.data.job_title ?? "");
    // Only fall back to API value if nothing saved locally yet
    if (!localStorage.getItem("mondaily_appearance")) {
      setAppearance(query.data.appearance ?? "system");
    }
    setNotifications(defaultNotifications(query.data));
  }, [query.data, user?.fullName]);

  useEffect(() => {
    localStorage.setItem("mondaily_appearance", appearance);
    const dark = appearance === "dark" ||
      (appearance === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  }, [appearance]);

  const save = useMutation({
    mutationFn: async () => {
      const [firstName, ...rest] = name.trim().split(/\s+/);
      await user?.update({ firstName, lastName: rest.join(" ") });
      return apiClient.patch("/settings/account", {
        job_title: jobTitle,
        appearance,
        notifications,
        connected_accounts: query.data?.connected_accounts ?? []
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account-settings"] })
  });
  const disconnect = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/settings/account/connections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account-settings"] })
  });

  async function uploadAvatar(file?: File) {
    if (!file || !user) return;
    await user.setProfileImage({ file });
  }

  function connect(provider: "gmail" | "outlook") {
    window.open(`/api/v1/integrations/${provider}/connect`, "_blank", "width=520,height=680");
  }

  async function deleteAccount() {
    if (deleteText !== "DELETE" || !user) return;
    await user.delete();
    await signOut({ redirectUrl: "/sign-up" });
  }

  if (query.isLoading) return <PageSkeleton rows={8} />;
  const accounts = query.data?.connected_accounts ?? [];
  const hasPassword = (user?.externalAccounts.length ?? 0) === 0;

  return (
    <div>
      <PageHeader title="Account" description="Manage your profile, preferences, and personal security." />
      <div className="space-y-5">
        <section className="rounded-lg border border-white/10 p-5">
          <h2 className="mb-4 text-sm font-medium">Profile</h2>
          <div className="mb-5 flex items-center gap-4">
            <div className="relative">
              <img src={user?.imageUrl} alt="" className="h-16 w-16 rounded-full bg-white/5 object-cover" />
              <button onClick={() => fileRef.current?.click()} className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-[#111419]" aria-label="Upload profile photo">
                <Camera size={12} />
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => uploadAvatar(event.target.files?.[0])} />
            </div>
            <div><p className="text-sm font-medium">Profile photo</p><p className="text-xs text-slate-500">JPG, PNG, or WebP.</p></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" value={name} onChange={setName} />
            <label className="text-sm">Email
              <div className="mt-2 flex h-10 items-center rounded-md border border-white/10 bg-white/[.02] px-3">
                <span className="min-w-0 flex-1 truncate text-slate-400">{user?.primaryEmailAddress?.emailAddress}</span>
                <button onClick={() => openUserProfile()} className="text-xs text-red-400">Change</button>
              </div>
            </label>
            <Field label="Job title" value={jobTitle} onChange={setJobTitle} placeholder="Founder, Head of Sales..." />
          </div>
        </section>

        {hasPassword ? (
          <section className="rounded-lg border border-white/10 p-5">
            <h2 className="mb-2 text-sm font-medium">Password</h2>
            <p className="mb-4 text-sm text-slate-500">Update your password through the secure identity profile.</p>
            <button onClick={() => openUserProfile()} className="flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm"><KeyRound size={14} /> Change password</button>
          </section>
        ) : null}

        <section className="rounded-lg border border-white/10 p-5">
          <h2 className="mb-4 text-sm font-medium">Connected accounts</h2>
          <div className="space-y-2">
            {(["gmail", "outlook"] as const).map((provider) => {
              const account = accounts.find((item) => item.provider.toLowerCase().includes(provider));
              return <div key={provider} className="flex items-center justify-between rounded-md bg-white/[.03] p-3">
                <div><p className="text-sm capitalize">{provider === "gmail" ? "Google" : "Outlook"}</p><p className="text-xs text-slate-500">{account?.email ?? "Not connected"}</p></div>
                {account ? <button onClick={() => disconnect.mutate(account.id)} className="text-xs text-red-400">Disconnect</button> : <button onClick={() => connect(provider)} className="text-xs text-red-400">Connect</button>}
              </div>;
            })}
          </div>
        </section>

        <section className="rounded-lg border border-white/10 p-5">
          <h2 className="mb-4 text-sm font-medium">Notification preferences</h2>
          <div className="grid grid-cols-[1fr_72px_72px] items-center gap-y-3 text-sm">
            <span className="text-xs text-slate-500">Notification</span><span className="text-center text-xs text-slate-500">In-app</span><span className="text-center text-xs text-slate-500">Email</span>
            {notificationTypes.map(([key, label]) => <div key={key} className="contents">
              <span>{label}</span>
              {(["in_app", "email"] as const).map((channel) => <label key={channel} className="flex justify-center">
                <input type="checkbox" checked={notifications[key]?.[channel] ?? true} onChange={(event) => setNotifications((current) => ({ ...current, [key]: { in_app: current[key]?.in_app ?? true, email: current[key]?.email ?? true, [channel]: event.target.checked } }))} />
              </label>)}
            </div>)}
          </div>
        </section>

        <section className="rounded-lg border border-white/10 p-5">
          <h2 className="mb-4 text-sm font-medium">Appearance</h2>
          <div className="grid grid-cols-3 gap-3">
            {([["light", Sun], ["dark", Moon], ["system", Monitor]] as const).map(([mode, Icon]) => <button key={mode} onClick={() => setAppearance(mode)} className={`relative flex min-h-20 flex-col items-center justify-center gap-2 rounded-md border text-sm capitalize ${appearance === mode ? "border-red-500 bg-red-500/5" : "border-white/10 text-slate-500"}`}><Icon size={18} />{mode}{appearance === mode ? <Check size={12} className="absolute right-2 top-2 text-red-400" /> : null}</button>)}
          </div>
        </section>

        <section className="rounded-lg border border-white/10 p-5">
          <h2 className="mb-4 text-sm font-medium">Keyboard shortcuts</h2>
          {shortcuts.map(([label, keys]) => <div key={label} className="flex justify-between border-t border-white/10 py-2 text-sm first:border-0"><span className="text-slate-400">{label}</span><kbd className="rounded border border-white/10 bg-white/[.03] px-2 py-0.5 text-xs">{keys}</kbd></div>)}
        </section>

        <section className="rounded-lg border border-red-500/20 p-5">
          <h2 className="mb-4 text-sm font-medium text-red-400">Danger zone</h2>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => signOut({ redirectUrl: "/sign-in" })} className="flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm"><LogOut size={14} /> Sign out</button>
            <button onClick={() => setDeleteOpen(true)} className="flex items-center gap-2 rounded-md border border-red-500/30 px-3 py-2 text-sm text-red-400"><Trash2 size={14} /> Delete account</button>
          </div>
        </section>

        <div className="flex justify-end">
          <button onClick={() => save.mutate()} disabled={save.isPending} className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm disabled:opacity-50"><Save size={14} /> {save.isPending ? "Saving..." : "Save changes"}</button>
        </div>
      </div>

      {deleteOpen ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6">
        <div className="w-full max-w-md rounded-lg border border-white/10 bg-[#111419] p-5">
          <h2 className="font-medium">Delete account</h2>
          <p className="mt-2 text-sm text-slate-500">This permanently deletes your account. Type DELETE to confirm.</p>
          <input value={deleteText} onChange={(event) => setDeleteText(event.target.value)} className="mt-4 h-10 w-full rounded-md border border-white/10 bg-transparent px-3 text-sm" />
          <div className="mt-5 flex justify-end gap-2"><button onClick={() => setDeleteOpen(false)} className="rounded-md border border-white/10 px-3 py-2 text-sm">Cancel</button><button onClick={deleteAccount} disabled={deleteText !== "DELETE"} className="rounded-md bg-red-600 px-3 py-2 text-sm disabled:opacity-40">Delete account</button></div>
        </div>
      </div> : null}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="text-sm">{label}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-2 h-10 w-full rounded-md border border-white/10 bg-transparent px-3" /></label>;
}
