"use client";

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Outer ring */}
      <circle cx="18" cy="18" r="16" stroke="rgba(255,255,255,0.1)" strokeWidth="1" fill="none"/>
      {/* Orange pie segment — 255° arc, clockwise from top */}
      {/* Start: top (18,2) → end at 255° CW: (18+16·cos(165°), 18+16·sin(165°)) = (2.54,22.14) */}
      <path d="M18 18 L18 2 A16 16 0 1 1 2.54 22.14 Z" fill="#f5820a"/>
      {/* Inner cutout to create donut */}
      <circle cx="18" cy="18" r="7" fill="#090b0f"/>
      {/* Center node */}
      <circle cx="18" cy="18" r="2.5" fill="#f5820a"/>
    </svg>
  );
}
