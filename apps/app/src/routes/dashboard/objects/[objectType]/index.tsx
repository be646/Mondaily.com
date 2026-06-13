import { useParams } from "react-router-dom";
import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, X, Sparkles, Check, Loader2, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { RecordTable } from "../../../../components/records/record-table";
import { CategoryPills, INDUSTRY_TAXONOMY } from "../../../../components/records/record-detail";
import { CsvImporter } from "../../../../components/records/csv-importer";
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

// ─── Page ─────────────────────────────────────────────────────────────────────
export function ObjectIndexPage() {
  const { objectType = "records" } = useParams();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [tableColumns, setTableColumns] = useState<string[]>([]);

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

      {/* Page header — title + actions */}
      <div className="flex items-center justify-between border-b border-zinc-800/40 px-6 py-2.5 shrink-0">
        <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-zinc-500 select-none">
          {objectType.replace(/[-_]/g, " ")}
        </span>
        <div className="flex items-center gap-1.5">
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

      <div className="flex-1 min-h-0 overflow-hidden">
        <RecordTable objectType={objectType} enrichedIds={enrichedIds} onColumnsChange={setTableColumns}/>
      </div>

      {showCreate && (
        <CreateRecordModal
          objectType={objectType}
          tableColumns={tableColumns}
          onClose={() => setShowCreate(false)}
          onEnrichStart={handleEnrichStart}
        />
      )}
    </div>
    </>
  );
}
