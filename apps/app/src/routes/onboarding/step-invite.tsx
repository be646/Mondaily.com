import { Plus, X, ArrowRight, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../lib/api-client";
import { usePanelState } from "./onboarding-context";

export function StepInvite() {
  const navigate = useNavigate();
  const [emails,  setEmails]  = useState([""]);
  const [role,    setRole]    = useState("member");
  const [sent,    setSent]    = useState(false);
  const [loading, setLoading] = useState(false);

  usePanelState({ emails, sent });

  async function sendInvites() {
    setLoading(true);
    const valid = emails.filter(e => e.includes("@"));
    await Promise.all(valid.map(email => apiClient.post("/invites", { email, role }).catch(() => null)));
    setLoading(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-stone-500/10">
          <CheckCircle2 size={22} className="text-stone-500" />
        </div>
        <h1 className="mb-1 font-sans text-xl font-semibold tracking-tight text-stone-900">Invitations sent</h1>
        <p className="mb-7 font-mono text-[12px] text-stone-500">Your team can join securely from their invitation links.</p>
        <button
          onClick={() => navigate("/onboarding/import")}
          className="mx-auto flex items-center justify-center gap-2 rounded-xl bg-stone-600 px-6 py-2.5 font-mono text-[13px] font-medium text-white hover:bg-stone-500 transition-all"
        >
          Continue <ArrowRight size={13} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 font-sans text-xl font-semibold tracking-tight text-stone-900">Invite your team</h1>
      <p className="mb-6 font-mono text-[12px] text-stone-500">Add teammates now or continue on your own.</p>

      <div className="mb-4 flex items-center gap-2">
        <p className="font-mono text-[11px] text-stone-500">Role</p>
        <select value={role} onChange={e => setRole(e.target.value)} className="rounded-xl border border-black/[.08] bg-white px-3 py-1.5 font-mono text-[12px] text-stone-700 outline-none focus:border-stone-500/40 transition-colors">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      <div className="mb-2 space-y-2">
        {emails.map((email, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={email}
              onChange={e => setEmails(c => c.map((v, j) => j === i ? e.target.value : v))}
              placeholder="colleague@company.com"
              className="h-10 flex-1 rounded-xl border border-black/[.08] bg-white px-4 font-mono text-[13px] text-stone-900 placeholder-stone-400 outline-none focus:border-stone-500/40 transition-colors"
            />
            {emails.length > 1 && (
              <button onClick={() => setEmails(c => c.filter((_, j) => j !== i))} className="flex h-10 w-10 items-center justify-center rounded-xl border border-black/[.08] text-stone-400 hover:bg-stone-50 transition-colors">
                <X size={13} />
              </button>
            )}
          </div>
        ))}
      </div>

      <button onClick={() => setEmails(c => [...c, ""])} className="mb-7 flex items-center gap-1.5 font-mono text-[12px] text-stone-400 hover:text-stone-700 transition-colors">
        <Plus size={13} /> Add another
      </button>

      <div className="flex gap-3">
        <button
          onClick={sendInvites}
          disabled={!emails.some(e => e.includes("@")) || loading}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-stone-600 py-2.5 font-mono text-[13px] font-medium text-white hover:bg-stone-500 transition-all disabled:opacity-50"
        >
          {loading ? "Sending…" : "Send invites"} {!loading && <ArrowRight size={13} />}
        </button>
        <button onClick={() => navigate("/onboarding/import")} className="rounded-xl border border-black/[.08] px-4 font-mono text-[12px] text-stone-500 hover:bg-stone-50 transition-colors">
          Skip
        </button>
      </div>
    </div>
  );
}
