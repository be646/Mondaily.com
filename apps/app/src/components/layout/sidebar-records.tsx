import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { Building2, Users, TrendingUp, Database, ChevronDown, Radar } from "lucide-react";
import { useState } from "react";
import { apiClient } from "../../lib/api-client";

interface ObjectDefinition { id: string; slug: string; name_plural: string; record_count?: number }

function objectIcon(slug: string) {
  const s = slug.toLowerCase();
  if (s.includes("compan")) return <Building2 size={14} className="shrink-0"/>;
  if (s.includes("people") || s.includes("person") || s.includes("contact")) return <Users size={14} className="shrink-0"/>;
  if (s.includes("deal")) return <TrendingUp size={14} className="shrink-0"/>;
  if (s.includes("discovered") || s.includes("lead")) return <Radar size={14} className="shrink-0"/>;
  return <Database size={14} className="shrink-0"/>;
}

/** User-created defs arrive as raw slugs ("assets", "contacts") — sentence-case for display. */
function label(o: ObjectDefinition): string {
  const raw = (o.name_plural || o.slug).replace(/[-_]/g, " ").trim();
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** How many entries show before "Show all". Enough for every daily-use type, short of a wall. */
const VISIBLE = 9;

export function SidebarObjects() {
  const location = useLocation();
  // Open by default — consistent with the other sidebar sections.
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const query = useQuery({
    queryKey: ["sidebar-objects"],
    queryFn: () => apiClient.get<ObjectDefinition[]>("/objects"),
  });
  // MOST-USED FIRST: the list previously rendered in table insertion order, so daily types sat
  // among empty experiments ("assets", "employees") in whatever order they were created — the
  // "messy sidebar" complaint. Count-descending puts the workspace's real objects on top; ties
  // (both empty) fall back to the alphabet so the order is stable.
  const objects = [...(query.data ?? [])].sort((a, b) =>
    (b.record_count ?? 0) - (a.record_count ?? 0) || label(a).localeCompare(label(b)));
  const activeObject = objects.find(o => location.pathname.startsWith(`/objects/${o.slug}`));
  // Never hide the page you are ON behind "Show all".
  const visible = showAll ? objects : objects.slice(0, VISIBLE);
  const hiddenActive = !showAll && activeObject && !visible.includes(activeObject);
  const shown = hiddenActive ? [...visible, activeObject] : visible;
  const hiddenCount = objects.length - shown.length;

  return (
    <section className="mt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold uppercase tracking-[0.16em] transition-colors hover:bg-stone-100 hover:text-stone-950 dark:hover:bg-stone-900 dark:hover:text-[var(--text-primary)]"
        style={{ color: "var(--text-faint)" }}
      >
        <span className="flex-1 text-left">Records{activeObject ? ` · ${label(activeObject)}` : ""}</span>
        <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`}/>
      </button>

      {open && (
        <div className="mt-0.5">
          {shown.map(obj => {
            const active = location.pathname.startsWith(`/objects/${obj.slug}`);
            return (
              <Link
                key={obj.id}
                to={`/objects/${obj.slug}`}
                className={`relative mb-px flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  active
                    ? "font-medium text-stone-950 dark:text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:bg-stone-100 hover:text-stone-950 dark:text-[var(--text-muted)] dark:hover:bg-stone-900 dark:hover:text-[var(--text-primary)]"
                }`}
              >
                {active && <span className="absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 rounded-full bg-stone-950 dark:bg-stone-50" />}
                <span className={active ? "text-stone-950 dark:text-[var(--text-primary)]" : "text-[var(--text-secondary)] dark:text-[var(--text-faint)]"}>
                  {objectIcon(obj.slug)}
                </span>
                <span className="min-w-0 flex-1 truncate">{label(obj)}</span>
                {/* Count renders whenever the API sent one — including zero, per the tabs contract:
                    a hidden zero reflows as data arrives and hides the most useful fact. */}
                {typeof obj.record_count === "number" && (
                  <span className={`shrink-0 text-[10.5px] tabular-nums ${active ? "text-[var(--text-muted)]" : "text-[var(--text-secondary)] dark:text-[var(--text-faint)]"}`}>
                    {obj.record_count.toLocaleString()}
                  </span>
                )}
              </Link>
            );
          })}
          {hiddenCount > 0 && (
            <button onClick={() => setShowAll(true)}
              className="mb-px flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-stone-100 hover:text-[var(--text-faint)] dark:hover:bg-stone-900 dark:hover:text-[var(--text-secondary)]">
              <span className="w-[14px]" />
              Show all ({hiddenCount} more)
            </button>
          )}
          {showAll && objects.length > VISIBLE && (
            <button onClick={() => setShowAll(false)}
              className="mb-px flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-stone-100 hover:text-[var(--text-faint)] dark:hover:bg-stone-900 dark:hover:text-[var(--text-secondary)]">
              <span className="w-[14px]" />
              Show less
            </button>
          )}
          {!query.isLoading && objects.length === 0 && (
            <p className="px-2.5 py-2 text-xs" style={{ color: "var(--text-faint)" }}>No objects yet</p>
          )}
        </div>
      )}
    </section>
  );
}
