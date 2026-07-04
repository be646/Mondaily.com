import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { SUPPORTED_LANGUAGES, languageMeta } from "@mondaily/shared/i18n";

/**
 * Premium, minimal language dropdown — flag + native name, good light/dark behavior. Used in app
 * Settings (with the "Follow workspace default" option) and reusable elsewhere. Value is a language
 * code, or "" for the follow-workspace default. Purely a controlled input — it never persists on its
 * own, so it can't touch account/billing state.
 */
export function LanguageSelect({
  value,
  onChange,
  includeFollowDefault = false,
  followLabel = "Follow workspace default",
  align = "left",
}: {
  value: string;
  onChange: (code: string) => void;
  includeFollowDefault?: boolean;
  followLabel?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = value ? languageMeta(value) : null;
  const currentLabel = selected ? `${selected.flag}  ${selected.nativeName}` : followLabel;

  return (
    <div ref={ref} className="relative" dir="ltr">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[13px] transition-colors hover:border-[color:var(--section-accent)]"
        style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-primary)" }}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronsUpDown size={13} className="shrink-0" style={{ color: "var(--text-faint)" }} />
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute z-50 mt-1 max-h-72 w-full min-w-[220px] overflow-y-auto rounded-lg border p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.35)] ${align === "right" ? "right-0" : "left-0"}`}
          style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}
        >
          {includeFollowDefault && (
            <Option label={followLabel} active={!value} onClick={() => { onChange(""); setOpen(false); }} />
          )}
          {SUPPORTED_LANGUAGES.map(l => (
            <Option
              key={l.code}
              label={<><span className="text-[15px] leading-none">{l.flag}</span><span>{l.nativeName}</span><span className="text-[11px] text-[var(--text-faint)]">{l.name}</span></>}
              active={value === l.code}
              onClick={() => { onChange(l.code); setOpen(false); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Option({ label, active, onClick }: { label: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-[var(--surface-hover)]"
      style={{ color: "var(--text-secondary)" }}
    >
      <span className="flex flex-1 items-center gap-2 truncate">{label}</span>
      {active && <Check size={13} className="shrink-0" style={{ color: "var(--section-accent)" }} />}
    </button>
  );
}
