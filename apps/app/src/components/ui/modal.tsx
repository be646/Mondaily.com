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
export function Modal({ title, subtitle, onClose, footer, width = "md", children }: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
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
