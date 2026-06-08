import React from "react";

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="22" r="13" fill="none" stroke="#ef4444" strokeWidth="2.5"/>
      <circle cx="26" cy="22" r="13" fill="none" stroke="white" strokeWidth="2" opacity="0.55"/>
      <circle cx="22" cy="22" r="3.5" fill="#ef4444"/>
      <circle cx="22" cy="22" r="6" fill="#ef4444" opacity="0.12"/>
    </svg>
  );
}
