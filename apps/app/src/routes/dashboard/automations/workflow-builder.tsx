import { GitBranch, Play, Plus } from "lucide-react";
import { useParams } from "react-router-dom";
import { PageHeader } from "../../../components/ui/page-state";

export function WorkflowBuilderPage() {
  const { id } = useParams();
  return <div className="h-full px-6 py-8"><PageHeader title={id === "new" ? "New workflow" : "Workflow builder"} description="Connect triggers, conditions, and agent actions." action={<button className="flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm"><Play size={14} /> Test workflow</button>} /><div className="relative min-h-[620px] overflow-hidden rounded-lg border border-white/10 bg-[radial-gradient(#262a31_1px,transparent_1px)] [background-size:18px_18px]"><div className="absolute left-16 top-16 w-64 rounded-lg border border-white/10 bg-[#111419] p-4"><div className="flex items-center gap-2 text-sm font-medium"><GitBranch size={15} className="text-red-400" /> Record created</div><p className="mt-2 text-xs text-slate-500">Choose an object type and optional filters.</p></div><button className="absolute left-40 top-52 grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-[#111419]"><Plus size={14} /></button></div></div>;
}
