import { useRef, useState, useCallback } from "react";
import { Upload, FileText, X, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { apiClient } from "../../lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { FieldSelect } from "../ui/controls";

type ColType = "Text" | "Number" | "Email" | "URL" | "Date" | "Status" | "Currency" | "Phone" | "Boolean";

const TYPE_COLORS: Record<ColType, string> = {
  Text:     "bg-stone-700/50 text-[var(--text-secondary)] border-stone-600/40",
  Number:   "bg-[#717784]/10 text-[#717784] border-[#717784]/25",
  Email:    "bg-stone-900/40 text-[var(--text-secondary)] border-stone-500/30",
  URL:      "bg-[var(--accent)]/40 text-[var(--accent)] border-[var(--accent)]/30",
  Date:     "bg-[#c6892e]/40 text-[#c6892e] border-[#c6892e]/30",
  Status:   "bg-[#c6892e]/10 text-[#c6892e] border-[#c6892e]/25",
  Currency: "bg-[#2f9e6b]/10 text-[#2f9e6b] border-[#2f9e6b]/25",
  Phone:    "bg-[#717784]/40 text-[#717784] border-[#717784]/30",
  Boolean:  "bg-[#717784]/10 text-[#717784] border-[#717784]/25",
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
  auto_enriching?: boolean;
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

    // Call backend for AI schema inference (sovereign gateway)
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
      // Chunk to the server's per-request cap (1000) — the backend inserts serially, so a huge CSV
      // must be split or it times out. Aggregate results across chunks.
      const CHUNK = 1000;
      let created = 0;
      const errors: ImportResult["errors"] = [];
      let column_types: ImportResult["column_types"] = {};
      let auto_enriching = false;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const res = await apiClient.post<ImportResult>("/import", {
          headers,
          samples: rows.slice(0, 3),
          rows: rows.slice(i, i + CHUNK),
          object_type: safeType,
        });
        created += res.created ?? 0;
        if (Array.isArray(res.errors)) errors.push(...res.errors.map(e => ({ ...e, row: e.row + i })));
        column_types = res.column_types ?? column_types;
        auto_enriching = auto_enriching || !!res.auto_enriching;
      }
      setResult({ created, errors, column_types, auto_enriching });
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
      className={`group relative flex cursor-pointer flex-col items-center gap-2 rounded-sm border-2 border-dashed px-6 py-5 transition-all ${
        dragging
          ? "border-stone-500/30 bg-stone-600/[.06]"
          : "border-[var(--border-soft)] hover:border-[var(--border-soft)] hover:bg-[var(--surface-hover)]"
      }`}
    >
      <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFileChange}/>
      <div className={`rounded-lg border p-2 transition-colors ${dragging ? "border-stone-500/30 bg-stone-600/10 text-[var(--text-secondary)]" : "border-[var(--border-soft)] bg-[var(--surface-hover)] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]"}`}>
        <Upload size={16}/>
      </div>
      <div className="text-center">
        <p className="text-xs font-medium text-[var(--text-secondary)]">Drop a CSV file or click to browse</p>
        <p className="mt-0.5 text-[10px] text-[var(--text-faint)]">Mondaily AI will auto-detect column types</p>
      </div>
      {phase === "error" && <p className="text-xs text-[var(--text-secondary)]">{error}</p>}
    </div>
  );

  // ── Inferring ────────────────────────────────────────────────────────────────
  if (phase === "inferring") return (
    <div className="flex items-center gap-3 rounded-sm border border-stone-500/30 bg-stone-600/[.04] px-4 py-4">
      <LogoMark size={16} className="shrink-0 animate-pulse text-[var(--text-secondary)]"/>
      <div>
        <p className="text-xs font-medium text-[var(--text-secondary)]">Inferring schema with Mondaily AI…</p>
        <p className="text-[10px] text-[var(--text-faint)]">{fileName} · {rows.length} rows · {headers.length} columns</p>
      </div>
      <button onClick={reset} className="ml-auto text-[var(--text-faint)] hover:text-[var(--text-secondary)]"><X size={14}/></button>
    </div>
  );

  // ── Preview / type editor ─────────────────────────────────────────────────────
  if (phase === "previewing") return (
    <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--border-soft)] px-4 py-3">
        <FileText size={14} className="shrink-0 text-[var(--text-muted)]"/>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{fileName}</p>
          <p className="text-[10px] text-[var(--text-faint)]">{rows.length} rows · {headers.length} columns · schema inferred</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1 rounded-md border border-stone-500/30 bg-stone-600/[.06] px-1.5 py-0.5 text-[9px] text-[var(--text-secondary)]">
            <LogoMark size={8}/> AI schema
          </span>
          <button onClick={reset} className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors"><X size={14}/></button>
        </div>
      </div>

      {/* Column type pills */}
      <div className="border-b border-[var(--border-soft)] px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {headers.map(h => (
            <div key={h} className="relative group/pill">
              <FieldSelect
                value={colTypes[h] ?? "Text"}
                onChange={v => setColTypes(prev => ({ ...prev, [h]: v as ColType }))}
                ariaLabel="Column type"
                className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold transition-opacity ${TYPE_COLORS[colTypes[h] ?? "Text"] ?? TYPE_COLORS.Text}`}
                options={ALL_TYPES.map(t => ({ value: t, label: t }))}
              />
              <div className="absolute -top-5 left-0 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[9px] text-[var(--text-primary)] opacity-0 group-hover/pill:opacity-100 transition-opacity z-10">
                {h}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Data preview toggle */}
      <button
        onClick={() => setShowPreview(p => !p)}
        className="flex w-full items-center gap-2 border-b border-[var(--border-soft)] px-4 py-2 text-left text-[10px] text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors"
      >
        {showPreview ? <ChevronUp size={10}/> : <ChevronDown size={10}/>}
        {showPreview ? "Hide" : "Show"} data preview (first 3 rows)
      </button>

      {showPreview && (
        <div className="overflow-auto max-h-[160px]">
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-[var(--surface-card)] border-b border-[var(--border-soft)]">
              <tr>
                {headers.map(h => (
                  <th key={h} className="px-3 py-1.5 text-left font-medium text-[var(--text-faint)] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 3).map((row, i) => (
                <tr key={i} className="border-b border-[var(--border-soft)]">
                  {headers.map((_, j) => (
                    <td key={j} className="px-3 py-1.5 text-[var(--text-secondary)] max-w-[120px] truncate">{row[j] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-[10px] text-[var(--text-faint)]">Ready to import <span className="text-[var(--text-primary)] font-medium">{rows.length}</span> records</p>
        <div className="flex items-center gap-2">
          <button onClick={reset} className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
            Cancel
          </button>
          <button
            onClick={runImport}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] transition-all"
          >
            <Upload size={11}/> Import {rows.length} rows
          </button>
        </div>
      </div>
    </div>
  );

  // ── Importing ────────────────────────────────────────────────────────────────
  if (phase === "importing") return (
    <div className="flex items-center gap-3 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-4 py-4">
      <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-stone-500/30 border-t-[#d1524a]"/>
      <div>
        <p className="text-xs font-medium text-[var(--text-primary)]">Importing {rows.length} rows…</p>
        <p className="text-[10px] text-[var(--text-faint)]">Creating records in {objectType}</p>
      </div>
    </div>
  );

  // ── Done ─────────────────────────────────────────────────────────────────────
  if (phase === "done" && result) return (
    <div className={`flex items-start gap-3 rounded-sm border px-4 py-3 ${result.errors.length > 0 ? "border-[#c6892e]/25 bg-[#c6892e]/[.04]" : "border-[#2f9e6b]/25 bg-[#2f9e6b]/[.04]"}`}>
      <CheckCircle2 size={16} className={`mt-0.5 shrink-0 ${result.errors.length > 0 ? "text-[#c6892e]" : "text-[#2f9e6b]"}`}/>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-[var(--text-primary)]">
          {result.created} record{result.created !== 1 ? "s" : ""} imported successfully
        </p>
        {result.errors.length > 0 && (
          <p className="text-[10px] text-[#c6892e] mt-0.5">
            {result.errors.length} row{result.errors.length !== 1 ? "s" : ""} failed · {result.errors[0]?.error}
          </p>
        )}
      </div>
      <button onClick={reset} className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors shrink-0"><X size={14}/></button>
    </div>
  );

  return null;
}
