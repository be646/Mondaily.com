// ─── Section identity maps — single source for hue + call-sign per route ──────
// Used by the dashboard layout (top bar + .section-soul --section-hue) and by
// PageHeader, so a section's colour offset and designation are defined once.

// Hue offset (deg) rotated off the active theme's base accent. styles.css derives
// --section-accent = hsl(base-hue + offset * theme-spread). Console-skin reading shown.
export const SECTION_HUE: [string, number][] = [
  ["/finance",        -120], // gold / ledger
  ["/settings",         60], // steel
  ["/discovery",       110], // violet / sweep
  ["/automations",      40], // cyan / flow
  ["/decisions",       185], // rose / approval gate
  ["/activity",         75], // blue / telemetry stream
  ["/reports",          30], // teal / AI signal
  ["/notifications",  -140], // orange / alert
  ["/team/oversight",  130], // indigo / org
  ["/notes",          -110], // sand / draft
  ["/ask",              15], // mint / Mondaily voice
  ["/search",          110], // violet (exploration, shares Discovery family)
  ["/calls",           -80], // amber-rose
  ["/emails",          -45], // warm
  ["/tasks",            95], // cool teal-blue
];

export function sectionHue(pathname: string): number {
  for (const [prefix, hue] of SECTION_HUE) if (pathname.startsWith(prefix)) return hue;
  return 0;
}

// Mono call-sign rendered in the section accent — the "instrument designation".
export const SECTION_CALLSIGN: [string, string][] = [
  ["/finance", "LEDGER"], ["/settings", "SYSTEM"], ["/discovery", "SWEEP"],
  ["/automations", "FLOW"], ["/decisions", "GATE"], ["/activity", "STREAM"],
  ["/reports", "SIGNAL"], ["/notifications", "ALERT"], ["/team/oversight", "ORG"],
  ["/notes", "DRAFT"], ["/ask", "MONDAILY"], ["/search", "GRAPH"],
  ["/calls", "COMMS"], ["/emails", "RELAY"], ["/tasks", "QUEUE"],
  ["/objects", "RECORDS"], ["/lists", "SEGMENTS"], ["/home", "DECK"],
];

export function sectionCallsign(pathname: string): string {
  for (const [prefix, sign] of SECTION_CALLSIGN) if (pathname.startsWith(prefix)) return sign;
  return "MONDAILY";
}
