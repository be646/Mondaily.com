import { Upload } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export function StepImport() {
  const navigate = useNavigate();
  const [file, setFile] = useState("");
  return (
    <section>
      <h1 className="text-2xl font-semibold">Import your data</h1><p className="mb-7 mt-1 text-sm text-slate-500">Bring contacts, companies, and deals. Mondaily will prepare a review before importing.</p>
      <label className="mb-7 flex h-40 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-white/15 hover:bg-white/[.03]">
        <input type="file" accept=".csv,.xlsx" className="hidden" onChange={(event) => setFile(event.target.files?.[0]?.name ?? "")} />
        <Upload className="mb-2 text-slate-500" size={22} /><span className="text-sm text-slate-400">{file || "Drop CSV or Excel, or browse"}</span>
      </label>
      <button onClick={() => navigate("/onboarding/plan")} className="h-10 w-full rounded-md bg-red-600 text-sm font-medium">{file ? "Continue" : "Skip for now"}</button>
    </section>
  );
}
