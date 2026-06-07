import { useOrganizationList } from "@clerk/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export function StepWorkspace() {
  const navigate = useNavigate();
  const { createOrganization, setActive } = useOrganizationList();
  const [name, setName] = useState("");
  const [size, setSize] = useState("");
  const [industry, setIndustry] = useState("");
  async function continueSetup() {
    const organization = await createOrganization?.({ name });
    if (organization) {
      await setActive?.({ organization: organization.id });
      localStorage.setItem("mondaily_workspace_id", organization.id);
      localStorage.setItem("mondaily_workspace_profile", JSON.stringify({ size, industry }));
    }
    navigate("/onboarding/connect-email");
  }
  return (
    <section>
      <h1 className="text-2xl font-semibold">Set up your workspace</h1><p className="mb-8 mt-1 text-sm text-slate-500">This is your company home in Mondaily.</p>
      <label className="mb-5 block text-sm">Workspace name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Acme Corp" className="mt-2 h-10 w-full rounded-md border border-white/10 bg-transparent px-3" /></label>
      <label className="mb-5 block text-sm">Company size<select value={size} onChange={(event) => setSize(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-white/10 bg-[#0b0d10] px-3"><option value="">Select size</option>{["1-10", "11-50", "51-200", "201-500", "500+"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="mb-8 block text-sm">Industry<select value={industry} onChange={(event) => setIndustry(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-white/10 bg-[#0b0d10] px-3"><option value="">Select industry</option>{["Technology", "Real Estate", "Finance", "Professional Services", "Healthcare", "Other"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <div className="flex gap-3"><button onClick={continueSetup} disabled={!name.trim()} className="h-10 flex-1 rounded-md bg-red-600 text-sm font-medium disabled:opacity-50">Continue</button><button onClick={() => navigate("/onboarding/connect-email")} className="rounded-md border border-white/10 px-4 text-sm">Skip</button></div>
    </section>
  );
}
