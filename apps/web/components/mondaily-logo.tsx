"use client";
import { motion } from "framer-motion";

interface Props {
  className?: string;
  size?: number;
  showWordmark?: boolean;
}

export function MondailyLogo({ className = "", size = 36, showWordmark = false }: Props) {
  const lineCount = 20;
  return (
    <div className={`flex items-center gap-2.5 select-none ${className}`}>
      {/* Square emblem */}
      <div
        className="relative overflow-hidden border border-white/20 bg-black"
        style={{ width: size, height: size, borderRadius: Math.max(2, size * 0.08) }}
      >
        {/* Scanning grid lines */}
        <motion.div
          animate={{ y: ["0%", "-50%"] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
          className="absolute inset-x-0 top-0 will-change-transform"
          style={{ height: "200%" }}
        >
          {Array.from({ length: lineCount * 2 }).map((_, i) => (
            <div
              key={i}
              style={{
                height: size / lineCount,
                borderBottom: `1px solid rgba(255,255,255,${
                  i % 5 === 0 ? 0.24 : i % 2 === 0 ? 0.07 : 0.03
                })`,
              }}
            />
          ))}
        </motion.div>
        {/* Stark white micro-dot accent */}
        <motion.div
          animate={{ opacity: [1, 0.35, 1] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" as const }}
          className="absolute rounded-full bg-white"
          style={{
            width: Math.max(4, size * 0.14),
            height: Math.max(4, size * 0.14),
            top: Math.max(3, size * 0.11),
            right: Math.max(3, size * 0.11),
            boxShadow: "0 0 8px rgba(255,255,255,0.95)",
          }}
        />
      </div>
      {showWordmark && (
        <span
          className="font-mono font-bold uppercase text-white tracking-widest"
          style={{ fontSize: Math.max(10, size * 0.36), letterSpacing: "0.18em" }}
        >
          MONDAILY
        </span>
      )}
    </div>
  );
}
