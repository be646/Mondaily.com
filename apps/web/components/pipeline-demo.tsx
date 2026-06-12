"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

const STAGES = ["Lead", "Qualified", "In Progress", "Proposal", "Closed Won"];

interface Deal {
  id: string;
  name: string;
  value: string;
  rawValue: number;
  company: string;
  owner: string;
  color: string;
}

const ALL_DEALS: Record<string, Deal[]> = {
  "Lead":        [{ id: "d1", name: "Growth Retainer", value: "$12K", rawValue: 12000, company: "Notion", owner: "AK", color: "bg-violet-500/20 text-violet-300" }],
  "Qualified":   [{ id: "d2", name: "API Integration", value: "$28K", rawValue: 28000, company: "Linear", owner: "SM", color: "bg-blue-500/20 text-blue-300" }],
  "In Progress": [{ id: "d3", name: "Enterprise License", value: "$84K", rawValue: 84000, company: "Stripe", owner: "DN", color: "bg-indigo-500/20 text-indigo-300" }],
  "Proposal":    [{ id: "d4", name: "Platform Rollout", value: "$55K", rawValue: 55000, company: "Vercel", owner: "JL", color: "bg-pink-500/20 text-pink-300" }],
  "Closed Won":  [],
};

function fmt(n: number) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n}`;
}

function DealCard({ deal, won }: { deal: Deal; won: boolean }) {
  return (
    <div className={`rounded-lg border p-2.5 transition-all duration-500 ${won ? "border-emerald-500/30 bg-emerald-500/[.06]" : "border-white/[.07] bg-white/[.02]"}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold text-white">{deal.name}</span>
        <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold ${won ? "bg-emerald-500/20 text-emerald-400" : deal.color}`}>
          {deal.company}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className={`font-mono text-xs font-bold ${won ? "text-emerald-400" : "text-slate-300"}`}>{deal.value}</span>
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/[.06] text-[8px] font-bold text-slate-400">
          {deal.owner}
        </span>
      </div>
    </div>
  );
}

export function PipelineDemo() {
  const [columns, setColumns] = useState(ALL_DEALS);
  const [totalWon, setTotalWon] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [wonDeal, setWonDeal] = useState<Deal | null>(null);

  useEffect(() => {
    const run = () => {
      // Reset
      setColumns(ALL_DEALS);
      setTotalWon(0);
      setWonDeal(null);

      setTimeout(() => {
        setAnimating(true);
        const moving = ALL_DEALS["In Progress"]![0]!;

        // Remove from In Progress
        setColumns(prev => ({
          ...prev,
          "In Progress": prev["In Progress"]!.filter(d => d.id !== moving.id),
        }));

        setTimeout(() => {
          // Add to Closed Won
          setColumns(prev => ({
            ...prev,
            "Closed Won": [moving],
          }));
          setWonDeal(moving);
          setTotalWon(moving.rawValue);
          setAnimating(false);
          setTimeout(run, 3200);
        }, 900);
      }, 2000);
    };

    const t = setTimeout(run, 600);
    return () => clearTimeout(t);
  }, []);

  const totalPipeline = Object.values(columns).flat().reduce((s, d) => s + d.rawValue, 0);

  return (
    <div className="w-full overflow-hidden rounded-xl border border-white/[.07] bg-[#080a10] shadow-2xl">
      {/* Chrome */}
      <div className="flex items-center justify-between border-b border-white/[.06] bg-[#0a0c14] px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500/70"/>
          <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70"/>
          <span className="h-2.5 w-2.5 rounded-full bg-green-500/70"/>
          <span className="ml-3 text-[10px] text-slate-600">Sales Pipeline</span>
        </div>
        {/* Live stats */}
        <div className="flex items-center gap-4 text-[10px]">
          <span className="text-slate-600">
            Pipeline: <motion.span
              className="font-mono font-semibold text-slate-300"
              key={totalPipeline}
              animate={{ opacity: [0.4, 1] }}
              transition={{ duration: 0.3 }}
            >
              {fmt(totalPipeline)}
            </motion.span>
          </span>
          <span className="text-slate-600">
            Won: <motion.span
              className="font-mono font-semibold text-emerald-400"
              key={totalWon}
              animate={{ scale: totalWon > 0 ? [1.2, 1] : 1, opacity: [0.5, 1] }}
              transition={{ duration: 0.4 }}
            >
              {fmt(totalWon)}
            </motion.span>
          </span>
        </div>
      </div>

      {/* Kanban */}
      <div className="flex gap-0 overflow-x-auto p-3">
        {STAGES.map(stage => {
          const deals = columns[stage] ?? [];
          const isWon = stage === "Closed Won";
          return (
            <div key={stage} className="min-w-[130px] flex-1 px-1.5">
              <div className="mb-2 flex items-center justify-between">
                <span className={`text-[9px] font-semibold uppercase tracking-widest ${isWon ? "text-emerald-500" : "text-slate-600"}`}>
                  {stage}
                </span>
                <span className="rounded-full bg-white/[.05] px-1.5 py-0.5 text-[8px] text-slate-600">
                  {deals.length}
                </span>
              </div>
              <div className="min-h-[80px] space-y-2 rounded-lg border border-white/[.04] bg-white/[.01] p-1.5">
                <AnimatePresence>
                  {deals.map(deal => (
                    <motion.div
                      key={deal.id}
                      layout
                      initial={{ opacity: 0, scale: 0.92, y: -8 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.88, y: 8 }}
                      transition={{ duration: 0.45, ease: [0.34, 1.56, 0.64, 1] }}
                    >
                      <DealCard deal={deal} won={isWon && wonDeal?.id === deal.id} />
                    </motion.div>
                  ))}
                </AnimatePresence>

                {deals.length === 0 && stage === "In Progress" && animating && (
                  <motion.div
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="h-16 rounded-lg border border-dashed border-indigo-500/20 bg-indigo-500/[.03]"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
