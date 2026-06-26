import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback, useRef } from "react";
import { AIMark } from "@/components/ui/ai-button";
import { LogoMark } from "@/components/logo";
import { Plus, X, Check, Loader2, ChevronDown, ChevronUp, Trash2, LayoutList, Kanban, ScanSearch, Filter } from "lucide-react";
import { RecordTable } from "../../../../components/records/record-table";
import { BoardView } from "../../../../components/records/board-view";
import { CategoryPills, INDUSTRY_TAXONOMY } from "../../../../components/records/record-detail";
import { CsvImporter } from "../../../../components/records/csv-importer";
import { DedupPanel } from "../../../../components/records/dedup-panel";
import { SegmentBuilder } from "../../../../components/records/segment-builder";
import { apiClient, getAuthHeaders } from "../../../../lib/api-client";
import { enrichCompany, enrichPerson } from "../../../../lib/ai-enrichment";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// ─── Toggle pill ──────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors ${checked ? "bg-stone-500" : "bg-white/[.10]"}`}
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
        ? "border-stone-600/50 bg-stone-800/40 text-stone-300"
        : "border-stone-700/40 bg-stone-900/30 text-stone-500"
    }`}>
      <LogoMark size={12} className={done ? "text-stone-300" : "animate-pulse text-stone-600"}/>
      {done
        ? `AI enriched "${name}" — fields auto-populated`
        : `Enriching "${name}" in background…`}
    </div>
  );
}

// ─── Create record modal (Manual + AI Generate tabs) ─────────────────────────
function CreateRecordModal({
  objectType,
  tableColumns,
  onClose,
  onEnrichStart,
}: {
  objectType: string;
  tableColumns: string[];
  onClose: () => void;
  onEnrichStart: (recordId: string, name: string) => void;
}) {
  const fieldKeys = tableColumns.length > 0 ? tableColumns : (() => {
    const t = objectType.toLowerCase();
    if (t === "companies") return ["name","description","arr","funding_raised","employee_range","country"];
    if (t === "people")    return ["name","email","job_title","twitter_followers","linkedin"];
    if (t === "deals")     return ["name","deal_stage","deal_value","deal_owner"];
    if (t.includes("employee") || t.includes("staff")) return ["name","email","role","department"];
    return ["name","email"];
  })();

  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"manual"|"ai">("manual");

  // Read colMeta (defaults + required) from localStorage — same key as RecordTable
  const colMeta: Record<string, { defaultValue?: string; required?: boolean }> = (() => {
    try { return JSON.parse(localStorage.getItem(`mondaily_colmeta_${objectType}`) ?? "{}"); } catch { return {}; }
  })();

  // ── Manual tab state — pre-fill defaults ──
  const [values, setValues]     = useState<Record<string, string>>(() =>
    Object.fromEntries(fieldKeys.map(k => [k, colMeta[k]?.defaultValue ?? ""]))
  );
  const [selectedCats, setCats] = useState<{ name: string; color: string }[]>([]);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const [createMore, setCreateMore] = useState(false);

  // ── AI tab state ──
  const [aiPrompt, setAiPrompt]           = useState("");
  const [aiCount, setAiCount]             = useState(10);
  const [aiLoading, setAiLoading]         = useState(false);
  const [aiError, setAiError]             = useState("");
  const [aiRecords, setAiRecords]         = useState<Record<string, string>[]>([]);
  const [aiSelected, setAiSelected]       = useState<Set<number>>(new Set());
  const [aiSaving, setAiSaving]           = useState(false);
  const [aiSaveProgress, setAiSaveProgress] = useState(0);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const resetForm = () => {
    setValues(Object.fromEntries(fieldKeys.map(k => [k, colMeta[k]?.defaultValue ?? ""])));
    setCats([]);
  };
  const label = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  // ── Manual save ──
  const save = useCallback(async () => {
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (k.trim()) data[k.trim().toLowerCase().replace(/\s+/g, "_")] = v;
    }
    if (!data.name) { setError("Name is required"); return; }
    // Enforce required fields
    const missing = fieldKeys.filter(k => colMeta[k]?.required && !data[k]?.trim());
    if (missing.length) { setError(`Required: ${missing.map(k => label(k)).join(", ")}`); return; }
    setSaving(true); setError("");
    try {
      const safeType = objectType.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
      const node = await apiClient.post<{ id: string }>("/nodes", {
        vertical: "shared", object_type: safeType,
        data: { ...data, ...(selectedCats.length ? { categories: selectedCats } : {}) }
      });
      queryClient.invalidateQueries({ queryKey: ["records", objectType] });
      const t = objectType.toLowerCase();
      const isEnrichable = t.includes("compan") || t.includes("person") || t.includes("people") || t.includes("contact") || t.includes("lead") || t.includes("account");
      if (isEnrichable && data.name) onEnrichStart(node.id, data.name);
      if (createMore) { resetForm(); } else { onClose(); }
    } catch (e: any) {
      const msg = e?.message || "Failed to create record";
      setError(msg.includes("createNode failed") ? msg.replace("createNode failed: ", "") : msg);
    } finally { setSaving(false); }
  }, [values, objectType, createMore, onClose, queryClient, onEnrichStart, selectedCats]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (tab === "manual" && (e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void save(); }
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, onClose, tab]);

  // ── AI generate ──
  const generateWithAI = async () => {
    if (!aiPrompt.trim()) { setAiError("Describe what records you want"); return; }
    setAiLoading(true); setAiError(""); setAiRecords([]); setAiSelected(new Set());
    try {
      const headers = await getAuthHeaders();
      const apiUrl = (import.meta.env.VITE_API_URL as string) || "";
      const res = await fetch(`${apiUrl}/api/v1/generate/records`, {
        method: "POST",
        headers: {
          ...headers,
        },
        body: JSON.stringify({ objectType, columns: fieldKeys, prompt: aiPrompt, count: aiCount }),
      });
      const data = await res.json() as any;
      if (data.error) throw new Error(data.error);
      const recs: Record<string, string>[] = (data.records ?? []).map((r: any) =>
        Object.fromEntries(fieldKeys.map(k => [k, String(r[k] ?? "")]))
      );
      setAiRecords(recs);
      setAiSelected(new Set(recs.map((_, i) => i)));
    } catch (e: any) {
      setAiError(e.message || "Failed to generate records");
    } finally { setAiLoading(false); }
  };

  const toggleSelect = (i: number) => setAiSelected(prev => {
    const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s;
  });
  const toggleAll = () => setAiSelected(prev => prev.size === aiRecords.length ? new Set() : new Set(aiRecords.map((_, i) => i)));

  const importSelected = async () => {
    const toCreate = aiRecords.filter((_, i) => aiSelected.has(i));
    if (!toCreate.length) return;
    setAiSaving(true); setAiSaveProgress(0);
    const safeType = objectType.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
    let done = 0;
    for (const rec of toCreate) {
      try {
        await apiClient.post("/nodes", { vertical: "shared", object_type: safeType, data: rec });
      } catch {}
      done++;
      setAiSaveProgress(Math.round((done / toCreate.length) * 100));
    }
    queryClient.invalidateQueries({ queryKey: ["records", objectType] });
    setAiSaving(false);
    onClose();
  };

  const EXAMPLE_PROMPTS: Record<string, string[]> = {
    default: [
      "Generate realistic sample records for demonstration",
      "Create a diverse set of records with varied data",
    ],
  };
  const examples = EXAMPLE_PROMPTS[objectType.toLowerCase()] ?? EXAMPLE_PROMPTS["default"] ?? [];

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={onClose}/>
      <div className={`fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[.09] bg-[#141414] shadow-[0_24px_64px_rgba(0,0,0,0.7)] transition-all duration-200 ${tab === "ai" && aiRecords.length ? "w-[680px]" : "w-[440px]"}`}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[.06] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-semibold capitalize text-white tracking-tight">
              New {objectType.replace(/[-_]/g, " ")}
            </span>
            {/* Tab switcher */}
            <div className="flex items-center rounded-md border border-white/[.07] bg-white/[.03] p-0.5 gap-0.5">
              <button
                onClick={() => setTab("manual")}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${tab === "manual" ? "bg-white/[.08] text-white" : "text-stone-500 hover:text-stone-300"}`}
              >Manual</button>
              <button
                onClick={() => { setTab("ai"); setTimeout(() => promptRef.current?.focus(), 50); }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${tab === "ai" ? "bg-stone-500/20 text-stone-300" : "text-stone-500 hover:text-stone-300"}`}
              >
                <AIMark size={10}/> Generate
              </button>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-stone-500 hover:bg-white/[.05] hover:text-white transition-colors">
            <X size={14}/>
          </button>
        </div>

        {/* ── Manual tab ── */}
        {tab === "manual" && (
          <>
            <div className="max-h-[400px] overflow-auto px-5 py-4 space-y-0.5">
              {fieldKeys.map(k => {
                const isRequired = colMeta[k]?.required;
                const hasDefault = !!colMeta[k]?.defaultValue;
                const isEmpty = !(values[k] ?? "").trim();
                return (
                  <div key={k} className="grid grid-cols-[130px_1fr] items-center gap-3 py-2 border-b border-white/[.04] last:border-0">
                    <span className={`text-[11px] font-medium uppercase tracking-wide select-none truncate flex items-center gap-1 ${isRequired ? "text-stone-400" : "text-stone-600"}`}>
                      {label(k)}
                      {isRequired && <span className="text-stone-400 text-[10px]">*</span>}
                    </span>
                    <input
                      value={values[k] ?? ""}
                      onChange={e => setValues(prev => ({ ...prev, [k]: e.target.value }))}
                      placeholder={hasDefault && isEmpty ? `Default: ${colMeta[k]!.defaultValue}` : "—"}
                      className={`w-full rounded-md border bg-white/[.03] px-2.5 py-1.5 text-sm text-white placeholder-stone-700 outline-none transition-colors focus:bg-white/[.05] ${isRequired && isEmpty ? "border-stone-500/20 focus:border-stone-500/40" : "border-white/[.07] focus:border-stone-500/30"}`}
                    />
                  </div>
                );
              })}
              <div className="py-2 border-b border-white/[.04]">
                <div className="grid grid-cols-[130px_1fr] items-start gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-stone-600 select-none pt-1">Categories</span>
                  <CategoryPills categories={selectedCats} onUpdate={setCats}/>
                </div>
              </div>
              {error && <p className="pt-2 text-xs text-stone-400">{error}</p>}
            </div>
            <div className="flex items-center justify-between border-t border-white/[.06] px-5 py-3.5">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-stone-500 select-none">
                <Toggle checked={createMore} onChange={setCreateMore}/>
                Create more
              </label>
              <div className="flex items-center gap-2">
                <button onClick={onClose} className="rounded-lg border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-xs text-stone-400 transition-all hover:bg-white/[.05] hover:text-white">
                  Cancel
                </button>
                <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg border border-stone-500/30 bg-stone-600 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-stone-500 disabled:opacity-50">
                  {saving ? "Creating…" : "Create record"}
                  <kbd className="rounded border border-stone-500/30 bg-stone-600/40 px-1.5 py-0.5 text-[10px] font-normal text-red-200/70">⌘↵</kbd>
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── AI Generate tab ── */}
        {tab === "ai" && (
          <div className="flex gap-0">
            {/* Left: prompt panel */}
            <div className="flex flex-col w-[440px] shrink-0">
              <div className="px-5 py-4 space-y-3">
                <p className="text-[11px] text-stone-500 leading-relaxed">
                  Describe the records you want. AI will generate realistic data matching your <strong className="text-stone-400">{objectType.replace(/[-_]/g, " ")}</strong> columns.
                </p>
                <textarea
                  ref={promptRef}
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void generateWithAI(); } }}
                  placeholder={`e.g. "10 tax expense categories for a SaaS startup including software subscriptions, travel, and office costs"`}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-white/[.07] bg-white/[.03] px-3 py-2.5 text-sm text-white placeholder-stone-700 outline-none focus:border-stone-500/30 focus:bg-white/[.05] transition-colors"
                />
                {/* Example chips */}
                <div className="flex flex-wrap gap-1.5">
                  {examples.map(ex => (
                    <button key={ex} onClick={() => setAiPrompt(ex)} className="rounded-full border border-white/[.06] bg-white/[.03] px-2.5 py-1 text-[10px] text-stone-500 hover:border-white/[.12] hover:text-stone-300 transition-colors text-left">
                      {ex}
                    </button>
                  ))}
                </div>
                {/* Count selector */}
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-stone-500">Generate</span>
                  <div className="flex items-center gap-1">
                    {[5,10,20,50].map(n => (
                      <button
                        key={n}
                        onClick={() => setAiCount(n)}
                        className={`w-9 rounded-md border py-1 text-[11px] font-medium transition-colors ${aiCount === n ? "border-stone-500/30 bg-stone-600/10 text-stone-300" : "border-white/[.07] bg-white/[.02] text-stone-500 hover:text-stone-300"}`}
                      >{n}</button>
                    ))}
                  </div>
                  <span className="text-[11px] text-stone-500">records</span>
                </div>
                {aiError && <p className="text-xs text-stone-400">{aiError}</p>}
              </div>
              <div className="flex items-center justify-between border-t border-white/[.06] px-5 py-3.5">
                <button onClick={onClose} className="rounded-lg border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-xs text-stone-400 transition-all hover:bg-white/[.05] hover:text-white">
                  Cancel
                </button>
                <button
                  onClick={generateWithAI}
                  disabled={aiLoading || !aiPrompt.trim()}
                  className="flex items-center gap-2 rounded-lg border border-stone-500/30 bg-stone-600 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-stone-500 disabled:opacity-50"
                >
                  {aiLoading ? <><Loader2 size={11} className="animate-spin"/> Generating…</> : <><LogoMark size={11}/> Generate {aiCount} records</>}
                </button>
              </div>
            </div>

            {/* Right: preview panel (only shown after generation) */}
            {aiRecords.length > 0 && (
              <div className="flex flex-col border-l border-white/[.06] w-[240px] shrink-0">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/[.06]">
                  <span className="text-[11px] font-semibold text-stone-300">{aiRecords.length} records generated</span>
                  <button onClick={toggleAll} className="text-[10px] text-stone-500 hover:text-stone-300 transition-colors">
                    {aiSelected.size === aiRecords.length ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <div className="flex-1 overflow-auto max-h-[320px]">
                  {aiRecords.map((rec, i) => (
                    <div
                      key={i}
                      onClick={() => toggleSelect(i)}
                      className={`flex items-start gap-2.5 px-4 py-2.5 cursor-pointer border-b border-white/[.03] transition-colors ${aiSelected.has(i) ? "bg-stone-500/5" : "opacity-40"}`}
                    >
                      <div className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded border transition-colors ${aiSelected.has(i) ? "border-stone-500 bg-stone-500" : "border-stone-600"}`}>
                        {aiSelected.has(i) && <Check size={10} className="text-white m-auto mt-[1px]"/>}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium text-stone-200 truncate">{rec.name || "—"}</p>
                        {fieldKeys.slice(1, 3).map(k => rec[k] && (
                          <p key={k} className="text-[10px] text-stone-600 truncate">{rec[k]}</p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-3 border-t border-white/[.06]">
                  {aiSaving ? (
                    <div className="space-y-1.5">
                      <div className="h-1.5 w-full rounded-full bg-white/[.06] overflow-hidden">
                        <div className="h-full bg-stone-500 transition-all duration-300" style={{ width: `${aiSaveProgress}%` }}/>
                      </div>
                      <p className="text-center text-[10px] text-stone-500">Saving… {aiSaveProgress}%</p>
                    </div>
                  ) : (
                    <button
                      onClick={importSelected}
                      disabled={aiSelected.size === 0}
                      className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-stone-500/30 bg-stone-600 py-2 text-[11px] font-semibold text-white transition-all hover:bg-stone-500 disabled:opacity-40"
                    >
                      <Check size={11}/> Import {aiSelected.size} record{aiSelected.size !== 1 ? "s" : ""}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ─── AI Fill Sheet modal ───────────────────────────────────────────────────────
// Streamlined version: opens straight to AI generation, no manual tab.
// Pre-populates the prompt with the object name + columns so user barely needs to type.
function AIFillModal({
  objectType, tableColumns, onClose,
}: { objectType: string; tableColumns: string[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const label = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const cleanName = objectType.replace(/[-_]/g, " ");

  // Fetch schema attributes as fallback when tableColumns are not yet known (empty sheet)
  const schemaQuery = useQuery({
    queryKey: ["sidebar-objects"],
    queryFn: () => apiClient.get<Array<{ slug: string; name_plural: string; attributes: Array<{ name: string }> }>>("/objects"),
    staleTime: 60_000,
  });
  const schemaAttrs: string[] = (() => {
    const def = schemaQuery.data?.find(o => o.slug === objectType);
    if (!def?.attributes?.length) return [];
    return ["name", ...def.attributes.map(a => a.name.toLowerCase().replace(/\s+/g, "_")).filter(k => k !== "name")];
  })();

  const [prompt, setPrompt] = useState(`Generate realistic ${cleanName} records`);
  const [count, setCount]   = useState(15);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [records, setRecords] = useState<Record<string, string>[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving]   = useState(false);
  const [progress, setProgress] = useState(0);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { promptRef.current?.focus(); }, []);

  // Use tableColumns (from live table) → schema attrs → fallback
  const fieldKeys = tableColumns.length > 0 ? tableColumns
    : schemaAttrs.length > 0 ? schemaAttrs
    : ["name"];

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true); setError(""); setRecords([]); setSelected(new Set());
    try {
      const headers = await getAuthHeaders();
      const apiUrl = (import.meta.env.VITE_API_URL as string) || "";
      const res = await fetch(`${apiUrl}/api/v1/generate/records`, {
        method: "POST",
        headers: {
          ...headers,
        },
        body: JSON.stringify({ objectType, columns: fieldKeys, prompt, count }),
      });
      const data = await res.json() as any;
      if (data.error) throw new Error(data.error);
      const recs: Record<string, string>[] = (data.records ?? []).map((r: any) =>
        Object.fromEntries(fieldKeys.map(k => [k, String(r[k] ?? "")]))
      );
      setRecords(recs);
      setSelected(new Set(recs.map((_, i) => i)));
    } catch (e: any) { setError(e.message || "Failed to generate"); }
    finally { setLoading(false); }
  };

  const toggleSelect = (i: number) => setSelected(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; });
  const toggleAll = () => setSelected(prev => prev.size === records.length ? new Set() : new Set(records.map((_, i) => i)));

  const importSelected = async () => {
    const toCreate = records.filter((_, i) => selected.has(i));
    if (!toCreate.length) return;
    setSaving(true); setProgress(0);
    const safeType = objectType.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
    let done = 0;
    for (const rec of toCreate) {
      try { await apiClient.post("/nodes", { vertical: "shared", object_type: safeType, data: rec }); } catch {}
      done++;
      setProgress(Math.round((done / toCreate.length) * 100));
    }
    queryClient.invalidateQueries({ queryKey: ["records", objectType] });
    setSaving(false);
    onClose();
  };

  useEffect(() => {
    function h(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[3px]" onClick={onClose}/>
      <div className={`fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[.09] bg-[#141414] shadow-[0_32px_80px_rgba(0,0,0,0.8)] transition-all duration-200 ${records.length ? "w-[720px]" : "w-[500px]"}`}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[.06] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-stone-500/10 border border-stone-500/20">
              <LogoMark size={13} className="text-stone-400"/>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-white capitalize">Fill "{cleanName}" with AI</p>
              <p className="text-[10px] text-stone-600">
                {fieldKeys.length} column{fieldKeys.length !== 1 ? "s" : ""}: {fieldKeys.slice(0, 4).map(label).join(", ")}{fieldKeys.length > 4 ? ` +${fieldKeys.length - 4} more` : ""}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-stone-500 hover:bg-white/[.05] hover:text-white transition-colors">
            <X size={14}/>
          </button>
        </div>

        <div className="flex">
          {/* Left: prompt + controls */}
          <div className="flex flex-col flex-1 min-w-0">
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-[11px] font-medium text-stone-500 mb-1.5 uppercase tracking-wide">Describe what you want</label>
                <textarea
                  ref={promptRef}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void generate(); } }}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-white/[.07] bg-white/[.03] px-3 py-2.5 text-sm text-white placeholder-stone-700 outline-none focus:border-stone-500/30 focus:bg-white/[.05] transition-colors"
                />
                <p className="mt-1 text-[10px] text-stone-700">e.g. "20 tax expense categories for a SaaS company" or "realistic employee records for a 50-person startup"</p>
              </div>

              {/* Count */}
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-stone-500 shrink-0">Number of records</span>
                <div className="flex items-center gap-1">
                  {[10, 20, 30, 50].map(n => (
                    <button key={n} onClick={() => setCount(n)}
                      className={`w-10 rounded-md border py-1 text-[11px] font-medium transition-colors ${count === n ? "border-stone-500/30 bg-stone-600/10 text-stone-300" : "border-white/[.07] bg-white/[.02] text-stone-500 hover:text-stone-300"}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-xs text-stone-400">{error}</p>}
            </div>

            <div className="flex items-center justify-between border-t border-white/[.06] px-6 py-4">
              <button onClick={onClose} className="rounded-lg border border-white/[.08] bg-white/[.03] px-4 py-2 text-xs text-stone-400 hover:text-white transition-all">
                Cancel
              </button>
              <button onClick={generate} disabled={loading || !prompt.trim()}
                className="flex items-center gap-2 rounded-lg border border-stone-500/30 bg-stone-600 px-4 py-2 text-xs font-semibold text-white hover:bg-stone-500 disabled:opacity-50 transition-all">
                {loading
                  ? <><Loader2 size={12} className="animate-spin"/> Generating {count} records…</>
                  : <><LogoMark size={12}/> Generate {count} records</>}
              </button>
            </div>
          </div>

          {/* Right: preview panel */}
          {records.length > 0 && (
            <div className="flex flex-col w-[260px] shrink-0 border-l border-white/[.06]">
              <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/[.06]">
                <span className="text-[11px] font-semibold text-stone-300">{records.length} records ready</span>
                <button onClick={toggleAll} className="text-[10px] text-stone-500 hover:text-stone-300 transition-colors">
                  {selected.size === records.length ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="flex-1 overflow-auto" style={{ maxHeight: 320 }}>
                {records.map((rec, i) => (
                  <div key={i} onClick={() => toggleSelect(i)}
                    className={`flex items-start gap-2.5 px-4 py-2.5 cursor-pointer border-b border-white/[.03] transition-colors ${selected.has(i) ? "bg-stone-500/5" : "opacity-35"}`}>
                    <div className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded border transition-colors flex items-center justify-center ${selected.has(i) ? "border-stone-500 bg-stone-500" : "border-stone-600"}`}>
                      {selected.has(i) && <Check size={9} className="text-white"/>}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-stone-200 truncate">{rec.name || "—"}</p>
                      {fieldKeys.slice(1, 3).map(k => rec[k] && (
                        <p key={k} className="text-[10px] text-stone-600 truncate">{label(k)}: {rec[k]}</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-4 py-3.5 border-t border-white/[.06]">
                {saving ? (
                  <div className="space-y-1.5">
                    <div className="h-1.5 w-full rounded-full bg-white/[.06] overflow-hidden">
                      <div className="h-full bg-stone-500 transition-all duration-300" style={{ width: `${progress}%` }}/>
                    </div>
                    <p className="text-center text-[10px] text-stone-500">Importing {progress}%</p>
                  </div>
                ) : (
                  <button onClick={importSelected} disabled={selected.size === 0}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-stone-500/30 bg-stone-600 py-2.5 text-[11px] font-semibold text-white hover:bg-stone-500 disabled:opacity-40 transition-all">
                    <Check size={11}/> Import {selected.size} record{selected.size !== 1 ? "s" : ""}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Delete sheet confirmation modal ─────────────────────────────────────────
function DeleteSheetModal({ objectType, onClose, onDeleted }: {
  objectType: string; onClose: () => void; onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const cleanName = objectType.replace(/[-_]/g, " ");

  const confirm = async () => {
    setDeleting(true); setError("");
    try {
      // Find the object definition id
      const defs = queryClient.getQueryData<Array<{ id: string; slug: string }>>(["sidebar-objects"]);
      const def = defs?.find(d => d.slug === objectType);
      if (!def) throw new Error("Object definition not found");
      await apiClient.delete(`/settings/objects/${def.id}`);
      queryClient.invalidateQueries({ queryKey: ["sidebar-objects"] });
      queryClient.invalidateQueries({ queryKey: ["records", objectType] });
      onDeleted();
    } catch (e: any) { setError(e.message || "Failed to delete"); setDeleting(false); }
  };

  useEffect(() => {
    function h(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]" onClick={onClose}/>
      <div className="fixed left-1/2 top-1/2 z-50 w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[.09] bg-[#141414] shadow-[0_24px_64px_rgba(0,0,0,0.8)]">
        <div className="px-6 py-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-stone-500/10 border border-stone-500/20 shrink-0">
              <Trash2 size={15} className="text-stone-400"/>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-white capitalize">Delete "{cleanName}"?</p>
              <p className="text-[11px] text-stone-500 mt-0.5">This will permanently delete the sheet and all its records.</p>
            </div>
          </div>
          <div className="rounded-lg border border-stone-500/30 bg-stone-600/5 px-4 py-3 mb-4">
            <p className="text-[11px] text-stone-300 leading-relaxed">
              ⚠️ This action cannot be undone. All records in <strong className="capitalize">{cleanName}</strong> will be permanently deleted along with the object definition.
            </p>
          </div>
          {error && <p className="mb-3 text-xs text-stone-400">{error}</p>}
          <div className="flex items-center gap-2 justify-end">
            <button onClick={onClose} className="rounded-lg border border-white/[.08] bg-white/[.03] px-4 py-2 text-xs text-stone-400 hover:text-white transition-all">
              Cancel
            </button>
            <button onClick={confirm} disabled={deleting}
              className="flex items-center gap-2 rounded-lg border border-red-600/60 bg-stone-600 px-4 py-2 text-xs font-semibold text-white hover:bg-stone-500 disabled:opacity-50 transition-all">
              {deleting ? "Deleting…" : "Yes, delete sheet"}
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = (searchParams.get("view") ?? "table") as "table" | "board";
  const setView = (v: "table" | "board") => setSearchParams(v === "table" ? {} : { view: v }, { replace: true });

  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showAIFill, setShowAIFill] = useState(false);
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [dedupOpen, setDedupOpen] = useState(false);
  const [segmentOpen, setSegmentOpen] = useState(false);
  const [tableColumns, setTableColumns] = useState<string[]>([]);

  // Detect empty state — shares the same cache key as RecordTable
  const [enriching, setEnriching] = useState<Record<string, { name: string; done: boolean }>>({});
  const hasActiveEnrichment = Object.values(enriching).some(v => !v.done);

  const recordsQuery = useQuery({
    queryKey: ["records", objectType],
    queryFn: () => apiClient.get<{ id: string; object_type: string; data: Record<string, unknown>; updated_at: string }[]>(`/nodes?object_type=${encodeURIComponent(objectType)}`),
    staleTime: 30_000,
    refetchInterval: hasActiveEnrichment ? 3000 : false,
  });
  const isEmpty = recordsQuery.isSuccess && (recordsQuery.data?.length ?? 0) === 0;

  const enrichedIds = Object.entries(enriching).filter(([, v]) => v.done).map(([id]) => id);

  const handleEnrichStart = useCallback((recordId: string, name: string) => {
    setEnriching(prev => ({ ...prev, [recordId]: { name, done: false } }));
    // Poll backend until enrichment_status === "done" (Inngest handles the actual enrichment)
    const interval = setInterval(async () => {
      try {
        const node = await apiClient.get<{ enrichment_status?: string }>(`/nodes/${recordId}`);
        if (node.enrichment_status === "done" || node.enrichment_status === "failed") {
          clearInterval(interval);
          queryClient.invalidateQueries({ queryKey: ["records", objectType] });
          setEnriching(prev => ({ ...prev, [recordId]: { name, done: true } }));
          setTimeout(() => setEnriching(prev => { const n = { ...prev }; delete n[recordId]; return n; }), 6000);
        }
      } catch {
        clearInterval(interval);
        setEnriching(prev => { const n = { ...prev }; delete n[recordId]; return n; });
      }
    }, 3000);
    // Stop polling after 60 seconds max
    setTimeout(() => {
      clearInterval(interval);
      setEnriching(prev => { const n = { ...prev }; delete n[recordId]; return n; });
    }, 60000);
  }, [objectType, queryClient]);

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden">

      {/* Page header — title + view toggle + actions */}
      <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800/40 px-6 py-2.5 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-stone-500 select-none">
            {objectType.replace(/[-_]/g, " ")}
          </span>
          {/* View toggle */}
          <div className="flex items-center rounded-md border border-stone-200 bg-stone-50 dark:border-white/[.06] dark:bg-white/[.02] p-0.5 gap-0.5">
            <button
              onClick={() => setView("table")}
              title="Table view"
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-colors ${view === "table" ? "bg-white text-stone-900 shadow-sm dark:bg-white/[.08] dark:text-white" : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"}`}
            >
              <LayoutList size={11}/> Table
            </button>
            <button
              onClick={() => setView("board")}
              title="Board view"
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-colors ${view === "board" ? "bg-white text-stone-900 shadow-sm dark:bg-white/[.08] dark:text-white" : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"}`}
            >
              <Kanban size={11}/> Board
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowDeleteSheet(true)}
            className="flex items-center gap-1.5 rounded-md border border-stone-200 bg-transparent px-2.5 py-1.5 text-[11px] font-medium text-stone-500 transition-all hover:border-stone-300 hover:text-stone-600 dark:border-white/[.08] dark:text-stone-400 dark:hover:text-stone-100 dark:hover:bg-white/[.05] dark:hover:border-white/[.10]"
            title="Delete this sheet"
          >
            <Trash2 size={11}/>
          </button>
          <button
            onClick={() => setShowAIFill(true)}
            className="flex items-center gap-1.5 rounded-md border border-stone-300 bg-stone-100 px-2.5 py-1.5 text-[11px] font-medium text-[var(--accent)] transition-all hover:bg-stone-200 dark:border-stone-500/30 dark:bg-stone-500/8 dark:text-stone-400 dark:hover:border-stone-500/50 dark:hover:bg-stone-500/15 dark:hover:text-stone-300"
          >
            <AIMark size={11}/> Fill
          </button>
          <button
            onClick={() => setDedupOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-dashed border-stone-300 bg-stone-50 px-2.5 py-1.5 text-[11px] font-medium text-stone-500 transition-all hover:bg-stone-100 dark:border-stone-800/80 dark:bg-stone-900/20 dark:text-stone-400 dark:hover:border-stone-500/40 dark:hover:text-stone-400 dark:hover:bg-stone-900/20"
          >
            <ScanSearch size={11}/> Clean & Lists
          </button>
          <button
            onClick={() => setSegmentOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-dashed border-stone-300 bg-stone-50 px-2.5 py-1.5 text-[11px] font-medium text-stone-500 transition-all hover:bg-stone-100 dark:border-stone-800/80 dark:bg-stone-900/20 dark:text-stone-400 dark:hover:border-stone-500/40 dark:hover:text-stone-400 dark:hover:bg-stone-900/20"
          >
            <Filter size={11}/> Segment
          </button>
          <button
            onClick={() => setImportOpen(p => !p)}
            className={`flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-[11px] font-medium transition-all ${importOpen ? "border-stone-400 bg-stone-100 text-stone-700 dark:border-stone-600/60 dark:bg-stone-800/50 dark:text-stone-200" : "border-stone-300 bg-stone-50 text-stone-500 hover:bg-stone-100 dark:border-stone-800/80 dark:bg-stone-900/20 dark:text-stone-400 dark:hover:border-stone-700/60 dark:hover:text-stone-200 dark:hover:bg-stone-900/20"}`}
          >
            <Plus size={11}/> Import CSV
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-md border border-transparent bg-stone-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-stone-700 dark:border-stone-400/40 dark:bg-stone-500 dark:hover:bg-stone-500"
          >
            <Plus size={11}/> New record
          </button>
        </div>
      </div>

      {/* Enrichment banners */}
      {Object.entries(enriching).length > 0 && (
        <div className="flex flex-col gap-1.5 border-b border-stone-800/40 px-6 py-2 shrink-0">
          {Object.entries(enriching).map(([id, { name, done }]) => (
            <EnrichBanner key={id} name={name} done={done}/>
          ))}
        </div>
      )}

      {/* AI Dedup panel */}
      {dedupOpen && (
        <DedupPanel
          objectType={objectType}
          records={recordsQuery.data ?? []}
          onClose={() => setDedupOpen(false)}
        />
      )}

      {/* Segment builder */}
      {segmentOpen && (
        <SegmentBuilder
          objectType={objectType}
          records={recordsQuery.data ?? []}
          columns={tableColumns}
          onClose={() => setSegmentOpen(false)}
        />
      )}

      {/* Collapsible CSV importer */}
      {importOpen && (
        <div className="border-b border-[#e5e7eb] dark:border-stone-800/40 px-6 py-3 shrink-0">
          <CsvImporter objectType={objectType} onImported={() => { queryClient.invalidateQueries({ queryKey: ["records", objectType] }); setImportOpen(false); }}/>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {isEmpty ? (
          /* Empty state — shown when the sheet has no records yet */
          <div className="flex flex-1 flex-col items-center justify-center gap-6">
            <div className="text-center space-y-2 max-w-sm">
              <div className="flex justify-center mb-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-stone-100 border border-stone-300 dark:bg-stone-500/10 dark:border-stone-500/20">
                  <LogoMark size={22} className="text-[var(--accent)] dark:text-stone-400"/>
                </div>
              </div>
              <h3 className="text-[15px] font-semibold text-[#111827] dark:text-white capitalize">
                {objectType.replace(/[-_]/g, " ")} is empty
              </h3>
              <p className="text-[12px] text-[#6b7280] dark:text-stone-500 leading-relaxed">
                Let AI build this sheet for you. It already knows your columns — just describe what records you want and it will generate them instantly.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowAIFill(true)}
                className="flex items-center gap-2 rounded-lg border border-stone-300 bg-stone-100 px-5 py-2.5 text-[12px] font-semibold text-[var(--accent)] hover:bg-stone-200 dark:border-stone-400/40 dark:bg-stone-500 dark:text-white dark:hover:bg-stone-400 transition-all"
              >
                <AIMark size={13}/> Fill
              </button>
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 rounded-lg border border-[#e5e7eb] bg-white px-5 py-2.5 text-[12px] text-[#374151] hover:bg-[#f8fafc] hover:border-[#cbd5e1] dark:border-white/[.08] dark:bg-white/[.03] dark:text-stone-400 dark:hover:text-white dark:hover:bg-white/[.06] transition-all"
              >
                <Plus size={13}/> Add manually
              </button>
              <button
                onClick={() => setImportOpen(true)}
                className="flex items-center gap-2 rounded-lg border border-dashed border-[#d1d5db] bg-[#f9fafb] px-5 py-2.5 text-[12px] text-[#6b7280] hover:bg-[#f3f4f6] hover:border-[#9ca3af] dark:border-stone-700/60 dark:bg-transparent dark:text-stone-500 dark:hover:text-stone-300 dark:hover:border-stone-600/60 transition-all"
              >
                <Plus size={13}/> Import CSV
              </button>
            </div>
          </div>
        ) : view === "board" ? (
          <BoardView objectType={objectType}/>
        ) : (
          <RecordTable objectType={objectType} enrichedIds={enrichedIds} onColumnsChange={setTableColumns}/>
        )}
      </div>

      {showCreate && (
        <CreateRecordModal
          objectType={objectType}
          tableColumns={tableColumns}
          onClose={() => setShowCreate(false)}
          onEnrichStart={handleEnrichStart}
        />
      )}
      {showAIFill && (
        <AIFillModal
          objectType={objectType}
          tableColumns={tableColumns}
          onClose={() => setShowAIFill(false)}
        />
      )}
      {showDeleteSheet && (
        <DeleteSheetModal
          objectType={objectType}
          onClose={() => setShowDeleteSheet(false)}
          onDeleted={() => navigate("/objects/companies")}
        />
      )}
    </div>
    </>
  );
}
