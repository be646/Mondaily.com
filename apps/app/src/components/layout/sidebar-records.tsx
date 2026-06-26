import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { Building2, Users, TrendingUp, Database, ChevronDown } from "lucide-react";
import { useState } from "react";
import { apiClient } from "../../lib/api-client";

interface ObjectDefinition { id: string; slug: string; name_plural: string }

function objectIcon(slug: string) {
  const s = slug.toLowerCase();
  if (s.includes("compan")) return <Building2 size={14} className="shrink-0"/>;
  if (s.includes("people") || s.includes("person") || s.includes("contact")) return <Users size={14} className="shrink-0"/>;
  if (s.includes("deal")) return <TrendingUp size={14} className="shrink-0"/>;
  return <Database size={14} className="shrink-0"/>;
}

export function SidebarObjects() {
  const location = useLocation();
  // Quiet by default — opens on demand instead of always listing every
  // object type permanently in the sidebar.
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["sidebar-objects"],
    queryFn: () => apiClient.get<ObjectDefinition[]>("/objects"),
  });
  const objects = query.data ?? [];
  const activeObject = objects.find(o => location.pathname.startsWith(`/objects/${o.slug}`));

  return (
    <section className="mt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors hover:bg-stone-100 hover:text-stone-950 dark:hover:bg-stone-900 dark:hover:text-stone-50"
        style={{ color: "var(--text-faint)" }}
      >
        <span className="flex-1 text-left">Records{activeObject ? ` · ${activeObject.name_plural}` : ""}</span>
        <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`}/>
      </button>

      {open && (
        <div className="mt-0.5">
          {objects.map(obj => {
            const active = location.pathname.startsWith(`/objects/${obj.slug}`);
            return (
              <Link
                key={obj.id}
                to={`/objects/${obj.slug}`}
                className={`relative mb-px flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  active
                    ? "font-medium text-stone-950 dark:text-stone-50"
                    : "text-stone-500 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-500 dark:hover:bg-stone-900 dark:hover:text-stone-200"
                }`}
              >
                {active && <span className="absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 rounded-full bg-stone-950 dark:bg-stone-50" />}
                <span className={active ? "text-stone-950 dark:text-stone-50" : "text-stone-400 dark:text-stone-600"}>
                  {objectIcon(obj.slug)}
                </span>
                {obj.name_plural}
              </Link>
            );
          })}
          {!query.isLoading && objects.length === 0 && (
            <p className="px-2.5 py-2 text-xs" style={{ color: "var(--text-faint)" }}>No objects yet</p>
          )}
        </div>
      )}
    </section>
  );
}
