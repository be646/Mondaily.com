"use client";

export function Logo({ size = 44, thinking = false }: { size?: number; thinking?: boolean }) {
  const pd = thinking ? "1.4s" : "4s";
  const bd = thinking ? "1.2s" : "5.5s";
  const sd = thinking ? "0.8s" : "2.8s";

  return (
    <div className="flex items-center" style={{ gap: Math.round(size * 0.3) }}>
      <style>{`
        @keyframes ml-hex1  { 0%,100%{opacity:1;stroke-width:3.5} 50%{opacity:0.5;stroke-width:2.5} }
        @keyframes ml-hex2  { 0%,100%{opacity:0.7;stroke-width:2.5} 50%{opacity:0.2;stroke-width:1.5} }
        @keyframes ml-hex3  { 0%,100%{opacity:0.4;stroke-width:2} 50%{opacity:0.1;stroke-width:1} }
        @keyframes ml-blink { 0%,40%,60%,100%{opacity:1} 48%,52%{opacity:0.05} }
        @keyframes ml-scan  { 0%{stroke-dashoffset:100} 100%{stroke-dashoffset:-100} }
        @keyframes ml-glint { 0%,75%,100%{opacity:0} 80%,92%{opacity:1} }
        @keyframes ml-lash  { 0%,100%{opacity:0.4} 50%{opacity:0.9} }
        @keyframes ml-notch { 0%,100%{opacity:0.3} 50%{opacity:0.85} }
        .ml-h1 { animation: ml-hex1  var(--ml-pd) ease-in-out infinite; }
        .ml-h2 { animation: ml-hex2  var(--ml-pd) ease-in-out infinite 0.4s; }
        .ml-h3 { animation: ml-hex3  var(--ml-pd) ease-in-out infinite 0.8s; }
        .ml-eye { animation: ml-blink var(--ml-bd) ease-in-out infinite; }
        .ml-scan { animation: ml-scan var(--ml-sd) linear infinite; }
        .ml-glint { animation: ml-glint var(--ml-bd) ease-in-out infinite; }
        .ml-lash { animation: ml-lash var(--ml-pd) ease-in-out infinite; }
        .ml-notch { animation: ml-notch var(--ml-pd) ease-in-out infinite; }
      `}</style>

      <svg
        width={size}
        height={size}
        viewBox="0 0 240 240"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          color: "white",
          flexShrink: 0,
          ["--ml-pd" as string]: pd,
          ["--ml-bd" as string]: bd,
          ["--ml-sd" as string]: sd,
        }}
      >
        <defs>
          <clipPath id="ml-clip">
            <polygon points="120,10 208,62 208,178 120,230 32,178 32,62"/>
          </clipPath>
          <radialGradient id="ml-pupil" cx="50%" cy="45%" r="50%">
            <stop offset="0%" stopColor="#a78bfa"/>
            <stop offset="100%" stopColor="#5b21b6"/>
          </radialGradient>
        </defs>

        {/* ── Outer hexagon with corner bracket notches ── */}
        <polygon
          className="ml-h1"
          points="120,10 208,62 208,178 120,230 32,178 32,62"
          stroke="currentColor" fill="none" strokeWidth="3.5" strokeLinejoin="round"
        />
        {/* Corner bracket notches — 6 sides, open "L" shapes */}
        {[
          // top-right corner
          { pts: "172,18 192,30 192,48",   d: "0s"    },
          // right corner
          { pts: "206,108 220,120 206,132", d: "0.25s" },
          // bottom-right corner
          { pts: "172,222 192,210 192,192", d: "0.5s"  },
          // bottom-left corner
          { pts: "68,222 48,210 48,192",    d: "0.75s" },
          // left corner
          { pts: "34,108 20,120 34,132",    d: "1s"    },
          // top-left corner
          { pts: "68,18 48,30 48,48",       d: "1.25s" },
        ].map((b, i) => (
          <polyline
            key={i}
            className="ml-notch"
            points={b.pts}
            stroke="currentColor" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
            style={{ animationDelay: b.d }}
          />
        ))}

        {/* ── Middle hexagon ── */}
        <polygon
          className="ml-h2"
          points="120,36 188,76 188,164 120,204 52,164 52,76"
          stroke="currentColor" fill="none" strokeWidth="2" strokeLinejoin="round"
        />

        {/* ── Inner hexagon ── */}
        <polygon
          className="ml-h3"
          points="120,64 168,92 168,148 120,176 72,148 72,92"
          stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinejoin="round"
        />

        {/* ── Eye group ── */}
        <g className="ml-eye">
          {/* Eye outline — classic almond */}
          <path
            d="M60,120 Q120,72 180,120 Q120,168 60,120Z"
            stroke="currentColor" fill="none" strokeWidth="3.5" strokeLinejoin="round"
          />

          {/* Iris */}
          <circle cx="120" cy="120" r="28" stroke="currentColor" fill="none" strokeWidth="2.5" opacity="0.5"/>

          {/* Pupil */}
          <circle cx="120" cy="120" r="15" fill="currentColor"/>
          <circle cx="120" cy="120" r="10" fill="url(#ml-pupil)"/>

          {/* Glint */}
          <path
            className="ml-glint"
            d="M129,108 Q138,103 136,112"
            stroke="currentColor" fill="none" strokeWidth="2.5" strokeLinecap="round" opacity="0.9"
          />

          {/* Eyelash rays — 8 lines radiating from iris */}
          {[
            { x1:120, y1:88,  x2:120, y2:72,  d:"0s"    },  // top
            { x1:144, y1:94,  x2:154, y2:82,  d:"0.15s" },  // top-right
            { x1:152, y1:120, x2:168, y2:120, d:"0.3s"  },  // right (handled by arrow)
            { x1:144, y1:146, x2:154, y2:158, d:"0.45s" },  // bottom-right
            { x1:120, y1:152, x2:120, y2:168, d:"0.6s"  },  // bottom
            { x1:96,  y1:146, x2:86,  y2:158, d:"0.75s" },  // bottom-left
            { x1:88,  y1:120, x2:72,  y2:120, d:"0.9s"  },  // left (handled by arrow)
            { x1:96,  y1:94,  x2:86,  y2:82,  d:"1.05s" },  // top-left
          ].map((l, i) => (
            <line
              key={i}
              className="ml-lash"
              x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              style={{ animationDelay: l.d }}
            />
          ))}

          {/* Double-headed arrow on left side */}
          <g opacity="0.6">
            <line x1="56" y1="120" x2="76" y2="120" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <polyline points="60,115 56,120 60,125" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points="72,115 76,120 72,125" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </g>
        </g>

        {/* ── Violet scan line ── */}
        <line
          className="ml-scan"
          x1="60" y1="120" x2="180" y2="120"
          stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round"
          strokeDasharray="14 8"
          clipPath="url(#ml-clip)"
          opacity="0.65"
        />
      </svg>

      {/* Orbitron wordmark — same cap-height as symbol */}
      <span
        className="font-orbitron"
        style={{
          fontWeight: 500,
          fontSize: `${Math.round(size * 0.36)}px`,
          letterSpacing: "0.14em",
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
