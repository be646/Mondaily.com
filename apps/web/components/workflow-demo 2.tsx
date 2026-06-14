"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
function GitBranchIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>;
}
function FilterIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>;
}
function MailIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>;
}
function ZapIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>;
}

type NodeState = "idle" | "active" | "done";

interface WNode {
  id: number;
  kind: "trigger" | "condition" | "action";
  icon: React.ElementType;
  label: string;
  sub: string;
}

const NODES: WNode[] = [
  { id: 0, kind: "trigger",   icon: GitBranchIcon, label: "Deal Stage Equals Won",           sub: "Trigger" },
  { id: 1, kind: "condition", icon: FilterIcon,    label: "Deal Value > $50K",                sub: "Condition" },
  { id: 2, kind: "action",    icon: MailIcon,      label: "Enroll in Enterprise Sequence",    sub: "Action" },
];

const KIND_STYLE = {
  trigger:   { ring: "border-red-500/60",    glow: "shadow-[0_0_16px_rgba(239,68,68,0.25)]",    bg: "bg-red-500/[.07]",    text: "text-red-400",    dot: "bg-red-500"    },
  condition: { ring: "border-yellow-500/60", glow: "shadow-[0_0_16px_rgba(234,179,8,0.25)]",    bg: "bg-yellow-500/[.07]", text: "text-yellow-400", dot: "bg-yellow-400" },
  action:    { ring: "border-blue-500/60",   glow: "shadow-[0_0_16px_rgba(59,130,246,0.25)]",   bg: "bg-blue-500/[.07]",   text: "text-blue-400",   dot: "bg-blue-500"   },
};

const IDLE_STYLE = {
  border: "border-white/[.07]",
  bg:     "bg-white/[.02]",
};

function EmailPreview() {
  return (
    <motion.div
      initial={{ opacity: 0, x: 24, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 16, scale: 0.95 }}
      transition={{ duration: 0.45, ease: [0.34, 1.1, 0.64, 1] }}
      className="absolute left-[calc(100%+12px)] top-0 w-44 rounded-lg border border-blue-500/20 bg-[#080c18] p-3 shadow-xl"
    >
      <div className="mb-2 flex items-center gap-1.5 text-[9px] text-blue-400">
        <MailIcon size={9}/> Sending now…
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between text-[9px]">
          <span className="text-slate-600">To:</span>
          <span className="text-slate-400 font-mono">ceo@stripe.com</span>
        </div>
        <div className="flex justify-between text-[9px]">
          <span className="text-slate-600">Subject:</span>
          <span className="text-slate-300">Welcome to Enterprise</span>
        </div>
        <div className="mt-2 rounded bg-white/[.03] p-1.5 text-[8px] text-slate-500 leading-relaxed">
          Hi Sarah, congratulations on your new plan…
        </div>
        <div className="flex items-center gap-1 text-[8px] text-emerald-400">
          <motion.span
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          >
            ●
          </motion.span>
          Delivered
        </div>
      </div>
    </motion.div>
  );
}

