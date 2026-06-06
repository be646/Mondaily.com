import { Sparkles, Calendar, CheckSquare } from "lucide-react";
import { AskMondailyInline } from "../../components/ai/ask-mondaily-inline";

export function HomePage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Good morning.</h1>
      <p className="mt-1 text-sm text-slate-400">Mondaily is ready to run today’s work.</p>
      <section className="mt-6 rounded-2xl border border-white/10 bg-white/[.04] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Sparkles size={15} className="text-red-400" />
          Ask Mondaily
        </div>
        <AskMondailyInline placeholder="Prepare me for today... What needs attention?" />
      </section>
      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-white/[.04] p-4">
          <h2 className="flex items-center gap-2 text-sm font-medium text-slate-300"><Calendar size={14} /> Meetings</h2>
          <p className="mt-4 text-sm text-slate-400">Calendar intelligence will appear here.</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[.04] p-4">
          <h2 className="flex items-center gap-2 text-sm font-medium text-slate-300"><CheckSquare size={14} /> Tasks</h2>
          <p className="mt-4 text-sm text-slate-400">AI-prioritized tasks will appear here.</p>
        </article>
      </section>
    </div>
  );
}

