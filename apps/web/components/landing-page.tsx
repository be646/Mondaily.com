"use client";
import { motion, useScroll, useTransform } from "framer-motion";
import Link from "next/link";
import { useRef } from "react";
import { MondailyLogo } from "./mondaily-logo";
import { CrmGridDemo } from "./crm-grid-demo";
import { PipelineDemo } from "./pipeline-demo";
import { WorkflowDemo } from "./workflow-demo";
import { HeroChat } from "./hero-chat";

// ── SVG icons ────────────────────────────────────────────────────────────────
function ArrowRight({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>;
}
function ChevronRight({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>;
}
function CheckIcon({ size = 13 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>;
}

const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};
const stagger = { show: { transition: { staggerChildren: 0.1 } } };

// ── Nav ───────────────────────────────────────────────────────────────────────
function Nav() {
  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-x-0 top-0 z-50 flex h-14 items-center justify-between border-b border-white/[.05] bg-[#060608]/75 px-6 backdrop-blur-xl"
    >
      <MondailyLogo size={32} showWordmark />
      <nav className="hidden items-center gap-7 md:flex">
        {[["#features","Features"],["#pipeline","Pipeline"],["#automations","Automations"]].map(([h, l]) => (
          <a key={l} href={h} className="text-[13px] text-slate-500 transition-colors hover:text-white">{l}</a>
        ))}
      </nav>
      <div className="flex items-center gap-3">
        <Link href="/sign-in" className="text-[13px] font-medium text-slate-400 transition-colors hover:text-white">
          Sign in
        </Link>
        <Link
          href="/sign-up"
          className="flex items-center gap-1.5 rounded-lg bg-white px-4 py-1.5 text-[13px] font-semibold text-black transition-all hover:bg-slate-100 active:scale-[.97]"
        >
          Get started <ChevronRight size={12}/>
        </Link>
      </div>
    </motion.header>
  );
}

// ── Stat badge ────────────────────────────────────────────────────────────────
function StatBadge({ value, label }: { value: string; label: string }) {
  return (
    <motion.div variants={fadeUp} className="flex flex-col items-center gap-1">
      <span className="text-2xl font-bold text-white tracking-tight">{value}</span>
      <span className="text-xs text-slate-600">{label}</span>
    </motion.div>
  );
}

// ── Feature row ───────────────────────────────────────────────────────────────
function FeatureRow({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {items.map(item => (
        <div key={item} className="flex items-center gap-1.5 text-[12px] text-slate-500">
          <CheckIcon size={11}/>
          {item}
        </div>
      ))}
    </div>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────
function SectionHead({ tag, tagColor, title, sub }: {
  tag: string; tagColor: string; title: string; sub: string;
}) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.3 }}
      className="mx-auto max-w-xl text-center space-y-3"
    >
      <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${tagColor}`}>
        {tag}
      </span>
      <h3 className="text-[1.75rem] font-bold tracking-tight text-white leading-snug">{title}</h3>
      <p className="text-slate-500 leading-relaxed text-[15px]">{sub}</p>
    </motion.div>
  );
}

// ── Bento card ────────────────────────────────────────────────────────────────
function BentoCard({ title, sub, icon, accent, children }: {
  title: string; sub: string; icon: string; accent: string; children?: React.ReactNode;
}) {
  return (
    <motion.div
      variants={fadeUp}
      className={`relative overflow-hidden rounded-2xl border border-white/[.07] bg-[#0b0d14] p-5 ${children ? "" : "flex flex-col justify-between"}`}
    >
      <div className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl border text-lg ${accent}`}>
        {icon}
      </div>
      <div>
        <p className="text-[14px] font-semibold text-white">{title}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-500">{sub}</p>
      </div>
      {children && <div className="mt-4">{children}</div>}
      {/* Corner glow */}
      <div className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl opacity-20 ${accent.includes('indigo') ? 'bg-indigo-500' : accent.includes('emerald') ? 'bg-emerald-500' : accent.includes('blue') ? 'bg-blue-500' : 'bg-purple-500'}`}/>
    </motion.div>
  );
}

