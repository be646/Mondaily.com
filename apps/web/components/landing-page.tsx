"use client";
import { motion } from "framer-motion";
import Link from "next/link";
import { MondailyLogo } from "./mondaily-logo";
import { CrmGridDemo } from "./crm-grid-demo";
import { PipelineDemo } from "./pipeline-demo";
import { WorkflowDemo } from "./workflow-demo";
import { ChatWidget } from "./chat-widget";

// ── Inline SVG icons (no lucide dep) ─────────────────────────────────────────
function ArrowRightIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>;
}
function DatabaseIcon({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>;
}
function ZapIcon({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>;
}
function GitBranchIcon({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>;
}
function SparklesIcon({ size = 11 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>;
}
function ChevronRightIcon({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>;
}

// ── Fade-up animation variant ─────────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show:   { opacity: 1, y: 0 },
};

// ── Nav ────────────────────────────────────────────────────────────────────────
function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-14 items-center justify-between border-b border-white/[.05] bg-[#060608]/80 px-6 backdrop-blur-md">
      <MondailyLogo size={34} showWordmark />

      <nav className="hidden items-center gap-6 md:flex">
        {[
          { label: "Features", href: "#features" },
          { label: "Pipeline", href: "#pipeline" },
          { label: "Automations", href: "#automations" },
        ].map(item => (
          <a key={item.label} href={item.href} className="text-[13px] text-slate-500 transition-colors hover:text-slate-200">
            {item.label}
          </a>
        ))}
      </nav>

      <div className="flex items-center gap-3">
        <Link
          href="/sign-in"
          className="text-[13px] font-medium text-slate-400 transition-colors hover:text-white"
        >
          Sign in
        </Link>
        <Link
          href="/sign-up"
          className="flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-1.5 text-[13px] font-semibold text-black transition-all hover:bg-slate-100 active:scale-[.97]"
        >
          Get started <ChevronRightIcon size={12}/>
        </Link>
      </div>
    </header>
  );
}

// ── Feature pill ──────────────────────────────────────────────────────────────
function FeaturePill({ icon: Icon, label, color }: { icon: React.ElementType; label: string; color: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium ${color}`}>
      <Icon size={12}/> {label}
    </div>
  );
}

// ── Centered demo block ───────────────────────────────────────────────────────
function DemoBlock({
  id, tag, tagColor, title, description, children,
}: {
  id?: string;
  tag: string;
  tagColor: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      id={id}
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center gap-8"
    >
      {/* Text block — centered */}
      <div className="max-w-2xl text-center space-y-3">
        <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${tagColor}`}>
          {tag}
        </span>
        <h3 className="text-2xl font-semibold tracking-tight text-white">{title}</h3>
        <p className="text-slate-500 leading-relaxed">{description}</p>
      </div>
      {/* Demo — full width, max 900px */}
      <div className="w-full max-w-[900px]">
        {children}
      </div>
    </motion.div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function LandingPage() {
  return (
    <div className="min-h-screen bg-[#060608] text-zinc-100 antialiased">
      <Nav />

      {/* ── HERO ──────────────────────────────────────────────────────────────── */}
      <section className="relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pt-14">
        {/* Mesh grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.018]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        {/* Subtle radial glows */}
        <div className="pointer-events-none absolute left-1/2 top-1/3 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600/[.05] blur-[140px]"/>
        <div className="pointer-events-none absolute right-1/3 bottom-1/4 h-[400px] w-[400px] rounded-full bg-purple-700/[.04] blur-[100px]"/>

        {/* Logo — large, centered above headline */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="mb-8"
        >
          <MondailyLogo size={64} />
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-3xl text-center text-[clamp(2.6rem,6vw,4.2rem)] font-bold leading-[1.07] tracking-[-0.03em] text-white"
        >
          The Autonomous
          <br/>
          <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            AI Workspace Platform
          </span>
        </motion.h1>

        {/* Sub copy */}
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-5 max-w-xl text-center text-[1.0625rem] leading-relaxed text-slate-500"
        >
          Unified relational tables, web-agent enrichment, and event-driven automation
          pipelines — orchestrated by AI so your team never does repetitive work again.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.45 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <Link
            href="/sign-up"
            className="flex items-center gap-2 rounded-xl bg-white px-6 py-2.5 text-sm font-semibold text-black transition-all hover:bg-slate-100 active:scale-[.97]"
          >
            Launch App <ArrowRightIcon size={14}/>
          </Link>
          <a
            href="#features"
            className="flex items-center gap-2 rounded-xl border border-white/[.10] bg-white/[.03] px-6 py-2.5 text-sm font-medium text-slate-300 transition-all hover:bg-white/[.07] hover:text-white"
          >
            See how it works
          </a>
        </motion.div>

        {/* Feature pills */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.65 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-2"
        >
          <FeaturePill icon={DatabaseIcon}  label="Relational CRM Tables"      color="border-slate-700/60 bg-slate-800/40 text-slate-400" />
          <FeaturePill icon={SparklesIcon}  label="AI Web Enrichment"           color="border-purple-500/20 bg-purple-500/[.06] text-purple-400" />
          <FeaturePill icon={GitBranchIcon} label="Event Automation Pipelines"  color="border-blue-500/20 bg-blue-500/[.06] text-blue-400" />
          <FeaturePill icon={ZapIcon}       label="Autonomous Sequences"        color="border-pink-500/20 bg-pink-500/[.06] text-pink-400" />
        </motion.div>

        {/* Scroll nudge */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 1.0 }}
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

      {/* ── DEMOS — full-width centered ───────────────────────────────────────── */}
      <section id="features" className="space-y-32 px-6 py-32">

        {/* Section intro */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-xl text-center"
        >
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/[.07] bg-white/[.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            <SparklesIcon size={10}/> Live Product Demos
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            Watch Mondaily work in real time
          </h2>
          <p className="mt-3 text-slate-500">
            Every animation is a faithful simulation of actual product behavior — no mockups.
          </p>
        </motion.div>

        {/* CRM Grid */}
        <DemoBlock
          id="crm"
          tag="CRM Engine"
          tagColor="border-purple-500/20 bg-purple-500/[.06] text-purple-400"
          title="Living relational records — enriched by AI automatically"
          description="Drop a company name and watch Mondaily's web agents fetch ARR, headcount, funding round, country, and more — filling every empty cell in seconds."
        >
          <CrmGridDemo />
        </DemoBlock>

        {/* Pipeline */}
        <DemoBlock
          id="pipeline"
          tag="Sales Pipeline"
          tagColor="border-emerald-500/20 bg-emerald-500/[.06] text-emerald-400"
          title="Kanban deal tracking with live aggregate math"
          description="Visualize your entire pipeline at a glance. Move deals across stages and watch totals update instantly. Mondaily auto-assigns owners and triggers follow-up sequences."
        >
          <PipelineDemo />
        </DemoBlock>

        {/* Workflow */}
        <DemoBlock
          id="automations"
          tag="Automation Engine"
          tagColor="border-blue-500/20 bg-blue-500/[.06] text-blue-400"
          title="Event-driven workflows — no code, full power"
          description="Chain triggers, conditions, and actions into autonomous pipelines. When a deal closes above $50K, Mondaily automatically enrolls the contact in your Enterprise email sequence."
        >
          {/* Workflow demo centered with max width for readability */}
          <div className="mx-auto max-w-[480px]">
            <WorkflowDemo />
          </div>
        </DemoBlock>
      </section>

      {/* ── CTA BANNER ────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-white/[.05]">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-indigo-600/[.03] to-transparent"/>
        <div className="mx-auto max-w-2xl px-6 py-28 text-center">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            transition={{ duration: 0.55 }}
          >
            <MondailyLogo size={52} className="mx-auto mb-6"/>
            <h2 className="text-3xl font-semibold tracking-tight text-white">
              Your entire business, run by AI
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-slate-500">
              Join forward-thinking teams replacing manual CRM work, spreadsheet maintenance,
              and repetitive outreach with one autonomous AI workspace.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/sign-up"
                className="flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black transition-all hover:bg-slate-100 active:scale-[.97]"
              >
                Start for free <ArrowRightIcon size={14}/>
              </Link>
              <Link
                href="/sign-in"
                className="flex items-center gap-2 rounded-xl border border-white/[.10] bg-white/[.03] px-6 py-3 text-sm font-medium text-slate-300 transition-all hover:bg-white/[.07] hover:text-white"
              >
                Sign in
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/[.04] px-6 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <MondailyLogo size={30} showWordmark />
          <p className="text-[12px] text-slate-700">© 2026 Mondaily · Built with AI</p>
          <div className="flex items-center gap-5">
            {["Privacy", "Terms", "Docs"].map(l => (
              <a key={l} href="#" className="text-[12px] text-slate-700 hover:text-slate-400 transition-colors">{l}</a>
            ))}
          </div>
        </div>
      </footer>

      {/* ── CHAT WIDGET ───────────────────────────────────────────────────────── */}
      <ChatWidget />
    </div>
  );
}
