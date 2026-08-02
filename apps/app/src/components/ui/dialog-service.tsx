import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * In-app replacements for window.prompt / confirm / alert.
 *
 * The native dialogs are the browser's chrome, not ours: a different typeface, a different button
 * order per OS, and an input box no theme reaches. They also block the whole tab, so nothing can
 * render behind them. Asking a user to type a money amount into a grey macOS box in the middle of a
 * finance app reads as a bug, because it looks like one.
 *
 * The API is imperative and promise-based on purpose — `await dialogs.prompt(...)` is a near
 * one-for-one swap for `window.prompt(...)`, so call sites keep their shape and nothing has to be
 * restructured into render-time state to get a themed dialog.
 */

interface PromptOptions {
  title: string;
  /** Shown under the title — the place for consequences, units, or an example. */
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** "text" keeps free-form input; "number" gets a numeric keypad on touch devices. */
  inputMode?: "text" | "number";
  /** Return an error string to keep the dialog open and show it. */
  validate?: (value: string) => string | null;
}

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the primary action as destructive and makes Cancel the default focus. */
  destructive?: boolean;
}

interface DialogApi {
  /** Resolves with the entered string, or null if dismissed. */
  prompt: (o: PromptOptions) => Promise<string | null>;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  alert: (o: { title: string; description?: string }) => Promise<void>;
}

type Pending =
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void }
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "alert"; opts: { title: string; description?: string }; resolve: () => void };

const DialogContext = createContext<DialogApi | null>(null);

/**
 * A module-level handle so non-React code (and the many existing plain event handlers) can call
 * these without threading a hook through. Set by the provider; falls back to the native dialog if
 * the provider is somehow absent, so a missing provider degrades instead of losing the interaction.
 */
let handle: DialogApi | null = null;

export const dialogs: DialogApi = {
  prompt: (o) => handle ? handle.prompt(o) : Promise.resolve(window.prompt(o.title, o.defaultValue ?? "")),
  confirm: (o) => handle ? handle.confirm(o) : Promise.resolve(window.confirm(o.title)),
  alert: (o) => { if (handle) return handle.alert(o); window.alert(o.title); return Promise.resolve(); },
};

export function useDialogs(): DialogApi {
  return useContext(DialogContext) ?? dialogs;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const api = useRef<DialogApi>({
    prompt: (opts) => new Promise(resolve => { setValue(opts.defaultValue ?? ""); setError(null); setPending({ kind: "prompt", opts, resolve }); }),
    confirm: (opts) => new Promise(resolve => { setPending({ kind: "confirm", opts, resolve }); }),
    alert: (opts) => new Promise(resolve => { setPending({ kind: "alert", opts, resolve }); }),
  }).current;

  useEffect(() => { handle = api; return () => { handle = null; }; }, [api]);
  useEffect(() => { if (pending?.kind === "prompt") setTimeout(() => inputRef.current?.select(), 30); }, [pending]);

  const close = useCallback(() => { setPending(null); setError(null); }, []);

  const dismiss = useCallback(() => {
    if (!pending) return;
    // Dismissing must resolve, never hang: an awaited dialog that never settles freezes the caller.
    if (pending.kind === "prompt") pending.resolve(null);
    else if (pending.kind === "confirm") pending.resolve(false);
    else pending.resolve();
    close();
  }, [pending, close]);

  const submit = useCallback(() => {
    if (!pending) return;
    if (pending.kind === "prompt") {
      const err = pending.opts.validate?.(value) ?? null;
      if (err) { setError(err); return; }          // stay open so the value can be corrected
      pending.resolve(value);
    } else if (pending.kind === "confirm") pending.resolve(true);
    else pending.resolve();
    close();
  }, [pending, value, close]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); dismiss(); }
      if (e.key === "Enter" && pending.kind !== "prompt") { e.preventDefault(); submit(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, dismiss, submit]);

  const o = pending?.opts as (PromptOptions & ConfirmOptions) | undefined;
  const destructive = pending?.kind === "confirm" && (pending.opts as ConfirmOptions).destructive;

  return (
    <DialogContext.Provider value={api}>
      {children}
      {pending && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={dismiss} role="presentation">
          <div
            role="dialog" aria-modal="true" aria-label={o?.title}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] shadow-[0_16px_48px_rgba(0,0,0,0.4)]">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border-soft)] px-4 py-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-[var(--text-primary)]">{o?.title}</p>
                {o?.description && (
                  <p className="mt-1 text-[11.5px] leading-snug" style={{ color: "var(--text-muted)" }}>{o.description}</p>
                )}
              </div>
              <button onClick={dismiss} aria-label="Close"
                className="shrink-0 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"><X size={13}/></button>
            </div>

            {pending.kind === "prompt" && (
              <div className="px-4 py-3">
                <input
                  ref={inputRef}
                  value={value}
                  inputMode={pending.opts.inputMode === "number" ? "decimal" : "text"}
                  onChange={e => { setValue(e.target.value); if (error) setError(null); }}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
                  placeholder={pending.opts.placeholder}
                  className="key-input w-full text-sm"/>
                {error && <p className="mt-1.5 text-[11px]" style={{ color: "var(--status-error)" }} role="alert">{error}</p>}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 px-4 py-3 pt-0">
              {pending.kind !== "alert" && (
                <button onClick={dismiss}
                  className="rounded-sm border border-[var(--border-soft)] px-3 py-1.5 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
                  {(o as ConfirmOptions)?.cancelLabel ?? "Cancel"}
                </button>
              )}
              <button onClick={submit} autoFocus={pending.kind !== "prompt" && !destructive}
                className="rounded-sm px-3 py-1.5 text-[11.5px] font-medium transition-colors"
                style={destructive
                  ? { background: "var(--status-error)", color: "#fff" }
                  : { background: "var(--section-accent)", color: "var(--on-accent, #fff)" }}>
                {o?.confirmLabel ?? (pending.kind === "alert" ? "OK" : destructive ? "Delete" : "Confirm")}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </DialogContext.Provider>
  );
}
