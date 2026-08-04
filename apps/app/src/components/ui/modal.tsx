import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Modal — THE dialog. One overlay recipe (dim backdrop, centered hairline card, Escape + backdrop
 * close, labelled close button) instead of the 26 hand-rolled `fixed inset-0` variants counted in
 * the routes on 2026-07-30. Rendered through a portal so no stacking context in the page can trap
 * it. Body content and footers stay free — this owns only the shell.
 *
 * Not for the Ask drawer / side panels (those are push-aside surfaces, not dialogs).
 */
export function Modal({ title, subtitle, onClose, footer, headerAction, width = "md", children }: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  /**
   * An action that belongs beside the title rather than in the footer — Export on a report, Copy on
   * a generated result. Added because two dialogs had one and the alternative was each keeping its
   * own header, which is how the 46 private shells started.
   */
  headerAction?: ReactNode;
  /** Right-aligned action row under the body; omit for read-only dialogs. */
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const maxW = width === "sm" ? "max-w-sm" : width === "lg" ? "max-w-2xl" : "max-w-lg";
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[10vh]">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title}
        className={`relative w-full ${maxW} rounded-md border shadow-xl`}
        style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
        <div className="flex items-start gap-3 border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h2>
            {subtitle && <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--text-muted)" }}>{subtitle}</p>}
          </div>
          {headerAction}
          <button onClick={onClose} aria-label="Close" className="btn-icon -mr-1 h-7 w-7 shrink-0">
            <X size={14} />
          </button>
        </div>
        <div className="px-4 py-3.5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Field — a labelled row in a dialog.
 *
 * The Edit Task dialog put Priority and Status side by side as two identical unlabelled selects, and
 * they read as one duplicated button: nothing on screen said which was which, so the eye saw the
 * same control twice rather than two different facts. A control without a name is not a form field,
 * it is a mystery box — and two mystery boxes of equal size look like a mistake.
 *
 * The label is the fix. Hairline chrome does the rest: dialogs in this app are made of rules, not
 * of filled panels stacked on filled panels.
 */
export function Field({ label, hint, htmlFor, children, className = "" }: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor}
        className="mb-1 block text-[10px] font-medium uppercase tracking-wide"
        style={{ color: "var(--text-faint)" }}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px]" style={{ color: "var(--text-faint)" }}>{hint}</p>}
    </div>
  );
}

/**
 * The dialog's action row. Cancel is a QUIET ghost, the primary carries the weight, and neither is
 * stretched — two equal-width filled buttons side by side are the same duplicate-looking mistake as
 * two unlabelled selects. Destructive actions sit left, away from the confirm.
 */
export function ModalActions({ onCancel, cancelLabel = "Cancel", children, destructive }: {
  onCancel: () => void;
  cancelLabel?: string;
  children: ReactNode;
  destructive?: ReactNode;
}) {
  return (
    <>
      {destructive && <div className="mr-auto">{destructive}</div>}
      <button type="button" onClick={onCancel}
        className="h-8 rounded-md px-3 text-[12px] transition-colors hover:bg-[var(--surface-hover)]"
        style={{ color: "var(--text-secondary)" }}>
        {cancelLabel}
      </button>
      {children}
    </>
  );
}

/**
 * Escape closes it.
 *
 * Measured 2026-08-03: 31 of the 46 hand-rolled `fixed inset-0` dialogs in this app did not listen
 * for Escape, and 8 of those had no backdrop click either — the only way out was finding the X.
 * Every one of them predates <Modal>, which has always done this.
 *
 * Converting 46 dialogs is a long job; being unable to dismiss one is a bug today. This hook closes
 * that gap in a line, and the conversions can follow without leaving users trapped meanwhile.
 */
export function useEscapeClose(onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, active]);
}

