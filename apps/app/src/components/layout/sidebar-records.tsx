import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { Building2, Users, TrendingUp, Database, Kanban } from "lucide-react";
import { apiClient } from "../../lib/api-client";

interface ObjectDefinition { id: string; slug: string; name_plural: string }

function objectIcon(slug: string) {
  const s = slug.toLowerCase();
  if (s.includes("compan")) return <Building2 size={14} className="shrink-0"/>;
  if (s.includes("people") || s.includes("person") || s.includes("contact")) return <Users size={14} className="shrink-0"/>;
  if (s.includes("deal") || s.includes("pipeline")) return <TrendingUp size={14} className="shrink-0"/>;
  return <Database size={14} className="shrink-0"/>;
}

export function SidebarObjects() {
  const location = useLocation();
  const query = useQuery({
    queryKey: ["sidebar-objects"],
    queryFn: () => apiClient.get<ObjectDefinition[]>("/objects"),
  });
  const objects = query.data ?? [];
  const pipelineActive = location.pathname === "/pipeline";

  return (
    <section className="mt-5">
      <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">Records</p>

      {/* Pipeline shortcut */}
      <Link
        to="/pipeline"
        className={`mb-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
          pipelineActive ? "bg-red-500/15 text-white" : "text-slate-400 hover:bg-white/[.04] hover:text-slate-200"
        }`}
      >
        <span className={pipelineActive ? "text-red-400" : "text-slate-600"}>
          <Kanban size={14} className="shrink-0"/>
        </span>
        Sales Pipeline
      </Link>

      {objects.map(obj => {
        const active = location.pathname.startsWith(`/objects/${obj.slug}`);
        return (
          <Link
            key={obj.id}
            to={`/objects/${obj.slug}`}
            className={`mb-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
              active ? "bg-red-500/15 text-white" : "text-slate-400 hover:bg-white/[.04] hover:text-slate-200"
            }`}
          >
            <span className={active ? "text-red-400" : "text-slate-600"}>
              {objectIcon(obj.slug)}
            </span>
            {obj.name_plural}
          </Link>
        );
      })}
      {!query.isLoading && objects.length === 0 && (
        <p className="px-3 py-2 text-xs text-slate-600">No objects yet</p>
      )}
    </section>
  );
}
