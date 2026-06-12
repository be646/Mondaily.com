"use client";

interface Props {
  className?: string;
  size?: number;
  showWordmark?: boolean;
}

export function MondailyLogo({ className = "", size = 36, showWordmark = false }: Props) {
  const s = size;
  const cx = s / 2;
  const cy = s / 2;
  const r = s * 0.38;

  // 6 nodes arranged in a circle + 1 center node
  const nodes = [0, 1, 2, 3, 4, 5].map(i => {
    const angle = (i * Math.PI * 2) / 6 - Math.PI / 2;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  });
  const center = { x: cx, y: cy };

  // Edges: center→each outer, plus alternating outer ring connections
  const edges: [number, number][] = [
    [-1, 0], [-1, 1], [-1, 2], [-1, 3], [-1, 4], [-1, 5], // center to outer
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0],       // ring
    [0, 3], [1, 4],                                         // diagonals
  ];

  const getPoint = (idx: number) => idx === -1 ? center : nodes[idx]!;

  const nodeDotR = s * 0.042;
  const centerDotR = s * 0.065;

  return (
    <div className={`flex items-center gap-2.5 select-none ${className}`}>
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Background */}
        <rect width={s} height={s} rx={s * 0.22} fill="#0e1018"/>
        <rect width={s} height={s} rx={s * 0.22} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="0.8"/>

        {/* Connection lines */}
        {edges.map(([a, b], i) => {
          const pa = getPoint(a);
          const pb = getPoint(b);
          const isCenter = a === -1;
          return (
            <line
              key={i}
              x1={pa.x} y1={pa.y}
              x2={pb.x} y2={pb.y}
              stroke={isCenter ? "rgba(139,92,246,0.35)" : "rgba(99,102,241,0.22)"}
              strokeWidth={isCenter ? 0.8 : 0.6}
            />
          );
        })}

        {/* Outer nodes */}
        {nodes.map((n, i) => (
          <circle
            key={i}
            cx={n.x} cy={n.y} r={nodeDotR}
            fill={i % 2 === 0 ? "#818cf8" : "#a78bfa"}
            opacity="0.85"
          />
        ))}

        {/* Center node — larger, brighter */}
        <circle cx={center.x} cy={center.y} r={centerDotR} fill="#c4b5fd" opacity="0.95"/>
        <circle cx={center.x} cy={center.y} r={centerDotR * 0.5} fill="white" opacity="0.9"/>
      </svg>

      {showWordmark && (
        <span className="text-[15px] font-semibold tracking-tight text-white">
          Mondaily
        </span>
      )}
    </div>
  );
}
