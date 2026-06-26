import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { apiClient } from "../lib/api-client";
import { Logo } from "../components/logo";

const TIMEZONES = [
  "UTC","Europe/London","Europe/Paris","Europe/Berlin","Europe/Amsterdam",
  "America/New_York","America/Chicago","America/Denver","America/Los_Angeles","America/Toronto",
  "Asia/Dubai","Asia/Singapore","Asia/Tokyo","Australia/Sydney",
];

const AVAILABLE_MODULES = [
  { id: "crm",         name: "CRM",              description: "Contacts, companies, deals and pipelines" },
  { id: "finance",     name: "Finance & Billing", description: "Invoices, credit notes, expenses and revenue reporting" },
  { id: "investments", name: "Investments",       description: "Portfolio tracking and investor relations" },
  { id: "hr",          name: "HR",                description: "Team management and people ops" },
];

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 font-mono text-[11px] text-stone-500">{children}</p>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        "w-full rounded-xl border border-black/[.08] bg-white px-4 py-2.5 font-mono text-[13px] text-stone-900 placeholder-stone-400 outline-none focus:border-stone-500/40 transition-colors " +
        (props.className ?? "")
      }
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={
        "w-full rounded-xl border border-black/[.08] bg-white px-4 py-2.5 font-mono text-[13px] text-stone-900 outline-none focus:border-stone-500/40 transition-colors " +
        (props.className ?? "")
      }
    />
  );
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const totalSteps = 4;

  const [workspaceName, setWorkspaceName] = useState("");
  const [logoUrl, setLogoUrl]             = useState("");
  const [timezone, setTimezone]           = useState("UTC");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole]   = useState("member");
  const [sentInvites, setSentInvites] = useState<{ email: string; role: string }[]>([]);

  const [activeModules, setActiveModules] = useState(["crm"]);
  const [loading, setLoading]             = useState(false);

  async function handleInvite() {
    if (!inviteEmail.includes("@")) return;
    try {
      await apiClient.post("/invites", { email: inviteEmail, role: inviteRole });
    } catch { /* add locally anyway */ }
    setSentInvites(inv => [...inv, { email: inviteEmail, role: inviteRole }]);
    setInviteEmail("");
  }

  async function handleNext() {
    setLoading(true);
    try {
      if (step === 1) {
        await apiClient.patch("/settings/general", { name: workspaceName, logo_url: logoUrl, timezone });
        setStep(2);
      } else if (step === 2) {
        setStep(3);
      } else if (step === 3) {
        await apiClient.patch("/settings/workspace", { modules: activeModules });
        setStep(4);
      } else {
        await apiClient.post("/settings/complete-onboarding", {});
        navigate("/");
      }
    } catch {
      if (step < 4) setStep(s => s + 1);
      else navigate("/");
    } finally {
      setLoading(false);
    }
  }

  const stepLabels = ["Workspace", "Team", "Modules", "Ready"];

  return (
    <div className="grid min-h-screen place-items-center bg-stone-50 px-6 py-12">
      <div className="w-full max-w-lg">

        {/* Logo */}
        <div className="mb-10 flex justify-center">
          <Logo size={40} />
        </div>

        {/* Step indicator */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            {[1, 2, 3, 4].map(s => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-all duration-300 ${s <= step ? "bg-stone-600" : "bg-black/[.06]"}`}
              />
            ))}
          </div>
          <div className="flex justify-between">
            {stepLabels.map((label, i) => (
              <span
                key={label}
                className={`font-mono text-[10px] transition-colors ${i + 1 === step ? "text-stone-600" : i + 1 < step ? "text-stone-400" : "text-stone-300"}`}
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-black/[.08] bg-white p-8">

          {step === 1 && (
            <div>
              <h1 className="mb-1 font-sans text-xl font-semibold tracking-tight text-stone-900">Set up your workspace</h1>
              <p className="mb-6 font-mono text-[12px] text-stone-500">This is how your team will see your workspace.</p>

              <div className="mb-4">
                <Label>Workspace name</Label>
                <Input value={workspaceName} onChange={e => setWorkspaceName(e.target.value)} placeholder="Acme Corp" />
              </div>
              <div className="mb-4">
                <Label>Logo URL <span className="text-stone-400">(optional)</span></Label>
                <Input value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://..." />
              </div>
              <div>
                <Label>Timezone</Label>
                <Select value={timezone} onChange={e => setTimezone(e.target.value)}>
                  {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </Select>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h1 className="mb-1 font-sans text-xl font-semibold tracking-tight text-stone-900">Invite your team</h1>
              <p className="mb-6 font-mono text-[12px] text-stone-500">Add teammates to collaborate. You can always do this later.</p>

              <div className="mb-4 flex gap-2">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleInvite()}
                  placeholder="colleague@company.com"
                  className="flex-1 rounded-xl border border-black/[.08] bg-white px-4 py-2.5 font-mono text-[13px] text-stone-900 placeholder-stone-400 outline-none focus:border-stone-500/40 transition-colors"
                />
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value)}
                  className="w-28 rounded-xl border border-black/[.08] bg-white px-3 py-2.5 font-mono text-[13px] text-stone-900 outline-none focus:border-stone-500/40 transition-colors"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  onClick={handleInvite}
                  className="rounded-xl border border-black/[.08] bg-white px-4 py-2.5 font-mono text-[12px] text-stone-600 hover:bg-stone-50 transition-colors"
                >
                  Add
                </button>
              </div>

              {sentInvites.length > 0 && (
                <div className="space-y-1.5">
                  {sentInvites.map(inv => (
                    <div key={inv.email} className="flex items-center justify-between rounded-xl border border-black/[.05] bg-stone-50 px-4 py-2.5">
                      <span className="font-mono text-[12px] text-stone-700">{inv.email}</span>
                      <span className="font-mono text-[11px] capitalize text-stone-400">{inv.role}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div>
              <h1 className="mb-1 font-sans text-xl font-semibold tracking-tight text-stone-900">Choose your modules</h1>
              <p className="mb-6 font-mono text-[12px] text-stone-500">Enable the tools your team needs. Change this anytime in settings.</p>

              <div className="space-y-2">
                {AVAILABLE_MODULES.map(mod => (
                  <label
                    key={mod.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                      activeModules.includes(mod.id)
                        ? "border-stone-500/30 bg-stone-500/[.04]"
                        : "border-black/[.06] hover:bg-stone-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={activeModules.includes(mod.id)}
                      disabled={mod.id === "crm"}
                      onChange={e => {
                        if (e.target.checked) setActiveModules(m => [...m, mod.id]);
                        else setActiveModules(m => m.filter(x => x !== mod.id));
                      }}
                      className="mt-0.5 accent-stone-600"
                    />
                    <div>
                      <p className="font-mono text-[12px] font-medium text-stone-800">{mod.name}</p>
                      <p className="font-mono text-[11px] text-stone-500">{mod.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="py-4 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-stone-500/10">
                <CheckCircle2 size={24} className="text-stone-500" />
              </div>
              <h1 className="mb-2 font-sans text-xl font-semibold tracking-tight text-stone-900">You're all set!</h1>
              <p className="font-mono text-[12px] text-stone-500">Your workspace is ready. Let's get started.</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="mt-4 flex items-center justify-between">
          {step > 1 ? (
            <button
              onClick={() => setStep(s => s - 1)}
              className="font-mono text-[12px] text-stone-400 hover:text-stone-700 transition-colors"
            >
              ← Back
            </button>
          ) : <div />}

          <div className="flex items-center gap-3">
            {step === 2 && (
              <button
                onClick={() => setStep(3)}
                className="font-mono text-[12px] text-stone-400 hover:text-stone-700 transition-colors"
              >
                Skip
              </button>
            )}
            <button
              onClick={handleNext}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-stone-600 px-5 py-2.5 font-mono text-[13px] font-medium text-white hover:bg-stone-500 transition-all disabled:opacity-50"
            >
              {step === 4 ? "Go to dashboard" : "Continue"} <ArrowRight size={13} />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
