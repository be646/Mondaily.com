export function RecordDetail({ recordId }: { recordId: string }) {
  return (
    <div className="grid gap-6 px-6 py-8 lg:grid-cols-[320px_1fr]">
      <aside className="rounded-2xl border border-white/10 bg-white/[.04] p-4">
        <p className="text-xs uppercase tracking-[0.16em] text-red-400">Record</p>
        <h1 className="mt-2 text-xl font-semibold">{recordId}</h1>
      </aside>
      <section className="rounded-2xl border border-white/10 bg-white/[.04] p-4">
        <h2 className="font-semibold">Activity timeline</h2>
        <p className="mt-3 text-sm text-slate-400">AI and human activity logs will appear here.</p>
      </section>
    </div>
  );
}

