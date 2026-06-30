import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Paperclip, X, Search, FileText, Inbox } from "lucide-react";
import { apiClient } from "../../lib/api-client";

/**
 * Shared chat attachments — pin workspace records (live /search) and read text
 * files client-side (FileReader, no storage). The pinned data flows into the chat
 * via the engine's `context.attachments`. Used by all three chat surfaces so the
 * paperclip + @-mention behave identically everywhere.
 */
export type AttachItem =
  | { kind: "record"; id: string; object_type: string; title: string; data: unknown }
  | { kind: "file"; id: string; title: string; text: string };

type RecordHit = { id: string; object_type: string; data: Record<string, unknown> };

export function recordTitle(r: { object_type: string; data: Record<string, unknown> }) {
  return String(r.data?.name ?? r.data?.title ?? r.object_type ?? "record");
}

export function useAttachments() {
  const [attachments, setAttachments] = useState<AttachItem[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RecordHit[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || query.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await apiClient.post<RecordHit[]>("/search", { q: query.trim() });
        if (!cancelled) setResults((res ?? []).slice(0, 8));
      } catch { if (!cancelled) setResults([]); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open]);

  const addRecord = (r: RecordHit) => {
    setAttachments(a => a.some(x => x.id === r.id) ? a : [...a, { kind: "record", id: r.id, object_type: r.object_type, title: recordTitle(r), data: r.data }]);
    setOpen(false); setQuery(""); setResults([]);
  };
  const onFilePick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "").slice(0, 20000);
      setAttachments(a => [...a, { kind: "file", id: `f-${f.name}-${text.length}`, title: f.name, text }]);
    };
    reader.readAsText(f);
    setOpen(false);
    e.target.value = "";
  };
  const remove = (id: string) => setAttachments(a => a.filter(x => x.id !== id));
  const clear = () => setAttachments([]);

  const attachContext = attachments.length
    ? { attachments: attachments.map(a => a.kind === "record"
        ? { object_type: a.object_type, node_id: a.id, title: a.title, data: a.data }
        : { kind: "file", title: a.title, text: a.text }) }
    : {};

  return { attachments, open, setOpen, query, setQuery, results, addRecord, onFilePick, remove, clear, attachContext, fileInputRef };
}

export type AttachApi = ReturnType<typeof useAttachments>;

/** The picker popover (record search + file button) + the hidden file input.
 *  Render it inside a `relative` container above the input. */
export function AttachPicker({ attach }: { attach: AttachApi }) {
  return (
    <>
      {attach.open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-full overflow-hidden rounded-sm border shadow-[0_8px_24px_rgba(15,23,42,0.1)]" style={{ background: "var(--surface-card)", borderColor: "var(--border-soft)" }}>
          <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border-soft)" }}>
            <Search size={13} style={{ color: "var(--text-faint)" }}/>
            <input autoFocus value={attach.query} onChange={e => attach.setQuery(e.target.value)}
              placeholder="Search records to attach…"
              className="flex-1 bg-transparent text-sm outline-none" style={{ color: "var(--text-primary)" }}/>
            <button onClick={() => attach.fileInputRef.current?.click()} className="shrink-0 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
              <Paperclip size={11}/> File
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto p-1.5">
            {attach.results.length === 0 ? (
              <p className="px-2 py-2 text-[12px]" style={{ color: "var(--text-faint)" }}>{attach.query.trim().length < 2 ? "Type to search records, or attach a text file." : "No matches."}</p>
            ) : attach.results.map(r => (
              <button key={r.id} onClick={() => attach.addRecord(r)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-stone-100 dark:hover:bg-stone-900">
                <span className="rounded px-1.5 py-px text-[9px] font-medium uppercase tracking-wide" style={{ background: "var(--surface-hover)", color: "var(--text-muted)" }}>{r.object_type}</span>
                <span className="truncate text-sm" style={{ color: "var(--text-primary)" }}>{recordTitle(r)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <input ref={attach.fileInputRef} type="file" accept=".txt,.md,.csv,.json,.log,.tsv,text/plain" onChange={attach.onFilePick} className="hidden"/>
    </>
  );
}

/** Removable chips for the current attachments. Render above the input. */
export function AttachChips({ attach }: { attach: AttachApi }) {
  if (attach.attachments.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {attach.attachments.map(a => (
        <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}>
          {a.kind === "file" ? <FileText size={11} style={{ color: "var(--accent)" }}/> : <Inbox size={11} style={{ color: "var(--accent)" }}/>}
          <span className="max-w-[160px] truncate">{a.title}</span>
          <button onClick={() => attach.remove(a.id)} title="Remove" style={{ color: "var(--text-faint)" }}><X size={11}/></button>
        </span>
      ))}
    </div>
  );
}

/** The paperclip toggle button (place inside the input bar). */
export function AttachButton({ attach }: { attach: AttachApi }) {
  return (
    <button onClick={() => attach.setOpen(o => !o)} title="Attach record or file"
      className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-stone-100 dark:hover:bg-stone-900"
      style={attach.open ? { color: "var(--text-primary)" } : { color: "var(--text-muted)" }}>
      <Paperclip size={16}/>
    </button>
  );
}
