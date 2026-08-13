import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Play, ShieldCheck, AlertTriangle } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { errorText } from "../../lib/alerts";

/**
 * SALESFORCE DATA BRIDGE — dropzone, live log, mapping matrix, guarded commit.
 *
 * The shape of this screen follows the shape of the risk. A bulk import is irreversible in the way
 * that matters — nobody un-imports 1,400 opportunities by hand — so the destructive action is the
 * LAST thing available, unlocked only after a dry run has been read. You cannot press the import
 * button before the product has told you what it found.
 *
 * The log shows real steps with real counts, the same rule as the sign-in console: no line is
 * printed for work that did not happen, and the numbers come from the server's own plan.
 */

interface FieldMapping {
  source: string;
  target: string | null;
  kind: string;
  inferred?: boolean;
}
interface Issue { row: number; field: string; severity: "warn" | "error"; message: string }
interface ParseResult {
  format: string; object: string; targetType: string;
  rowCount: number; columns: string[]; mappings: FieldMapping[]; unmapped: string[];
}
interface MigrateResult {
  object: string; target_type: string;
  scanned: number; ready: number; rejected: number;
  currencies: string[]; unmapped: string[]; mappings: FieldMapping[];
  issues: Issue[]; issue_count: number;
  dry_run: boolean; committed: boolean; imported: number;
  error?: string;
}

type LogLevel = "run" | "ok" | "warn" | "fail";
interface LogLine { id: number; level: LogLevel; text: string }

const TONE: Record<LogLevel, string> = {
  run: "var(--status-warn)", ok: "var(--status-ok)",
  warn: "var(--status-warn)", fail: "var(--status-error)",
};

