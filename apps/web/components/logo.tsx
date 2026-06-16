"use client";

// Rounded square frame + almond eye with iris + pupil (monochrome)
// Animated arc travels continuously around the outside of the square
export function Logo({ size = 52 }: { size?: number }) {
  const fs = Math.round(size * 0.36);

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
        <style>{`
          @keyframes orbit {
            from { stroke-dashoffset: 0; }
            to   { stroke-dashoffset: -1; }
          }
          .logo-orbit {
            animation: orbit 2.8s linear infinite;
          }
        `}</style>

        {/* Offset shadow square — matte grey, slightly shifted down-right */}
        <rect
          x="16" y="18"
          width="72" height="72"
          rx="17"
          stroke="#4b4b52"
          strokeWidth="1.8"
          fill="none"
          opacity="0.55"
        />

        {/* Main rounded square — white */}
        <rect
          x="10" y="10"
          width="72" height="72"
          rx="17"
          stroke="white"
          strokeWidth="2.8"
          fill="none"
        />

        {/*
          Traveling arc — same path as main square.
          pathLength="1" lets us express dasharray in fractions of perimeter.
          A 0.14 dash travels around the full square continuously.
        */}
        <rect
          x="10" y="10"
          width="72" height="72"
          rx="17"
          stroke="white"
          strokeWidth="2.8"
          fill="none"
          pathLength="1"
          strokeDasharray="0.14 0.86"
          strokeLinecap="round"
          className="logo-orbit"
          opacity="0.9"
        />

        {/* Almond eye — centered in the square (square center: 46,46) */}
        <path
          d="M 24,46 Q 46,30 68,46 Q 46,62 24,46 Z"
          stroke="white"
          strokeWidth="2.5"
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Iris ring — matte grey */}
        <circle
          cx="46" cy="46" r="11"
          stroke="#a1a1aa"
          strokeWidth="2"
          fill="none"
        />

        {/* Pupil — solid white */}
        <circle cx="46" cy="46" r="4.5" fill="white" />

        {/* Glint — small arc top-right of iris */}
        <path
          d="M 52,41 Q 57,38 56,44"
          stroke="white"
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
          opacity="0.55"
        />
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
