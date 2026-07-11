import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Phone, Video, UploadCloud, Mic, Sparkles, Lock, Webhook, Check, AlertTriangle, MinusCircle, ArrowRight, LifeBuoy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { apiClient } from "../../../lib/api-client";
import { PageHeader, PageSkeleton } from "../../../components/ui/page-state";

type RowStatus = "ready" | "available" | "partially_configured" | "missing_config" | "unavailable" | "not_enabled" | "not_configured";
interface Readiness {
  status: {
    calls: RowStatus; native_recording: RowStatus; upload_import: RowStatus;
    transcription: RowStatus; ai_summaries: RowStatus; secure_playback: RowStatus; webhook: RowStatus;
  };
}

// Map a coarse status → a badge look + label (never a secret, never a fake).
const BADGE: Record<RowStatus, { label: string; tone: string; Icon: LucideIcon }> = {
  ready:                 { label: "Ready",           tone: "#5f8169", Icon: Check },
  available:             { label: "Available",       tone: "#5f8169", Icon: Check },
  partially_configured:  { label: "Partial",         tone: "#97824f", Icon: AlertTriangle },
  missing_config:        { label: "Missing config",  tone: "#9c6b72", Icon: AlertTriangle },
  unavailable:           { label: "Unavailable",     tone: "var(--text-faint)", Icon: MinusCircle },
  not_enabled:           { label: "Not enabled",     tone: "var(--text-faint)", Icon: MinusCircle },
  not_configured:        { label: "Not configured",  tone: "#9c6b72", Icon: AlertTriangle },
};

const ROWS: { key: keyof Readiness["status"]; label: string; Icon: LucideIcon; means: string }[] = [
  { key: "calls",           label: "Calls",                 Icon: Phone,       means: "Native member-to-member audio/video calls over your self-hosted LiveKit server." },
  { key: "native_recording",label: "Native recording",      Icon: Video,       means: "Record a live Mondaily call and send it to Meeting Memory. Needs LiveKit + recording enabled + the private bucket." },
  { key: "upload_import",   label: "Upload / import",       Icon: UploadCloud, means: "Upload an external audio file to transcribe & summarize. Available once the private recordings bucket exists." },
  { key: "transcription",   label: "Transcription",         Icon: Mic,         means: "Speech-to-text via your sovereign STT appliance. Without it, audio is stored but transcripts show as unavailable." },
  { key: "ai_summaries",    label: "AI summaries",          Icon: Sparkles,    means: "Summaries & action items from the transcript via your AI gateway. Never fabricated." },
  { key: "secure_playback", label: "Secure playback",       Icon: Lock,        means: "Recordings play only through short-lived signed URLs from the private bucket — never a public link." },
  { key: "webhook",         label: "Recording webhook",     Icon: Webhook,     means: "The LiveKit egress webhook (signature-verified) that finalizes a recording and triggers transcription." },
];

export function CallsSettings() {
  const q = useQuery<Readiness>({ queryKey: ["calls-readiness"], queryFn: () => apiClient.get("/calls/readiness"), retry: false });

  if (q.isLoading) return <PageSkeleton rows={7} />;
  if (q.isError) return (
    <div className="space-y-5">
      <PageHeader title="Calls & Recording" description="Configuration status for calls, recording, transcription, and summaries." />
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>Only workspace owners and admins can view call readiness.</p>
    </div>
  );

  const s = q.data!.status;
  return (
    <div className="space-y-5">
      <PageHeader title="Calls & Recording" description="Configuration status for calls, recording, transcription, and summaries. Read-only — nothing here exposes or edits secrets." />

      <section className="settings-section overflow-hidden rounded-sm border p-0" style={{ borderColor: "var(--border-soft)" }}>
        <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
          {ROWS.map(({ key, label, Icon, means }) => {
            const b = BADGE[s[key]];
            return (
              <div key={key} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <Icon size={15} className="mt-0.5 shrink-0" style={{ color: "var(--text-muted)" }} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{label}</p>
                    <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--text-faint)" }}>{means}</p>
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-sm px-2 py-0.5 text-[11px] font-medium" style={{ color: b.tone, background: `color-mix(in srgb, ${b.tone} 12%, transparent)` }}>
                  <b.Icon size={11} /> {b.label}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <p className="rounded-sm border px-4 py-2.5 text-[12px]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)", color: "var(--text-muted)" }}>
        Recording controls appear in live calls only when LiveKit recording is configured. Until then, recording is disabled and everything fails closed — no call is ever recorded silently.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Link to="/calls" className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-strong)", color: "var(--text-primary)" }}><Video size={13} /> Open Meeting Memory <ArrowRight size={12} /></Link>
        <Link to="/settings/support" className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}><LifeBuoy size={13} /> Contact support</Link>
      </div>
    </div>
  );
}
