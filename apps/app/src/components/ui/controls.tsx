// ─── Shared UI primitives ─────────────────────────────────────────────────────
// One Button / Select / SectionHeader / SoulCard for the whole app. They read the
// theme + section-soul tokens (styles.css), so every surface stays consistent across
// all 4 themes and each section's accent flows through automatically. Use these
// instead of hand-rolling <select>/<button> chrome per page.

import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ── Button ────────────────────────────────────────────────────────────────────
type ButtonVariant = "default" | "primary" | "ghost" | "danger";
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: LucideIcon;
}
export function Button({ variant = "default", size = "md", icon: Icon, className, children, ...rest }: ButtonProps) {
  return (
    <button
      className={cx(
        "ui-btn",
        variant === "primary" && "ui-btn--primary",
        variant === "ghost" && "ui-btn--ghost",
        variant === "danger" && "ui-btn--danger",
        size === "sm" && "ui-btn--sm",
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={size === "sm" ? 12 : 14} />}
      {children}
    </button>
  );
}

// ── Select (native, fully styled incl. chevron via styles.css) ─────────────────
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options?: { value: string; label: string }[];
}
export function Select({ options, className, children, ...rest }: SelectProps) {
  return (
    <select className={cx("ui-select", className)} {...rest}>
      {options ? options.map(o => <option key={o.value} value={o.value}>{o.label}</option>) : children}
    </select>
  );
}

// ── SectionHeader — the section "soul": mono call-sign + glyph + accent rule ────
interface SectionHeaderProps {
  /** mono call-sign, e.g. "LEDGER" — rendered as `// LEDGER` in the section accent */
  callsign: string;
  title: string;
  icon?: LucideIcon;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}
export function SectionHeader({ callsign, title, icon: Icon, subtitle, actions, className }: SectionHeaderProps) {
  return (
    <div className={cx("mb-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {Icon && <Icon size={15} style={{ color: "var(--section-accent)" }} />}
            <span className="soul-kicker">// {callsign}</span>
          </div>
          <h1 className="mt-1.5 text-[17px] font-semibold text-[var(--text-primary)]">{title}</h1>
          {subtitle && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="soul-rule mt-3" />
    </div>
  );
}

// ── SoulCard — card whose border can be "lit" with the section accent ──────────
interface SoulCardProps {
  lit?: boolean;
  className?: string;
  children?: ReactNode;
  style?: React.CSSProperties;
}
export function SoulCard({ lit, className, children, style }: SoulCardProps) {
  return (
    <div className={cx("soul-card", lit && "soul-card--lit", className)} style={style}>
      {children}
    </div>
  );
}

// ── MenuSelect — custom dropdown (button + .ui-menu popover) ────────────────────
// Native <select> option lists can't be themed, so filter bars use this instead:
// squared trigger, thin border, compact matte rows, dark/light via tokens, no
// browser-blue selected row. Keyboard: Enter/Space/ArrowDown open, arrows move,
// Enter picks, Escape closes. Value semantics match a native select (""=All).
interface MenuSelectOption { value: string; label: string; dot?: string }
interface MenuSelectProps {
  label?: string;                    // small uppercase prefix label inside the trigger
  value: string;                     // "" = the allLabel option
  options: MenuSelectOption[];
  onChange: (v: string) => void;
  allLabel?: string;                 // label for the "" option (default "All")
  className?: string;
  maxWidth?: number;
  disabled?: boolean;
  title?: string;
}
export function MenuSelect({ label, value, options, onChange, allLabel = "All", className, maxWidth = 180, disabled, title }: MenuSelectProps) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);   // highlighted row index
  const rootRef = useRef<HTMLDivElement>(null);
  const all: MenuSelectOption[] = [{ value: "", label: allLabel }, ...options];
  const current = all.find(o => o.value === value) ?? all[0]!;

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const openMenu = () => { setHi(Math.max(0, all.findIndex(o => o.value === value))); setOpen(true); };
  const pick = (v: string) => { onChange(v); setOpen(false); };

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); openMenu(); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, all.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(all[hi]!.value); }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div ref={rootRef} className={cx("relative inline-block", className)} onKeyDown={onKeyDown}>
      <button type="button" onClick={() => (open ? setOpen(false) : openMenu())} disabled={disabled} title={title}
        aria-haspopup="listbox" aria-expanded={open}
        className="inline-flex h-7 items-center gap-1.5 rounded-sm border px-2 text-[11.5px] transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderColor: open ? "var(--border-strong)" : "var(--border-soft)", background: "var(--surface-input)", color: "var(--text-secondary)", maxWidth }}>
        {label && <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>{label}</span>}
        <span className="truncate font-medium capitalize" style={{ color: value ? "var(--text-primary)" : "var(--text-muted)" }}>
          {current.dot && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: current.dot }} />}
          {current.label}
        </span>
        <ChevronDown size={11} className="shrink-0" style={{ color: "var(--text-faint)", transform: open ? "rotate(180deg)" : undefined, transition: "transform .12s" }} />
      </button>
      {open && (
        <div role="listbox" className="ui-menu absolute left-0 top-full z-40 mt-1 max-h-64 min-w-full overflow-y-auto py-1" style={{ borderRadius: 4, width: "max-content", maxWidth: 260 }}>
          {all.map((o, i) => {
            const selected = o.value === value;
            return (
              <div key={o.value || "__all"} role="option" aria-selected={selected}
                onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}
                className="ui-menu-item capitalize" data-active={selected}
                style={{ background: i === hi ? "var(--surface-hover)" : undefined, color: selected ? "var(--text-primary)" : undefined }}>
                {o.dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: o.dot }} />}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {selected && <Check size={12} style={{ color: "var(--section-accent)" }} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
