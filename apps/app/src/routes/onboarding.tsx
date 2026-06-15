import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { apiClient } from "../lib/api-client";

const TIMEZONES = [
  "UTC","Europe/London","Europe/Paris","Europe/Berlin","Europe/Amsterdam",
  "America/New_York","America/Chicago","America/Denver","America/Los_Angeles","America/Toronto",
  "Asia/Dubai","Asia/Singapore","Asia/Tokyo","Australia/Sydney",
];

const AVAILABLE_MODULES = [
  { id: "crm", name: "CRM", description: "Contacts, companies, deals and pipelines" },
  { id: "finance", name: "Finance & Billing", description: "Invoices, credit notes, expenses and revenue reporting" },
  { id: "investments", name: "Investments", description: "Portfolio tracking and investor relations" },
  { id: "hr", name: "HR", description: "Team management and people ops" },
];

export function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const totalSteps = 4;

  // Step 1 state
  const [workspaceName, setWorkspaceName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [timezone, setTimezone] = useState("UTC");

  // Step 2 state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [sentInvites, setSentInvites] = useState<{ email: string; role: string }[]>([]);

  // Step 3 state
  const [activeModules, setActiveModules] = useState(["crm"]);

  const [loading, setLoading] = useState(false);

  async function handleInvite() {
    if (!inviteEmail.includes("@")) return;
    try {
      await apiClient.post("/invites", { email: inviteEmail, role: inviteRole });
      setSentInvites(inv => [...inv, { email: inviteEmail, role: inviteRole }]);
      setInviteEmail("");
    } catch {
      // still add to local list so UX doesn't block
      setSentInvites(inv => [...inv, { email: inviteEmail, role: inviteRole }]);
      setInviteEmail("");
    }
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
      } else if (step === 4) {
        await apiClient.post("/settings/complete-onboarding", {});
        navigate("/");
      }
    } catch {
      // continue anyway
      if (step < 4) setStep(s => s + 1);
      else navigate("/");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0b0d10] flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            {[1, 2, 3, 4].map(s => (
              <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${s <= step ? "bg-red-500" : "bg-white/[.06]"}`} />
            ))}
          </div>
          <p className="text-[11px] text-zinc-500">Step {step} of {totalSteps}</p>
        </div>

        {/* Step content */}
        <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-8">
          {step === 1 && (
            <div>
              <h1 className="text-xl font-semibold text-white mb-1">Set up your workspace</h1>
              <p className="text-[12px] text-zinc-500 mb-6">This is how your team will see your workspace.</p>
              <label className="block text-[11px] text-zinc-400 mb-1.5">Workspace name</label>
              <input className="key-input w-full mb-4" value={workspaceName} onChange={e => setWorkspaceName(e.target.value)} placeholder="Acme Corp" />
              <label className="block text-[11px] text-zinc-400 mb-1.5">Logo URL <span className="text-zinc-600">(optional)</span></label>
              <input className="key-input w-full mb-4" value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://..." />
              <label className="block text-[11px] text-zinc-400 mb-1.5">Timezone</label>
              <select className="key-input w-full" value={timezone} onChange={e => setTimezone(e.target.value)}>
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
          )}

          {step === 2 && (
            <div>
              <h1 className="text-xl font-semibold text-white mb-1">Invite your team</h1>
              <p className="text-[12px] text-zinc-500 mb-6">Add teammates to collaborate. You can always do this later.</p>
              <div className="flex gap-2 mb-4">
                <input
                  className="key-input flex-1"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  type="email"
                  onKeyDown={e => e.key === "Enter" && handleInvite()}
                />
                <select className="key-input w-32" value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  onClick={handleInvite}
                  className="px-3 py-2 bg-white/[.05] hover:bg-white/[.08] border border-white/[.06] rounded-lg text-[12px] text-zinc-300"
                >
                  Add
                </button>
              </div>
              {sentInvites.length > 0 && (
                <div className="space-y-1.5">
                  {sentInvites.map(inv => (
                    <div key={inv.email} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[.02] border border-white/[.04]">
                      <span className="text-[12px] text-zinc-300">{inv.email}</span>
                      <span className="text-[11px] text-zinc-600 capitalize">{inv.role}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div>
              <h1 className="text-xl font-semibold text-white mb-1">Choose your modules</h1>
              <p className="text-[12px] text-zinc-500 mb-6">Enable the tools your team needs. You can change this in settings.</p>
              {AVAILABLE_MODULES.map(mod => (
                <label key={mod.id} className="flex items-start gap-3 p-4 rounded-lg border border-white/[.06] mb-2 cursor-pointer hover:bg-white/[.02]">
                  <input
                    type="checkbox"
                    checked={activeModules.includes(mod.id)}
                    disabled={mod.id === "crm"}
                    onChange={e => {
                      if (e.target.checked) setActiveModules(m => [...m, mod.id]);
                      else setActiveModules(m => m.filter(x => x !== mod.id));
                    }}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-[12px] font-medium text-zinc-200">{mod.name}</p>
                    <p className="text-[11px] text-zinc-500">{mod.description}</p>
                  </div>
                </label>
              ))}
            </div>
          )}

          {step === 4 && (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={24} className="text-emerald-400" />
              </div>
              <h1 className="text-xl font-semibold text-white mb-2">You're all set!</h1>
              <p className="text-[12px] text-zinc-500">Your workspace is ready. Let's get started.</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="mt-4 flex justify-between">
          {step > 1 && (
            <button onClick={() => setStep(s => s - 1)} className="text-[12px] text-zinc-500 hover:text-zinc-300">
              Back
            </button>
          )}
          <div className="ml-auto flex gap-3">
            {step === 2 && (
              <button onClick={() => setStep(3)} className="text-[12px] text-zinc-500 hover:text-zinc-300">
                Skip
              </button>
            )}
            <button
              onClick={handleNext}
              disabled={loading}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-[12px] rounded-lg font-medium flex items-center gap-2 disabled:opacity-50"
            >
              {step === 4 ? "Go to dashboard" : "Continue"} <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
