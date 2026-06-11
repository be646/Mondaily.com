import { useParams } from "react-router-dom";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { RecordTable } from "../../../../components/records/record-table";
import { apiClient } from "../../../../lib/api-client";
import { useQueryClient } from "@tanstack/react-query";

function CreateRecordModal({ objectType, onClose }: { objectType: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const defaultFields = (() => {
    const t = objectType.toLowerCase();
    if (t.includes("employee") || t.includes("staff") || t.includes("hr"))
      return [{ key: "name", value: "" }, { key: "email", value: "" }, { key: "role", value: "" }, { key: "department", value: "" }];
    if (t.includes("deal") || t.includes("opportunit"))
      return [{ key: "name", value: "" }, { key: "company", value: "" }, { key: "amount", value: "" }, { key: "stage", value: "" }];
    if (t.includes("compan") || t.includes("org"))
      return [{ key: "name", value: "" }, { key: "email", value: "" }, { key: "website", value: "" }, { key: "phone", value: "" }];
    return [{ key: "name", value: "" }, { key: "email", value: "" }];
  })();
  const [fields, setFields] = useState<{ key: string; value: string }[]>(defaultFields);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const updateField = (i: number, k: "key" | "value", v: string) => {
    setFields(prev => prev.map((f, idx) => idx === i ? { ...f, [k]: v } : f));
  };

  const addField = () => setFields(prev => [...prev, { key: "", value: "" }]);
  const removeField = (i: number) => setFields(prev => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    const data: Record<string, string> = {};
    for (const f of fields) {
      if (f.key.trim()) data[f.key.trim().toLowerCase().replace(/\s+/g, "_")] = f.value;
    }
    if (!data.name) { setError("Name is required"); return; }
    setSaving(true);
    setError("");
    try {
      const safeType = objectType.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
      await apiClient.post("/nodes", { vertical: "shared", object_type: safeType, data });
      queryClient.invalidateQueries({ queryKey: ["records", objectType] });
      onClose();
    } catch (e: any) {
      const msg = e?.message || "Failed to create record";
      setError(msg.includes("createNode failed") ? msg.replace("createNode failed: ", "") : msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}/>
      <div className="fixed left-1/2 top-1/2 z-50 w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#161820] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="text-sm font-medium text-white capitalize">New {objectType.replace(/-/g, " ")}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={15}/></button>
        </div>
        <div className="p-5 space-y-3 max-h-96 overflow-auto">
          {fields.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={f.key}
                onChange={e => updateField(i, "key", e.target.value)}
                placeholder="Field name"
                className="w-32 shrink-0 rounded-lg border border-white/10 bg-white/[.04] px-2.5 py-1.5 text-xs text-slate-400 placeholder-slate-600 outline-none focus:border-white/20"
              />
              <input
                value={f.value}
                onChange={e => updateField(i, "value", e.target.value)}
                placeholder="Value"
                className="flex-1 rounded-lg border border-white/10 bg-white/[.04] px-2.5 py-1.5 text-sm text-white placeholder-slate-600 outline-none focus:border-red-500/40"
              />
              <button onClick={() => removeField(i)} className="text-slate-600 hover:text-red-400">
                <X size={13}/>
              </button>
            </div>
          ))}
          <button onClick={addField} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white transition-colors">
            <Plus size={13}/> Add field
          </button>
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
        <div className="flex gap-2 border-t border-white/10 px-5 py-4">
          <button onClick={onClose} className="flex-1 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-400 hover:bg-white/[.04] transition-colors">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-400 transition-colors disabled:opacity-50"
          >
            {saving ? "Creating..." : "Create record"}
          </button>
        </div>
      </div>
    </>
  );
}

export function ObjectIndexPage() {
  const { objectType = "records" } = useParams();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold capitalize text-white">{objectType.replace(/-/g, " ")}</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-2 text-sm font-medium text-white hover:bg-red-400 transition-colors"
        >
          <Plus size={15}/> New {objectType.replace(/-/g, " ")}
        </button>
      </div>
      <RecordTable objectType={objectType} />
      {showCreate && <CreateRecordModal objectType={objectType} onClose={() => setShowCreate(false)}/>}
    </div>
  );
}
