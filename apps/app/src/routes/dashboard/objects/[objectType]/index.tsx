import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { AIMark } from "@/components/ui/ai-button";
import { LogoMark } from "@/components/logo";
import { Plus, X, Check, Loader2, ChevronDown, ChevronUp, Trash2, LayoutList, Kanban, ScanSearch, Filter, Sparkles, UploadCloud } from "lucide-react";
import { EmptyState } from "../../../../components/ui/page-state";
import { RecordTable } from "../../../../components/records/record-table";
import { BoardView } from "../../../../components/records/board-view";
import { CategoryPills, INDUSTRY_TAXONOMY } from "../../../../components/records/record-detail";
import { CsvImporter } from "../../../../components/records/csv-importer";
import { DedupPanel } from "../../../../components/records/dedup-panel";
import { SegmentBuilder } from "../../../../components/records/segment-builder";
import { apiClient, apiFetch, getAuthHeaders } from "../../../../lib/api-client";
import { enrichCompany, enrichPerson } from "../../../../lib/ai-enrichment";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PeriodSelector } from "../../../../components/ui/period-selector";
import { CommandPageHeader, ActionMenu } from "../../../../components/ui/controls";
import { usePeriod, periodRange, previousRange, inRange, deltaPct, periodLabel } from "../../../../lib/period";

