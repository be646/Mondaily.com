import { Upload, ArrowRight, FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePanelState } from "./onboarding-context";

export function StepImport() {
  const navigate = useNavigate();
  const [file, setFile] = useState("");

  usePanelState({ file });

  return (
    <div>
      <h1 className="mb-1 font-sans text-xl font-semibold tracking-tight text-zinc-900">Import your data</h1>
      <p className="mb-6 font-mono text-[12px] text-[var(--text-muted)]">Bring contacts, companies, and deals. Mondaily prepares a review before anything is imported.</p>

      <label className={`mb-7 flex h-40 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${file ? "border-indigo-500/40 bg-indigo-500/[.03]" : "border-black/[.08] hover:border-indigo-500/30 hover:bg-zinc-50"}`}>
        <input type="file" accept=".csv,.xlsx" className="hidden" onChange={e => setFile(e.target.files?.[0]?.name ?? "")} />
        {file ? (
          <>
            <FileSpreadsheet size={22} className="mb-2 text-indigo-500" />
            <span className="font-mono text-[12px] text-indigo-600">{file}</span>
            <span className="mt-1 font-mono text-[11px] text-[var(--text-secondary)]">Click to change</span>
          </>
        ) : (
          <>
            <Upload size={22} className="mb-2 text-[var(--text-secondary)]" />
            <span className="font-mono text-[12px] text-[var(--text-muted)]">Drop CSV or Excel, or browse</span>
            <span className="mt-1 font-mono text-[11px] text-[var(--text-secondary)]">.csv · .xlsx supported</span>
          </>
        )}
      </label>

      <button
        onClick={() => navigate("/onboarding/plan")}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 font-mono text-[13px] font-medium text-white hover:bg-indigo-500 transition-all"
      >
        {file ? "Continue" : "Skip for now"} <ArrowRight size={13} />
      </button>
    </div>
  );
}
