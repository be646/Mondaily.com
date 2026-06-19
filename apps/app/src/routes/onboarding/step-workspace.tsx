import { useOrganizationList } from "@clerk/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { usePanelState } from "./onboarding-context";

const SIZES = ["1–10", "11–50", "51–200", "201–500", "500+"];
const INDUSTRIES = ["Technology", "Real Estate", "Finance", "Professional Services", "Healthcare", "Other"];

export function StepWorkspace() {
  const navigate = useNavigate();
  const { createOrganization, setActive } = useOrganizationList();
  const [name,     setName]     = useState("");
  const [size,     setSize]     = useState("");
  const [industry, setIndustry] = useState("");
  const [loading,  setLoading]  = useState(false);

  usePanelState({ name, size, industry });

  async function continueSetup() {
    setLoading(true);
    try {
      const org = await createOrganization?.({ name });
      if (org) {
        localStorage.setItem("mondaily_workspace_profile", JSON.stringify({ size, industry }));
        // Exchange Clerk org ID for a Supabase workspace UUID via bootstrap endpoint
        try {
          const token = await (window as unknown as { Clerk?: { session?: { getToken: () => Promise<string | null> } } }).Clerk?.session?.getToken();
          const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
          const res = await fetch(`${apiBase}/api/v1/onboarding/bootstrap`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ clerk_org_id: org.id, name }),
          });
          if (res.ok) {
            const { workspace_id } = await res.json() as { workspace_id: string };
            localStorage.setItem("mondaily_workspace_id", workspace_id);
          }
        } catch { /* non-fatal: workspace_id stays unset, AuthGate will retry */ }
        navigate("/onboarding/connect-email");
        setActive?.({ organization: org.id });
        return;
      }
    } catch { /* continue to next step anyway */ }
    navigate("/onboarding/connect-email");
  }

  const inputCls = "w-full rounded-xl border border-black/[.08] bg-white px-4 py-2.5 font-mono text-[13px] text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500/40 transition-colors";

  return (
    <div>
      <h1 className="mb-1 font-sans text-xl font-semibold tracking-tight text-zinc-900">Set up your workspace</h1>
      <p className="mb-7 font-mono text-[12px] text-zinc-500">This is your company home in Mondaily.</p>

      <div className="mb-4">
        <p className="mb-1.5 font-mono text-[11px] text-zinc-500">Workspace name</p>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Acme Corp" className={inputCls} />
      </div>
      <div className="mb-4">
        <p className="mb-1.5 font-mono text-[11px] text-zinc-500">Company size</p>
        <select value={size} onChange={e => setSize(e.target.value)} className={inputCls}>
          <option value="">Select size</option>
          {SIZES.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div className="mb-8">
        <p className="mb-1.5 font-mono text-[11px] text-zinc-500">Industry</p>
        <select value={industry} onChange={e => setIndustry(e.target.value)} className={inputCls}>
          <option value="">Select industry</option>
          {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
        </select>
      </div>

      <div className="flex gap-3">
        <button
          onClick={continueSetup}
          disabled={!name.trim() || loading}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 font-mono text-[13px] font-medium text-white hover:bg-indigo-500 active:translate-y-[1px] transition-all disabled:opacity-50"
        >
          {loading ? "Saving…" : "Continue"} {!loading && <ArrowRight size={13} />}
        </button>
        <button onClick={() => navigate("/onboarding/connect-email")} className="rounded-xl border border-black/[.08] px-4 font-mono text-[12px] text-zinc-500 hover:bg-zinc-50 transition-colors">
          Skip
        </button>
      </div>
    </div>
  );
}
