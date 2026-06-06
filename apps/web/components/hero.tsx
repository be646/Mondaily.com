import { Nav } from "./nav";

export function Hero() {
  return (
    <section className="min-h-screen bg-[radial-gradient(circle_at_20%_0%,rgba(239,68,68,.18),transparent_30%),#090b0f]">
      <Nav />
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-red-400">Fully AI, not AI-assisted</p>
          <h1 className="mt-5 text-5xl font-semibold tracking-tight md:text-7xl">Your entire business, run by AI.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            Mondaily is the fully AI business operating system for sales, real estate, HR, finance, investments, and operations.
          </p>
          <div className="mt-8 flex gap-3">
            <a className="rounded-xl bg-red-500 px-5 py-3 text-sm font-semibold text-white" href="https://app.mondaily.com/sign-up">Start for free</a>
            <a className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-200" href="#features">Explore features</a>
          </div>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[.04] p-4">
          <div className="rounded-2xl border border-white/10 bg-[#101216] p-4">
            <div className="mb-4 text-sm text-slate-400">Ask Mondaily</div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-slate-200">Find at-risk deals, draft follow-ups, and assign next steps.</div>
            <div className="mt-4 grid gap-2">
              {["Pipeline analysis", "AI drafted follow-up", "Revenue forecast"].map((item) => (
                <div key={item} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300">{item}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

