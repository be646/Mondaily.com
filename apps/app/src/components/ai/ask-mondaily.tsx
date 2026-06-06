import { AskMondailyInline } from "./ask-mondaily-inline";

export function AskMondaily() {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-6 py-8">
      <h1 className="text-2xl font-semibold">Ask Mondaily</h1>
      <p className="mt-2 text-sm text-slate-400">Streaming AI command interface will connect to `/api/v1/ask/stream`.</p>
      <div className="mt-auto">
        <AskMondailyInline placeholder="Ask anything or give Mondaily an instruction..." />
      </div>
    </div>
  );
}

