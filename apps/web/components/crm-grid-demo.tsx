"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
function SparklesIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
    </svg>
  );
}

// Fictional companies only — never real firms with invented metrics.
const RECORDS = [
  { name: "Lumen Labs", logo: "L",  arr: "$2.4M",  country: "USA",     employees: "180",  stage: "Series B" },
  { name: "Fathom",     logo: "F",  arr: "$8.1M",  country: "USA",     employees: "820",  stage: "Acquired" },
  { name: "Vantage",    logo: "V",  arr: "$3.7M",  country: "USA",     employees: "260",  stage: "Series C" },
  { name: "Relay Co",   logo: "R",  arr: "$0.9M",  country: "Canada",  employees: "40",   stage: "Seed"     },
  { name: "Substrate",  logo: "S",  arr: "$5.2M",  country: "Singapore","employees":"310", stage: "Series B" },
];

const COLS = ["Company", "ARR", "Country", "Employees", "Stage"];

type RowState = "empty" | "enriching" | "enriched";

function LogoBadge({ letter }: { letter: string }) {
  const colors: Record<string, string> = {
    L: "bg-violet-500/20 text-violet-300",
    F: "bg-zinc-200/60 text-pink-300",
    V: "bg-slate-500/20 text-slate-300",
    R: "bg-emerald-500/20 text-emerald-300",
    S: "bg-emerald-100 text-green-300",
  };
  return (
    <span className={`inline-flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold ${colors[letter] ?? "bg-indigo-500/20 text-indigo-300"}`}>
      {letter}
    </span>
  );
}

export function CrmGridDemo() {
  const [rowStates, setRowStates] = useState<RowState[]>(RECORDS.map(() => "empty"));
  const [activeRow, setActiveRow] = useState(0);

  useEffect(() => {
    let row = 0;
    const cycle = () => {
      // Reset all
      setRowStates(RECORDS.map(() => "empty"));
      setActiveRow(0);
      row = 0;

      const enrichNext = () => {
        if (row >= RECORDS.length) {
          setTimeout(cycle, 2400);
          return;
        }
        setActiveRow(row);
        setRowStates(prev => { const n = [...prev]; n[row] = "enriching"; return n; });
        setTimeout(() => {
          setRowStates(prev => { const n = [...prev]; n[row] = "enriched"; return n; });
          row++;
          setTimeout(enrichNext, 600);
        }, 900);
      };
      enrichNext();
    };
    const t = setTimeout(cycle, 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="w-full overflow-hidden rounded-xl border border-white/[.07] bg-[#080a10] shadow-2xl">
      {/* Window chrome */}
      <div className="flex items-center gap-1.5 border-b border-white/[.06] bg-[#0a0c14] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-300"/>
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-300"/>
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-300"/>
        <span className="ml-3 text-[10px] text-slate-600">Companies — Mondaily Graph</span>
      </div>

      {/* Table */}
      <div className="overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-white/[.05]">
              {COLS.map(c => (
                <th key={c} className="px-3 py-2 text-left font-medium uppercase tracking-widest text-slate-700 first:pl-4">
                  {c}
                </th>
              ))}
              <th className="px-3 py-2 text-left font-medium uppercase tracking-widest text-slate-700">Status</th>
            </tr>
          </thead>
          <tbody>
            {RECORDS.map((rec, i) => {
              const state = rowStates[i] ?? "empty";
              const isActive = i === activeRow && state !== "enriched";
              return (
                <motion.tr
                  key={rec.name}
                  className={`border-b border-white/[.04] transition-colors ${isActive ? "bg-indigo-500/[.04]" : ""}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08, duration: 0.4 }}
                >
                  {/* Name */}
                  <td className="pl-4 pr-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <LogoBadge letter={rec.logo} />
                      <span className="font-medium text-white">{rec.name}</span>
                    </div>
                  </td>

                  {/* ARR */}
                  <td className="px-3 py-2.5">
                    <AnimatePresence mode="wait">
                      {state === "enriched" ? (
                        <motion.span
                          key="val"
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="font-mono font-semibold text-emerald-400"
                        >
                          {rec.arr}
                        </motion.span>
                      ) : state === "enriching" ? (
                        <motion.span key="loading" className="flex items-center gap-1 text-indigo-400">
                          <motion.span
                            animate={{ opacity: [0.3, 1, 0.3] }}
                            transition={{ duration: 0.8, repeat: Infinity }}
                          >
                            ···
                          </motion.span>
                        </motion.span>
                      ) : (
                        <span key="empty" className="text-slate-700">—</span>
                      )}
                    </AnimatePresence>
                  </td>

                  {/* Country */}
                  <td className="px-3 py-2.5">
                    <AnimatePresence mode="wait">
                      {state === "enriched" ? (
                        <motion.span key="val" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-slate-300">
                          {rec.country}
                        </motion.span>
                      ) : (
                        <span key="empty" className="text-slate-700">—</span>
                      )}
                    </AnimatePresence>
                  </td>

                  {/* Employees */}
                  <td className="px-3 py-2.5">
                    <AnimatePresence mode="wait">
                      {state === "enriched" ? (
                        <motion.span key="val" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-slate-300">
                          {rec.employees}
                        </motion.span>
                      ) : (
                        <span key="empty" className="text-slate-700">—</span>
                      )}
                    </AnimatePresence>
                  </td>

                  {/* Stage */}
                  <td className="px-3 py-2.5">
                    <AnimatePresence mode="wait">
                      {state === "enriched" ? (
                        <motion.span key="val" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-slate-400">
                          {rec.stage}
                        </motion.span>
                      ) : (
                        <span key="empty" className="text-slate-700">—</span>
                      )}
                    </AnimatePresence>
                  </td>

                  {/* Status badge */}
                  <td className="px-3 py-2.5">
                    <AnimatePresence mode="wait">
                      {state === "enriched" && (
                        <motion.span
                          key="badge"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-400"
                        >
                          <SparklesIcon size={8} /> AI Enriched
                        </motion.span>
                      )}
                      {state === "enriching" && (
                        <motion.span
                          key="enriching"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="inline-flex items-center gap-1 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 text-[9px] font-semibold text-indigo-400"
                        >
                          <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                            <SparklesIcon size={8} />
                          </motion.span>
                          Enriching…
                        </motion.span>
                      )}
                      {state === "empty" && (
                        <span key="empty" className="text-slate-700 text-[10px]">—</span>
                      )}
                    </AnimatePresence>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
