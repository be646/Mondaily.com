export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-sm uppercase tracking-[0.2em] text-red-400">Mondaily</p>
      <h1 className="mt-3 text-3xl font-semibold">{title}</h1>
      <p className="mt-4 text-stone-400">This route is scaffolded for the full AI build.</p>
    </div>
  );
}

