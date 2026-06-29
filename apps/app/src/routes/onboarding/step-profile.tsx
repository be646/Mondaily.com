import { useCurrentUser } from "../../hooks/useCurrentUser";
import { apiClient } from "../../lib/api-client";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { usePanelState } from "./onboarding-context";

export function StepProfile() {
  const me = useCurrentUser();
  const navigate = useNavigate();
  const [name,  setName]  = useState(me.name ?? "");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);

  usePanelState({ name, title });

  async function continueSetup() {
    setLoading(true);
    await apiClient.post("/members/sync", { name, email: me.email });
    localStorage.setItem("mondaily_job_title", title);
    navigate("/onboarding/workspace");
  }

  const inputCls = "w-full rounded-xl border border-black/[.08] bg-white px-4 py-2.5 font-mono text-[13px] text-stone-900 placeholder-stone-400 outline-none focus:border-stone-500/40 transition-colors";

  return (
    <div>
      <h1 className="mb-1 font-sans text-xl font-semibold tracking-tight text-stone-900">Your profile</h1>
      <p className="mb-7 font-mono text-[12px] text-stone-500">How should your teammates know you?</p>

      <div className="mb-4">
        <p className="mb-1.5 font-mono text-[11px] text-stone-500">Full name</p>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" className={inputCls} />
      </div>
      <div className="mb-8">
        <p className="mb-1.5 font-mono text-[11px] text-stone-500">Job title</p>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Founder, Head of Sales…" className={inputCls} />
      </div>

      <button
        onClick={continueSetup}
        disabled={!name.trim() || loading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-stone-600 py-2.5 font-mono text-[13px] font-medium text-[var(--text-primary)] hover:bg-stone-500 transition-all disabled:opacity-50"
      >
        {loading ? "Saving…" : "Continue"} {!loading && <ArrowRight size={13} />}
      </button>
    </div>
  );
}
