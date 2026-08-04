import { Nav } from "../../components/nav";

export const metadata = {
  title: "Terms of Service",
  description: "The terms that govern your use of Mondaily.",
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

export default function TermsPage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-2 font-mono text-[14px] text-zinc-500 tracking-widest uppercase">// terms.of.service</div>
        <h1 className="mb-6 font-sans text-4xl font-semibold tracking-tight text-zinc-900">Terms of Service</h1>
        <p className="mb-12 font-mono text-[14px] leading-relaxed text-zinc-500">
          Last updated 2026-06-21. These terms govern your use of Mondaily, the AI-native workspace and
          asset-graph platform. By creating a workspace, you agree to the terms below.
        </p>

        <Section tag="// the service" title="What Mondaily provides">
          <p>
            Mondaily gives you a workspace graph for your records, tasks, documents, and finance, plus a
            set of AI agents that monitor, recommend, and — only with your approval — act on that graph.
            You retain ownership of all data you put into your workspace.
          </p>
        </Section>

        <Section tag="// accounts" title="Accounts &amp; billing">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>You're responsible for keeping your account credentials secure</li>
            <li>Paid plans are billed monthly or annually as selected at signup</li>
            <li>You can cancel at any time from billing settings; access continues through the current billing period</li>
          </ul>
        </Section>

        <Section tag="// acceptable use" title="Acceptable use">
          <p className="mb-3">You agree not to:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Use Mondaily to store or process data you don't have the right to hold</li>
            <li>Attempt to disrupt, reverse engineer, or abuse the platform or its AI agents</li>
            <li>Use the product in a way that violates applicable law</li>
          </ul>
        </Section>

        <Section tag="// liability" title="Disclaimers &amp; liability">
          <p>
            Mondaily is provided as-is. AI agent recommendations are decision support, not professional
            advice — any action that affects billing, sending, or deleting data requires your explicit
            approval before it runs. See our <a href="/security" className="text-indigo-600 hover:underline">Security &amp; Compliance</a> page for details on data handling.
          </p>
        </Section>

        <Section tag="// contact" title="Questions">
          <p>
            For questions about these terms, contact{" "}
            <a href="mailto:legal@mondaily.com" className="text-indigo-600 hover:underline">legal@mondaily.com</a>.
          </p>
        </Section>
      </main>
    </>
  );
}
