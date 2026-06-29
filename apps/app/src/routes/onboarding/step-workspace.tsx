import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { usePanelState } from "./onboarding-context";

const SIZES = ["1–10", "11–50", "51–200", "201–500", "500+"];
const INDUSTRIES = ["Technology", "Real Estate", "Finance", "Professional Services", "Healthcare", "Other"];

export function StepWorkspace() {
  const navigate = useNavigate();
  const [name,     setName]     = useState("");
  const [size,     setSize]     = useState("");
  const [industry, setIndustry] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  usePanelState({ name, size, industry });

  async function continueSetup() {
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      localStorage.setItem("mondaily_workspace_profile", JSON.stringify({ size, industry }));

      // Native: ensure the user's workspace exists, then name it.
      const res = await apiClient.post<{ workspace_id?: string }>("/onboarding/bootstrap", { name }).catch(() => null);
      if (res?.workspace_id) localStorage.setItem("mondaily_workspace_id", res.workspace_id);
      await apiClient.patch("/settings/workspace", { name }).catch(() => {});

      navigate("/onboarding/connect-email");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  const inputCls = "w-full rounded-xl border border-black/[.08] bg-white px-4 py-2.5 font-mono text-[13px] text-stone-900 placeholder-stone-400 outline-none focus:border-stone-500/40 transition-colors";

  return (
    <div>
      <h1 className="mb-1 font-sans text-xl font-semibold tracking-tight text-stone-900">Set up your workspace</h1>
      <p className="mb-7 font-mono text-[12px] text-stone-500">This is your company home in Mondaily.</p>

      <div className="mb-4">
        <p className="mb-1.5 font-mono text-[11px] text-stone-500">Workspace name</p>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Acme Corp" className={inputCls} />
      </div>
      <div className="mb-4">
        <p className="mb-1.5 font-mono text-[11px] text-stone-500">Company size</p>
        <select value={size} onChange={e => setSize(e.target.value)} className={inputCls}>
          <option value="">Select size</option>
          {SIZES.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div className="mb-8">
        <p className="mb-1.5 font-mono text-[11px] text-stone-500">Industry</p>
        <select value={industry} onChange={e => setIndustry(e.target.value)} className={inputCls}>
          <option value="">Select industry</option>
          {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
        </select>
      </div>

      {error && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 font-mono text-[12px] text-amber-700">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          onClick={continueSetup}
          disabled={!name.trim() || loading}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-stone-600 py-2.5 font-mono text-[13px] font-medium text-[var(--text-primary)] hover:bg-stone-500 transition-all disabled:opacity-50"
        >
          {loading ? "Saving…" : "Continue"} {!loading && <ArrowRight size={13} />}
        </button>
        <button onClick={() => navigate("/onboarding/connect-email")} className="rounded-xl border border-black/[.08] px-4 font-mono text-[12px] text-stone-500 hover:bg-stone-50 transition-colors">
          Skip
        </button>
      </div>
    </div>
  );
}
