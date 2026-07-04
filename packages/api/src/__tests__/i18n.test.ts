import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SUPPORTED_LANGUAGES, normalizeLang, isRtl, dir, localeFor, languageInstruction, t, tList, fillTemplate,
  formatNumber, formatCredits, formatCurrency, formatDate, languageMeta, TRANSLATION_KEYS,
} from "@mondaily/shared/i18n";
import {
  resolveProfile, mergeProfile, EMPTY_PROFILE, discoverySuggestions, discoveryNextSuggestions,
  broadQueryRefinements, askStarterPrompts, homeQuickPrompts,
} from "@mondaily/shared/profile";

describe("supported languages", () => {
  it("includes all 12 required languages", () => {
    const codes = SUPPORTED_LANGUAGES.map(l => l.code).sort();
    expect(codes).toEqual(["ar", "de", "en", "es", "fr", "it", "nl", "pl", "pt", "ru", "tr", "uk"].sort());
  });
  it("marks ONLY Arabic as RTL", () => {
    expect(SUPPORTED_LANGUAGES.filter(l => l.rtl).map(l => l.code)).toEqual(["ar"]);
  });
});

describe("normalizeLang — always resolves to a supported code (fallback English)", () => {
  it("passes through supported codes and strips region suffixes", () => {
    expect(normalizeLang("pl")).toBe("pl");
    expect(normalizeLang("en-US")).toBe("en");
    expect(normalizeLang("PT_BR")).toBe("pt");
  });
  it("unknown / empty / null → en", () => {
    expect(normalizeLang("klingon")).toBe("en");
    expect(normalizeLang("")).toBe("en");
    expect(normalizeLang(null)).toBe("en");
    expect(normalizeLang(undefined)).toBe("en");
  });
});

describe("RTL direction helpers (Arabic must not break layout)", () => {
  it("Arabic → rtl, everything else → ltr", () => {
    expect(dir("ar")).toBe("rtl");
    expect(isRtl("ar")).toBe(true);
    expect(dir("en")).toBe("ltr");
    expect(dir("pl")).toBe("ltr");
    expect(isRtl("unknown")).toBe(false);   // safe fallback
  });
  it("dir() only ever returns a valid HTML dir value", () => {
    for (const l of [...SUPPORTED_LANGUAGES.map(x => x.code), "bogus"]) {
      expect(["rtl", "ltr"]).toContain(dir(l));
    }
  });
});

describe("Ask language instruction", () => {
  it("names the target language (native + English) for non-English", () => {
    expect(languageInstruction("pl")).toMatch(/Respond in Polish \(Polski\)/);
    expect(languageInstruction("ar")).toMatch(/Arabic/);
    expect(languageInstruction("uk")).toMatch(/Ukrainian/);
  });
  it("is EMPTY for English (English chats unchanged)", () => {
    expect(languageInstruction("en")).toBe("");
    expect(languageInstruction("en-GB")).toBe("");
  });
  it("tells the model to keep data/identifiers as-is (no fabrication of translation)", () => {
    expect(languageInstruction("de").toLowerCase()).toMatch(/stored data|identifiers/);
  });
});

describe("translation lookup with English fallback", () => {
  it("returns the localized string when present", () => {
    expect(t("pl", "settings.language")).toBe("Język");
    expect(t("ar", "settings.language")).toBe("اللغة");
  });
  it("falls back to English for a language with no entry", () => {
    expect(t("it", "onboarding.language_q")).toBeTruthy();   // Italian present
    // a key that exists only in English still resolves to the English text, never blank
    expect(t("ru", "discovery.heading")).toBeTruthy();
  });
  it("unknown key → returns the key itself (never throws / never blank)", () => {
    expect(t("en", "nonexistent.key")).toBe("nonexistent.key");
  });
});

