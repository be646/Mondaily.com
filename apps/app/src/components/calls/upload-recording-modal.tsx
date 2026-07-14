import { useRef, useState } from "react";
import { X, UploadCloud, Loader2, FileAudio } from "lucide-react";
import { apiClient } from "../../lib/api-client";

const AUDIO_MIMES = ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg"];
const MAX_BYTES = 500 * 1024 * 1024;
const fmtSize = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

type Phase = "idle" | "uploading" | "finishing" | "error";

/** Import an external audio recording → private storage → sovereign STT + summary pipeline.
 *  Consent attestation is REQUIRED; audio goes straight to a private bucket via a signed URL. */
export function UploadRecordingModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | null) => {
    setError("");
    if (!f) return;
    if (!AUDIO_MIMES.includes(f.type)) { setError("Audio files only — mp3, m4a, wav, webm, ogg."); return; }
    if (f.size > MAX_BYTES) { setError("Recording exceeds the 500 MB limit."); return; }
    setFile(f);
  };

  async function upload() {
    if (!file || !consent || phase === "uploading" || phase === "finishing") return;
    setPhase("uploading"); setError("");
    try {
      const init = await apiClient.post<{ id: string; upload_url: string }>("/calls/upload/init", {
        filename: file.name, content_type: file.type, size: file.size, consent_attestation: true,
        title: title.trim() || undefined,
      });
      const put = await fetch(init.upload_url, { method: "PUT", headers: { "content-type": file.type, "x-upsert": "true" }, body: file });
      if (!put.ok) throw new Error("Upload failed. Please try again.");
      setPhase("finishing");
      await apiClient.post("/calls/upload/complete", { id: init.id });
      onDone(init.id);
    } catch (e) {
      setPhase("error");
      setError((e as Error)?.message ?? "Something went wrong. Please try again.");
    }
  }

  const busy = phase === "uploading" || phase === "finishing";
  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/40" onClick={busy ? undefined : onClose} />
      <div className="fixed left-1/2 top-1/2 z-[201] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-sm border shadow-lg"
        style={{ background: "var(--surface-modal)", borderColor: "var(--border-strong)" }}>
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <span className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}><UploadCloud size={14} /> Import recording</span>
          <button onClick={onClose} disabled={busy} className="btn-icon h-7 w-7 disabled:opacity-40"><X size={15} /></button>
        </div>

        <div className="space-y-3 p-5">
          <button type="button" onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-1.5 rounded-sm border border-dashed py-6 text-center transition-colors hover:bg-[var(--surface-hover)]"
            style={{ borderColor: "var(--border-strong)" }}>
            {file ? <FileAudio size={22} style={{ color: "var(--section-accent)" }} /> : <UploadCloud size={22} style={{ color: "var(--text-faint)" }} />}
            <span className="text-[12.5px]" style={{ color: "var(--text-secondary)" }}>{file ? file.name : "Drop an audio file or browse"}</span>
            <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{file ? fmtSize(file.size) : "mp3, m4a, wav, webm, ogg · up to 500 MB"}</span>
          </button>
          <input ref={inputRef} type="file" accept={AUDIO_MIMES.join(",")} className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} />

          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)"
            className="w-full rounded-sm border bg-transparent px-3 py-2 text-[13px] outline-none" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }} />

          <label className="flex cursor-pointer items-start gap-2 text-[12px]" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
            <span>I confirm I have consent from all participants to upload and transcribe this recording.</span>
          </label>

          {error && <p className="text-[12px]" style={{ color: "#d1524a" }}>{error}</p>}

          <button onClick={upload} disabled={!file || !consent || busy}
            className="flex w-full items-center justify-center gap-1.5 rounded-sm px-4 py-2 text-[12.5px] font-semibold text-black disabled:opacity-50"
            style={{ background: "var(--accent)" }}>
            {busy ? <><Loader2 size={13} className="animate-spin" /> {phase === "finishing" ? "Finishing…" : "Uploading…"}</> : "Upload & transcribe"}
          </button>
          <p className="text-center text-[10.5px]" style={{ color: "var(--text-faint)" }}>Audio is stored privately. Transcription runs on your sovereign speech service.</p>
        </div>
      </div>
    </>
  );
}
