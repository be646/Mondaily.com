"use client";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Nav } from "./nav";

const TYPING_PHRASES = [
  "Find at-risk deals, draft follow-ups, and assign next steps.",
  "Summarize this week's pipeline and flag stalled deals.",
  "Draft a follow-up email for the Acme Corp meeting.",
  "Which HR candidates need a response today?",
  "Show me overdue invoices and suggest next actions.",
];

function TypingText() {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [displayed, setDisplayed] = useState("");
  const [typing, setTyping] = useState(true);

  useEffect(() => {
    const phrase = TYPING_PHRASES[phraseIndex] ?? "";
    if (typing) {
      if (displayed.length < phrase.length) {
        const t = setTimeout(() => setDisplayed(phrase.slice(0, displayed.length + 1)), 28);
        return () => clearTimeout(t);
      } else {
        const t = setTimeout(() => setTyping(false), 2000);
        return () => clearTimeout(t);
      }
    } else {
      if (displayed.length > 0) {
        const t = setTimeout(() => setDisplayed(displayed.slice(0, -1)), 14);
        return () => clearTimeout(t);
      } else {
        setPhraseIndex((i) => (i + 1) % TYPING_PHRASES.length);
        setTyping(true);
      }
    }
  }, [displayed, typing, phraseIndex]);

  return (
    <span>
      {displayed}
      <span className="animate-pulse text-red-400">|</span>
    </span>
  );
}

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.12, duration: 0.55, ease: "easeOut" as const } }),
};

export function Hero() {
  return (
    <section className="min-h-screen bg-[radial-gradient(circle_at_20%_0%,rgba(239,68,68,.18),transparent_30%),#090b0f]">
      <Nav />
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
        <div>
          <motion.p custom={0} variants={fadeUp} initial="hidden" animate="show"
            className="text-sm font-semibold uppercase tracking-[0.2em] text-red-400">
            Fully AI, not AI-assisted
          </motion.p>
          <motion.h1 custom={1} variants={fadeUp} initial="hidden" animate="show"
            className="mt-5 text-5xl font-semibold tracking-tight md:text-7xl">
            Your entire business, run by AI.
          </motion.h1>
          <motion.p custom={2} variants={fadeUp} initial="hidden" animate="show"
            className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            Mondaily is the fully AI business operating system for sales, real estate, HR, finance, investments, and operations.
          </motion.p>
          <motion.div custom={3} variants={fadeUp} initial="hidden" animate="show"
            className="mt-8 flex gap-3">
            <a className="rounded-xl bg-red-500 px-5 py-3 text-sm font-semibold text-white transition-all hover:bg-red-400 hover:scale-105"
              href="https://app.mondaily.com/sign-up">Start for free</a>
            <a className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-200 transition-all hover:border-white/30 hover:bg-white/5"
              href="#features">Explore features</a>
          </motion.div>
        </div>
        <motion.div custom={4} variants={fadeUp} initial="hidden" animate="show"
          className="rounded-3xl border border-white/10 bg-white/[.04] p-4">
          <div className="rounded-2xl border border-white/10 bg-[#101216] p-4">
            <div className="mb-4 text-sm text-slate-400">Ask Mondaily</div>
            <div className="min-h-[60px] rounded-xl border border-white/10 bg-black/20 p-4 text-slate-200">
              <TypingText />
            </div>
            <div className="mt-4 grid gap-2">
              {["Pipeline analysis", "AI drafted follow-up", "Revenue forecast"].map((item, i) => (
                <motion.div key={item} custom={5 + i} variants={fadeUp} initial="hidden" animate="show"
                  className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 transition-all hover:border-red-500/30 hover:bg-white/5 cursor-pointer">
                  {item}
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