// ── Scroll parallax demo wrapper ──────────────────────────────────────────────
function ParallaxDemo({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [30, -30]);
  return (
    <div ref={ref} className="w-full">
      <motion.div style={{ y }}>
        {children}
      </motion.div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function LandingPage() {
  return (
    <div className="min-h-screen bg-[#060608] text-zinc-100 antialiased overflow-x-hidden">
      <Nav />

      {/* ╔═ HERO ════════════════════════════════════════════════════════════╗ */}
      <section className="relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pb-16 pt-24">
        {/* Grid background */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.022]"
          style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.5) 1px,transparent 1px)", backgroundSize: "44px 44px" }}
        />
        {/* Ambient glows */}
        <div className="pointer-events-none absolute left-1/2 top-0 h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600/[.06] blur-[160px]"/>
        <div className="pointer-events-none absolute -left-32 bottom-0 h-[500px] w-[500px] rounded-full bg-violet-700/[.04] blur-[120px]"/>
        <div className="pointer-events-none absolute -right-32 top-1/2 h-[400px] w-[400px] rounded-full bg-blue-700/[.04] blur-[100px]"/>

        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mb-6 flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/[.07] px-4 py-1.5 text-[11px] font-medium text-indigo-300"
        >
          <motion.span
            className="h-1.5 w-1.5 rounded-full bg-indigo-400"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.8, repeat: Infinity }}
          />
          Powered by Claude AI · Autonomous by default
          <ArrowRight size={11}/>
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.18, ease: "easeOut" }}
          className="mb-5 max-w-3xl text-center text-[clamp(2.5rem,6vw,4.4rem)] font-bold leading-[1.06] tracking-[-0.035em] text-white"
        >
          Your entire business
          <br/>
          <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-pink-400 bg-clip-text text-transparent">
            run by AI
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mb-10 max-w-lg text-center text-[1.0625rem] leading-relaxed text-slate-500"
        >
          CRM, pipeline, sequences, and automations — all running autonomously.
          Ask the AI anything and watch it work in real time.
        </motion.p>

        {/* ── HERO CHAT ── */}
        <motion.div
          initial={{ opacity: 0, y: 28, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.42, ease: "easeOut" }}
          className="w-full"
        >
          <HeroChat />
        </motion.div>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.65 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <Link
            href="/sign-up"
            className="flex items-center gap-2 rounded-xl bg-white px-6 py-2.5 text-sm font-semibold text-black transition-all hover:bg-slate-100 active:scale-[.97] shadow-lg shadow-white/5"
          >
            Start for free <ArrowRight size={14}/>
          </Link>
          <Link
            href="/sign-in"
            className="flex items-center gap-2 rounded-xl border border-white/[.10] bg-white/[.03] px-6 py-2.5 text-sm font-medium text-slate-300 transition-all hover:bg-white/[.07] hover:text-white"
          >
            Sign in
          </Link>
        </motion.div>

        {/* Feature checklist */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.85 }}
          className="mt-8"
        >
          <FeatureRow items={["AI CRM enrichment","Sales pipeline","Email sequences","Workflow automation","CSV import","Team collaboration"]}/>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
        >
          <motion.div
            animate={{ y: [0, 7, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            className="flex h-8 w-5 items-start justify-center rounded-full border border-white/[.09] pt-1.5"
          >
            <div className="h-1.5 w-0.5 rounded-full bg-white/20"/>
          </motion.div>
        </motion.div>
      </section>

      {/* ╔═ STATS STRIP ═════════════════════════════════════════════════════╗ */}
      <section className="border-y border-white/[.04] bg-white/[.01] px-6 py-10">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="mx-auto grid max-w-3xl grid-cols-2 gap-8 md:grid-cols-4"
        >
          <StatBadge value="10×" label="Faster data entry with AI"/>
          <StatBadge value="100%" label="Autonomous enrichment"/>
          <StatBadge value="∞" label="Custom object types"/>
          <StatBadge value="0" label="Manual workflow steps"/>
        </motion.div>
      </section>

      {/* ╔═ BENTO FEATURES ══════════════════════════════════════════════════╗ */}
      <section id="features" className="mx-auto max-w-5xl px-6 py-24">
        <SectionHead
          tag="Platform"
          tagColor="border-indigo-500/20 bg-indigo-500/[.06] text-indigo-400"
          title="Everything your team needs. Nothing it doesn't."
          sub="Mondaily replaces five separate tools with one AI-native workspace that operates itself."
        />
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.1 }}
          className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <BentoCard icon="🧠" accent="border-indigo-500/20 bg-indigo-500/[.08] text-indigo-300" title="AI Web Enrichment" sub="Add a company name — Mondaily fetches ARR, headcount, funding, and 20+ fields from the web automatically."/>
          <BentoCard icon="📊" accent="border-purple-500/20 bg-purple-500/[.08] text-purple-300" title="Relational CRM Tables" sub="Spreadsheet-style views with linked objects, formula columns, sticky math, and real-time collaborative editing."/>
          <BentoCard icon="🔀" accent="border-blue-500/20 bg-blue-500/[.08] text-blue-300" title="Sales Pipeline" sub="Kanban deal stages with auto-updating totals. Deals move when signals fire — no drag and drop required."/>
          <BentoCard icon="📧" accent="border-pink-500/20 bg-pink-500/[.08] text-pink-300" title="Email Sequences" sub="Multi-step outreach sequences with send-window controls, reply detection, and per-contact personalization."/>
          <BentoCard icon="⚡" accent="border-yellow-500/20 bg-yellow-500/[.08] text-yellow-300" title="Workflow Automation" sub="Visual trigger → condition → action builder. No code. Runs on every deal, contact, or data change."/>
          <BentoCard icon="📁" accent="border-emerald-500/20 bg-emerald-500/[.08] text-emerald-300" title="CSV Ingestion" sub="Drop a spreadsheet and Claude infers every column type, bulk-inserts all rows, and backfills missing fields."/>
        </motion.div>
      </section>

      {/* ╔═ CRM DEMO ════════════════════════════════════════════════════════╗ */}
      <section className="border-t border-white/[.04] px-6 py-24">
        <div className="mx-auto max-w-5xl space-y-12">
          <SectionHead
            tag="CRM Engine"
            tagColor="border-purple-500/20 bg-purple-500/[.06] text-purple-400"
            title="Records that fill themselves"
            sub="Drop a company name. Watch every field populate in real time — ARR, employees, funding stage, and country pulled from the web by AI agents."
          />
          <ParallaxDemo><CrmGridDemo /></ParallaxDemo>
        </div>
      </section>

      {/* ╔═ PIPELINE DEMO ═══════════════════════════════════════════════════╗ */}
      <section id="pipeline" className="border-t border-white/[.04] bg-white/[.005] px-6 py-24">
        <div className="mx-auto max-w-5xl space-y-12">
          <SectionHead
            tag="Sales Pipeline"
            tagColor="border-emerald-500/20 bg-emerald-500/[.06] text-emerald-400"
            title="Live deal tracking with AI context"
            sub="Every deal stage transition is logged, every owner is auto-assigned, and aggregate totals update the moment anything moves."
          />
          <ParallaxDemo><PipelineDemo /></ParallaxDemo>
        </div>
      </section>

      {/* ╔═ WORKFLOW DEMO ════════════════════════════════════════════════════╗ */}
      <section id="automations" className="border-t border-white/[.04] px-6 py-24">
        <div className="mx-auto max-w-5xl space-y-12">
          <SectionHead
            tag="Automation Engine"
            tagColor="border-blue-500/20 bg-blue-500/[.06] text-blue-400"
            title="Events trigger everything"
            sub="Build workflows visually — trigger on any record change, apply conditions, fire actions. It runs 24/7 without you."
          />
          <div className="mx-auto max-w-md">
            <ParallaxDemo><WorkflowDemo /></ParallaxDemo>
          </div>
        </div>
      </section>

      {/* ╔═ CTA ══════════════════════════════════════════════════════════════╗ */}
      <section className="relative overflow-hidden border-t border-white/[.05] px-6 py-28">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-indigo-600/[.04] via-transparent to-transparent"/>
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600/[.05] blur-[120px]"/>
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="relative mx-auto max-w-2xl text-center space-y-6"
        >
          <motion.div variants={fadeUp} className="flex justify-center">
            <MondailyLogo size={56} />
          </motion.div>
          <motion.h2 variants={fadeUp} className="text-3xl font-bold tracking-tight text-white">
            Ready to run your business on autopilot?
          </motion.h2>
          <motion.p variants={fadeUp} className="text-slate-500 text-[15px] leading-relaxed">
            Join teams that replaced manual CRM work, spreadsheet maintenance, and repetitive
            outreach with one autonomous AI workspace.
          </motion.p>
          <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              href="/sign-up"
              className="flex items-center gap-2 rounded-xl bg-white px-7 py-3 text-sm font-semibold text-black transition-all hover:bg-slate-100 active:scale-[.97] shadow-xl shadow-white/5"
            >
              Start for free <ArrowRight size={14}/>
            </Link>
            <Link
              href="/sign-in"
              className="flex items-center gap-2 rounded-xl border border-white/[.10] bg-white/[.03] px-7 py-3 text-sm font-medium text-slate-300 transition-all hover:bg-white/[.07] hover:text-white"
            >
              Sign in
            </Link>
          </motion.div>
          <motion.div variants={fadeUp}>
            <FeatureRow items={["Free to start","No credit card","Cancel anytime"]}/>
          </motion.div>
        </motion.div>
      </section>

      {/* ╔═ FOOTER ═══════════════════════════════════════════════════════════╗ */}
      <footer className="border-t border-white/[.04] px-6 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <MondailyLogo size={28} showWordmark />
          <p className="text-[11px] text-slate-700">© 2026 Mondaily · Built with AI</p>
          <div className="flex items-center gap-5">
            {["Privacy","Terms","Docs"].map(l => (
              <a key={l} href="#" className="text-[11px] text-slate-700 hover:text-slate-400 transition-colors">{l}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
