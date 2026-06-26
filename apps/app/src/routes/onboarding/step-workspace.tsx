import { useAuth, useOrganizationList } from "@clerk/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { usePanelState } from "./onboarding-context";

const SIZES = ["1–10", "11–50", "51–200", "201–500", "500+"];
const INDUSTRIES = ["Technology", "Real Estate", "Finance", "Professional Services", "Healthcare", "Other"];

const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

export function StepWorkspace() {
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const { createOrganization, setActive } = useOrganizationList();
  const [name,     setName]     = useState("");
  const [size,     setSize]     = useState("");
  const [industry, setIndustry] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  usePanelState({ name, size, industry });

  async function callBootstrap(clerkOrgId: string, orgName: string): Promise<string | null> {
    const token = await getToken();
    if (!token) return null;
    const res = await fetch(`${API_BASE}/api/v1/onboarding/bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ clerk_org_id: clerkOrgId, name: orgName }),
    });
    if (!res.ok) return null;
    const json = await res.json() as { workspace_id?: string };
    return json.workspace_id ?? null;
  }

  async function continueSetup() {
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      const org = await createOrganization?.({ name });
      if (!org) throw new Error("Could not create organisation");

      localStorage.setItem("mondaily_workspace_profile", JSON.stringify({ size, industry }));

      const workspaceId = await callBootstrap(org.id, name);
      if (workspaceId) {
        localStorage.setItem("mondaily_workspace_id", workspaceId);
      } else {
        setError("Workspace created but could not link to database. Continue anyway — it will auto-connect on next sign in.");
      }

      // setActive first so Clerk context is current before navigation
      await setActive?.({ organization: org.id });
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
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-stone-600 py-2.5 font-mono text-[13px] font-medium text-white hover:bg-stone-500 transition-all disabled:opacity-50"
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
