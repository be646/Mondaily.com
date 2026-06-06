const features = [
  "AI fills fields on record creation",
  "AI drafts follow-ups for approval",
  "AI flags at-risk deals proactively",
  "AI connects sales, HR, finance, real estate, and investments",
  "pgvector memory stays co-located with source records",
  "Humans review, approve, and guide exceptions"
];

export function FeatureSection() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-24">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-red-400">The review layer for AI work</p>
      <h2 className="mt-4 max-w-3xl text-4xl font-semibold">Everything is designed around agents doing the work first.</h2>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {features.map((feature) => (
          <article key={feature} className="rounded-2xl border border-white/10 bg-white/[.04] p-5 text-slate-300">{feature}</article>
        ))}
      </div>
    </section>
  );
}

