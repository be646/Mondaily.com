import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiClient } from "../../lib/api-client";

interface ObjectDefinition { id: string; slug: string; name_plural: string }

export function SidebarObjects() {
  const query = useQuery({ queryKey: ["sidebar-objects"], queryFn: () => apiClient.get<ObjectDefinition[]>("/objects") });
  const objects = query.data ?? [];
  return (
    <section className="mt-5">
      <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">Records</p>
      {objects.map((object) => <Link key={object.id} to={`/objects/${object.slug}`} className="mb-1 block rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.04]">{object.name_plural}</Link>)}
      {!query.isLoading && objects.length === 0 ? <p className="px-3 py-2 text-xs text-slate-600">No objects yet</p> : null}
    </section>
  );
}
