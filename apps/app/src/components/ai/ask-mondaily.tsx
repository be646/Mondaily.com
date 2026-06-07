import { Sparkles } from "lucide-react";
import { useState } from "react";
import { AskMondailyInline } from "./ask-mondaily-inline";

export function AskMondaily() {
  const [response, setResponse] = useState("");
  return <div className="mx-auto flex h-full max-w-3xl flex-col px-6 py-8"><h1 className="text-2xl font-semibold">Ask Mondaily</h1><p className="mt-2 text-sm text-slate-400">Search, analyze, create, and coordinate work across your workspace.</p><div className="flex flex-1 items-center justify-center">{response ? <article className="w-full rounded-lg border border-white/10 p-5"><div className="mb-3 flex items-center gap-2 text-sm font-medium"><Sparkles size={15} className="text-red-400" /> Mondaily</div><p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{response}</p></article> : <div className="text-center text-sm text-slate-600">Ask a question or give Mondaily an instruction.</div>}</div><AskMondailyInline placeholder="Ask anything or give Mondaily an instruction..." onResponse={setResponse} /></div>;
}