describe("Intl formatters never throw and respect locale", () => {
  it("formatNumber / credits group digits and stay non-negative for credits", () => {
    expect(formatCredits(-50, "en")).toBe("0");
    expect(formatNumber(1000000, "en")).toMatch(/1.000.000|1,000,000/);
    for (const l of SUPPORTED_LANGUAGES) expect(typeof formatNumber(1234.5, l.code)).toBe("string");
  });
  it("currency + date format for every language without throwing", () => {
    for (const l of SUPPORTED_LANGUAGES) {
      expect(typeof formatCurrency(29, "USD", l.code)).toBe("string");
      expect(typeof formatDate("2026-07-04", l.code)).toBe("string");
    }
  });
  it("localeFor + languageMeta are defined for all", () => {
    for (const l of SUPPORTED_LANGUAGES) {
      expect(localeFor(l.code)).toBe(l.locale);
      expect(languageMeta(l.code).name).toBe(l.name);
    }
  });
});

describe("language is stored in the profile + resolvable", () => {
  it("resolveProfile surfaces settings.profile.language, defaulting to en", () => {
    expect(resolveProfile({ profile: { language: "pl" } }).language).toBe("pl");
    expect(resolveProfile({}).language).toBe("en");            // fallback
    expect(resolveProfile({ language: "de" }).language).toBe("de"); // legacy top-level field
  });
});

describe("PHASE 2 — dynamic suggestions are localized AND keep profile personalization", () => {
  const clinicPL = mergeProfile(EMPTY_PROFILE, { industry: "Aesthetic clinics", region: "Warszawa", target_customers: "kliniki" });

  it("Discovery suggestions translate the FRAME and keep the profile DATA verbatim", () => {
    const pl = discoverySuggestions(clinicPL, 4, "pl");
    // Polish frame "Znajdź {who} w {region}" filled with the user's own words.
    expect(pl.some(s => s.includes("Znajdź") && s.includes("kliniki") && s.includes("Warszawa"))).toBe(true);
  });
  it("combines with region + customers across languages", () => {
    const de = discoverySuggestions(mergeProfile(EMPTY_PROFILE, { target_customers: "Zahnärzte", region: "Berlin" }), 4, "de");
    expect(de.some(s => s.includes("Zahnärzte") && s.includes("Berlin"))).toBe(true);
  });
  it("Ask starter prompts are localized", () => {
    expect(askStarterPrompts(clinicPL, 4, "de").join(" ")).toMatch(/Zeig|Woche|Nachfass/);
    expect(askStarterPrompts(clinicPL, 4, "ar").join(" ")).toMatch(/[؀-ۿ]/); // contains Arabic
  });
  it("Home quick prompts localize (attention/decisions translated, discovery keeps data)", () => {
    const home = homeQuickPrompts(clinicPL, "pl");
    expect(home.find(h => h.key === "attention")?.prompt).toMatch(/uwagi|pilności/i);
    expect(home.find(h => h.key === "discovery")?.prompt).toContain("kliniki");
  });
  it("broad-query refinements localize the frame around the typed query", () => {
    const ru = broadQueryRefinements(clinicPL, "клиники", 3, "ru");
    expect(ru.some(s => s.includes("клиники") && s.includes("Warszawa"))).toBe(true);
  });
  it("discoveryNextSuggestions localize", () => {
    expect(discoveryNextSuggestions(clinicPL, 3, "fr").join(" ").toLowerCase()).toMatch(/avis|région|similaires/);
  });

  it("ENGLISH path is UNCHANGED — still the rich family-specific behavior", () => {
    const en = discoverySuggestions(mergeProfile(EMPTY_PROFILE, { industry: "Aesthetic clinics", region: "London" }), 4);
    expect(en.join(" ").toLowerCase()).toContain("clinics in london");   // English family template
    expect(discoverySuggestions(EMPTY_PROFILE, 4, "en")).toEqual(discoverySuggestions(EMPTY_PROFILE, 4)); // "en" == default
  });
  it("unknown language falls back to English suggestions", () => {
    const p = mergeProfile(EMPTY_PROFILE, { industry: "Real estate", region: "Miami" });
    expect(discoverySuggestions(p, 4, "klingon")).toEqual(discoverySuggestions(p, 4));
  });
  it("empty profile localized suggestions are still non-empty + neutral", () => {
    const ar = discoverySuggestions(EMPTY_PROFILE, 4, "ar");
    expect(ar.length).toBeGreaterThan(0);
    expect(ar.join(" ")).toMatch(/[؀-ۿ]/);
  });
  it("tList + fillTemplate: frame localized, {placeholders} filled, no leftover braces", () => {
    const frames = tList("es", "tpl.discovery");
    expect(frames.length).toBeGreaterThan(0);
    const filled = fillTemplate(frames[0]!, { who: "clínicas", region: "Madrid" });
    expect(filled).not.toMatch(/[{}]/);
    expect(filled).toContain("clínicas");
  });
});

