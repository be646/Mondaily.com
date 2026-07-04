/**
 * LOCALIZATION + LANGUAGE INTELLIGENCE — foundation (phase 1).
 *
 * One source of truth for: the supported languages, RTL direction, Intl locale + formatters, the
 * Ask "respond in language X" instruction, and a SMALL translation dictionary for the highest-impact
 * static strings. Everything falls back to English, so partial dictionaries and unknown codes are
 * always safe. This does NOT translate the whole UI — it's the base other surfaces build on.
 */

export type LanguageCode = "en" | "pl" | "ru" | "uk" | "ar" | "fr" | "de" | "es" | "pt" | "it" | "tr" | "nl";

export interface Language {
  code: LanguageCode;
  name: string;        // English name
  nativeName: string;  // endonym
  rtl: boolean;
  locale: string;      // BCP-47 for Intl
}

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: "en", name: "English",    nativeName: "English",   rtl: false, locale: "en" },
  { code: "pl", name: "Polish",     nativeName: "Polski",    rtl: false, locale: "pl" },
  { code: "ru", name: "Russian",    nativeName: "Русский",   rtl: false, locale: "ru" },
  { code: "uk", name: "Ukrainian",  nativeName: "Українська",rtl: false, locale: "uk" },
  { code: "ar", name: "Arabic",     nativeName: "العربية",   rtl: true,  locale: "ar" },
  { code: "fr", name: "French",     nativeName: "Français",  rtl: false, locale: "fr" },
  { code: "de", name: "German",     nativeName: "Deutsch",   rtl: false, locale: "de" },
  { code: "es", name: "Spanish",    nativeName: "Español",   rtl: false, locale: "es" },
  { code: "pt", name: "Portuguese", nativeName: "Português", rtl: false, locale: "pt" },
  { code: "it", name: "Italian",    nativeName: "Italiano",  rtl: false, locale: "it" },
  { code: "tr", name: "Turkish",    nativeName: "Türkçe",    rtl: false, locale: "tr" },
  { code: "nl", name: "Dutch",      nativeName: "Nederlands",rtl: false, locale: "nl" },
];

const BY_CODE = new Map(SUPPORTED_LANGUAGES.map((l) => [l.code, l]));

/** Coerce any raw string (e.g. "en-US", "PL", "unknown") to a supported LanguageCode; default en. */
export function normalizeLang(raw?: string | null): LanguageCode {
  const base = (raw ?? "").toLowerCase().trim().split(/[-_]/)[0];
  return (base && BY_CODE.has(base as LanguageCode) ? base : "en") as LanguageCode;
}

export function languageMeta(code?: string | null): Language {
  return BY_CODE.get(normalizeLang(code))!;
}

export function isRtl(code?: string | null): boolean {
  return languageMeta(code).rtl;
}

/** "rtl" | "ltr" — safe to drop into an HTML `dir` attribute. */
export function dir(code?: string | null): "rtl" | "ltr" {
  return isRtl(code) ? "rtl" : "ltr";
}

/** BCP-47 locale for Intl. If a region is provided we bias the locale (e.g. pt + Brazil → pt-BR is
 *  NOT guessed here; we keep the language locale to stay predictable). */
export function localeFor(code?: string | null): string {
  return languageMeta(code).locale;
}

// ── Intl formatters — all guard against environments/locales that throw, falling back to a plain
//    string so a formatting call can never break a render. ──────────────────────────────────────
export function formatNumber(value: number, code?: string | null): string {
  try { return new Intl.NumberFormat(localeFor(code)).format(value); } catch { return String(value); }
}
/** Credits are AI credits (never "tokens" in user copy) — same as a plain grouped number. */
export function formatCredits(value: number, code?: string | null): string {
  return formatNumber(Math.max(0, Math.round(value)), code);
}
export function formatCurrency(value: number, currency = "USD", code?: string | null): string {
  try { return new Intl.NumberFormat(localeFor(code), { style: "currency", currency }).format(value); }
  catch { return `${currency} ${value.toFixed(2)}`; }
}
export function formatDate(value: Date | string | number, code?: string | null, opts?: Intl.DateTimeFormatOptions): string {
  try {
    const d = value instanceof Date ? value : new Date(value);
    return new Intl.DateTimeFormat(localeFor(code), opts ?? { month: "short", day: "numeric", year: "numeric" }).format(d);
  } catch { return String(value); }
}

/**
 * The instruction appended to the Ask system prompt so answers come back in the user's language.
 * Empty for English (the model's default), so English chats are unchanged.
 */
export function languageInstruction(code?: string | null): string {
  const lang = languageMeta(code);
  if (lang.code === "en") return "";
  return `\n\nRespond in ${lang.name} (${lang.nativeName}) by default. If the user writes in or explicitly asks for another language, use that instead. Keep proper nouns, identifiers, code, URLs and stored data values exactly as they are — only your prose should be in ${lang.name}.`;
}

// ── Translation dictionary (highest-impact static strings only; English fallback) ───────────────
// Keys are dotted namespaces. Values may be a string or a string[] (e.g. starter-prompt lists).
type Translations = Record<string, Partial<Record<LanguageCode, string | string[]>>>;

