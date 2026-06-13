import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, X, Sparkles, Check, Loader2, ChevronDown, ChevronUp, Trash2, LayoutList, Kanban } from "lucide-react";
import { RecordTable } from "../../../../components/records/record-table";
import { BoardView } from "../../../../components/records/board-view";
import { CategoryPills, INDUSTRY_TAXONOMY } from "../../../../components/records/record-detail";
import { CsvImporter } from "../../../../components/records/csv-importer";
import { apiClient } from "../../../../lib/api-client";
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
        ? "border-zinc-600/50 bg-zinc-800/40 text-zinc-300"
        : "border-zinc-700/40 bg-zinc-900/30 text-zinc-500"
    }`}>
      <Sparkles size={12} className={done ? "text-zinc-300" : "animate-pulse text-zinc-600"}/>
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

  // ── Manual tab state ──
  const [values, setValues]     = useState<Record<string, string>>(() => Object.fromEntries(fieldKeys.map(k => [k, ""])));
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

  const resetForm = () => { setValues(Object.fromEntries(fieldKeys.map(k => [k, ""]))); setCats([]); };
  const label = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  // ── Manual save ──
  const save = useCallback(async () => {
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (k.trim()) data[k.trim().toLowerCase().replace(/\s+/g, "_")] = v;
    }
    if (!data.name) { setError("Name is required"); return; }
    setSaving(true); setError("");
    try {
      const safeType = objectType.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
      const node = await apiClient.post<{ id: string }>("/nodes", {
        vertical: "shared", object_type: safeType,
        data: { ...data, ...(selectedCats.length ? { categories: selectedCats } : {}) }
      });
      queryClient.invalidateQueries({ queryKey: ["records", objectType] });
      const t = objectType.toLowerCase();
      if ((t === "companies" || t.includes("compan")) && data.name) onEnrichStart(node.id, data.name);
      else if ((t === "people" || t.includes("person") || t.includes("contact")) && data.email) onEnrichStart(node.id, data.name || data.email);
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
      const token = localStorage.getItem("mondaily_session_token");
      const workspaceId = localStorage.getItem("mondaily_workspace_id");
      const apiUrl = (import.meta.env.VITE_API_URL as string) || "";
      const res = await fetch(`${apiUrl}/api/v1/generate/records`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
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
      <div className={`fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/[.08] bg-[#13151a] shadow-[0_24px_64px_rgba(0,0,0,0.7)] transition-all duration-200 ${tab === "ai" && aiRecords.length ? "w-[680px]" : "w-[440px]"}`}>

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
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${tab === "manual" ? "bg-white/[.08] text-white" : "text-zinc-500 hover:text-zinc-300"}`}
              >Manual</button>
              <button
                onClick={() => { setTab("ai"); setTimeout(() => promptRef.current?.focus(), 50); }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${tab === "ai" ? "bg-red-500/20 text-red-300" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                <Sparkles size={10}/> Generate with AI
              </button>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-white/[.05] hover:text-white transition-colors">
            <X size={14}/>
          </button>
        </div>

        {/* ── Manual tab ── */}
        {tab === "manual" && (
          <>
            <div className="max-h-[400px] overflow-auto px-5 py-4 space-y-0.5">
              {fieldKeys.map(k => (
                <div key={k} className="grid grid-cols-[130px_1fr] items-center gap-3 py-2 border-b border-white/[.04] last:border-0">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-600 select-none truncate">{label(k)}</span>
                  <input
                    value={values[k] ?? ""}
                    onChange={e => setValues(prev => ({ ...prev, [k]: e.target.value }))}
                    placeholder="—"
                    className="w-full rounded-md border border-white/[.07] bg-white/[.03] px-2.5 py-1.5 text-sm text-white placeholder-slate-700 outline-none transition-colors focus:border-red-500/30 focus:bg-white/[.05]"
                  />
                </div>
              ))}
              <div className="py-2 border-b border-white/[.04]">
                <div className="grid grid-cols-[130px_1fr] items-start gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-600 select-none pt-1">Categories</span>
                  <CategoryPills categories={selectedCats} onUpdate={setCats}/>
                </div>
              </div>
              {error && <p className="pt-2 text-xs text-red-400">{error}</p>}
            </div>
            <div className="flex items-center justify-between border-t border-white/[.06] px-5 py-3.5">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500 select-none">
                <Toggle checked={createMore} onChange={setCreateMore}/>
                Create more
              </label>
              <div className="flex items-center gap-2">
                <button onClick={onClose} className="rounded-lg border-x border-t border-white/[.08] border-b-2 border-b-white/[.14] bg-white/[.03] px-3 py-1.5 text-xs text-slate-400 transition-all hover:bg-white/[.05] hover:text-white active:translate-y-[1px]">
                  Cancel
                </button>
                <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg border-x border-t border-red-500/50 border-b-[3px] border-b-red-700 bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-red-400 active:translate-y-[1px] disabled:opacity-50">
                  {saving ? "Creating…" : "Create record"}
                  <kbd className="rounded border border-red-400/40 bg-red-600/40 px-1.5 py-0.5 text-[10px] font-normal text-red-200/70">⌘↵</kbd>
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
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Describe the records you want. AI will generate realistic data matching your <strong className="text-zinc-400">{objectType.replace(/[-_]/g, " ")}</strong> columns.
                </p>
                <textarea
                  ref={promptRef}
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void generateWithAI(); } }}
                  placeholder={`e.g. "10 tax expense categories for a SaaS startup including software subscriptions, travel, and office costs"`}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-white/[.07] bg-white/[.03] px-3 py-2.5 text-sm text-white placeholder-zinc-700 outline-none focus:border-red-500/30 focus:bg-white/[.05] transition-colors"
                />
                {/* Example chips */}
                <div className="flex flex-wrap gap-1.5">
                  {examples.map(ex => (
                    <button key={ex} onClick={() => setAiPrompt(ex)} className="rounded-full border border-white/[.06] bg-white/[.03] px-2.5 py-1 text-[10px] text-zinc-500 hover:border-white/[.12] hover:text-zinc-300 transition-colors text-left">
                      {ex}
                    </button>
                  ))}
                </div>
                {/* Count selector */}
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-zinc-500">Generate</span>
                  <div className="flex items-center gap-1">
                    {[5,10,20,50].map(n => (
                      <button
                        key={n}
                        onClick={() => setAiCount(n)}
                        className={`w-9 rounded-md border py-1 text-[11px] font-medium transition-colors ${aiCount === n ? "border-red-500/50 bg-red-500/10 text-red-300" : "border-white/[.07] bg-white/[.02] text-zinc-500 hover:text-zinc-300"}`}
                      >{n}</button>
                    ))}
                  </div>
                  <span className="text-[11px] text-zinc-500">records</span>
                </div>
                {aiError && <p className="text-xs text-red-400">{aiError}</p>}
              </div>
              <div className="flex items-center justify-between border-t border-white/[.06] px-5 py-3.5">
                <button onClick={onClose} className="rounded-lg border-x border-t border-white/[.08] border-b-2 border-b-white/[.14] bg-white/[.03] px-3 py-1.5 text-xs text-slate-400 transition-all hover:bg-white/[.05] hover:text-white">
                  Cancel
                </button>
                <button
                  onClick={generateWithAI}
                  disabled={aiLoading || !aiPrompt.trim()}
                  className="flex items-center gap-2 rounded-lg border-x border-t border-red-500/50 border-b-[3px] border-b-red-700 bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-red-400 active:translate-y-[1px] disabled:opacity-50"
                >
                  {aiLoading ? <><Loader2 size={11} className="animate-spin"/> Generating…</> : <><Sparkles size={11}/> Generate {aiCount} records</>}
                </button>
              </div>
            </div>

            {/* Right: preview panel (only shown after generation) */}
            {aiRecords.length > 0 && (
              <div className="flex flex-col border-l border-white/[.06] w-[240px] shrink-0">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/[.06]">
                  <span className="text-[11px] font-semibold text-zinc-300">{aiRecords.length} records generated</span>
                  <button onClick={toggleAll} className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors">
                    {aiSelected.size === aiRecords.length ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <div className="flex-1 overflow-auto max-h-[320px]">
                  {aiRecords.map((rec, i) => (
                    <div
                      key={i}
                      onClick={() => toggleSelect(i)}
                      className={`flex items-start gap-2.5 px-4 py-2.5 cursor-pointer border-b border-white/[.03] transition-colors ${aiSelected.has(i) ? "bg-red-500/5" : "opacity-40"}`}
                    >
                      <div className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded border transition-colors ${aiSelected.has(i) ? "border-red-500 bg-red-500" : "border-zinc-600"}`}>
                        {aiSelected.has(i) && <Check size={10} className="text-white m-auto mt-[1px]"/>}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium text-zinc-200 truncate">{rec.name || "—"}</p>
                        {fieldKeys.slice(1, 3).map(k => rec[k] && (
                          <p key={k} className="text-[10px] text-zinc-600 truncate">{rec[k]}</p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-3 border-t border-white/[.06]">
                  {aiSaving ? (
                    <div className="space-y-1.5">
                      <div className="h-1.5 w-full rounded-full bg-white/[.06] overflow-hidden">
                        <div className="h-full bg-red-500 transition-all duration-300" style={{ width: `${aiSaveProgress}%` }}/>
                      </div>
                      <p className="text-center text-[10px] text-zinc-500">Saving… {aiSaveProgress}%</p>
                    </div>
                  ) : (
                    <button
                      onClick={importSelected}
                      disabled={aiSelected.size === 0}
                      className="w-full flex items-center justify-center gap-1.5 rounded-lg border-x border-t border-red-500/50 border-b-[3px] border-b-red-700 bg-red-500 py-2 text-[11px] font-semibold text-white transition-all hover:bg-red-400 disabled:opacity-40"
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
      const token = localStorage.getItem("mondaily_session_token");
      const workspaceId = localStorage.getItem("mondaily_workspace_id");
      const apiUrl = (import.meta.env.VITE_API_URL as string) || "";
      const res = await fetch(`${apiUrl}/api/v1/generate/records`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
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
      <div className={`fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/[.08] bg-[#13151a] shadow-[0_32px_80px_rgba(0,0,0,0.8)] transition-all duration-200 ${records.length ? "w-[720px]" : "w-[500px]"}`}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[.06] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/10 border border-red-500/20">
              <Sparkles size={13} className="text-red-400"/>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-white capitalize">Fill "{cleanName}" with AI</p>
              <p className="text-[10px] text-zinc-600">
                {fieldKeys.length} column{fieldKeys.length !== 1 ? "s" : ""}: {fieldKeys.slice(0, 4).map(label).join(", ")}{fieldKeys.length > 4 ? ` +${fieldKeys.length - 4} more` : ""}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-white/[.05] hover:text-white transition-colors">
            <X size={14}/>
          </button>
        </div>

        <div className="flex">
          {/* Left: prompt + controls */}
          <div className="flex flex-col flex-1 min-w-0">
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-[11px] font-medium text-zinc-500 mb-1.5 uppercase tracking-wide">Describe what you want</label>
                <textarea
                  ref={promptRef}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void generate(); } }}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-white/[.07] bg-white/[.03] px-3 py-2.5 text-sm text-white placeholder-zinc-700 outline-none focus:border-red-500/30 focus:bg-white/[.05] transition-colors"
                />
                <p className="mt-1 text-[10px] text-zinc-700">e.g. "20 tax expense categories for a SaaS company" or "realistic employee records for a 50-person startup"</p>
              </div>

              {/* Count */}
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-zinc-500 shrink-0">Number of records</span>
                <div className="flex items-center gap-1">
                  {[10, 20, 30, 50].map(n => (
                    <button key={n} onClick={() => setCount(n)}
                      className={`w-10 rounded-md border py-1 text-[11px] font-medium transition-colors ${count === n ? "border-red-500/50 bg-red-500/10 text-red-300" : "border-white/[.07] bg-white/[.02] text-zinc-500 hover:text-zinc-300"}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-xs text-red-400">{error}</p>}
            </div>

            <div className="flex items-center justify-between border-t border-white/[.06] px-6 py-4">
              <button onClick={onClose} className="rounded-lg border border-white/[.08] bg-white/[.03] px-4 py-2 text-xs text-slate-400 hover:text-white transition-all">
                Cancel
              </button>
              <button onClick={generate} disabled={loading || !prompt.trim()}
                className="flex items-center gap-2 rounded-lg border-x border-t border-red-500/50 border-b-[3px] border-b-red-700 bg-red-500 px-4 py-2 text-xs font-semibold text-white hover:bg-red-400 disabled:opacity-50 transition-all">
                {loading
                  ? <><Loader2 size={12} className="animate-spin"/> Generating {count} records…</>
                  : <><Sparkles size={12}/> Generate {count} records</>}
              </button>
            </div>
          </div>

          {/* Right: preview panel */}
          {records.length > 0 && (
            <div className="flex flex-col w-[260px] shrink-0 border-l border-white/[.06]">
              <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/[.06]">
                <span className="text-[11px] font-semibold text-zinc-300">{records.length} records ready</span>
                <button onClick={toggleAll} className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors">
                  {selected.size === records.length ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="flex-1 overflow-auto" style={{ maxHeight: 320 }}>
                {records.map((rec, i) => (
                  <div key={i} onClick={() => toggleSelect(i)}
                    className={`flex items-start gap-2.5 px-4 py-2.5 cursor-pointer border-b border-white/[.03] transition-colors ${selected.has(i) ? "bg-red-500/5" : "opacity-35"}`}>
                    <div className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded border transition-colors flex items-center justify-center ${selected.has(i) ? "border-red-500 bg-red-500" : "border-zinc-600"}`}>
                      {selected.has(i) && <Check size={9} className="text-white"/>}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-zinc-200 truncate">{rec.name || "—"}</p>
                      {fieldKeys.slice(1, 3).map(k => rec[k] && (
                        <p key={k} className="text-[10px] text-zinc-600 truncate">{label(k)}: {rec[k]}</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-4 py-3.5 border-t border-white/[.06]">
                {saving ? (
                  <div className="space-y-1.5">
                    <div className="h-1.5 w-full rounded-full bg-white/[.06] overflow-hidden">
                      <div className="h-full bg-red-500 transition-all duration-300" style={{ width: `${progress}%` }}/>
                    </div>
                    <p className="text-center text-[10px] text-zinc-500">Importing {progress}%</p>
                  </div>
                ) : (
                  <button onClick={importSelected} disabled={selected.size === 0}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg border-x border-t border-red-500/50 border-b-[3px] border-b-red-700 bg-red-500 py-2.5 text-[11px] font-semibold text-white hover:bg-red-400 disabled:opacity-40 transition-all">
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
      <div className="fixed left-1/2 top-1/2 z-50 w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-red-500/20 bg-[#13151a] shadow-[0_24px_64px_rgba(0,0,0,0.8)]">
        <div className="px-6 py-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10 border border-red-500/20 shrink-0">
              <Trash2 size={15} className="text-red-400"/>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-white capitalize">Delete "{cleanName}"?</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">This will permanently delete the sheet and all its records.</p>
            </div>
          </div>
          <div className="rounded-lg border border-red-500/15 bg-red-500/5 px-4 py-3 mb-4">
            <p className="text-[11px] text-red-300 leading-relaxed">
              ⚠️ This action cannot be undone. All records in <strong className="capitalize">{cleanName}</strong> will be permanently deleted along with the object definition.
            </p>
          </div>
          {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
          <div className="flex items-center gap-2 justify-end">
            <button onClick={onClose} className="rounded-lg border border-white/[.08] bg-white/[.03] px-4 py-2 text-xs text-zinc-400 hover:text-white transition-all">
              Cancel
            </button>
            <button onClick={confirm} disabled={deleting}
              className="flex items-center gap-2 rounded-lg border border-red-600/60 bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50 transition-all">
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
  const [tableColumns, setTableColumns] = useState<string[]>([]);

  // Detect empty state — shares the same cache key as RecordTable
  const recordsQuery = useQuery({
    queryKey: ["records", objectType],
    queryFn: () => apiClient.get<{ id: string }[]>(`/nodes?object_type=${encodeURIComponent(objectType)}`),
    staleTime: 30_000,
  });
  const isEmpty = recordsQuery.isSuccess && (recordsQuery.data?.length ?? 0) === 0;

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
    <>
      <div className="flex h-full flex-col overflow-hidden">

      {/* Page header — title + view toggle + actions */}
      <div className="flex items-center justify-between border-b border-zinc-800/40 px-6 py-2.5 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-zinc-500 select-none">
            {objectType.replace(/[-_]/g, " ")}
          </span>
          {/* View toggle */}
          <div className="flex items-center rounded-md border border-white/[.06] bg-white/[.02] p-0.5 gap-0.5">
            <button
              onClick={() => setView("table")}
              title="Table view"
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-colors ${view === "table" ? "bg-white/[.08] text-white" : "text-zinc-600 hover:text-zinc-300"}`}
            >
              <LayoutList size={11}/> Table
            </button>
            <button
              onClick={() => setView("board")}
              title="Board view"
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-colors ${view === "board" ? "bg-white/[.08] text-white" : "text-zinc-600 hover:text-zinc-300"}`}
            >
              <Kanban size={11}/> Board
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowDeleteSheet(true)}
            className="flex items-center gap-1.5 rounded-md border border-zinc-800/60 bg-transparent px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 transition-all hover:border-red-500/30 hover:text-red-400"
            title="Delete this sheet"
          >
            <Trash2 size={11}/>
          </button>
          <button
            onClick={() => setShowAIFill(true)}
            className="flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/8 px-2.5 py-1.5 text-[11px] font-medium text-red-400 transition-all hover:border-red-500/50 hover:bg-red-500/15 hover:text-red-300"
          >
            <Sparkles size={11}/> Fill with AI
          </button>
          <button
            onClick={() => setImportOpen(p => !p)}
            className={`flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-[11px] font-medium transition-all ${importOpen ? "border-zinc-600/60 bg-zinc-800/50 text-zinc-200" : "border-zinc-800/80 bg-zinc-900/20 text-zinc-400 hover:border-zinc-700/60 hover:text-zinc-200"}`}
          >
            <Plus size={11}/> Import CSV
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-md border-x border-t border-red-500/50 border-b-[3px] border-b-red-700 bg-red-500 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-red-400 active:translate-y-[1px] active:border-b active:border-b-red-500/50"
          >
            <Plus size={11}/> New record
          </button>
        </div>
      </div>

      {/* Enrichment banners */}
      {Object.entries(enriching).length > 0 && (
        <div className="flex flex-col gap-1.5 border-b border-zinc-800/40 px-6 py-2 shrink-0">
          {Object.entries(enriching).map(([id, { name, done }]) => (
            <EnrichBanner key={id} name={name} done={done}/>
          ))}
        </div>
      )}

      {/* Collapsible CSV importer */}
      {importOpen && (
        <div className="border-b border-zinc-800/40 px-6 py-3 shrink-0">
          <CsvImporter objectType={objectType} onImported={() => { queryClient.invalidateQueries({ queryKey: ["records", objectType] }); setImportOpen(false); }}/>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {isEmpty ? (
          /* Empty state — shown when the sheet has no records yet */
          <div className="flex flex-1 flex-col items-center justify-center gap-6">
            <div className="text-center space-y-2 max-w-sm">
              <div className="flex justify-center mb-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 border border-red-500/20">
                  <Sparkles size={22} className="text-red-400"/>
                </div>
              </div>
              <h3 className="text-[15px] font-semibold text-white capitalize">
                {objectType.replace(/[-_]/g, " ")} is empty
              </h3>
              <p className="text-[12px] text-zinc-500 leading-relaxed">
                Let AI build this sheet for you. It already knows your columns — just describe what records you want and it will generate them instantly.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowAIFill(true)}
                className="flex items-center gap-2 rounded-lg border-x border-t border-red-500/50 border-b-[3px] border-b-red-700 bg-red-500 px-5 py-2.5 text-[12px] font-semibold text-white hover:bg-red-400 transition-all"
              >
                <Sparkles size={13}/> Fill with AI
              </button>
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 rounded-lg border border-white/[.08] bg-white/[.03] px-5 py-2.5 text-[12px] text-zinc-400 hover:text-white hover:bg-white/[.06] transition-all"
              >
                <Plus size={13}/> Add manually
              </button>
              <button
                onClick={() => setImportOpen(true)}
                className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-700/60 bg-transparent px-5 py-2.5 text-[12px] text-zinc-500 hover:text-zinc-300 hover:border-zinc-600/60 transition-all"
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