// ─── Toggle pill ──────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors ${checked ? "bg-stone-500" : "bg-[var(--surface-hover)]"}`}
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
  const queryClient = useQueryClient();

  // Schema-aware fields — the create form now uses THIS sheet's real defined columns (object_definitions
  // attributes), so a custom sheet like "Tax Sheet Report" shows its own columns, not generic hardcoded
  // ones. We union the schema attributes with any columns already discovered on existing rows (so ad-hoc
  // columns aren't lost), schema first. Hardcoded fallback is last resort (brand-new type, no schema yet).
  const schemaQuery = useQuery({
    queryKey: ["objects-schema"],
    queryFn: () => apiClient.get<Array<{ slug: string; attributes?: Array<{ name: string }> }>>("/objects"),
    staleTime: 60_000,
  });
  const fieldKeys = useMemo(() => {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "_");
    const def = schemaQuery.data?.find(o => o.slug === objectType);
    const fromSchema = def?.attributes?.length
      ? ["name", ...def.attributes.map(a => norm(a.name)).filter(k => k !== "name")]
      : [];
    const merged = [...new Set([...fromSchema, ...tableColumns])];
    if (merged.length) return merged;
    const t = objectType.toLowerCase();
    if (t === "companies") return ["name","description","arr","funding_raised","employee_range","country"];
    if (t === "people")    return ["name","email","job_title","twitter_followers","linkedin"];
    if (t === "deals")     return ["name","deal_stage","deal_value","deal_owner"];
    if (t.includes("employee") || t.includes("staff")) return ["name","email","role","department"];
    return ["name","email"];
  }, [schemaQuery.data, objectType, tableColumns]);
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

  // ── Semantic dedup — as the user types a name, surface likely EXISTING duplicates (GET
  //    /nodes/similar, embedding-backed, fail-soft) so they don't create a second "Acme Corp". ──
  const [dupes, setDupes] = useState<{ id: string; name: string; similarity: number | null }[]>([]);
  const nameValue = values.name ?? "";
  useEffect(() => {
    const q = nameValue.trim();
    if (q.length < 3) { setDupes([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await apiClient.get<{ candidates: { id: string; name: string; similarity: number | null }[] }>(`/nodes/similar?q=${encodeURIComponent(q)}&object_type=${encodeURIComponent(objectType)}&limit=3`);
        if (!cancelled) setDupes(res.candidates ?? []);
      } catch { if (!cancelled) setDupes([]); }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [nameValue, objectType]);

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

  // When the schema loads (async), add any newly-known fields to the form without clobbering typed values.
  useEffect(() => {
    setValues(prev => {
      let changed = false;
      const next = { ...prev };
      for (const k of fieldKeys) if (!(k in next)) { next[k] = colMeta[k]?.defaultValue ?? ""; changed = true; }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldKeys]);

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
      const res = await apiFetch(`${apiUrl}/api/v1/generate/records`, {
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
      // No fabrication: when the web yields nothing real, show the reason instead of empty silence.
      if (recs.length === 0 && data.reason) setAiError(data.reason);
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

  // Real-web prompts — this finds genuine, source-backed records online (never fabricated samples).
  const EXAMPLE_PROMPTS: Record<string, string[]> = {
    default: [
      "Aesthetic clinics in London with public contact details",
      "Real estate agencies in Dubai and their websites",
      "SaaS companies that raised a seed round this year",
    ],
  };
  const examples = EXAMPLE_PROMPTS[objectType.toLowerCase()] ?? EXAMPLE_PROMPTS["default"] ?? [];

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={onClose}/>
      <div className={`fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] transition-all duration-200 ${tab === "ai" && aiRecords.length ? "w-[min(680px,92vw)]" : "w-[min(440px,92vw)]"}`}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-semibold capitalize text-[var(--text-primary)] tracking-tight">
              New {objectType.replace(/[-_]/g, " ")}
            </span>
            {/* Tab switcher */}
            <div className="flex items-center rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] p-0.5 gap-0.5">
              <button
                onClick={() => setTab("manual")}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${tab === "manual" ? "bg-[var(--surface-hover)] text-[var(--text-primary)]" : "text-stone-500 hover:text-stone-300"}`}
              >Manual</button>
              <button
                onClick={() => { setTab("ai"); setTimeout(() => promptRef.current?.focus(), 50); }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${tab === "ai" ? "bg-stone-500/20 text-stone-300" : "text-stone-500 hover:text-stone-300"}`}
              >
                <AIMark size={10}/> Generate
              </button>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-stone-500 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors">
            <X size={14}/>
          </button>
        </div>

        {/* ── Manual tab ── */}
        {tab === "manual" && (
          <>
            {dupes.length > 0 && (
              <div className="mx-5 mt-4 rounded-md border px-3 py-2" style={{ borderColor: "color-mix(in srgb, #c6892e 45%, transparent)", background: "color-mix(in srgb, #c6892e 8%, transparent)" }}>
                <p className="text-[11px] font-medium" style={{ color: "#c6892e" }}>Possible duplicate{dupes.length === 1 ? "" : "s"} already in this workspace:</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {dupes.map(d => (
                    <a key={d.id} href={`/objects/${objectType}/${d.id}`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                      {d.name}{d.similarity != null ? <span style={{ color: "var(--text-faint)" }}>· {d.similarity}%</span> : null}
                    </a>
                  ))}
                </div>
              </div>
            )}
            <div className="max-h-[400px] overflow-auto px-5 py-4 space-y-0.5">
              {fieldKeys.map(k => {
                const isRequired = colMeta[k]?.required;
                const hasDefault = !!colMeta[k]?.defaultValue;
                const isEmpty = !(values[k] ?? "").trim();
                return (
                  <div key={k} className="grid grid-cols-[130px_1fr] items-center gap-3 py-2 border-b border-[var(--border-soft)] last:border-0">
                    <span className={`text-[11px] font-medium uppercase tracking-wide select-none truncate flex items-center gap-1 ${isRequired ? "text-stone-400" : "text-stone-600"}`}>
                      {label(k)}
                      {isRequired && <span className="text-stone-400 text-[10px]">*</span>}
                    </span>
                    <input
                      value={values[k] ?? ""}
                      onChange={e => setValues(prev => ({ ...prev, [k]: e.target.value }))}
                      placeholder={hasDefault && isEmpty ? `Default: ${colMeta[k]!.defaultValue}` : "—"}
                      className={`w-full rounded-md border bg-[var(--surface-hover)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] placeholder-stone-700 outline-none transition-colors focus:bg-[var(--surface-hover)] ${isRequired && isEmpty ? "border-stone-500/20 focus:border-stone-500/40" : "border-[var(--border-soft)] focus:border-stone-500/30"}`}
                    />
                  </div>
                );
              })}
              <div className="py-2 border-b border-[var(--border-soft)]">
                <div className="grid grid-cols-[130px_1fr] items-start gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-stone-600 select-none pt-1">Categories</span>
                  <CategoryPills categories={selectedCats} onUpdate={setCats}/>
                </div>
              </div>
              {error && <p className="pt-2 text-xs text-stone-400">{error}</p>}
            </div>
            <div className="flex items-center justify-between border-t border-[var(--border-soft)] px-5 py-3.5">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-stone-500 select-none">
                <Toggle checked={createMore} onChange={setCreateMore}/>
                Create more
              </label>
              <div className="flex items-center gap-2">
                <button onClick={onClose} className="btn-secondary px-3 py-1.5 text-xs">
                  Cancel
                </button>
                <button onClick={save} disabled={saving} className="btn-primary gap-2 px-3 py-1.5 text-xs font-semibold">
                  {saving ? "Creating…" : "Create record"}
                  <kbd className="rounded border border-stone-500/30 bg-stone-600/40 px-1.5 py-0.5 text-[10px] font-normal text-[#d1524a]/70">⌘↵</kbd>
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── AI Generate tab ── */}
        {tab === "ai" && (
          <div className="flex gap-0">
            {/* Left: prompt panel */}
            <div className="flex flex-col w-[min(440px,92vw)] shrink-0">
              <div className="px-5 py-4 space-y-3">
                <p className="text-[11px] text-stone-500 leading-relaxed">
                  Describe what you're looking for. The agent searches the live web and extracts only real, source-backed <strong className="text-stone-400">{objectType.replace(/[-_]/g, " ")}</strong> — never invented data.
                </p>
                <textarea
                  ref={promptRef}
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void generateWithAI(); } }}
                  placeholder={`e.g. "Aesthetic clinics in London with public contact details"`}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-stone-700 outline-none focus:border-stone-500/30 focus:bg-[var(--surface-hover)] transition-colors"
                />
                {/* Example chips */}
                <div className="flex flex-wrap gap-1.5">
                  {examples.map(ex => (
                    <button key={ex} onClick={() => setAiPrompt(ex)} className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2.5 py-1 text-[10px] text-stone-500 hover:border-[var(--border-soft)] hover:text-stone-300 transition-colors text-left">
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
                        className={`w-9 rounded-md border py-1 text-[11px] font-medium transition-colors ${aiCount === n ? "border-stone-500/30 bg-stone-600/10 text-stone-300" : "border-[var(--border-soft)] bg-[var(--surface-hover)] text-stone-500 hover:text-stone-300"}`}
                      >{n}</button>
                    ))}
                  </div>
                  <span className="text-[11px] text-stone-500">records</span>
                </div>
                {aiError && <p className="text-xs text-stone-400">{aiError}</p>}
              </div>
              <div className="flex items-center justify-between border-t border-[var(--border-soft)] px-5 py-3.5">
                <button onClick={onClose} className="btn-secondary px-3 py-1.5 text-xs">
                  Cancel
                </button>
                <button
                  onClick={generateWithAI}
                  disabled={aiLoading || !aiPrompt.trim()}
                  className="flex items-center gap-2 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] transition-all hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] disabled:opacity-50"
                >
                  {aiLoading ? <><Loader2 size={11} className="animate-spin"/> Searching the web…</> : <><LogoMark size={11}/> Find {aiCount} real records</>}
                </button>
              </div>
            </div>

            {/* Right: preview panel (only shown after generation) */}
            {aiRecords.length > 0 && (
              <div className="flex flex-col border-l border-[var(--border-soft)] w-[240px] shrink-0">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-soft)]">
                  <span className="text-[11px] font-semibold text-stone-300">{aiRecords.length} real records found</span>
                  <button onClick={toggleAll} className="text-[10px] text-stone-500 hover:text-stone-300 transition-colors">
                    {aiSelected.size === aiRecords.length ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <div className="flex-1 overflow-auto max-h-[320px]">
                  {aiRecords.map((rec, i) => (
                    <div
                      key={i}
                      onClick={() => toggleSelect(i)}
                      className={`flex items-start gap-2.5 px-4 py-2.5 cursor-pointer border-b border-[var(--border-soft)] transition-colors ${aiSelected.has(i) ? "bg-stone-500/5" : "opacity-40"}`}
                    >
                      <div className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded border transition-colors ${aiSelected.has(i) ? "border-stone-500 bg-stone-500" : "border-stone-600"}`}>
                        {aiSelected.has(i) && <Check size={10} className="text-[var(--text-primary)] m-auto mt-[1px]"/>}
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
                <div className="px-4 py-3 border-t border-[var(--border-soft)]">
                  {aiSaving ? (
                    <div className="space-y-1.5">
                      <div className="h-1.5 w-full rounded-full bg-[var(--surface-hover)] overflow-hidden">
                        <div className="h-full bg-stone-500 transition-all duration-300" style={{ width: `${aiSaveProgress}%` }}/>
                      </div>
                      <p className="text-center text-[10px] text-stone-500">Saving… {aiSaveProgress}%</p>
                    </div>
                  ) : (
                    <button
                      onClick={importSelected}
                      disabled={aiSelected.size === 0}
                      className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] py-2 text-[11px] font-semibold text-[var(--text-primary)] transition-all hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] disabled:opacity-40"
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

  const [prompt, setPrompt] = useState(`Find real ${cleanName} records from the web`);
  const [count, setCount]   = useState(15);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [records, setRecords] = useState<Record<string, string>[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving]   = useState(false);
  const [progress, setProgress] = useState(0);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { promptRef.current?.focus(); }, []);

  // Union the sheet's real schema attributes with columns discovered on existing rows (schema first),
  // so AI-fill extracts exactly this sheet's columns — not a generic guess. Fallback: name only.
  const fieldKeys = (() => {
    const merged = [...new Set([...schemaAttrs, ...tableColumns])];
    return merged.length ? merged : ["name"];
  })();

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true); setError(""); setRecords([]); setSelected(new Set());
    try {
      const headers = await getAuthHeaders();
      const apiUrl = (import.meta.env.VITE_API_URL as string) || "";
      const res = await apiFetch(`${apiUrl}/api/v1/generate/records`, {
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
    setSaving(true); setProgress(0); setError("");
    const safeType = objectType.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
    let done = 0, failed = 0;
    for (const rec of toCreate) {
      try { await apiClient.post("/nodes", { vertical: "shared", object_type: safeType, data: rec }); }
      catch { failed++; }
      done++;
      setProgress(Math.round((done / toCreate.length) * 100));
    }
    queryClient.invalidateQueries({ queryKey: ["records", objectType] });
    setSaving(false);
    // Never fake success: if some (or all) inserts failed, tell the user honestly instead of
    // silently closing on a 100% bar.
    if (failed === toCreate.length) { setError(`Couldn't create any of the ${toCreate.length} record(s). Please try again.`); return; }
    if (failed > 0) { setError(`Created ${toCreate.length - failed} of ${toCreate.length} — ${failed} failed.`); return; }
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
      <div className={`fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] shadow-[0_32px_80px_rgba(0,0,0,0.8)] transition-all duration-200 ${records.length ? "w-[min(720px,92vw)]" : "w-[min(500px,92vw)]"}`}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-stone-500/10 border border-stone-500/20">
              <LogoMark size={13} className="text-stone-400"/>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-[var(--text-primary)] capitalize">Fill "{cleanName}" with AI</p>
              <p className="text-[10px] text-stone-600">
                {fieldKeys.length} column{fieldKeys.length !== 1 ? "s" : ""}: {fieldKeys.slice(0, 4).map(label).join(", ")}{fieldKeys.length > 4 ? ` +${fieldKeys.length - 4} more` : ""}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-stone-500 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors">
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
                  className="w-full resize-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-stone-700 outline-none focus:border-stone-500/30 focus:bg-[var(--surface-hover)] transition-colors"
                />
                <p className="mt-1 text-[10px] text-stone-700">e.g. "SaaS companies that raised a seed round this year" — the agent searches the live web and only returns real, source-backed results.</p>
              </div>

              {/* Count */}
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-stone-500 shrink-0">Number of records</span>
                <div className="flex items-center gap-1">
                  {[10, 20, 30, 50].map(n => (
                    <button key={n} onClick={() => setCount(n)}
                      className={`w-10 rounded-md border py-1 text-[11px] font-medium transition-colors ${count === n ? "border-stone-500/30 bg-stone-600/10 text-stone-300" : "border-[var(--border-soft)] bg-[var(--surface-hover)] text-stone-500 hover:text-stone-300"}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-xs text-stone-400">{error}</p>}
            </div>

            <div className="flex items-center justify-between border-t border-[var(--border-soft)] px-6 py-4">
              <button onClick={onClose} className="btn-secondary px-4 py-2 text-xs">
                Cancel
              </button>
              <button onClick={generate} disabled={loading || !prompt.trim()}
                className="flex items-center gap-2 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] disabled:opacity-50 transition-all">
                {loading
                  ? <><Loader2 size={12} className="animate-spin"/> Searching the web…</>
                  : <><LogoMark size={12}/> Find {count} real records</>}
              </button>
            </div>
          </div>

          {/* Right: preview panel */}
          {records.length > 0 && (
            <div className="flex flex-col w-[260px] shrink-0 border-l border-[var(--border-soft)]">
              <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--border-soft)]">
                <span className="text-[11px] font-semibold text-stone-300">{records.length} records ready</span>
                <button onClick={toggleAll} className="text-[10px] text-stone-500 hover:text-stone-300 transition-colors">
                  {selected.size === records.length ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="flex-1 overflow-auto" style={{ maxHeight: 320 }}>
                {records.map((rec, i) => (
                  <div key={i} onClick={() => toggleSelect(i)}
                    className={`flex items-start gap-2.5 px-4 py-2.5 cursor-pointer border-b border-[var(--border-soft)] transition-colors ${selected.has(i) ? "bg-stone-500/5" : "opacity-35"}`}>
                    <div className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded border transition-colors flex items-center justify-center ${selected.has(i) ? "border-stone-500 bg-stone-500" : "border-stone-600"}`}>
                      {selected.has(i) && <Check size={9} className="text-[var(--text-primary)]"/>}
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
              <div className="px-4 py-3.5 border-t border-[var(--border-soft)]">
                {saving ? (
                  <div className="space-y-1.5">
                    <div className="h-1.5 w-full rounded-full bg-[var(--surface-hover)] overflow-hidden">
                      <div className="h-full bg-stone-500 transition-all duration-300" style={{ width: `${progress}%` }}/>
                    </div>
                    <p className="text-center text-[10px] text-stone-500">Importing {progress}%</p>
                  </div>
                ) : (
                  <button onClick={importSelected} disabled={selected.size === 0}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] py-2.5 text-[11px] font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] disabled:opacity-40 transition-all">
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
      // GET /objects is cached under THREE keys across the app (objects-schema here, sidebar-objects
      // for the nav, object-defs inside record-table). Invalidating only one left the other two
      // serving the deleted type.
      for (const key of ["sidebar-objects", "objects-schema", "object-defs"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
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
      <div className="fixed left-1/2 top-1/2 z-50 w-[min(400px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] shadow-[0_24px_64px_rgba(0,0,0,0.8)]">
        <div className="px-6 py-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-stone-500/10 border border-stone-500/20 shrink-0">
              <Trash2 size={15} className="text-stone-400"/>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-[var(--text-primary)] capitalize">Delete "{cleanName}"?</p>
              <p className="text-[11px] text-stone-500 mt-0.5">This will permanently delete the sheet and all its records.</p>
            </div>
          </div>
          <div className="rounded-sm border border-stone-500/30 bg-stone-600/5 px-4 py-3 mb-4">
            <p className="text-[11px] text-stone-300 leading-relaxed">
              ⚠️ This action cannot be undone. All records in <strong className="capitalize">{cleanName}</strong> will be permanently deleted along with the object definition.
            </p>
          </div>
          {error && <p className="mb-3 text-xs text-stone-400">{error}</p>}
          <div className="flex items-center gap-2 justify-end">
            <button onClick={onClose} className="btn-secondary px-4 py-2 text-xs">
              Cancel
            </button>
            <button onClick={confirm} disabled={deleting}
              className="flex items-center gap-2 rounded-sm border border-[#d1524a] bg-[color-mix(in_srgb,#d1524a_16%,transparent)] px-4 py-2 text-xs font-semibold text-[#d1524a] hover:bg-[color-mix(in_srgb,#d1524a_24%,transparent)] disabled:opacity-50 transition-all">
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
    // limit=1000 — the backend defaults to 50, which truncated the list (showed 50 while the count
    // said 90). Request the full set so the table reflects the real record count.
    queryFn: () => apiClient.get<{ id: string; object_type: string; data: Record<string, unknown>; updated_at: string }[]>(`/nodes?object_type=${encodeURIComponent(objectType)}&limit=1000`),
    staleTime: 30_000,
    refetchInterval: hasActiveEnrichment ? 3000 : false,
  });
  const isEmpty = recordsQuery.isSuccess && (recordsQuery.data?.length ?? 0) === 0;

  // Period lens (FLOW): how many records of this type were CREATED within the selected window, with a
  // period-over-period delta. Generic across every object type. Created date = node created_at
  // (fallback data.created_at). "All" hides the flow chip (nothing to scope).
  const [period, setPeriod] = usePeriod(`mondaily_obj_${objectType}_period`, "month");
  const allRecords = recordsQuery.data ?? [];
  const recCreatedAt = (r: { created_at?: string; data?: Record<string, unknown> }) => String(r.created_at ?? (r.data?.created_at as string | undefined) ?? "");
  const pRange = periodRange(period);
  const pPrev = previousRange(period);
  const newThisPeriod = period === "all" ? [] : allRecords.filter((r) => inRange(recCreatedAt(r as never), pRange));
  const newPrevCount = pPrev ? allRecords.filter((r) => inRange(recCreatedAt(r as never), pPrev)).length : 0;
  const newDelta = pPrev ? deltaPct(newThisPeriod.length, newPrevCount) : null;

  const enrichedIds = Object.entries(enriching).filter(([, v]) => v.done).map(([id]) => id);

  // Every interval/timeout this callback creates, so unmount can cancel them. Without this,
  // navigating away mid-enrichment left a 3s poller hitting GET /nodes/:id forever and calling
  // setEnriching on an unmounted tree.
  const enrichTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => () => {
    for (const t of enrichTimers.current) clearTimeout(t as never);
    enrichTimers.current.clear();
  }, []);

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
    enrichTimers.current.add(interval as never);
    // Stop polling after 60 seconds max
    const stop = setTimeout(() => {
      clearInterval(interval);
      enrichTimers.current.delete(interval as never);
      setEnriching(prev => { const n = { ...prev }; delete n[recordId]; return n; });
    }, 60000);
    enrichTimers.current.add(stop);
  }, [objectType, queryClient]);

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden">

      {/* Page header — title + view toggle + actions. On the shared variable/matte system (was
          hardcoded stone / bg-white, which was inconsistent and theme-fragile). */}
      <div className="px-6 py-3 shrink-0">
        <CommandPageHeader
          className="mb-0"
          icon={LayoutList}
          callsign="RECORDS"
          title={objectType.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          secondaryActions={
            <>
              {/* View toggle */}
              <div className="flex items-center gap-0.5 rounded-sm border p-0.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)" }}>
                <button onClick={() => setView("table")} title="Table view"
                  className="flex items-center gap-1.5 rounded-[3px] px-2 py-1 text-[11px] font-medium transition-colors"
                  style={view === "table" ? { background: "var(--surface-card)", color: "var(--text-primary)" } : { color: "var(--text-muted)" }}>
                  <LayoutList size={11}/> Table
                </button>
                <button onClick={() => setView("board")} title="Board view"
                  className="flex items-center gap-1.5 rounded-[3px] px-2 py-1 text-[11px] font-medium transition-colors"
                  style={view === "board" ? { background: "var(--surface-card)", color: "var(--text-primary)" } : { color: "var(--text-muted)" }}>
                  <Kanban size={11}/> Board
                </button>
              </div>
              {/* Period lens — new records this window + period-over-period delta (flow). */}
              <PeriodSelector value={period} onChange={setPeriod} />
              {period !== "all" && allRecords.length > 0 && (
                <span className="hidden items-center gap-1 text-[11px] sm:inline-flex" style={{ color: "var(--text-muted)" }}>
                  <span style={{ color: "var(--section-accent)" }}>{newThisPeriod.length} new</span>
                  <span style={{ color: "var(--text-faint)" }}>{periodLabel(period).toLowerCase()}</span>
                  {newDelta != null && (
                    <span style={{ color: newDelta >= 0 ? "#2f9e6b" : "#d1524a" }}>{newDelta >= 0 ? "↑" : "↓"}{Math.abs(newDelta)}%</span>
                  )}
                </span>
              )}
              {/* Utility actions collapsed into one menu — no wall of buttons (handlers unchanged). */}
              <ActionMenu triggerLabel="Manage" ariaLabel="Sheet actions" items={[
                { key: "fill", label: "Fill with AI", icon: Sparkles, onClick: () => setShowAIFill(true) },
                { key: "clean", label: "Clean & Lists", icon: ScanSearch, onClick: () => setDedupOpen(true) },
                { key: "segment", label: "Segment", icon: Filter, onClick: () => setSegmentOpen(true) },
                { key: "import", label: importOpen ? "Hide CSV importer" : "Import CSV", icon: UploadCloud, onClick: () => setImportOpen(p => !p) },
                { key: "delete", label: "Delete sheet", icon: Trash2, onClick: () => setShowDeleteSheet(true) },
              ]} />
            </>
          }
          primaryAction={
            <button onClick={() => setShowCreate(true)} className="btn-primary text-[11px]">
              <Plus size={11}/> New record
            </button>
          }
        />
      </div>

      {/* Enrichment banners */}
      {Object.entries(enriching).length > 0 && (
        <div className="flex flex-col gap-1.5 border-b px-6 py-2 shrink-0" style={{ borderColor: "var(--border-soft)" }}>
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
        <div className="border-b px-6 py-3 shrink-0" style={{ borderColor: "var(--border-soft)" }}>
          <CsvImporter objectType={objectType} onImported={() => { queryClient.invalidateQueries({ queryKey: ["records", objectType] }); setImportOpen(false); }}/>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {isEmpty ? (
          /* Empty sheet — the shared guided EmptyState (fully tokenized, same as the rest of the app).
             Every step is a real action; the AI hint is honest about how records are found. */
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              icon={LayoutList}
              title={`${objectType.replace(/[-_]/g, " ")} is empty`}
              description="Add records manually, import a CSV, or let AI find real ones on the web — the sheet already knows your columns."
              aiHint="AI Fill searches the live web and extracts only real, source-backed records — never invented data."
              steps={[
                { icon: Sparkles, label: "Fill with AI", hint: "Describe what you want; the agent finds real, source-backed records and previews them before saving.", onClick: () => setShowAIFill(true) },
                { icon: Plus, label: "Add manually", hint: "Create a single record inline — fast when you already have the details.", onClick: () => setShowCreate(true) },
                { icon: UploadCloud, label: "Import a CSV", hint: "Bring existing data across; the importer maps your columns to this sheet.", onClick: () => setImportOpen(true) },
              ]}
            />
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
