import { Nav } from "../../components/nav";

export const metadata = {
  title: "Data Processing Agreement — Mondaily",
  description: "Mondaily's DPA for enterprise and business customers.",
};

export default function DpaPage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-2 font-mono text-[14px] text-zinc-500 tracking-widest uppercase">// data.processing.agreement</div>
        <h1 className="mb-6 font-sans text-4xl font-semibold tracking-tight text-zinc-900">Data Processing Agreement</h1>
        <p className="mb-6 font-mono text-[14px] leading-relaxed text-zinc-500">
          Business and Enterprise customers can request a signed Data Processing Agreement (DPA) covering
          how Mondaily processes personal data on your behalf, in line with GDPR Article 28. This includes
          sub-processor disclosure (Vercel for hosting, Supabase for database infrastructure), data
          deletion timelines, and breach notification commitments.
        </p>
        <p className="font-mono text-[14px] leading-relaxed text-zinc-500">
          To request a DPA, email{" "}
          <a href="mailto:privacy@mondaily.com" className="text-indigo-600 hover:underline">privacy@mondaily.com</a>{" "}
          with your workspace name — we'll send a copy for signature within one business day.
        </p>
      </main>
    </>
  );
}
