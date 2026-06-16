"use client";

// Corner bracket reticle + bold almond eye + iris + pupil — monochrome
// Four L-shaped corners frame the eye with no enclosing border
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
        {/* Four corner brackets — L shapes at each corner */}
        <polyline points="10,28 10,10 28,10" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        <polyline points="72,10 90,10 90,28" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        <polyline points="10,72 10,90 28,90" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        <polyline points="90,72 90,90 72,90" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"/>

        {/* Bold almond eye — wide, centered */}
        <path
          d="M 14,50 Q 50,22 86,50 Q 50,78 14,50 Z"
          stroke="white"
          strokeWidth="2.8"
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Iris ring — matte grey */}
        <circle cx="50" cy="50" r="14" stroke="#a1a1aa" strokeWidth="2" fill="none"/>

        {/* Pupil — solid white */}
        <circle cx="50" cy="50" r="5.5" fill="white"/>

        {/* Glint */}
        <path d="M 57,43 Q 64,39 62,47" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.55"/>
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
