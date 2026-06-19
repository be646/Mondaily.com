import { useRef, useState, useCallback } from "react";
import { Upload, FileText, X, Sparkles, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useQueryClient } from "@tanstack/react-query";

type ColType = "Text" | "Number" | "Email" | "URL" | "Date" | "Status" | "Currency" | "Phone" | "Boolean";

const TYPE_COLORS: Record<ColType, string> = {
  Text:     "bg-slate-700/50 text-slate-300 border-slate-600/40",
  Number:   "bg-blue-900/40 text-blue-300 border-blue-500/30",
  Email:    "bg-purple-900/40 text-purple-300 border-purple-500/30",
  URL:      "bg-cyan-900/40 text-cyan-300 border-cyan-500/30",
  Date:     "bg-orange-900/40 text-orange-300 border-orange-500/30",
  Status:   "bg-yellow-900/40 text-yellow-300 border-yellow-500/30",
  Currency: "bg-emerald-900/40 text-emerald-300 border-emerald-500/30",
  Phone:    "bg-teal-900/40 text-teal-300 border-teal-500/30",
  Boolean:  "bg-pink-900/40 text-pink-300 border-pink-500/30",
};
const ALL_TYPES: ColType[] = ["Text","Number","Email","URL","Date","Status","Currency","Phone","Boolean"];

function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  return lines.map(line => {
    const cells: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === "," && !inQuote) { cells.push(cur); cur = ""; continue; }
      cur += ch;
    }
    cells.push(cur);
    return cells;
  });
}

type Phase = "idle" | "parsed" | "inferring" | "previewing" | "importing" | "done" | "error";

interface ImportResult {
  created: number;
  errors: Array<{ row: number; error: string }>;
  column_types: Record<string, string>;
}

