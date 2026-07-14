// ─── Theme engine — single source of truth ───────────────────────────────────
// User-selectable skins persisted to localStorage("mondaily_appearance"). The CSS
// lives in styles.css under html[data-theme="<id>"]; this module only flips the
// data-theme attribute + the legacy `dark` class. Section "souls" derive their
// accent from whichever theme is active (see styles.css + layout.tsx sectionHue).

export type ThemeId = "console" | "paper" | "daylight" | "rose";

export interface ThemeDef {
  id: ThemeId;
  label: string;
  blurb: string;
  /** swatch[0] = canvas, [1] = card, [2] = accent — for the picker preview chips */
  swatch: [string, string, string];
  /** legacy `dark` class drives a few Tailwind dark: utilities still in the tree */
  isDark: boolean;
}

export const THEMES: ThemeDef[] = [
  { id: "console",  label: "Console",  blurb: "Jet-black operations deck", swatch: ["#09090b", "#121214", "#2f9e6b"], isDark: true },
  { id: "paper",    label: "Paper",    blurb: "Warm cream document mode",  swatch: ["#f3ece0", "#faf5ec", "#4f7a5f"], isDark: false },
  { id: "daylight", label: "Daylight", blurb: "Pure white, high contrast", swatch: ["#ffffff", "#f7f7f5", "#1f8a6d"], isDark: false },
  { id: "rose",     label: "Rosé",     blurb: "Soft tonal pink",           swatch: ["#fbf0f1", "#fdf6f7", "#c64f74"], isDark: false },
];

const STORAGE_KEY = "mondaily_appearance";

/** Map any stored value (incl. legacy "dark"/"light"/"system") to a real theme id. */
export function normalizeTheme(raw: string | null): ThemeId {
  switch (raw) {
    case "console": case "paper": case "daylight": case "rose":
      return raw;
    case "light":
      return "daylight";
    case "system":
      return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches
        ? "daylight" : "console";
    case "dark":
    default:
      return "console";
  }
}

export function getTheme(): ThemeId {
  return normalizeTheme(typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null);
}

/** Apply a theme to <html> and persist it. Safe to call before React mounts. */
export function applyTheme(id: ThemeId): void {
  const def = THEMES.find(t => t.id === id) ?? THEMES[0]!;
  const el = document.documentElement;
  // Suppress all CSS transitions for one frame while the tokens flip, so elements snap to the
  // new theme instead of animating through intermediate (often dark) colours mid-switch.
  el.classList.add("theme-switching");
  el.dataset.theme = def.id;
  el.classList.toggle("dark", def.isDark);
  try { localStorage.setItem(STORAGE_KEY, def.id); } catch { /* ignore quota */ }
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("theme-switching")));
  } else {
    el.classList.remove("theme-switching");
  }
}
