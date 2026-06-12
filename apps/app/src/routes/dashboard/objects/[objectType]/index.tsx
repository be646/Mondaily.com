import { useParams } from "react-router-dom";
import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, X, Sparkles } from "lucide-react";
import { RecordTable } from "../../../../components/records/record-table";
import { apiClient } from "../../../../lib/api-client";
import { enrichCompany, enrichPerson } from "../../../../lib/ai-enrichment";
import { useQueryClient } from "@tanstack/react-query";

// ─── Toggle pill ──────────────────────────────────────────────────────────────
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

// ─── Enrichment status banner ─────────────────────────────────────────────────
function EnrichBanner({ name, done }: { name: string; done: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all duration-500 ${
      done
        ? "border-emerald-500/30 bg-emerald-500/[.06] text-emerald-400"
        : "border-purple-500/20 bg-purple-500/[.04] text-purple-400"
    }`}>
      <Sparkles size={12} className={done ? "" : "animate-pulse"}/>
      {done
        ? `AI enriched "${name}" — fields auto-populated`
        : `Enriching "${name}" in background…`}
    </div>
  );
}

// ─── Create record modal ──────────────────────────────────────────────────────
function CreateRecordModal({
  objectType,
  onClose,
  onEnrichStart,
}: {
  objectType: string;
  onClose: () => void;
  onEnrichStart: (recordId: string, name: string) => void;
}) {
  const queryClient = useQueryClient();
  const cachedRecords = (queryClient.getQueryData<Array<{ data: Record<string, unknown> }>>(["records", objectType])) ?? [];
  const liveColumns = Array.from(new Set(cachedRecords.flatMap(r => Object.keys(r.data)))).slice(0, 8);

  const fieldKeys = liveColumns.length > 0 ? liveColumns : (() => {
    const t = objectType.toLowerCase();
    if (t === "companies") return ["name","description","arr","funding_raised","employee_range","country"];
    if (t === "people")    return ["name","email","job_title","twitter_followers","linkedin"];
    if (t === "deals")     return ["name","deal_stage","deal_value","deal_owner"];
    if (t.includes("employee") || t.includes("staff")) return ["name","email","role","department"];
    return ["name","email"];
  })();

  const [values, setValues]     = useState<Record<string, string>>(() => Object.fromEntries(fieldKeys.map(k => [k, ""])));
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const [createMore, setCreateMore] = useState(false);

  const resetForm = () => setValues(Object.fromEntries(fieldKeys.map(k => [k, ""])));

  const save = useCallback(async () => {
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (k.trim()) data[k.trim().toLowerCase().replace(/\s+/g, "_")] = v;
    }
    if (!data.name) { setError("Name is required"); return; }
    setSaving(true); setError("");
    try {
      const safeType = objectType.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
      const node = await apiClient.post<{ id: string }>("/nodes", { vertical: "shared", object_type: safeType, data });
      queryClient.invalidateQueries({ queryKey: ["records", objectType] });

      // Kick off background enrichment for companies and people
      const t = objectType.toLowerCase();
      if ((t === "companies" || t.includes("compan")) && data.name) {
        onEnrichStart(node.id, data.name);
      } else if ((t === "people" || t.includes("person") || t.includes("contact")) && data.email) {
        onEnrichStart(node.id, data.name || data.email);
      }

      if (createMore) { resetForm(); } else { onClose(); }
    } catch (e: any) {
      const msg = e?.message || "Failed to create record";
      setError(msg.includes("createNode failed") ? msg.replace("createNode failed: ", "") : msg);
    } finally { setSaving(false); }
  }, [values, objectType, createMore, onClose, queryClient, onEnrichStart]);

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

        <div className="flex items-center justify-between border-b border-white/[.06] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold capitalize text-white tracking-tight">
              New {objectType.replace(/[-_]/g, " ")}
            </span>
            {(objectType.toLowerCase() === "companies" || objectType.toLowerCase().includes("compan") || objectType.toLowerCase() === "people") && (
              <span className="flex items-center gap-1 rounded-md border border-purple-500/20 bg-purple-500/[.06] px-1.5 py-0.5 text-[9px] text-purple-400">
                <Sparkles size={8}/> AI enrichment
              </span>
            )}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-white/[.05] hover:text-white transition-colors">
            <X size={14}/>
          </button>
        </div>

        <div className="max-h-[400px] overflow-auto px-5 py-4 space-y-0.5">
          {fieldKeys.map(k => (
            <div key={k} className="grid grid-cols-[130px_1fr] items-center gap-3 py-2 border-b border-white/[.04] last:border-0">
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
          {error && <p className="pt-2 text-xs text-red-400">{error}</p>}
        </div>

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
              <kbd className="rounded border border-red-400/40 bg-red-600/40 px-1.5 py-0.5 text-[10px] font-normal text-red-200/70 tracking-normal">⌘↵</kbd>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function ObjectIndexPage() {
  const { objectType = "records" } = useParams();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  // Track enrichment state: { [recordId]: { name, done } }
  const [enriching, setEnriching] = useState<Record<string, { name: string; done: boolean }>>({});
  const enrichedIds = Object.entries(enriching).filter(([, v]) => v.done).map(([id]) => id);

  const handleEnrichStart = useCallback(async (recordId: string, name: string) => {
    setEnriching(prev => ({ ...prev, [recordId]: { name, done: false } }));
    try {
      const t = objectType.toLowerCase();
      let result;
      if (t === "companies" || t.includes("compan")) {
        const { enrichCompany: ec } = await import("../../../../lib/ai-enrichment");
        result = await ec(name);
      } else {
        const email = name.includes("@") ? name : "";
        if (!email) return;
        const { enrichPerson: ep } = await import("../../../../lib/ai-enrichment");
        result = await ep(email);
      }

      // Fetch current record, merge enriched fields, patch back
      const current = await apiClient.get<{ id: string; data: Record<string, unknown> }>(`/nodes/${recordId}`);
      const merged = { ...current.data, ...result.fields };
      await apiClient.patch(`/nodes/${recordId}`, { data: merged });
      queryClient.invalidateQueries({ queryKey: ["records", objectType] });

      setEnriching(prev => ({ ...prev, [recordId]: { name, done: true } }));
      // Clear banner after 6 seconds
      setTimeout(() => setEnriching(prev => { const n = { ...prev }; delete n[recordId]; return n; }), 6000);
    } catch {
      setEnriching(prev => { const n = { ...prev }; delete n[recordId]; return n; });
    }
  }, [objectType, queryClient]);

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-3 border-b border-white/[.06] px-6 py-3">
        <h1 className="flex-1 text-[15px] font-semibold capitalize text-white tracking-tight">
          {objectType.replace(/[-_]/g, " ")}
        </h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg border-x border-t border-red-500/50 border-b-[3px] border-b-red-700 bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-red-400 active:translate-y-[1px] active:border-b active:border-b-red-500/50"
        >
          <Plus size={13}/> New {objectType.replace(/[-_]/g, " ")}
        </button>
      </div>

      {/* Enrichment banners */}
      {Object.entries(enriching).length > 0 && (
        <div className="flex flex-col gap-1.5 border-b border-white/[.04] px-6 py-2">
          {Object.entries(enriching).map(([id, { name, done }]) => (
            <EnrichBanner key={id} name={name} done={done}/>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto px-6 py-4">
        <RecordTable objectType={objectType} enrichedIds={enrichedIds}/>
      </div>

      {showCreate && (
        <CreateRecordModal
          objectType={objectType}
          onClose={() => setShowCreate(false)}
          onEnrichStart={handleEnrichStart}
        />
      )}
    </div>
  );
}
