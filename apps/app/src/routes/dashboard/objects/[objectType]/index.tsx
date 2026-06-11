import { useParams } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import { Plus, X } from "lucide-react";
import { RecordTable } from "../../../../components/records/record-table";
import { apiClient } from "../../../../lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { getDemoRecords } from "../../../../lib/demo-data";

function getDefaultFields(objectType: string) {
  const t = objectType.toLowerCase();
  if (t.includes("employee") || t.includes("staff") || t.includes("hr"))
    return ["name", "email", "role", "department"];
  if (t.includes("deal") || t.includes("opportunit") || t.includes("crm") || t.includes("pipeline"))
    return ["name", "stage", "owner", "value"];
  if (t.includes("compan") || t.includes("org") || t.includes("account"))
    return ["name", "description", "arr", "funding_raised", "employee_range"];
  if (t.includes("people") || t.includes("person") || t.includes("contact"))
    return ["name", "email", "job_title", "linkedin", "twitter", "twitter_followers"];
  return ["name", "email"];
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors ${checked ? "bg-red-500" : "bg-white/[.10]"}`}
    >
      <span className={`block h-3 w-3 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-3.5" : "translate-x-0.5"}`}/>
    </button>
  );
}

function CreateRecordModal({ objectType, onClose, existingColumns }: { objectType: string; onClose: () => void; existingColumns: string[] }) {
  const queryClient = useQueryClient();
  const fieldKeys = existingColumns.length > 0 ? existingColumns : getDefaultFields(objectType);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fieldKeys.map(k => [k, ""]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [createMore, setCreateMore] = useState(false);

  const resetForm = () => setValues(Object.fromEntries(fieldKeys.map(k => [k, ""])));

  const save = useCallback(async () => {
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (k.trim()) data[k.trim().toLowerCase().replace(/\s+/g, "_")] = v;
    }
    if (!data.name) { setError("Name is required"); return; }
    setSaving(true);
    setError("");
    try {
      const safeType = objectType.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
      await apiClient.post("/nodes", { vertical: "shared", object_type: safeType, data });
      queryClient.invalidateQueries({ queryKey: ["records", objectType] });
      if (createMore) { resetForm(); } else { onClose(); }
    } catch (e: any) {
      const msg = e?.message || "Failed to create record";
      setError(msg.includes("createNode failed") ? msg.replace("createNode failed: ", "") : msg);
    } finally {
      setSaving(false);
    }
  }, [values, objectType, createMore, onClose, queryClient]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void save(); }
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, onClose]);

  const label = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={onClose}/>
      <div className="fixed left-1/2 top-1/2 z-50 w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/[.08] bg-[#13151a] shadow-[0_24px_64px_rgba(0,0,0,0.7)]">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[.06] px-5 py-3.5">
          <span className="text-[13px] font-semibold capitalize text-white tracking-tight">
            New {objectType.replace(/[-_]/g, " ")}
          </span>
          <button onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-white/[.05] hover:text-white transition-colors">
            <X size={14}/>
          </button>
        </div>

        {/* Fields */}
        <div className="max-h-[360px] overflow-auto px-5 py-4 space-y-1">
          {fieldKeys.map((k) => (
            <div key={k} className="grid grid-cols-[120px_1fr] items-center gap-3 py-1.5 border-b border-white/[.04] last:border-0">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-600 select-none truncate">
                {label(k)}
              </span>
              <input
                value={values[k] ?? ""}
                onChange={e => setValues(prev => ({ ...prev, [k]: e.target.value }))}
                placeholder="—"
                className="w-full rounded-md border border-white/[.07] bg-white/[.03] px-2.5 py-1.5 text-sm text-white placeholder-slate-700 outline-none transition-colors focus:border-red-500/30 focus:bg-white/[.05]"
              />
            </div>
          ))}
          {error && <p className="pt-1 text-xs text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/[.06] px-5 py-3.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500 select-none">
            <Toggle checked={createMore} onChange={setCreateMore}/>
            Create more
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border-x border-t border-white/[.08] border-b-2 border-b-white/[.14] bg-white/[.03] px-3 py-1.5 text-xs text-slate-400 transition-all hover:bg-white/[.05] hover:text-white active:translate-y-[1px] active:border-b active:border-b-white/[.08]"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg border-x border-t border-red-500/50 border-b-[3px] border-b-red-700 bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-red-400 active:translate-y-[1px] active:border-b active:border-b-red-500/50 disabled:opacity-50"
            >
              {saving ? "Creating…" : "Create record"}
              <kbd className="rounded border border-red-400/40 bg-red-600/40 px-1.5 py-0.5 text-[10px] font-normal text-red-200/70 tracking-normal">
                ⌘↵
              </kbd>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export function ObjectIndexPage() {
  const { objectType = "records" } = useParams();
  const [showCreate, setShowCreate] = useState(false);

  // Derive column names from demo data (if available) so modal pre-matches the visible columns
  const demoRecords = getDemoRecords(objectType);
  const existingColumns = demoRecords
    ? Array.from(new Set(demoRecords.flatMap(r => Object.keys(r.data)))).slice(0, 8)
    : [];

  return (
    <div className="px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold capitalize text-white tracking-tight">{objectType.replace(/[-_]/g, " ")}</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg border-x border-t border-red-500/50 border-b-[3px] border-b-red-700 bg-red-500 px-3 py-2 text-sm font-semibold text-white transition-all hover:bg-red-400 active:translate-y-[1px] active:border-b active:border-b-red-500/50"
        >
          <Plus size={14}/> New {objectType.replace(/[-_]/g, " ")}
        </button>
      </div>
      <RecordTable objectType={objectType} />
      {showCreate && (
        <CreateRecordModal
          objectType={objectType}
          existingColumns={existingColumns}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
