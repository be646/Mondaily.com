import { Nav } from "../../components/nav";

export const metadata = {
  title: "Privacy Policy",
  description: "How Mondaily collects, uses, and protects your data.",
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

export default function PrivacyPage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-2 font-mono text-[14px] text-zinc-500 tracking-widest uppercase">// privacy.policy</div>
        <h1 className="mb-6 font-sans text-4xl font-semibold tracking-tight text-zinc-900">Privacy Policy</h1>
        <p className="mb-12 font-mono text-[14px] leading-relaxed text-zinc-500">
          Last updated 2026-06-21. This policy explains what data Mondaily collects when you use the
          workspace graph and AI agents, why we collect it, and what control you have over it. For a
          detailed look at our infrastructure and certifications, see our{" "}
          <a href="/security" className="text-indigo-600 hover:underline">Security &amp; Compliance</a> page.
        </p>

        <Section tag="// what we collect" title="Information we collect">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Account information you provide directly (name, email, workspace details)</li>
            <li>Records you create in your workspace graph (people, companies, tasks, documents, invoices)</li>
            <li>Content you connect — inbox, calendar, and finance integrations you authorize</li>
            <li>Usage data needed to operate and secure the product (logs, device/browser metadata)</li>
          </ul>
        </Section>

        <Section tag="// how we use it" title="How we use your data">
          <p className="mb-3">We use your data to operate Mondaily for you and your workspace — nothing more:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Running the AI agents (Graph, Operations, Relationship, Finance, Insights, Workflow) inside your workspace graph</li>
            <li>Storing and syncing the records, tasks, and decisions you create</li>
            <li>Sending account, billing, and product notifications</li>
            <li>Improving reliability and security of the platform</li>
          </ul>
          <p className="mt-3">We do not sell your data, and AI agents only ever read data inside your own workspace graph.</p>
        </Section>

        <Section tag="// your rights" title="Your rights and controls">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Export your records and data at any time from workspace settings</li>
            <li>Request full account and data deletion</li>
            <li>Disconnect any integration (email, calendar, finance) at any time</li>
            <li>Request a Data Processing Agreement — see our <a href="/dpa" className="text-indigo-600 hover:underline">DPA</a> page</li>
          </ul>
        </Section>

        <Section tag="// contact" title="Questions">
          <p>
            For privacy questions or data requests, contact{" "}
            <a href="mailto:privacy@mondaily.com" className="text-indigo-600 hover:underline">privacy@mondaily.com</a>.
          </p>
        </Section>
      </main>
    </>
  );
}
