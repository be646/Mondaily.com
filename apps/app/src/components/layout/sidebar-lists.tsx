import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../lib/api-client";

interface ListItem { id: string; name: string; object_type: string; entry_count: number }

export function SidebarLists() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [objectType, setObjectType] = useState("contact");
  const query = useQuery({ queryKey: ["lists"], queryFn: () => apiClient.get<ListItem[]>("/lists") });
  const create = useMutation({
    mutationFn: () => apiClient.post("/lists", { name, object_type: objectType }),
    onSuccess: () => { setOpen(false); setName(""); qc.invalidateQueries({ queryKey: ["lists"] }); }
  });
  const grouped = (query.data ?? []).reduce<Record<string, ListItem[]>>((groups, item) => {
    (groups[item.object_type] ??= []).push(item);
    return groups;
  }, {});
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between px-3"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">Lists</p><button onClick={() => setOpen(true)} title="New list" className="text-slate-600 hover:text-white"><Plus size={13} /></button></div>
      {Object.entries(grouped).map(([type, lists]) => <div key={type} className="mb-2"><p className="px-3 py-1 text-[10px] capitalize text-slate-700">{type.replaceAll("_", " ")}</p>{lists.map((list) => <div key={list.id} className="group flex items-center"><Link to={`/lists/${list.id}`} className="flex min-w-0 flex-1 items-center justify-between rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-white/[.04] hover:text-slate-200"><span className="truncate">{list.name}</span><span className="text-[10px] text-slate-700">{list.entry_count}</span></Link><button title="List menu" className="mr-1 text-slate-700 opacity-0 group-hover:opacity-100"><MoreHorizontal size={12} /></button></div>)}</div>)}
      {!query.isLoading && !query.data?.length ? <button onClick={() => setOpen(true)} className="w-full px-3 py-2 text-left text-xs text-slate-600 hover:text-slate-400">Create your first list</button> : null}
      {open ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"><form onSubmit={(event) => { event.preventDefault(); if (name.trim()) create.mutate(); }} className="w-full max-w-sm rounded-lg border border-white/10 bg-[#111419] p-5"><div className="flex items-center justify-between"><h2 className="font-medium">New list</h2><button type="button" onClick={() => setOpen(false)}><X size={16} /></button></div><label className="mt-5 block text-xs text-slate-500">Name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-transparent px-3 text-sm" /></label><label className="mt-4 block text-xs text-slate-500">Object type<select value={objectType} onChange={(event) => setObjectType(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#0b0d10] px-3 text-sm"><option value="contact">People</option><option value="company">Companies</option><option value="deal">Deals</option><option value="property">Properties</option><option value="employee">Employees</option></select></label><button className="mt-5 h-10 w-full rounded-md bg-red-600 text-sm font-medium">Create list</button></form></div> : null}
    </section>
  );
}
