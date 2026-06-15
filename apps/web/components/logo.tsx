"use client";

export function Logo({ size = 36, thinking = false }: { size?: number; thinking?: boolean }) {
  const pd = thinking ? "1.6s" : "4s";
  const bd = thinking ? "1.4s" : "6s";
  const sd = thinking ? "0.9s" : "3s";

  return (
    <>
      <style>{`
        @keyframes ml-pulse-outer { 0%,100%{opacity:1;stroke-width:3} 50%{opacity:0.45;stroke-width:2} }
        @keyframes ml-pulse-mid   { 0%,100%{opacity:1;stroke-width:2.5} 50%{opacity:0.55;stroke-width:1.5} }
        @keyframes ml-pulse-inner { 0%,100%{opacity:1;stroke-width:2} 50%{opacity:0.65;stroke-width:1.2} }
        @keyframes ml-blink       { 0%,44%,56%,100%{opacity:1} 48%,52%{opacity:0} }
        @keyframes ml-scan        { 0%{stroke-dashoffset:60} 100%{stroke-dashoffset:-60} }
        @keyframes ml-glint       { 0%,78%,100%{opacity:0} 84%,92%{opacity:1} }
        @keyframes ml-notch       { 0%,100%{opacity:0.35} 50%{opacity:1} }
        .ml-hex-outer { animation: ml-pulse-outer var(--ml-pd) ease-in-out infinite; }
        .ml-hex-mid   { animation: ml-pulse-mid   var(--ml-pd) ease-in-out infinite 0.4s; }
        .ml-hex-inner { animation: ml-pulse-inner var(--ml-pd) ease-in-out infinite 0.8s; }
        .ml-eye-group { animation: ml-blink var(--ml-bd) ease-in-out infinite; }
        .ml-scan-line { animation: ml-scan  var(--ml-sd) linear infinite; }
        .ml-glint     { animation: ml-glint var(--ml-bd) ease-in-out infinite; }
        .ml-notch     { animation: ml-notch var(--ml-pd) ease-in-out infinite; }
      `}</style>
      <svg
        width={size}
        height={size}
        viewBox="0 0 160 160"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          color: "white",
          ["--ml-pd" as string]: pd,
          ["--ml-bd" as string]: bd,
          ["--ml-sd" as string]: sd,
        }}
      >
        <defs>
          <clipPath id="ml-hex-clip">
            <polygon points="80,10 140,45 140,115 80,150 20,115 20,45" />
          </clipPath>
        </defs>

        {/* Outer hex — thicker strokes for visibility */}
        <polygon
          className="ml-hex-outer"
          points="80,10 140,45 140,115 80,150 20,115 20,45"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinejoin="round"
          opacity="0.9"
        />

        {/* Notch ticks */}
        {[
          { x1: 80,  y1: 10,  x2: 80,  y2: 22,  d: "0s"    },
          { x1: 20,  y1: 59,  x2: 29,  y2: 64,  d: "0.3s"  },
          { x1: 20,  y1: 97,  x2: 29,  y2: 92,  d: "0.6s"  },
          { x1: 140, y1: 59,  x2: 131, y2: 64,  d: "0.9s"  },
          { x1: 140, y1: 97,  x2: 131, y2: 92,  d: "1.2s"  },
          { x1: 80,  y1: 150, x2: 80,  y2: 138, d: "1.5s"  },
        ].map((n, i) => (
          <line
            key={i}
            className="ml-notch"
            x1={n.x1} y1={n.y1} x2={n.x2} y2={n.y2}
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            style={{ animationDelay: n.d }}
            opacity="0.75"
          />
        ))}

        {/* Mid hex */}
        <polygon
          className="ml-hex-mid"
          points="80,28 122,52 122,108 80,132 38,108 38,52"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
          opacity="0.4"
        />

        {/* Inner hex */}
        <polygon
          className="ml-hex-inner"
          points="80,46 108,62 108,98 80,114 52,98 52,62"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          opacity="0.2"
        />

        {/* Eye group — high contrast fill on iris */}
        <g className="ml-eye-group">
          <path
            d="M50,80 Q80,52 110,80 Q80,108 50,80Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinejoin="round"
          />
          {/* Iris ring */}
          <circle cx="80" cy="80" r="15" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.55" />
          {/* Pupil — solid white for max contrast */}
          <circle cx="80" cy="80" r="6.5" fill="currentColor" />
          {/* Violet inner glow on pupil */}
          <circle cx="80" cy="80" r="4" fill="#7c3aed" opacity="0.7" />
          {/* Glint */}
          <path
            className="ml-glint"
            d="M86,72 Q91,68 90,73"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.6"
          />
          {/* Eyelash lines */}
          <line x1="80" y1="46" x2="80" y2="58" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.4"/>
          <line x1="60" y1="53" x2="65" y2="63" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.4"/>
          <line x1="100" y1="53" x2="95" y2="63" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.4"/>
          <line x1="80" y1="114" x2="80" y2="102" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.4"/>
          <line x1="60" y1="107" x2="65" y2="97" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.4"/>
          <line x1="100" y1="107" x2="95" y2="97" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.4"/>
          {/* Side arrows */}
          <polyline points="41,80 50,74 50,86" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.35"/>
          <line x1="41" y1="80" x2="50" y2="80" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.35"/>
          <polyline points="119,80 110,74 110,86" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.35"/>
          <line x1="119" y1="80" x2="110" y2="80" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.35"/>
        </g>

        {/* Scan line */}
        <line
          className="ml-scan-line"
          x1="50" y1="80" x2="110" y2="80"
          stroke="#7c3aed"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeDasharray="9 6"
          clipPath="url(#ml-hex-clip)"
          opacity="0.7"
        />
      </svg>
    </>
  );
}
