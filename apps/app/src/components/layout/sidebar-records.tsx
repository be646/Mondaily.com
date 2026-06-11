import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { apiClient } from "../../lib/api-client";

interface ObjectDefinition { id: string; slug: string; name_plural: string }

export function SidebarObjects() {
  const location = useLocation();
  const query = useQuery({
    queryKey: ["sidebar-objects"],
    queryFn: () => apiClient.get<ObjectDefinition[]>("/objects"),
  });
  const objects = query.data ?? [];

  return (
    <section className="mt-5">
      <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">Records</p>
      {objects.map(obj => (
        <Link
          key={obj.id}
          to={`/objects/${obj.slug}`}
          className={`mb-1 flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
            location.pathname.startsWith(`/objects/${obj.slug}`)
              ? "bg-red-500/15 text-white"
              : "text-slate-400 hover:bg-white/[.04] hover:text-slate-200"
          }`}
        >
          {obj.name_plural}
        </Link>
      ))}
      {!query.isLoading && objects.length === 0 && (
        <p className="px-3 py-2 text-xs text-slate-600">No objects yet</p>
      )}
    </section>
  );
}