export function CsvImporter({ objectType, onImported }: { objectType: string; onImported?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>("idle");
  const [dragging, setDragging] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [colTypes, setColTypes] = useState<Record<string, ColType>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [fileName, setFileName] = useState("");

  const reset = () => {
    setPhase("idle"); setHeaders([]); setRows([]); setColTypes({});
    setResult(null); setError(""); setShowPreview(false); setFileName("");
  };

  const processFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      setError("Please upload a .csv file"); setPhase("error"); return;
    }
    setFileName(file.name);
    const text = await file.text();
    const parsed = parseCSV(text);
    if (parsed.length < 2) { setError("CSV must have a header row and at least one data row"); setPhase("error"); return; }
    const hdrs = parsed[0]!;
    const dataRows = parsed.slice(1);
    setHeaders(hdrs);
    setRows(dataRows);
    setPhase("inferring");

    // Call backend for Claude schema inference
    try {
      const samples = dataRows.slice(0, 3);
      const res = await apiClient.post<ImportResult>("/import", {
        headers: hdrs,
        samples,
        rows: [], // schema-only call with no rows
        object_type: objectType,
      });
      const inferred: Record<string, ColType> = {};
      hdrs.forEach(h => {
        const t = res.column_types?.[h];
        inferred[h] = (ALL_TYPES.includes(t as ColType) ? t : "Text") as ColType;
      });
      setColTypes(inferred);
      setPhase("previewing");
    } catch {
      // Fall back to Text for all columns
      const fallback: Record<string, ColType> = {};
      hdrs.forEach(h => { fallback[h] = "Text"; });
      setColTypes(fallback);
      setPhase("previewing");
    }
  }, [objectType]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void processFile(file);
  }, [processFile]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
    e.target.value = "";
  }, [processFile]);

  const runImport = useCallback(async () => {
    setPhase("importing");
    try {
      const safeType = objectType.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
      const res = await apiClient.post<ImportResult>("/import", {
        headers,
        samples: rows.slice(0, 3),
        rows,
        object_type: safeType,
      });
      setResult(res);
      setPhase("done");
      qc.invalidateQueries({ queryKey: ["records", objectType] });
      onImported?.();
    } catch (e: any) {
      setError(e?.message ?? "Import failed");
      setPhase("error");
    }
  }, [headers, rows, objectType, qc, onImported]);

  // ── Idle / drop zone ─────────────────────────────────────────────────────────
  if (phase === "idle" || phase === "error") return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className={`group relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-5 transition-all ${
        dragging
          ? "border-indigo-400/60 bg-indigo-500/[.06]"
          : "border-white/[.08] hover:border-white/[.16] hover:bg-white/[.02]"
      }`}
    >
      <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFileChange}/>
      <div className={`rounded-lg border p-2 transition-colors ${dragging ? "border-indigo-400/40 bg-indigo-500/10 text-indigo-400" : "border-white/[.08] bg-white/[.03] text-slate-500 group-hover:text-slate-300"}`}>
        <Upload size={16}/>
      </div>
      <div className="text-center">
        <p className="text-xs font-medium text-slate-300">Drop a CSV file or click to browse</p>
        <p className="mt-0.5 text-[10px] text-slate-600">Claude will auto-detect column types</p>
      </div>
      {phase === "error" && <p className="text-xs text-indigo-400">{error}</p>}
    </div>
  );

  // ── Inferring ────────────────────────────────────────────────────────────────
  if (phase === "inferring") return (
    <div className="flex items-center gap-3 rounded-xl border border-purple-500/20 bg-purple-500/[.04] px-4 py-4">
      <Sparkles size={16} className="shrink-0 animate-pulse text-purple-400"/>
      <div>
        <p className="text-xs font-medium text-purple-300">Inferring schema with Claude…</p>
        <p className="text-[10px] text-slate-600">{fileName} · {rows.length} rows · {headers.length} columns</p>
      </div>
      <button onClick={reset} className="ml-auto text-slate-600 hover:text-slate-300"><X size={14}/></button>
    </div>
  );

  // ── Preview / type editor ─────────────────────────────────────────────────────
  if (phase === "previewing") return (
    <div className="rounded-xl border border-white/[.08] bg-[#0d0f13] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/[.06] px-4 py-3">
        <FileText size={14} className="shrink-0 text-slate-500"/>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white truncate">{fileName}</p>
          <p className="text-[10px] text-slate-600">{rows.length} rows · {headers.length} columns · schema inferred</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1 rounded-md border border-purple-500/20 bg-purple-500/[.06] px-1.5 py-0.5 text-[9px] text-purple-400">
            <Sparkles size={8}/> AI schema
          </span>
          <button onClick={reset} className="text-slate-600 hover:text-slate-300 transition-colors"><X size={14}/></button>
        </div>
      </div>

      {/* Column type pills */}
      <div className="border-b border-white/[.06] px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {headers.map(h => (
            <div key={h} className="relative group/pill">
              <select
                value={colTypes[h] ?? "Text"}
                onChange={e => setColTypes(prev => ({ ...prev, [h]: e.target.value as ColType }))}
                className={`appearance-none cursor-pointer rounded-full border px-2 py-0.5 text-[9px] font-semibold transition-opacity pr-4 ${TYPE_COLORS[colTypes[h] ?? "Text"] ?? TYPE_COLORS.Text}`}
              >
                {ALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[8px] opacity-60">▾</span>
              <div className="absolute -top-5 left-0 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[9px] text-white opacity-0 group-hover/pill:opacity-100 transition-opacity z-10">
                {h}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Data preview toggle */}
      <button
        onClick={() => setShowPreview(p => !p)}
        className="flex w-full items-center gap-2 border-b border-white/[.06] px-4 py-2 text-left text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
      >
        {showPreview ? <ChevronUp size={10}/> : <ChevronDown size={10}/>}
        {showPreview ? "Hide" : "Show"} data preview (first 3 rows)
      </button>

      {showPreview && (
        <div className="overflow-auto max-h-[160px]">
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-[#0d0f13] border-b border-white/[.06]">
              <tr>
                {headers.map(h => (
                  <th key={h} className="px-3 py-1.5 text-left font-medium text-slate-600 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 3).map((row, i) => (
                <tr key={i} className="border-b border-white/[.03]">
                  {headers.map((_, j) => (
                    <td key={j} className="px-3 py-1.5 text-slate-400 max-w-[120px] truncate">{row[j] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-[10px] text-slate-600">Ready to import <span className="text-white font-medium">{rows.length}</span> records</p>
        <div className="flex items-center gap-2">
          <button onClick={reset} className="rounded-lg border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={runImport}
            className="flex items-center gap-1.5 rounded-lg border-x border-t border-indigo-500/50 border-b-[3px] border-b-red-700 bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-400 transition-all active:translate-y-[1px] active:border-b active:border-b-red-500/50"
          >
            <Upload size={11}/> Import {rows.length} rows
          </button>
        </div>
      </div>
    </div>
  );

  // ── Importing ────────────────────────────────────────────────────────────────
  if (phase === "importing") return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[.08] bg-white/[.02] px-4 py-4">
      <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-indigo-500/30 border-t-red-500"/>
      <div>
        <p className="text-xs font-medium text-white">Importing {rows.length} rows…</p>
        <p className="text-[10px] text-slate-600">Creating records in {objectType}</p>
      </div>
    </div>
  );

  // ── Done ─────────────────────────────────────────────────────────────────────
  if (phase === "done" && result) return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${result.errors.length > 0 ? "border-yellow-500/20 bg-yellow-500/[.04]" : "border-emerald-500/20 bg-emerald-500/[.04]"}`}>
      <CheckCircle2 size={16} className={`mt-0.5 shrink-0 ${result.errors.length > 0 ? "text-yellow-400" : "text-emerald-400"}`}/>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white">
          {result.created} record{result.created !== 1 ? "s" : ""} imported successfully
        </p>
        {result.errors.length > 0 && (
          <p className="text-[10px] text-yellow-400 mt-0.5">
            {result.errors.length} row{result.errors.length !== 1 ? "s" : ""} failed · {result.errors[0]?.error}
          </p>
        )}
      </div>
      <button onClick={reset} className="text-slate-600 hover:text-slate-300 transition-colors shrink-0"><X size={14}/></button>
    </div>
  );

  return null;
}
