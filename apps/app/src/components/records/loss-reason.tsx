import { useState } from "react";
import { Modal } from "../ui/modal";

/**
 * Loss-reason capture — asked ONCE, at the moment a deal transitions to a lost stage.
 * The reason lands in data.loss_reason on the same PATCH as the stage change (read-merge-write,
 * never a second racy write). Skipping is allowed and honest: the lost-deal report will show
 * "no reason recorded" for skipped deals rather than inventing a category.
 */
export const LOSS_REASONS = ["Price", "Competitor", "No budget", "Bad timing", "No response", "Requirements mismatch", "Other"] as const;

export function isLostStage(v: unknown): boolean {
  return /lost|churn|declin|reject/i.test(String(v ?? ""));
}

export interface PendingLoss { name: string; apply: (reason: string | null) => void }

export function LossReasonModal({ pending, onClose }: { pending: PendingLoss; onClose: () => void }) {
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const finalReason = reason === "Other" ? (note.trim() || "Other") : reason;
  return (
    <Modal
      title="Why was this deal lost?"
      subtitle={`${pending.name} — one reason powers the lost-deal analysis. Optional, but future-you will thank you.`}
      onClose={() => { pending.apply(null); onClose(); }}
      footer={<>
        <button onClick={() => { pending.apply(null); onClose(); }} className="btn-secondary px-3 py-1.5 text-[12px] font-medium">Skip</button>
        <button onClick={() => { pending.apply(finalReason || null); onClose(); }} disabled={!finalReason}
          className="btn-primary px-3 py-1.5 text-[12px] font-medium">Save reason</button>
      </>}
    >
      <div className="flex flex-wrap gap-1.5">
        {LOSS_REASONS.map(r => (
          <button key={r} onClick={() => setReason(r)}
            className="rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors"
            style={reason === r
              ? { background: "color-mix(in srgb, var(--text-primary) 8%, transparent)", color: "var(--text-primary)" }
              : { color: "var(--text-muted)" }}>
            {r}
          </button>
        ))}
      </div>
      {reason === "Other" && (
        <input value={note} onChange={e => setNote(e.target.value)} autoFocus placeholder="What happened?"
          className="mt-2.5 w-full rounded-md border bg-transparent px-2.5 py-1.5 text-[12.5px] outline-none"
          style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }} />
      )}
    </Modal>
  );
}
