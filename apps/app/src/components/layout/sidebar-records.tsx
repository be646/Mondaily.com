import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { useSyncExternalStore } from "react";
import { Building2, Users, TrendingUp, FlaskConical } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { getSimMode, onSimChange, SIM_VIEWS } from "../../lib/simulation";

interface ObjectDefinition { id: string; slug: string; name_plural: string }

const SIM_ICONS: Record<string, React.ElementType> = {
  companies: Building2,
  people:    Users,
  deals:     TrendingUp,
};

export function SidebarObjects() {
  const location = useLocation();
  const simMode = useSyncExternalStore(onSimChange, getSimMode, getSimMode);

  const query = useQuery({
    queryKey: ["sidebar-objects"],
    queryFn: () => apiClient.get<ObjectDefinition[]>("/objects"),
    enabled: !simMode,
  });

  if (simMode) {
    return (
      <section className="mt-5">
        <div className="mb-2 flex items-center gap-1.5 px-3">
          <FlaskConical size={10} className="text-amber-400/60"/>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-400/60">Simulation</p>
        </div>
        {SIM_VIEWS.map(v => {
          const Icon = SIM_ICONS[v.key] ?? Building2;
          const to = `/objects/${v.key}`;
          const active = location.pathname === to;
          return (
            <Link
              key={v.key}
              to={to}
              className={`mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                active ? "bg-red-500/15 text-white" : "text-slate-400 hover:bg-white/[.04] hover:text-slate-200"
              }`}
            >
              <Icon size={14} className={active ? "text-red-400" : "text-slate-600"}/>
              {v.label}
              <span className="ml-auto text-[10px] text-slate-700">20</span>
            </Link>
          );
        })}
      </section>
    );
  }

  const objects = query.data ?? [];
  return (
    <section className="mt-5">
      <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">Records</p>
      {objects.map((object) => (
        <Link
          key={object.id}
          to={`/objects/${object.slug}`}
          className={`mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
            location.pathname.startsWith(`/objects/${object.slug}`)
              ? "bg-red-500/15 text-white"
              : "text-slate-400 hover:bg-white/[.04] hover:text-slate-200"
          }`}
        >
          {object.name_plural}
        </Link>
      ))}
      {!query.isLoading && objects.length === 0 && (
        <p className="px-3 py-2 text-xs text-slate-600">No objects yet</p>
      )}
    </section>
  );
}