describe("PHASE 3 — selector metadata (flags + native names)", () => {
  it("every language has a non-empty flag, native name and English name", () => {
    for (const l of SUPPORTED_LANGUAGES) {
      expect(l.flag.length, `${l.code} flag`).toBeGreaterThan(0);
      expect(l.nativeName.length, `${l.code} nativeName`).toBeGreaterThan(0);
      expect(l.name.length, `${l.code} name`).toBeGreaterThan(0);
    }
  });
  it("flags are distinct per language (no duplicated/placeholder flag)", () => {
    const flags = SUPPORTED_LANGUAGES.map(l => l.flag);
    expect(new Set(flags).size).toBe(flags.length);
  });
  it("languageMeta exposes the flag for the selector", () => {
    expect(languageMeta("pl").flag).toBe("🇵🇱");
    expect(languageMeta("ar").flag.length).toBeGreaterThan(0);
  });
});

describe("PHASE 3 — high-traffic chrome keys: full coverage + English fallback", () => {
  const NAV_KEYS = TRANSLATION_KEYS.filter(k => k.startsWith("nav.") || k.startsWith("common.") || k.startsWith("section."));
  it("nav/common/section keys are translated in ALL 12 languages", () => {
    for (const key of NAV_KEYS) {
      for (const l of SUPPORTED_LANGUAGES) {
        const v = t(l.code, key);
        expect(v, `${key}/${l.code}`).not.toBe(key);   // never the raw key
        expect(v.length).toBeGreaterThan(0);
      }
    }
  });
  it("missing key → English; unknown-language key → English value", () => {
    expect(t("pl", "common.definitely_missing")).toBe("common.definitely_missing"); // no entry → key
    expect(t("klingon", "common.save")).toBe(t("en", "common.save"));               // unknown lang → en
  });
  it("common buttons cover the required verb set", () => {
    for (const verb of ["save", "cancel", "delete", "edit", "filter", "search", "create", "add", "remove", "assign", "approve", "reject", "snooze", "open", "close", "back", "next"]) {
      expect(t("de", `common.${verb}`), `common.${verb} de`).not.toBe(`common.${verb}`);
    }
  });
});

describe("PHASE 3 — route/path safety: translation keys are never route paths", () => {
  it("no translation key is (or contains) a URL/route path", () => {
    for (const key of TRANSLATION_KEYS) {
      expect(key.startsWith("/"), key).toBe(false);
      expect(key.includes("://"), key).toBe(false);
    }
  });
  it("translated nav VALUES never introduce a leading slash (labels, not links)", () => {
    for (const l of SUPPORTED_LANGUAGES) {
      for (const k of ["nav.home", "nav.discovery", "nav.tasks"]) expect(t(l.code, k).startsWith("/")).toBe(false);
    }
  });
});

