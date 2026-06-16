"use client";

export function Logo({ size = 52 }: { size?: number }) {
  const fs = Math.round(size * 0.46);

  return (
    <div className="flex items-center" style={{ lineHeight: 1 }}>
      <span
        className="font-orbitron"
        style={{
          fontWeight: 700,
          fontSize: `${fs}px`,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "white",
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        MONDAILY
      </span>
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: Math.max(5, Math.round(size * 0.09)),
          height: Math.max(5, Math.round(size * 0.09)),
          borderRadius: "50%",
          background: "#7c3aed",
          marginLeft: Math.max(3, Math.round(size * 0.06)),
          marginBottom: Math.round(fs * 0.32),
          boxShadow: "0 0 8px rgba(124,58,237,0.7)",
        }}
      />
    </div>
  );
}
