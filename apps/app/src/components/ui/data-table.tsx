// ─── DataTable ────────────────────────────────────────────────────────────────
// The ONE presentational shell for simple, read-only data surfaces (finance lists,
// settings tables, etc.). It owns ONLY structure + canonical styling: the <table>
// wrapper, the uppercase muted header contract (from .minimal-table), row density,
// hover, responsive column hiding, and the loading/error/empty state switch.
//
// It knows NOTHING about the data domain — every cell is rendered by the page via
// `column.cell(row)`, so all formatting, money values, badges, navigation and
// mutations stay in the page. Migrating a hand-rolled table into this shell is a
// pure markup move: same rows, same handlers, same values.
import type { ReactNode } from "react";
import { RefreshCw, ChevronUp, ChevronDown } from "lucide-react";

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export type DataTableAlign = "left" | "right";
export type DataTableBreakpoint = "sm" | "md" | "lg";
export type DataTableSortDir = "asc" | "desc";

export interface DataTableColumn<T> {
  /** Stable key for React + the header cell. Also the sort key when `sortable`. */
  key: string;
  /** Header label (rendered inside the canonical uppercase muted <th>). */
  header: ReactNode;
  /** Text alignment — use "right" for numeric/currency columns. Default "left". */
  align?: DataTableAlign;
  /** Optional fixed width utility class, e.g. "w-28". */
  width?: string;
  /** Hide this column below the given breakpoint (responsive). */
  hideBelow?: DataTableBreakpoint;
  /** Per-column <td> styling (font size/weight/colour) — column-level constants. */
  cellClassName?: string;
  /** Per-column <th> styling override (rare). */
  headerClassName?: string;
  /** Opt-in: this column's header is clickable to sort (calls `sort.onSort(column.key)`).
   *  Presentational only — the PAGE owns the sort state and the already-sorted `rows`. */
  sortable?: boolean;
  /** Render the cell content for a row. The page owns ALL formatting/logic. */
  cell: (row: T) => ReactNode;
}

/** Optional selection wiring — fully PAGE-OWNED state. The shell only renders the checkboxes
 *  and calls back; it never stores or derives which rows are selected. */
export interface DataTableSelection<T> {
  /** Keys (matching `rowKey`) of the currently-selected rows. */
  selectedKeys: Set<string>;
  /** Toggle a single row. */
  onToggle: (row: T) => void;
  /** Toggle all currently-shown rows. */
  onToggleAll: () => void;
  /** Header checkbox visual state (page-computed). */
  allSelected?: boolean;
  someSelected?: boolean;
}

/** Optional sort wiring — PAGE-OWNED. The shell shows the direction arrow on the active column
 *  and calls `onSort(key)`; the page decides the new dir and sorts its own `rows`. */
export interface DataTableSort {
  key: string;
  dir: DataTableSortDir;
  onSort: (key: string) => void;
}

export interface DataTableState {
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  loadingLabel?: ReactNode;
  errorLabel?: ReactNode;
  /** Shown when rows is empty and not loading/error. Page-owned JSX. */
  empty?: ReactNode;
}

const HIDE: Record<DataTableBreakpoint, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

const DENSITY = {
  comfortable: { th: "px-4 py-2.5", td: "px-4 py-3" },
  compact:     { th: "px-3 py-1.5", td: "px-3 py-2" },
} as const;

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Optional — when set, rows become clickable (cursor-pointer). */
  onRowClick?: (row: T) => void;
  /** Optional — adds a leading checkbox column. State stays page-owned. */
  selection?: DataTableSelection<T>;
  /** Optional — active sort state + callback. Makes `sortable` columns clickable. */
  sort?: DataTableSort;
  /** Optional per-row presentational hooks — the PAGE computes these (e.g. a deep-link anchor id or a
   *  highlight). Purely additive: `rowClassName` is appended after the shell's own row classes, and
   *  `rowStyle` is composed UNDER the selected-row highlight so selection styling is never lost. */
  rowId?: (row: T) => string;
  rowClassName?: (row: T) => string;
  rowStyle?: (row: T) => React.CSSProperties | undefined;
  state?: DataTableState;
  density?: keyof typeof DENSITY;
  stickyHeader?: boolean;
  className?: string;
}

