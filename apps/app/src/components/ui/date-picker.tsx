import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { MenuLayer } from "./controls";

/**
 * The one date picker.
 *
 * Dates were typed as text ("2026-01-31") in the sheet, and elsewhere the app fell back to a native
 * `<input type="date">` — which paints the BROWSER's calendar: its own typeface, its own chrome, no
 * theme token reaches it. That is the same reason window.prompt was removed from the money flows
 * earlier: an OS-drawn panel in the middle of a designed surface reads as a bug because it looks
 * like one.
 *
 * So this is built from the same parts as everything else — hairline borders on --border-soft,
 * surface tokens, the shared portalled MenuLayer so no scroll container can clip it, and the
 * workspace's Sunday week start so a column headed "S" means the same day here as on the Calendar
 * page and in every period boundary the close engine files.
 *
 * Colour is spent only where it carries meaning: the selected day, and a dot under today. The
 * chrome stays neutral.
 */

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/** Local Y-M-D, never toISOString — that shifts the date across a timezone and silently moves it. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseValue(v: unknown): { date: Date | null; time: string } {
  const raw = String(v ?? "").trim();
  if (!raw) return { date: null, time: "" };
  const d = new Date(raw.includes("T") || raw.includes(" ") ? raw : `${raw}T00:00:00`);
  if (isNaN(d.getTime())) return { date: null, time: "" };
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return { date: d, time: hh === "00" && mm === "00" ? "" : `${hh}:${mm}` };
}

/** The 42 cells of a month grid, Sunday-first, including the neighbouring days that pad it. */
function monthGrid(view: Date): Date[] {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function DatePicker({
  value, withTime = false, onChange, onClose, open, anchorRef,
}: {
  value: unknown;
  withTime?: boolean;
  onChange: (v: string) => void;
  onClose: () => void;
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const initial = useMemo(() => parseValue(value), [value]);
  const [view, setView] = useState<Date>(initial.date ?? new Date());
  const [time, setTime] = useState(initial.time);

  useEffect(() => {
    if (!open) return;
    const p = parseValue(value);
    setView(p.date ?? new Date());
    setTime(p.time);
  }, [open, value]);

  // Closing is the owner's job, but the picker is PORTALLED, so a click inside it is outside the
  // trigger's subtree. Both nodes have to be checked or picking a day would close before it lands.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!anchorRef.current?.contains(t) && !menuRef.current?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open, onClose, anchorRef]);

  const selected = initial.date;
  const todayKey = ymd(new Date());
  const grid = monthGrid(view);

  const emit = (d: Date, t: string) => {
    onChange(withTime && t ? `${ymd(d)}T${t}` : ymd(d));
    if (!withTime) onClose();
  };

  return (
    <MenuLayer anchorRef={anchorRef} menuRef={menuRef} open={open} role="menu" maxWidth={280} minWidth={252}>
      <div className="w-[252px] select-none p-2" onMouseDown={e => e.preventDefault()}>
        {/* Month rail — one hairline under it, like every other header block in the app. */}
        <div className="mb-1 flex items-center justify-between gap-1 pb-1.5"
          style={{ borderBottom: "1px solid var(--border-soft)" }}>
          <button type="button" aria-label="Previous month" className="btn-icon"
            onClick={() => setView(v => new Date(v.getFullYear(), v.getMonth() - 1, 1))}>
            <ChevronLeft size={13} />
          </button>
          <span className="text-[11.5px] font-medium" style={{ color: "var(--text-primary)" }}>
            {MONTHS[view.getMonth()]} {view.getFullYear()}
          </span>
          <button type="button" aria-label="Next month" className="btn-icon"
            onClick={() => setView(v => new Date(v.getFullYear(), v.getMonth() + 1, 1))}>
            <ChevronRight size={13} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-px">
          {WEEKDAYS.map((w, i) => (
            <div key={i} className="py-1 text-center text-[10px] font-medium uppercase"
              style={{ color: "var(--text-faint)" }}>{w}</div>
          ))}
          {grid.map((d, i) => {
            const key = ymd(d);
            const outside = d.getMonth() !== view.getMonth();
            const isSelected = selected != null && key === ymd(selected);
            const isToday = key === todayKey;
            return (
              <button key={i} type="button" onClick={() => emit(d, time)}
                aria-current={isToday ? "date" : undefined}
                aria-pressed={isSelected}
                className="relative grid h-7 place-items-center rounded-sm text-[11.5px] tabular-nums transition-colors hover:bg-[var(--surface-hover)]"
                style={{
                  // Selection is DATA, so it carries the accent. Everything around it stays neutral.
                  background: isSelected ? "var(--section-accent-soft)" : undefined,
                  color: isSelected ? "var(--text-primary)"
                    : outside ? "var(--text-faint)" : "var(--text-secondary)",
                  border: isSelected ? "1px solid var(--section-accent-line)" : "1px solid transparent",
                }}>
                {d.getDate()}
                {isToday && !isSelected && (
                  <span className="absolute bottom-0.5 h-1 w-1 rounded-full"
                    style={{ background: "var(--section-accent)" }} />
                )}
              </button>
            );
          })}
        </div>

        {withTime && (
          <div className="mt-1.5 flex items-center gap-2 pt-1.5" style={{ borderTop: "1px solid var(--border-soft)" }}>
            <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>Time</span>
            <input type="time" value={time}
              onChange={e => { setTime(e.target.value); if (selected) emit(selected, e.target.value); }}
              className="h-6 flex-1 rounded-sm border px-1.5 text-[11.5px] tabular-nums outline-none"
              style={{ borderColor: "var(--border-soft)", background: "var(--surface-input)", color: "var(--text-primary)" }} />
          </div>
        )}

        <div className="mt-1.5 flex items-center justify-between pt-1.5" style={{ borderTop: "1px solid var(--border-soft)" }}>
          <button type="button" className="text-[11px]" style={{ color: "var(--text-secondary)" }}
            onClick={() => { const n = new Date(); setView(n); emit(n, time); }}>Today</button>
          {/* Clearing is explicit. A date you cannot unset is a date you cannot correct. */}
          <button type="button" className="text-[11px]" style={{ color: "var(--text-faint)" }}
            onClick={() => { onChange(""); onClose(); }}>Clear</button>
        </div>
      </div>
    </MenuLayer>
  );
}

export { CalendarDays as DatePickerIcon };
