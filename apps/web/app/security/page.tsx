import { Nav } from "../../components/nav";

export const metadata = {
  title: "Security & Compliance",
  description: "How Mondaily handles privacy, data protection, and hosting infrastructure security.",
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

export default function SecurityPage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-2 font-mono text-[14px] text-zinc-500 tracking-widest uppercase">// security.policy</div>
        <h1 className="mb-6 font-sans text-4xl font-semibold tracking-tight text-zinc-900">
          Security &amp; Compliance
        </h1>
        <p className="mb-12 font-mono text-[14px] leading-relaxed text-zinc-500">
          Your privacy and data security are our top priorities. Mondaily is built in full compliance
          with GDPR and CCPA standards. To guarantee the highest level of security, our application
          hosting and database infrastructure is managed by Vercel and Supabase — both of which
          maintain SOC 2 Type II security certifications, with Vercel also holding ISO 27001 certification.
        </p>

        <Section tag="// ai-sovereignty" title="Sovereign-first AI architecture">
          <p className="mb-3">
            Mondaily runs on a sovereign-first AI architecture. AI inference runs on a private AI
            gateway, web search runs on a self-hosted sovereign search appliance, and your data is
            workspace-isolated — every AI request is scoped to your workspace and can&apos;t read another&apos;s.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Source-backed AI answers, with human-approved agent actions — agents prepare, you approve</li>
            <li>No silent fallback to third-party AI providers; your data isn&apos;t used for training unless you explicitly approve it</li>
            <li>Google and Outlook are optional, client-authorized integrations — email and calendar data is accessed only after you connect an account, stays workspace-scoped, and can be disconnected any time; they are not core AI infrastructure</li>
            <li>Stripe is our payment processor — card numbers live with Stripe, never stored by Mondaily, and are never accessible to AI tools</li>
          </ul>
        </Section>

        <Section tag="// gdpr" title="GDPR Compliant Architecture">
          <p className="mb-3">
            We process personal data in line with the EU General Data Protection Regulation. This includes:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>A clear legal basis for any data we collect</li>
            <li>Full account and data deletion on request</li>
            <li>Data portability — export your records at any time</li>
            <li>Data Processing Agreements (DPA) available for enterprise customers</li>
          </ul>
        </Section>

        <Section tag="// ccpa" title="CCPA Data Protected">
          <p className="mb-3">
            For California residents, Mondaily does not sell personal information. You have the right to:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Know what personal data we hold about you</li>
            <li>Request deletion of your personal data</li>
            <li>Opt out of any data sale (we do not sell data)</li>
          </ul>
        </Section>

        <Section tag="// infrastructure" title="Hosting Infrastructure: ISO 27001 & SOC 2">
          <p className="mb-3">
            100% of our application hosting and database infrastructure is managed by trusted,
            independently audited providers:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li><span className="text-zinc-800">Vercel</span> — application hosting &amp; edge network</li>
            <li><span className="text-zinc-800">Supabase</span> — database &amp; backend infrastructure</li>
          </ul>
          <p className="mt-3">
            For the current status of their certifications, see{" "}
            <a href="https://vercel.com/security" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
              vercel.com/security
            </a>{" "}
            and{" "}
            <a href="https://supabase.com/security" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
              supabase.com/security
            </a>.
          </p>
        </Section>

        <Section tag="// contact" title="Questions">
          <p>
            For security or compliance questions, including data deletion requests, contact{" "}
            <a href="mailto:privacy@mondaily.com" className="text-indigo-600 hover:underline">privacy@mondaily.com</a>.
          </p>
        </Section>
      </main>
    </>
  );
}
