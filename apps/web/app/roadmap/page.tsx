import { Nav } from "../../components/nav";

export const metadata = {
  title: "Roadmap — Mondaily",
  description: "What's shipped, what's running, and what's planned for Mondaily.",
};

const COLUMNS = [
  {
    label: "Shipped", dot: "#10b981",
    items: [
      "Workspace graph — records, tasks, finance, automations on one connected graph",
      "Ask Mondaily — source-backed answers over your graph",
      "Decision Queue — agent recommendations with human approval",
      "Invoice chasing, credit note disputes, recurring invoices (Finance Agent)",
      "Relationship health scoring (daily, real cron job)",
    ],
  },
  {
    label: "In progress", dot: "#f59e0b",
    items: [
      "Expanding source coverage feeding the Decision Queue",
      "Broader AI health/signal coverage across record types",
    ],
  },
  {
    label: "Planned", dot: "#a1a1aa",
    items: [
      "Autonomous workflow execution (trigger → condition → action), with human review until the engine is proven",
      "Deal-stage-triggered quote drafting",
      "Universal scoring across arbitrary record types",
    ],
  },
];

export default function RoadmapPage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-2 font-mono text-[14px] text-zinc-500 tracking-widest uppercase">// roadmap</div>
        <h1 className="mb-4 font-sans text-4xl font-semibold tracking-tight text-zinc-900">Roadmap</h1>
        <p className="mb-12 font-mono text-[14px] leading-relaxed text-zinc-500">
          We'd rather tell you exactly what's running than promise a date we might miss. This list is
          kept honest on purpose — items only move to "Shipped" once they're backed by real, running code.
        </p>

        <div className="space-y-10">
          {COLUMNS.map(col => (
            <div key={col.label}>
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: col.dot }}/>
                <span className="font-mono text-[14px] font-semibold text-zinc-800">{col.label}</span>
              </div>
              <ul className="space-y-1.5 pl-4">
                {col.items.map(item => (
                  <li key={item} className="flex items-start gap-2 font-mono text-[13px] text-zinc-600">
                    <span className="mt-0.5 text-zinc-400">›</span>{item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-12 font-mono text-[14px] leading-relaxed text-zinc-500">
          Have a request? Email{" "}
          <a href="mailto:support@mondaily.com" className="text-indigo-600 hover:underline">support@mondaily.com</a>.
        </p>
      </main>
    </>
  );
}
