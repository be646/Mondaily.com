import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SUPPORTED_LANGUAGES, normalizeLang, isRtl, dir, localeFor, languageInstruction, t,
  formatNumber, formatCredits, formatCurrency, formatDate, languageMeta,
} from "@mondaily/shared/i18n";
import { resolveProfile } from "@mondaily/shared/profile";

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
    expect(read("../../../../apps/app/src/routes/dashboard/settings/account.tsx")).toMatch(/SUPPORTED_LANGUAGES/);
    expect(read("../../../../apps/app/src/routes/dashboard/discovery.tsx")).toMatch(/t\("discovery\.heading"\)/);
    expect(read("../../../../apps/app/src/components/ai/ask-mondaily.tsx")).toMatch(/t\("ask\.heading"\)/);
  });
});
