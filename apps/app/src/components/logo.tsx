export function LogoMark({ size = 32, thinking = false }: { size?: number; thinking?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, display: "block" }}>
      <circle cx="16" cy="16" r="6.5" fill="currentColor" />
      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
      <circle cx="0" cy="0" r="2.4" fill="currentColor" opacity="0.85">
        <animateMotion dur={thinking ? "1.4s" : "6s"} repeatCount="indefinite" path="M27,9 A13,13 0 1 1 5,23 A13,13 0 1 1 27,9" />
      </circle>
    </svg>
  );
}

export function Logo({ size = 52, showWordmark = true }: { size?: number; showWordmark?: boolean }) {
  const fs = Math.round(size * 0.42);
  const mark = Math.round(size * 0.62);
  return (
    <div className="flex items-center" style={{ gap: showWordmark ? Math.round(size * 0.14) : 0, lineHeight: 1 }}>
      <span style={{ color: "var(--accent)", display: "inline-flex" }}>
        <LogoMark size={mark} />
      </span>
      {showWordmark && (
        <span style={{
          fontFamily: "'Orbitron', sans-serif",
          fontWeight: 500,
          fontSize: `${fs}px`,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-primary)",
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}>
          MONDAILY
        </span>
      )}
    </div>
  );
}
