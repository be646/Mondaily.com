"use client";

export function Logo({ size = 52 }: { size?: number }) {
  const fs = Math.round(size * 0.36);
  const s = size / 100;

  return (
    <div className="flex items-center gap-3">
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ flexShrink: 0, display: "block" }}
      >
        {/* Outer rounded rect — thin, ghosted */}
        <rect x="6" y="6" width="88" height="88" rx="14" stroke="white" strokeWidth="1.5" fill="none" opacity="0.18"/>

        {/* ECG / signal waveform across midline */}
        <polyline
          points="8,50 20,50 26,26 34,74 42,38 50,50 58,50 64,32 72,68 80,50 92,50"
          stroke="white"
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Pulse dot at center */}
        <circle cx="50" cy="50" r="5" fill="white"/>
        <circle cx="50" cy="50" r="9" stroke="white" strokeWidth="1.2" fill="none" opacity="0.35"/>
      </svg>

      {/* Wordmark */}
      <span
        className="font-orbitron"
        style={{
          fontWeight: 600,
          fontSize: `${fs}px`,
          letterSpacing: "0.13em",
          textTransform: "uppercase",
          color: "white",
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        MONDAILY
      </span>
    </div>
  );
}