const TRANSLATIONS: Translations = {
  "onboarding.language_q": {
    en: "Preferred language for AI responses?",
    pl: "Preferowany język odpowiedzi AI?",
    ru: "Предпочитаемый язык ответов ИИ?",
    uk: "Бажана мова відповідей ШІ?",
    ar: "اللغة المفضلة لردود الذكاء الاصطناعي؟",
    fr: "Langue préférée pour les réponses de l’IA ?",
    de: "Bevorzugte Sprache für KI-Antworten?",
    es: "¿Idioma preferido para las respuestas de la IA?",
    pt: "Idioma preferido para as respostas da IA?",
    it: "Lingua preferita per le risposte dell’IA?",
    tr: "Yapay zekâ yanıtları için tercih edilen dil?",
    nl: "Voorkeurstaal voor AI-antwoorden?",
  },
  "settings.language": {
    en: "Language", pl: "Język", ru: "Язык", uk: "Мова", ar: "اللغة", fr: "Langue",
    de: "Sprache", es: "Idioma", pt: "Idioma", it: "Lingua", tr: "Dil", nl: "Taal",
  },
  "settings.language_help": {
    en: "Language for AI responses and number/date formatting.",
    pl: "Język odpowiedzi AI oraz formatowania liczb i dat.",
    ru: "Язык ответов ИИ и форматирования чисел и дат.",
    uk: "Мова відповідей ШІ та форматування чисел і дат.",
    ar: "لغة ردود الذكاء الاصطناعي وتنسيق الأرقام والتواريخ.",
    fr: "Langue des réponses de l’IA et du format des nombres et dates.",
    de: "Sprache für KI-Antworten und Zahlen-/Datumsformat.",
    es: "Idioma de las respuestas de la IA y del formato de números y fechas.",
    pt: "Idioma das respostas da IA e da formatação de números e datas.",
    it: "Lingua delle risposte dell’IA e del formato di numeri e date.",
    tr: "Yapay zekâ yanıtları ve sayı/tarih biçimi için dil.",
    nl: "Taal voor AI-antwoorden en getal-/datumnotatie.",
  },
  "discovery.heading": {
    en: "Find real leads & reviews online",
    pl: "Znajdź prawdziwych klientów i opinie online",
    ru: "Находите реальных клиентов и отзывы в интернете",
    uk: "Знаходьте реальних клієнтів і відгуки онлайн",
    ar: "اعثر على عملاء محتملين ومراجعات حقيقية عبر الإنترنت",
    fr: "Trouvez de vrais prospects et avis en ligne",
    de: "Finden Sie echte Leads & Bewertungen online",
    es: "Encuentra clientes potenciales y reseñas reales en línea",
    pt: "Encontre leads e avaliações reais online",
    it: "Trova lead e recensioni reali online",
    tr: "Gerçek müşteri adayları ve yorumları çevrimiçi bulun",
    nl: "Vind echte leads en reviews online",
  },
  "discovery.sub": {
    en: "Ask in plain language. Discovery searches the open web, reads the pages, and brings back source-backed prospects.",
    pl: "Pytaj naturalnym językiem. Discovery przeszukuje sieć, czyta strony i zwraca zweryfikowane kontakty.",
    ru: "Спрашивайте обычным языком. Discovery ищет в открытом вебе, читает страницы и возвращает проверённые контакты.",
    uk: "Запитуйте звичайною мовою. Discovery шукає у відкритому вебі, читає сторінки й повертає перевірені контакти.",
    ar: "اسأل بلغة بسيطة. يبحث Discovery في الويب ويقرأ الصفحات ويعيد عملاء محتملين موثّقين بالمصادر.",
    fr: "Demandez en langage naturel. Discovery parcourt le web, lit les pages et renvoie des prospects sourcés.",
    de: "Fragen Sie in normaler Sprache. Discovery durchsucht das Web, liest Seiten und liefert quellenbasierte Kontakte.",
    es: "Pregunta en lenguaje natural. Discovery busca en la web, lee las páginas y devuelve prospectos con fuentes.",
    pt: "Pergunte em linguagem natural. O Discovery pesquisa na web, lê as páginas e retorna leads com fontes.",
    it: "Chiedi in linguaggio naturale. Discovery cerca sul web, legge le pagine e restituisce contatti con fonti.",
    tr: "Doğal dille sorun. Discovery web’de arar, sayfaları okur ve kaynaklı müşteri adayları getirir.",
    nl: "Vraag in gewone taal. Discovery doorzoekt het web, leest pagina’s en levert onderbouwde leads.",
  },
  "ask.heading": {
    en: "What do you want to know about the workspace graph?",
    pl: "Co chcesz wiedzieć o grafie przestrzeni roboczej?",
    ru: "Что вы хотите узнать о графе рабочего пространства?",
    uk: "Що ви хочете дізнатися про граф робочого простору?",
    ar: "ماذا تريد أن تعرف عن رسم مساحة العمل؟",
    fr: "Que voulez-vous savoir sur le graphe de votre espace ?",
    de: "Was möchten Sie über den Workspace-Graphen wissen?",
    es: "¿Qué quieres saber sobre el grafo del espacio de trabajo?",
    pt: "O que você quer saber sobre o grafo do espaço de trabalho?",
    it: "Cosa vuoi sapere sul grafo dello spazio di lavoro?",
    tr: "Çalışma alanı grafiği hakkında ne bilmek istiyorsunuz?",
    nl: "Wat wil je weten over de workspace-graph?",
  },
};

/** Look up a translated string. Falls back to English, then to the key itself. Never throws. */
export function t(code: string | null | undefined, key: string): string {
  const lang = normalizeLang(code);
  const entry = TRANSLATIONS[key];
  const val = (entry?.[lang] ?? entry?.en) as string | undefined;
  return typeof val === "string" ? val : key;
}

/** The list of translation keys that currently have any localization (for tests/coverage). */
export const TRANSLATION_KEYS = Object.keys(TRANSLATIONS);
