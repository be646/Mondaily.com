export function PricingTable() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-red-400">Pricing</p>
      <h2 className="mt-4 text-4xl font-semibold">Start free. Scale when the AI work grows.</h2>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {[
          ["Free", "$0", "Basic workspace and trial access"],
          ["Plus", "$7.99", "Cloud sync and core AI workflows"],
          ["Pro", "$12.99", "Unlimited records, AI, and team invitations"]
        ].map(([name, price, copy]) => (
          <article key={name} className="rounded-2xl border border-white/10 bg-white/[.04] p-6">
            <h3 className="text-xl font-semibold">{name}</h3>
            <p className="mt-4 text-4xl font-semibold">{price}<span className="text-base text-slate-400">/mo</span></p>
            <p className="mt-4 text-sm leading-6 text-slate-400">{copy}</p>
            <button className="mt-6 w-full rounded-xl bg-red-500 px-4 py-3 text-sm font-semibold text-white">Choose {name}</button>
          </article>
        ))}
      </div>
    </section>
  );
}

