"use client";

// Abstract geometric logo: hexagon frame → infinity-knot loop → almond eye + pupil dot
// Neon cyan (#00d4ff) on dark, thick strokes, pure inline SVG, no external deps.
export function Logo({ size = 40 }: { size?: number }) {
  const fs = Math.round(size * 0.38);
  const id = "logo-glow";

  return (
    <div className="flex items-center gap-2.5">
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ flexShrink: 0, display: "block" }}
      >
        <defs>
          <filter id={id} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ── Outer hexagon frame (flat-top, thin, subtle) ── */}
        <polygon
          points="96,50 73,91 27,91 4,50 27,9 73,9"
          stroke="#00d4ff"
          strokeOpacity="0.18"
          fill="none"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />

        {/*
          ── Infinity knot ──
          A single continuous figure-8 path, symmetric around (50,50).
          Upper lobe: rises to y≈20, lower lobe: drops to y≈80.
          The two lobes cross at the center (50,50) forming the classic
          infinity/ouroboros crossover — representing non-stop workflow loops.
        */}
        <path
          d={`
            M 50,50
            C 50,38 62,20 72,20
            C 86,20 88,38 80,47
            C 72,56 58,56 50,50
            C 42,44 28,44 20,53
            C 12,62 14,80 28,80
            C 38,80 50,62 50,50
            C 50,38 62,20 72,20
          `}
          stroke="#00d4ff"
          fill="none"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#${id})`}
        />
        <path
          d={`
            M 50,50
            C 50,62 38,80 28,80
            C 14,80 12,62 20,53
            C 28,44 42,44 50,50
            C 58,56 72,56 80,47
            C 88,38 86,20 72,20
            C 62,20 50,38 50,50
          `}
          stroke="#00d4ff"
          fill="none"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#${id})`}
        />

        {/*
          ── Almond eye at center ──
          Horizontal diamond/almond spanning ~20px either side of center.
          Sharp pointed ends at left (30,50) and right (70,50).
        */}
        <path
          d="M 34,50 Q 50,40 66,50 Q 50,60 34,50 Z"
          stroke="#00d4ff"
          fill="none"
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
          filter={`url(#${id})`}
        />

        {/* Pupil — single solid dot, center of eye */}
        <circle
          cx="50" cy="50" r="3.5"
          fill="#00d4ff"
          filter={`url(#${id})`}
        />
      </svg>

      {/* Wordmark */}
      <span
        className="font-orbitron"
        style={{
          fontWeight: 600,
          fontSize: `${fs}px`,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#ffffff",
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        MONDAILY
      </span>
    </div>
  );
}
