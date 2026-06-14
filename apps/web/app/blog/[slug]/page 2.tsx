export default function BlogPostPage({ params }: { params: { slug: string } }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <p className="text-sm uppercase tracking-[0.2em] text-red-400">Blog</p>
      <h1 className="mt-3 text-4xl font-semibold">{params.slug.replace(/-/g, " ")}</h1>
      <p className="mt-4 text-slate-400">Storyblok content will render here.</p>
    </main>
  );
}

