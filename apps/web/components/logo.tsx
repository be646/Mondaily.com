"use client";

export function Logo({ size = 52 }: { size?: number }) {
  const fs = Math.round(size * 0.42);
  const mark = Math.round(size * 0.62);

  return (
    <div className="flex items-center" style={{ gap: Math.round(size * 0.14), lineHeight: 1 }}>
      <svg width={mark} height={mark} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, display: "block", color: "currentColor" }}>
        <circle cx="16" cy="16" r="6.5" fill="currentColor"/>
        <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.4" opacity="0.35"/>
        <circle cx="0" cy="0" r="2.4" fill="currentColor" opacity="0.85">
          <animateMotion
            dur="6s"
            repeatCount="indefinite"
            path="M27,9 A13,13 0 1 1 5,23 A13,13 0 1 1 27,9"
          />
        </circle>
      </svg>
      <span
        className="font-orbitron"
        style={{
          fontWeight: 500,
          fontSize: `${fs}px`,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "currentColor",
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        MONDAILY
      </span>
    </div>
  );
}
