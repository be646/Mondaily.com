import { Search } from "lucide-react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CommandPageHeader } from "@/components/ui/controls";

/**
 * FinanceHeader — the app-standard page header (icon chip + `// CALLSIGN` kicker + title + subtitle
 * + right-aligned action), matching CommandPageHeader's look so the finance pages read like the rest
 * of the app (Decisions/Discovery/Team). Kept as a light component (no soul-rule) so it drops into
 * the finance pages' pinned header band without a double divider.
 */
export function FinanceHeader({ icon, callsign, title, subtitle, action }: {
  icon: LucideIcon;
  callsign: string;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  // Thin alias over CommandPageHeader. This was a byte-identical COPY of that component minus the
  // divider, so the two drifted independently and the app had two page-header implementations.
  // `divider={false}` is the only difference the finance pages ever needed.
  return (
    <CommandPageHeader
      icon={icon}
      callsign={callsign}
      title={title}
      subtitle={subtitle}
      primaryAction={action}
      divider={false}
    />
  );
}

/**
 * FinanceListToolbar — the single, consistent status-tabs + search bar shared by every
 * finance list page (Invoices, Credit Notes, Quotes). One place so the segmented control
 * and the search field look identical everywhere. The active tab sits on --surface-card
 * (lighter than the --surface-hover track) with a hairline + soft shadow, so the selection
 * reads clearly — fixing the old "active pill invisible on the same-token track" bug.
 */
export interface FinanceTab { key: string; label: string }

export function FinanceListToolbar({
  tabs, activeTab, onTab, search, onSearch, placeholder = "Search…",
}: {
  tabs: FinanceTab[];
  activeTab: string;
  onTab: (key: string) => void;
  search: string;
  onSearch: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border p-0.5"
        style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)" }}>
        {tabs.map(t => {
          const active = activeTab === t.key;
          return (
            <button key={t.key} onClick={() => onTab(t.key)}
              className="rounded-md px-3 py-1 text-[11.5px] font-medium transition-colors"
              style={active
                ? { background: "var(--surface-card)", color: "var(--text-primary)", boxShadow: "0 1px 2px rgba(0,0,0,0.18)" }
                : { color: "var(--text-muted)" }}>
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"/>
        <input
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder={placeholder}
          className="key-input h-8 w-full pl-8 pr-3 text-[12px]"
        />
      </div>
    </div>
  );
}
