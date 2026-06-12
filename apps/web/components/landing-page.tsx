"use client";
import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Database, Zap, GitBranch, Sparkles, ChevronRight } from "lucide-react";
import { MondailyLogo } from "./mondaily-logo";
import { CrmGridDemo } from "./crm-grid-demo";
import { PipelineDemo } from "./pipeline-demo";
import { WorkflowDemo } from "./workflow-demo";

// ── Shared fade-up variant ─────────────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show:   { opacity: 1, y: 0 },
};

// ── Nav ────────────────────────────────────────────────────────────────────────
function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-14 items-center justify-between border-b border-white/[.05] bg-[#060608]/80 px-6 backdrop-blur-md">
      <MondailyLogo size={30} showWordmark />

      <nav className="hidden items-center gap-6 md:flex">
        {["Features", "Pricing", "Docs", "Blog"].map(item => (
          <a key={item} href="#" className="text-[13px] text-slate-500 transition-colors hover:text-slate-200">
            {item}
          </a>
        ))}
      </nav>

      <div className="flex items-center gap-3">
        <Link
          href="/sign-in"
          className="text-[13px] text-slate-400 transition-colors hover:text-white"
        >
          Sign in
        </Link>
        <Link
          href="/sign-up"
          className="flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3.5 py-1.5 text-[13px] font-medium text-indigo-300 transition-all hover:bg-indigo-500/20 hover:text-white"
        >
          Get started <ChevronRight size={12}/>
        </Link>
      </div>
    </header>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/[.07] bg-white/[.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
      {children}
    </div>
  );
}

// ── Feature card pill ──────────────────────────────────────────────────────────
function FeaturePill({ icon: Icon, label, color }: { icon: React.ElementType; label: string; color: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium ${color}`}>
      <Icon size={12}/> {label}
    </div>
  );
}

// ── Demo section ───────────────────────────────────────────────────────────────
function DemoSection({
  tag, title, description, color, children,
}: {
  tag: string; title: string; description: string; color: string; children: React.ReactNode;
}) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-12"
    >
      {/* Text side */}
      <div className="flex-1 space-y-4">
        <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${color}`}>
          {tag}
        </span>
        <h3 className="text-2xl font-semibold tracking-tight text-white">{title}</h3>
        <p className="leading-relaxed text-slate-500">{description}</p>
      </div>
      {/* Demo side */}
      <div className="flex-1 min-w-0">{children}</div>
    </motion.div>
  );
}