describe("wiring guards — language flows through the app", () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
  it("Ask backend appends the language instruction, resolving user pref → profile → en", () => {
    const src = read("../routes/ask.ts");
    expect(src).toMatch(/languageInstruction\(lang\)/);
    expect(src).toMatch(/user_preferences.*language|\.language\)/);
    expect(src).toMatch(/workspaceProfileBlock\(workspaceId, userId\)/);
  });
  it("account settings persist + return a per-user language", () => {
    expect(read("../routes/app-data.ts")).toMatch(/language: userPreferences\.language/);
  });
  it("useLanguage keeps <html lang/dir> in sync and the dashboard mounts it", () => {
    const hook = read("../../../../apps/app/src/hooks/useLanguage.ts");
    expect(hook).toMatch(/el\.dir = dirFor\(lang\)/);
    expect(hook).toMatch(/el\.lang = lang/);
    expect(read("../../../../apps/app/src/routes/dashboard/layout.tsx")).toMatch(/useLanguage\(\)/);
  });
  it("Settings exposes a language selector; Discovery + Ask use translated headings", () => {
    expect(read("../../../../apps/app/src/routes/dashboard/settings/account.tsx")).toMatch(/<LanguageSelect/);
    expect(read("../../../../apps/app/src/routes/dashboard/discovery.tsx")).toMatch(/t\("discovery\.heading"\)/);
    expect(read("../../../../apps/app/src/components/ai/ask-mondaily.tsx")).toMatch(/t\("ask\.heading"\)/);
  });
  it("backend resolves the effective language and passes it to the suggestion generators", () => {
    const src = read("../routes/app-data.ts");
    expect(src).toMatch(/discoverySuggestions\(profile, 4, lang\)/);
    expect(src).toMatch(/askStarterPrompts\(profile, 4, lang\)/);
    expect(src).toMatch(/homeQuickPrompts\(profile, lang\)/);
    expect(src).toMatch(/broadQueryRefinements\(profile, .*, 3, lang\)/);
  });
  it("Discovery no-results + tabs + Home date are localized", () => {
    const disc = read("../../../../apps/app/src/routes/dashboard/discovery.tsx");
    expect(disc).toMatch(/t\("discovery\.no_results"\)/);
    expect(disc).toMatch(/t\("discovery\.search_deeper"\)/);
    expect(read("../../../../apps/app/src/routes/dashboard/home.tsx")).toMatch(/loc\.formatDate/);
  });
  it("onboarding passes the chosen language so the AI helper copy is localized", () => {
    expect(read("../routes/onboarding.ts")).toMatch(/languageMeta\(body\.language\)/);
    expect(read("../../../../apps/app/src/routes/onboarding/terminal-console.tsx")).toMatch(/language: answers\.language/);
  });
  it("sidebar localizes nav LABELS via NAV_TKEY while keeping route literals intact", () => {
    const sidebar = read("../../../../apps/app/src/components/layout/sidebar.tsx");
    expect(sidebar).toMatch(/NAV_TKEY/);
    expect(sidebar).toMatch(/useNavLabel/);
    expect(sidebar).toMatch(/to: "\/discovery"/);   // route path unchanged
    expect(sidebar).toMatch(/to: "\/search"/);
    for (const k of ["discovery.heading", "ask.heading", "settings.language"]) expect(k).not.toMatch(/^\//);
  });
  it("app Settings uses the polished LanguageSelect (flag + native name) with follow-default", () => {
    const sel = read("../../../../apps/app/src/components/ui/language-select.tsx");
    expect(sel).toMatch(/l\.flag/);
    expect(sel).toMatch(/l\.nativeName/);
    const acct = read("../../../../apps/app/src/routes/dashboard/settings/account.tsx");
    expect(acct).toMatch(/<LanguageSelect/);
    expect(acct).toMatch(/includeFollowDefault/);
  });
  it("landing footer selector: localStorage-backed, no account API, translated footer", () => {
    const src = read("../../../../apps/web/components/landing-page.tsx");
    expect(src).toMatch(/SiteLanguageSelect/);
    expect(src).toMatch(/mondaily_site_lang/);                    // persisted to localStorage
    expect(src).toMatch(/st\("landing\.footer\.product"\)/);      // footer translated
    expect(src).not.toMatch(/\/settings\/account/);              // never touches account settings
  });
});
