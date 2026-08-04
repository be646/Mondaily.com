import { Nav } from "../../components/nav";

export const metadata = {
  title: "API Docs",
  description: "Mondaily's API — authentication, workspace scoping, and core endpoints.",
};

function Section({ tag, title, children }: { tag: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <div className="mb-2 font-mono text-[13px] text-zinc-500 tracking-widest uppercase">{tag}</div>
      <h2 className="mb-4 font-sans text-2xl font-semibold tracking-tight text-zinc-900">{title}</h2>
      <div className="font-mono text-[14px] leading-relaxed text-zinc-600">{children}</div>
    </section>
  );
}

export default function DocsPage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-2 font-mono text-[14px] text-zinc-500 tracking-widest uppercase">// api.docs</div>
        <h1 className="mb-6 font-sans text-4xl font-semibold tracking-tight text-zinc-900">API Docs</h1>
        <p className="mb-12 font-mono text-[14px] leading-relaxed text-zinc-500">
          Mondaily's API runs on the same workspace graph the app uses — every endpoint is scoped to a
          single workspace and requires authentication. A full interactive reference is on the roadmap;
          this page covers the basics needed to make your first authenticated request today.
        </p>

        <Section tag="// auth" title="Authentication">
          <p className="mb-3">
            All requests require a Bearer token plus a workspace header:
          </p>
          <pre className="overflow-x-auto rounded-lg bg-black/[.03] p-3 text-[12.5px] text-zinc-700">{`Authorization: Bearer <your-token>
X-Workspace-Id: <your-workspace-id>`}</pre>
        </Section>

        <Section tag="// base url" title="Base URL">
          <pre className="overflow-x-auto rounded-lg bg-black/[.03] p-3 text-[12.5px] text-zinc-700">https://api.mondaily.com/api/v1</pre>
        </Section>

        <Section tag="// core resources" title="Core resources">
          <ul className="list-disc space-y-1.5 pl-5">
            <li><code className="text-zinc-800">/decisions</code> — read and act on Decision Queue items</li>
            <li><code className="text-zinc-800">/agents</code> — read live agent status</li>
            <li><code className="text-zinc-800">/invoices</code>, <code className="text-zinc-800">/tasks</code> — manage finance and task records</li>
          </ul>
        </Section>

        <Section tag="// contact" title="Need something specific?">
          <p>
            Email <a href="mailto:support@mondaily.com" className="text-indigo-600 hover:underline">support@mondaily.com</a>{" "}
            with what you're building — most integration requests are quick to support.
          </p>
        </Section>
      </main>
    </>
  );
}