// ── Main landing page ──────────────────────────────────────────────────────────
export function LandingPage() {
  return (
    <div className="min-h-screen bg-[#060608] text-zinc-100 antialiased">
      <Nav />

      {/* ── HERO ──────────────────────────────────────────────────────────────── */}
      <section className="relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pt-14">
        {/* Mesh grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* Radial glows */}
        <div className="pointer-events-none absolute left-1/2 top-1/4 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600/[.06] blur-[120px]"/>
        <div className="pointer-events-none absolute left-1/3 top-2/3 h-[400px] w-[400px] rounded-full bg-purple-600/[.05] blur-[100px]"/>
        <div className="pointer-events-none absolute right-1/4 top-1/3 h-[300px] w-[300px] rounded-full bg-pink-600/[.04] blur-[90px]"/>

        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mb-6 flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/[.06] px-4 py-1.5 text-[11px] font-medium text-indigo-300"
        >
          <motion.span
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Sparkles size={11}/>
          </motion.span>
          Powered by Claude · Web Agents · Event Pipelines
          <ArrowRight size={11} className="opacity-50"/>
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-3xl text-center text-[clamp(2.4rem,6vw,4rem)] font-bold leading-[1.08] tracking-[-0.03em] text-white"
        >
          The Autonomous
          <br/>
          <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            AI Workspace Platform
          </span>
        </motion.h1>

        {/* Sub copy */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.35 }}
          className="mt-5 max-w-xl text-center text-[1.0625rem] leading-relaxed text-slate-500"
        >
          Unified relational tables, web-agent enrichment, and event-driven automation
          pipelines — all orchestrated by AI so your team never does repetitive work again.
        </motion.p>

        {/* CTA buttons */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.5 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <Link
            href="/sign-up"
            className="flex items-center gap-2 rounded-xl border-x border-t border-indigo-400/50 border-b-[3px] border-b-indigo-700 bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 transition-all hover:bg-indigo-500 active:translate-y-[1px]"
          >
            Launch App <ArrowRight size={14}/>
          </Link>
          <a
            href="#features"
            className="flex items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.03] px-5 py-2.5 text-sm font-medium text-slate-300 transition-all hover:bg-white/[.06] hover:text-white"
          >
            Explore Features
          </a>
        </motion.div>

        {/* Feature pills */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.7 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-2"
        >
          <FeaturePill icon={Database}   label="Relational CRM Tables"   color="border-slate-700/60 bg-slate-800/40 text-slate-400" />
          <FeaturePill icon={Sparkles}   label="AI Web Enrichment"        color="border-purple-500/20 bg-purple-500/[.06] text-purple-400" />
          <FeaturePill icon={GitBranch}  label="Event Automation Pipelines" color="border-blue-500/20 bg-blue-500/[.06] text-blue-400" />
          <FeaturePill icon={Zap}        label="Autonomous Sequences"     color="border-pink-500/20 bg-pink-500/[.06] text-pink-400" />
        </motion.div>

        {/* Scroll nudge */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 1.1 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
        >
          <motion.div
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            className="flex h-8 w-5 items-start justify-center rounded-full border border-white/[.10] pt-1.5"
          >
            <div className="h-1.5 w-0.5 rounded-full bg-white/20"/>
          </motion.div>
        </motion.div>
      </section>

      {/* ── PRODUCT DEMOS ─────────────────────────────────────────────────────── */}
      <section id="features" className="mx-auto max-w-6xl space-y-28 px-6 py-28">

        {/* Section header */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <SectionLabel><Sparkles size={10}/> Live Product Demos</SectionLabel>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            Watch Mondaily work in real time
          </h2>
          <p className="mt-3 text-slate-500">
            Every animation below is a faithful simulation of actual product behavior — no mockups.
          </p>
        </motion.div>

        {/* CRM Grid */}
        <DemoSection
          tag="CRM Engine"
          title="Living relational records — enriched by AI automatically"
          description="Drop a company name and watch Mondaily's web agents fetch ARR, headcount, funding round, country, and more — filling every empty cell in seconds. No more copy-pasting from LinkedIn or Crunchbase."
          color="border-purple-500/20 bg-purple-500/[.06] text-purple-400"
        >
          <CrmGridDemo />
        </DemoSection>

        {/* Pipeline */}
        <DemoSection
          tag="Sales Pipeline"
          title="Kanban deal tracking with live aggregate math"
          description="Visualize your entire pipeline at a glance. Move deals across stages and watch totals update instantly. Mondaily auto-assigns owners, triggers follow-up sequences, and logs every transition to the activity feed."
          color="border-emerald-500/20 bg-emerald-500/[.06] text-emerald-400"
        >
          <PipelineDemo />
        </DemoSection>

        {/* Workflow */}
        <DemoSection
          tag="Automation Engine"
          title="Event-driven workflows — no code, full power"
          description="Chain triggers, conditions, and actions into autonomous pipelines. When a deal closes above $50K, Mondaily automatically enrolls the contact in your Enterprise email sequence — zero manual work."
          color="border-blue-500/20 bg-blue-500/[.06] text-blue-400"
        >
          <WorkflowDemo />
        </DemoSection>
      </section>

      {/* ── CTA BANNER ────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-white/[.05]">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-indigo-600/[.04] to-transparent"/>
        <div className="mx-auto max-w-3xl px-6 py-28 text-center">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            transition={{ duration: 0.55 }}
          >
            <MondailyLogo size={44} className="mx-auto mb-6"/>
            <h2 className="text-3xl font-semibold tracking-tight text-white">
              Your entire business, run by AI
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-slate-500">
              Join forward-thinking teams replacing manual CRM work, spreadsheet maintenance, and
              repetitive outreach with one autonomous AI workspace.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/sign-up"
                className="flex items-center gap-2 rounded-xl border-x border-t border-indigo-400/50 border-b-[3px] border-b-indigo-700 bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition-all hover:bg-indigo-500"
              >
                Start for free <ArrowRight size={14}/>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/[.04] px-6 py-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <MondailyLogo size={28} showWordmark />
          <p className="text-[12px] text-slate-700">© 2026 Mondaily · Built with AI</p>
          <div className="flex items-center gap-5">
            {["Privacy", "Terms", "Docs"].map(l => (
              <a key={l} href="#" className="text-[12px] text-slate-700 hover:text-slate-400 transition-colors">{l}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