export function SalesforceBridge() {
  const [raw, setRaw] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [dry, setDry] = useState<MigrateResult | null>(null);
  const [done, setDone] = useState<MigrateResult | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const seq = useRef(0);
  const logEnd = useRef<HTMLDivElement>(null);

  const say = useCallback((level: LogLevel, text: string) => {
    setLog(l => [...l, { id: seq.current++, level, text }]);
  }, []);

  useEffect(() => { logEnd.current?.scrollIntoView({ block: "end" }); }, [log]);

  function reset() {
    setParsed(null); setDry(null); setDone(null); setOverrides({}); setLog([]); seq.current = 0;
  }

  async function readFile(f: File) {
    // 8MB matches the server cap; rejecting here saves a pointless upload of a file that cannot
    // be accepted, and says so in the same words the server would.
    if (f.size > 8 * 1024 * 1024) { say("fail", `[ ${f.name} IS ${(f.size / 1048576).toFixed(1)}MB — LIMIT IS 8MB ]`); return; }
    const text = await f.text();
    reset();
    setRaw(text); setFileName(f.name);
    say("ok", `[ LOADED ${f.name} · ${(f.size / 1024).toFixed(0)}KB ]`);
  }

  async function runParse() {
    if (!raw.trim() || busy) return;
    setBusy(true); setDry(null); setDone(null);
    say("run", "[ PARSING SALESFORCE SCHEMA... ]");
    try {
      const r = await apiClient.post<ParseResult>("/integrations/salesforce/parse", { raw });
      setParsed(r);
      const custom = r.mappings.filter(m => m.inferred).length;
      say("ok", `[ DETECTED: ${r.object.toUpperCase()} · ${r.columns.length} ATTRIBUTES · ${r.rowCount.toLocaleString()} ROWS · ${r.format.toUpperCase()} ]`);
      if (custom) say("ok", `[ ${custom} CUSTOM FIELD${custom === 1 ? "" : "S"} INFERRED — CONFIRM IN THE MATRIX ]`);
      if (r.unmapped.length) say("warn", `[ ${r.unmapped.length} COLUMN${r.unmapped.length === 1 ? "" : "S"} UNMAPPED: ${r.unmapped.slice(0, 6).join(", ")}${r.unmapped.length > 6 ? "…" : ""} ]`);
      say("ok", `[ MAPPING TO MONDAILY PERIOD-AWARE ENGINE... SUCCESS ✓ ]`);
    } catch (e) {
      say("fail", `[ PARSE FAILED: ${msg(e)} ]`);
    } finally { setBusy(false); }
  }

  async function runDry() {
    if (!raw.trim() || busy) return;
    setBusy(true); setDone(null);
    say("run", "[ DRY RUN — VALIDATING AGAINST THE MONEY MODEL... ]");
    try {
      const r = await apiClient.post<MigrateResult>("/integrations/salesforce/migrate", { raw, overrides });
      setDry(r);
      say("ok", `[ SCANNED ${r.scanned.toLocaleString()} · READY ${r.ready.toLocaleString()} · REJECTED ${r.rejected.toLocaleString()} ]`);
      if (r.currencies.length > 1) say("warn", `[ MIXED CURRENCIES: ${r.currencies.join(", ")} — CONVERTED AT REPORT TIME VIA ECB RATES ]`);
      else if (r.currencies.length === 1) say("ok", `[ CURRENCY: ${r.currencies[0]} ]`);
      if (r.issue_count) say("warn", `[ ${r.issue_count} DIAGNOSTIC${r.issue_count === 1 ? "" : "S"} — REVIEW BELOW ]`);
      say(r.rejected ? "warn" : "ok", "[ DRY RUN COMPLETE — NOTHING WRITTEN ]");
    } catch (e) {
      say("fail", `[ DRY RUN FAILED: ${msg(e)} ]`);
    } finally { setBusy(false); }
  }

  async function runCommit() {
    if (!dry || busy) return;
    setBusy(true);
    say("run", `[ EXECUTING SOVEREIGN DATA IMPORT — ${dry.ready.toLocaleString()} RECORDS... ]`);
    try {
      const r = await apiClient.post<MigrateResult>("/integrations/salesforce/migrate", { raw, overrides, commit: true });
      setDone(r);
      if (r.error) say("fail", `[ ${r.error.toUpperCase()} ]`);
      else say("ok", `[ ${r.imported.toLocaleString()} RECORDS MIGRATED · ${r.rejected} CONFLICTS ]`);
    } catch (e) {
      say("fail", `[ IMPORT FAILED: ${msg(e)} ]`);
    } finally { setBusy(false); }
  }

  const line = "1px solid var(--border-soft)";

  return (
    <section className="rounded-sm" style={{ border: line }}>
      <header className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: line }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--status-ok)" }} />
        <h3 className="text-body font-medium" style={{ color: "var(--text-primary)" }}>Salesforce Data Bridge</h3>
        <span className="ml-auto font-mono text-caption" style={{ color: "var(--text-faint)" }}>
          CSV · JSON · XML
        </span>
      </header>

      <div className="space-y-4 p-4">
        {/* Dropzone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void readFile(f); }}
          className="rounded-sm px-4 py-8 text-center transition-colors"
          style={{ border: `1px dashed ${dragging ? "var(--status-ok)" : "var(--border-soft)"}`, background: dragging ? "color-mix(in srgb, var(--status-ok) 5%, transparent)" : "transparent" }}
        >
          <Upload size={18} className="mx-auto mb-2" style={{ color: "var(--text-faint)" }} />
          <p className="text-body" style={{ color: "var(--text-secondary)" }}>
            {fileName ? fileName : "Drop a Salesforce export here"}
          </p>
          <label className="mt-2 inline-block cursor-pointer font-mono text-caption underline" style={{ color: "var(--text-muted)" }}>
            or choose a file
            <input type="file" accept=".csv,.json,.xml,text/csv,application/json,text/xml" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void readFile(f); }} />
          </label>
          <p className="mt-2 font-mono text-caption" style={{ color: "var(--text-faint)" }}>
            Leads · Contacts · Accounts · Opportunities — up to 8MB
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => void runParse()} disabled={!raw.trim() || busy}
            className="rounded-sm px-3 py-2 font-mono text-caption transition-colors disabled:opacity-40"
            style={{ border: line, color: "var(--text-secondary)" }}>
            [ PARSE SCHEMA ]
          </button>
          <button onClick={() => void runDry()} disabled={!parsed || busy}
            className="rounded-sm px-3 py-2 font-mono text-caption transition-colors disabled:opacity-40"
            style={{ border: line, color: "var(--text-secondary)" }}>
            [ DRY RUN ]
          </button>
        </div>

        {/* Live terminal — real steps only, never a scripted animation. */}
        {log.length > 0 && (
          <div className="max-h-52 overflow-y-auto rounded-sm px-3 py-2 font-mono text-caption leading-relaxed" style={{ border: line }}>
            {log.map(l => (
              <div key={l.id} style={{ color: TONE[l.level] }}>
                {l.text}
                {l.level === "run" && busy && <span className="ml-1 animate-pulse">▍</span>}
              </div>
            ))}
            <div ref={logEnd} />
          </div>
        )}

        {/* Field mapping matrix — the admin's chance to correct us before anything is written. */}
        {parsed && (
          <div className="overflow-hidden rounded-sm" style={{ border: line }}>
            <div className="px-3 py-2 font-mono text-caption" style={{ borderBottom: line, color: "var(--text-muted)" }}>
              FIELD MAPPING MATRIX · {parsed.object} → {parsed.targetType}
            </div>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="font-mono text-caption" style={{ color: "var(--text-faint)" }}>
                    <th className="px-3 py-1.5 font-normal">SALESFORCE</th>
                    <th className="px-3 py-1.5 font-normal">MONDAILY</th>
                    <th className="px-3 py-1.5 font-normal">TYPE</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.mappings.map(m => {
                    const value = Object.prototype.hasOwnProperty.call(overrides, m.source) ? overrides[m.source] : m.target;
                    return (
                      <tr key={m.source} style={{ borderTop: line }}>
                        <td className="px-3 py-1.5 font-mono text-caption" style={{ color: "var(--text-secondary)" }}>
                          {m.source}
                          {m.inferred && <span className="ml-1.5" style={{ color: "var(--status-warn)" }}>guess</span>}
                        </td>
                        <td className="px-3 py-1">
                          <input
                            value={value ?? ""}
                            placeholder="— not imported —"
                            onChange={e => setOverrides(o => ({ ...o, [m.source]: e.target.value.trim() || null }))}
                            className="w-full rounded-sm bg-transparent px-2 py-1 font-mono text-caption outline-none"
                            style={{ border: line, color: "var(--text-primary)" }}
                          />
                        </td>
                        <td className="px-3 py-1.5 font-mono text-caption" style={{ color: "var(--text-faint)" }}>{m.kind}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Diagnostics from the dry run. */}
        {dry && dry.issues.length > 0 && (
          <div className="max-h-44 overflow-y-auto rounded-sm px-3 py-2" style={{ border: line }}>
            {dry.issues.map((i, n) => (
              <div key={n} className="flex gap-2 py-0.5 font-mono text-caption">
                <span style={{ color: i.severity === "error" ? "var(--status-error)" : "var(--status-warn)" }}>
                  {i.severity === "error" ? "✕" : "!"}
                </span>
                <span style={{ color: "var(--text-faint)" }}>row {i.row} · {i.field}</span>
                <span style={{ color: "var(--text-secondary)" }}>{i.message}</span>
              </div>
            ))}
            {dry.issue_count > dry.issues.length && (
              <p className="pt-1 font-mono text-caption" style={{ color: "var(--text-faint)" }}>
                …and {dry.issue_count - dry.issues.length} more.
              </p>
            )}
          </div>
        )}

        {/* THE destructive action. Only reachable after a dry run, and it says what it will do. */}
        {dry && !done && (
          <div className="rounded-sm p-3" style={{ border: line }}>
            <p className="mb-2 flex items-center gap-2 text-body" style={{ color: "var(--text-secondary)" }}>
              <ShieldCheck size={14} style={{ color: "var(--status-ok)" }} />
              {dry.ready.toLocaleString()} record{dry.ready === 1 ? "" : "s"} ready
              {dry.rejected > 0 && <span style={{ color: "var(--status-warn)" }}> · {dry.rejected} will be skipped</span>}
            </p>
            <button onClick={() => void runCommit()} disabled={busy || dry.ready === 0}
              className="w-full rounded-sm px-4 py-2.5 font-mono text-caption transition-colors disabled:opacity-40"
              style={{ border: "1px solid var(--border-strong)", background: "var(--surface-selected)", color: "var(--text-primary)" }}>
              <Play size={12} className="mr-1.5 inline" />
              [ EXECUTE SOVEREIGN DATA IMPORT ]
            </button>
            <p className="mt-2 font-mono text-caption" style={{ color: "var(--text-faint)" }}>
              Writes to your workspace. Nothing has been written yet.
            </p>
          </div>
        )}

        {/* Completion. */}
        {done && (
          <div className="rounded-sm p-3" style={{ border: `1px solid ${done.error ? "var(--status-error)" : "var(--status-ok)"}` }}>
            <p className="flex items-center gap-2 font-mono text-body" style={{ color: "var(--text-primary)" }}>
              {done.error ? <AlertTriangle size={14} style={{ color: "var(--status-error)" }} /> : <ShieldCheck size={14} style={{ color: "var(--status-ok)" }} />}
              [ {done.imported.toLocaleString()} RECORDS MIGRATED · {done.rejected} CONFLICTS ]
            </p>
            {done.error && <p className="mt-1 text-body" style={{ color: "var(--status-error)" }}>{done.error}</p>}
            <button onClick={() => { reset(); setRaw(""); setFileName(null); }}
              className="mt-2 font-mono text-caption underline" style={{ color: "var(--text-muted)" }}>
              import another export
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function msg(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  // The API returns a JSON error body; show its message, not the raw envelope.
  return errorText(s, s);
}
