import { Search } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented";
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
  tabs, activeTab, onTab, search, onSearch, placeholder = "Search…", counts,
}: {
  tabs: FinanceTab[];
  activeTab: string;
  onTab: (key: string) => void;
  search: string;
  onSearch: (value: string) => void;
  placeholder?: string;
  /** Per-status counts. Rendered whenever given — including zero (on a filter, zero IS the answer). */
  counts?: Record<string, number>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {/* The pill row is now THE shared SegmentedControl — same control the calendar view-switch
          and period bars adopt next, instead of a dropdown here and a button wall there. */}
      <SegmentedControl
        segments={tabs.map(t => ({ key: t.key, label: t.label, count: counts ? (t.key === "" ? undefined : counts[t.key] ?? 0) : undefined }))}
        active={activeTab}
        onChange={onTab}
      />
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
