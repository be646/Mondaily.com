import { Nav } from "../../components/nav";

export const metadata = {
  title: "Help Center",
  description: "Get help with Mondaily — workspace setup, agents, and billing.",
};

const TOPICS = [
  { tag: "// getting started", title: "Setting up your workspace graph", desc: "Import contacts, connect your inbox, and create your first records." },
  { tag: "// agents", title: "How the AI agents work", desc: "What each agent monitors, what it recommends, and how approval works." },
  { tag: "// finance", title: "Invoices, credit notes & approvals", desc: "How the Finance Agent drafts reminders and waits for your sign-off." },
  { tag: "// billing", title: "Plans & billing", desc: "Upgrading, downgrading, and managing your subscription." },
];

export default function HelpPage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-2 font-mono text-[14px] text-zinc-500 tracking-widest uppercase">// help.center</div>
        <h1 className="mb-4 font-sans text-4xl font-semibold tracking-tight text-zinc-900">Help Center</h1>
        <p className="mb-12 font-mono text-[14px] leading-relaxed text-zinc-500">
          Browse common topics below, or reach out directly — a real person reads every message.
        </p>

        <div className="mb-12 grid gap-4 sm:grid-cols-2">
          {TOPICS.map(t => (
            <div key={t.title} className="rounded-xl border border-black/[.06] bg-white p-4">
              <div className="mb-1 font-mono text-[11px] text-indigo-500 tracking-widest uppercase">{t.tag}</div>
              <div className="mb-1 font-mono text-[14px] font-semibold text-zinc-800">{t.title}</div>
              <div className="font-mono text-[12.5px] text-zinc-500 leading-relaxed">{t.desc}</div>
            </div>
          ))}
        </div>

        <p className="font-mono text-[14px] leading-relaxed text-zinc-500">
          Can't find what you need? Email{" "}
          <a href="mailto:support@mondaily.com" className="text-indigo-600 hover:underline">support@mondaily.com</a>{" "}
          and we'll get back to you within one business day.
        </p>
      </main>
    </>
  );
}