export function DataTable<T>({
  columns, rows, rowKey, onRowClick, selection, sort, rowId, rowClassName, rowStyle, state, density = "comfortable", stickyHeader = false, className,
}: DataTableProps<T>) {
  const d = DENSITY[density] ?? DENSITY.comfortable;
  const colClass = (c: DataTableColumn<T>) =>
    cx(c.align === "right" ? "text-right" : "text-left", c.width, c.hideBelow && HIDE[c.hideBelow]);

  // Honest shared states — never fabricated. Loading/error render in place of the table;
  // empty defers entirely to the page-provided node (guided empty states stay page-owned).
  if (state?.isLoading) {
    return (
      <div className="flex h-40 items-center justify-center text-[12px] text-[var(--text-secondary)]">
        {state.loadingLabel ?? "Loading…"}
      </div>
    );
  }
  if (state?.isError) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 text-[12px] text-[var(--text-muted)]">
        {state.errorLabel ?? "Couldn’t load this list."}
        {state.onRetry && (
          <button onClick={state.onRetry} className="inline-flex items-center gap-1 underline">
            <RefreshCw size={11} /> Retry
          </button>
        )}
      </div>
    );
  }
  if (rows.length === 0) return <>{state?.empty ?? null}</>;

  const sortArrow = (key: string) =>
    sort && sort.key === key
      ? (sort.dir === "asc" ? <ChevronUp size={11} className="shrink-0" /> : <ChevronDown size={11} className="shrink-0" />)
      : null;

  return (
    <table className={cx("minimal-table w-full", className)}>
      <thead className={stickyHeader ? "sticky top-0 z-10" : undefined}>
        <tr>
          {/* Optional select-all checkbox column — only when `selection` is provided. */}
          {selection && (
            <th className={cx(d.th, "w-8 text-left")}>
              <input
                type="checkbox"
                aria-label="Select all rows"
                className="cursor-pointer align-middle"
                checked={!!selection.allSelected}
                ref={(el) => { if (el) el.indeterminate = !!selection.someSelected && !selection.allSelected; }}
                onChange={selection.onToggleAll}
              />
            </th>
          )}
          {columns.map((c) => {
            const canSort = !!c.sortable && !!sort;
            return (
              <th key={c.key}
                className={cx(d.th, colClass(c), canSort && "cursor-pointer select-none", c.headerClassName)}
                onClick={canSort ? () => sort!.onSort(c.key) : undefined}>
                {canSort ? (
                  <span className={cx("inline-flex items-center gap-1", c.align === "right" && "flex-row-reverse")}>
                    {c.header}{sortArrow(c.key)}
                  </span>
                ) : c.header}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const selected = selection ? selection.selectedKeys.has(rowKey(row)) : false;
          // Compose page `rowStyle` UNDER the selected-row highlight so selection is never lost: when a
          // row is selected its background wins; all other rowStyle props still apply. Fall back to
          // `undefined` when nothing applies, so rows omitting the hooks render byte-identically.
          const mergedStyle = { ...rowStyle?.(row), ...(selected ? { background: "var(--surface-selected)" } : {}) };
          return (
            <tr key={rowKey(row)}
              id={rowId?.(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              // `group` is a Tailwind marker only — inert unless a cell uses `group-hover:` (e.g. a
              // reveal-on-row-hover action). Page `rowClassName` is appended after the shell classes.
              className={cx("group", onRowClick && "cursor-pointer", rowClassName?.(row))}
              style={Object.keys(mergedStyle).length ? mergedStyle : undefined}>
              {selection && (
                <td className={cx(d.td, "w-8")} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label="Select row"
                    className="cursor-pointer align-middle"
                    checked={selected}
                    onChange={() => selection.onToggle(row)}
                  />
                </td>
              )}
              {columns.map((c) => (
                <td key={c.key} className={cx(d.td, colClass(c), c.cellClassName)}>{c.cell(row)}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
