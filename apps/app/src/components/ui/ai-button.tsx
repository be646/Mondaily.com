import React from "react";
import { LogoMark } from "../logo";

/**
 * AIMark — Mondaily's AI identity lockup: the orbital mark + the word "AI".
 * The logo alone isn't legible enough as "this is AI", so we always pair them.
 * Reuse this anywhere an AI action needs its mark (buttons, chips, headers).
 */
export function AIMark({ size = 13, thinking = false }: { size?: number; thinking?: boolean }) {
  return (
    <span className="ai-mark" aria-label="AI">
      <LogoMark size={size} thinking={thinking} />
      <span className="ai-mark-label">AI</span>
    </span>
  );
}

/**
 * AIButton — the single, consistent button for every AI action across the app.
 * Carries the AIMark (orbital logo + "AI"), not a bare icon. Two weights:
 *   - "solid"  : high-contrast command block (.btn-ai) — primary AI action
 *   - "subtle" : light chip (.btn-suggested) — secondary / inline suggestion
 */
export function AIButton({
  children,
  onClick,
  variant = "solid",
  size = "md",
  loading = false,
  disabled = false,
  title,
  className = "",
  type = "button",
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  variant?: "solid" | "subtle";
  size?: "sm" | "md";
  loading?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  type?: "button" | "submit";
}) {
  const base = variant === "solid" ? "btn-ai" : "btn-suggested";
  // Pass 4A: sm text uses the shared scale (text-label = 11px); padding stays overridden. No !important
  // on font-size — .btn-ai/.btn-suggested set no font-size, so text-label applies cleanly.
  const sizeCls = size === "sm" ? "!px-2.5 !py-1 text-label" : "";
  const markSize = size === "sm" ? 12 : 14;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className={`${base} ${sizeCls} ${className}`}
    >
      <AIMark size={markSize} thinking={loading} />
      {children}
    </button>
  );
}

/**
 * SuggestionHints — AI-suggested prompts as a clean, ordered vertical stack of
 * soft cards with a light shadow (the Claude-composer look), NOT framed pill
 * buttons. Use for example / coach / starter prompts app-wide.
 */
export function SuggestionHints({
  items,
  onPick,
  label,
  className = "",
}: {
  items: string[];
  onPick: (s: string) => void;
  label?: string;
  className?: string;
}) {
  if (!items.length) return null;
  return (
    <div className={className}>
      {label && (
        <p className="mb-1.5 px-0.5 text-[10.5px] font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
          {label}
        </p>
      )}
      <div className="suggestion-stack">
        {items.map((s) => (
          <button key={s} type="button" onClick={() => onPick(s)} className="suggestion-row group">
            <SparkleGlyph />
            <span className="flex-1">{s}</span>
            <svg className="suggestion-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M7 17L17 7M17 7H8M17 7V16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

function SparkleGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.9 5.6L19.5 10.5 13.9 12.4 12 18l-1.9-5.6L4.5 10.5 10.1 8.6 12 3z" fill="currentColor" />
    </svg>
  );
}
