export function RecordTable({ objectType }: { objectType: string }) {
  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-white/[.04]">
      <div className="grid grid-cols-4 border-b border-white/10 px-4 py-3 text-xs uppercase tracking-[0.14em] text-slate-500">
        <span>Name</span>
        <span>Status</span>
        <span>AI summary</span>
        <span>Updated</span>
      </div>
      <div className="px-4 py-8 text-sm text-slate-400">
        {objectType} records will hydrate from the UBC API.
      </div>
    </section>
  );
}