export function WorkflowDemo() {
  const [states, setStates] = useState<NodeState[]>([0, 1, 2].map(() => "idle"));
  const [pulseY, setPulseY] = useState<number | null>(null);
  const [showEmail, setShowEmail] = useState(false);

  useEffect(() => {
    const cycle = () => {
      setStates(["idle", "idle", "idle"]);
      setShowEmail(false);
      setPulseY(null);

      const activate = (i: number) => {
        setPulseY(i);
        setStates(prev => { const n = [...prev] as NodeState[]; n[i] = "active"; return n; });
        setTimeout(() => {
          setStates(prev => { const n = [...prev] as NodeState[]; n[i] = "done"; return n; });
          if (i === 2) {
            setShowEmail(true);
            setTimeout(() => { setShowEmail(false); setTimeout(cycle, 1200); }, 2600);
          } else {
            setTimeout(() => activate(i + 1), 700);
          }
        }, 900);
      };

      setTimeout(() => activate(0), 400);
    };

    const t = setTimeout(cycle, 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="w-full overflow-hidden rounded-xl border border-white/[.07] bg-[#080a10] shadow-2xl">
      {/* Chrome */}
      <div className="flex items-center gap-1.5 border-b border-white/[.06] bg-[#0a0c14] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500/70"/>
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70"/>
        <span className="h-2.5 w-2.5 rounded-full bg-green-500/70"/>
        <span className="ml-3 text-[10px] text-slate-600">Workflow Automation</span>
        <div className="ml-auto flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[8px] font-semibold text-emerald-400">
          <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.5, repeat: Infinity }}>●</motion.span>
          Live
        </div>
      </div>

      {/* Dot-grid canvas */}
      <div
        className="relative px-8 py-6"
        style={{
          backgroundImage: "radial-gradient(circle, #1e2030 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      >
        <div className="relative mx-auto w-56 flex flex-col items-center gap-0">
          {NODES.map((node, i) => {
            const state = states[i] ?? "idle";
            const s = KIND_STYLE[node.kind];
            const Icon = node.icon;
            const isActive = state === "active";
            const isDone   = state === "done";

            return (
              <div key={node.id} className="flex w-full flex-col items-center">
                {/* Wire above (skip first) */}
                {i > 0 && (
                  <div className="relative h-8 w-px bg-white/[.06]">
                    <AnimatePresence>
                      {pulseY !== null && pulseY >= i && (
                        <motion.div
                          className={`absolute top-0 h-full w-full ${s.dot}`}
                          initial={{ scaleY: 0, originY: 0 }}
                          animate={{ scaleY: 1 }}
                          transition={{ duration: 0.4, ease: "easeIn" }}
                        />
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* Node card */}
                <div className="relative w-full">
                  <motion.div
                    animate={isActive ? {
                      scale: [1, 1.02, 1],
                    } : {}}
                    transition={{ duration: 0.6, repeat: isActive ? Infinity : 0 }}
                    className={`relative overflow-hidden rounded-xl border px-3.5 py-3 transition-all duration-300 ${
                      isActive ? `${s.ring} ${s.glow} ${s.bg}` :
                      isDone   ? `border-white/[.09] bg-white/[.03]` :
                                 `${IDLE_STYLE.border} ${IDLE_STYLE.bg}`
                    }`}
                  >
                    {/* Active glow sweep */}
                    {isActive && (
                      <motion.div
                        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/[.03] to-transparent"
                        animate={{ x: ["-100%", "100%"] }}
                        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                      />
                    )}

                    <div className="flex items-center gap-2.5">
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors ${isActive ? `${s.ring} ${s.bg} ${s.text}` : "border-white/[.07] bg-white/[.03] text-slate-600"}`}>
                        <Icon size={13}/>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[9px] font-semibold uppercase tracking-widest transition-colors ${isActive ? s.text : isDone ? "text-slate-600" : "text-slate-700"}`}>
                          {node.sub}
                        </p>
                        <p className={`text-[11px] font-medium transition-colors ${isActive ? "text-white" : isDone ? "text-slate-400" : "text-slate-600"}`}>
                          {node.label}
                        </p>
                      </div>
                      {isDone && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400"
                        >
                          <svg viewBox="0 0 8 8" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                            <path d="M1.5 4L3 5.5 6.5 2"/>
                          </svg>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>

                  {/* Email preview flyout (action node) */}
                  {node.kind === "action" && (
                    <AnimatePresence>
                      {showEmail && <EmailPreview />}
                    </AnimatePresence>
                  )}
                </div>
              </div>
            );
          })}

          {/* End node */}
          <div className="mt-0 flex flex-col items-center">
            <div className="h-8 w-px bg-white/[.06]"/>
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[.07] bg-white/[.02] text-slate-700">
              <ZapIcon size={13}/>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
