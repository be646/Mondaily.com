import { Nav } from "../../components/nav";

export const metadata = {
  title: "System Status",
  description: "Mondaily's hosting and infrastructure status.",
};

export default function StatusPage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-2 font-mono text-[14px] text-zinc-500 tracking-widest uppercase">// system.status</div>
        <h1 className="mb-6 font-sans text-4xl font-semibold tracking-tight text-zinc-900">System Status</h1>
        <p className="mb-8 font-mono text-[14px] leading-relaxed text-zinc-500">
          Mondaily doesn't yet run its own public incident history — this page will track that once it
          exists. In the meantime, Mondaily's hosting and database run on infrastructure with their own
          public status pages:
        </p>
        <ul className="mb-12 list-disc space-y-2 pl-5 font-mono text-[14px] text-zinc-600">
          <li>
            <a href="https://www.vercel-status.com" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
              vercel-status.com
            </a> — application hosting &amp; edge network
          </li>
          <li>
            <a href="https://status.supabase.com" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
              status.supabase.com
            </a> — database &amp; backend infrastructure
          </li>
        </ul>
        <p className="font-mono text-[14px] leading-relaxed text-zinc-500">
          If something feels wrong with your workspace, email{" "}
          <a href="mailto:support@mondaily.com" className="text-indigo-600 hover:underline">support@mondaily.com</a>{" "}
          and we'll look into it directly.
        </p>
      </main>
    </>
  );
}
