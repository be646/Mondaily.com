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
  flag: string;        // small emoji flag for selectors (tasteful, no asset files)
}

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: "en", name: "English",    nativeName: "English",   rtl: false, locale: "en", flag: "🇬🇧" },
  { code: "pl", name: "Polish",     nativeName: "Polski",    rtl: false, locale: "pl", flag: "🇵🇱" },
  { code: "ru", name: "Russian",    nativeName: "Русский",   rtl: false, locale: "ru", flag: "🇷🇺" },
  { code: "uk", name: "Ukrainian",  nativeName: "Українська",rtl: false, locale: "uk", flag: "🇺🇦" },
  { code: "ar", name: "Arabic",     nativeName: "العربية",   rtl: true,  locale: "ar", flag: "🇸🇦" },
  { code: "fr", name: "French",     nativeName: "Français",  rtl: false, locale: "fr", flag: "🇫🇷" },
  { code: "de", name: "German",     nativeName: "Deutsch",   rtl: false, locale: "de", flag: "🇩🇪" },
  { code: "es", name: "Spanish",    nativeName: "Español",   rtl: false, locale: "es", flag: "🇪🇸" },
  { code: "pt", name: "Portuguese", nativeName: "Português", rtl: false, locale: "pt", flag: "🇵🇹" },
  { code: "it", name: "Italian",    nativeName: "Italiano",  rtl: false, locale: "it", flag: "🇮🇹" },
  { code: "tr", name: "Turkish",    nativeName: "Türkçe",    rtl: false, locale: "tr", flag: "🇹🇷" },
  { code: "nl", name: "Dutch",      nativeName: "Nederlands",rtl: false, locale: "nl", flag: "🇳🇱" },
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

  // ── Short static UI strings (Discovery chrome) ──
  "discovery.search_deeper": {
    en: "Search deeper", pl: "Szukaj głębiej", ru: "Искать глубже", uk: "Шукати глибше",
    ar: "بحث أعمق", fr: "Chercher plus loin", de: "Tiefer suchen", es: "Buscar más a fondo",
    pt: "Pesquisar mais fundo", it: "Cerca più a fondo", tr: "Daha derin ara", nl: "Dieper zoeken",
  },
  "discovery.deep_research": {
    en: "Deep research", pl: "Dogłębne badanie", ru: "Глубокое исследование", uk: "Глибоке дослідження",
    ar: "بحث معمّق", fr: "Recherche approfondie", de: "Tiefenrecherche", es: "Investigación profunda",
    pt: "Pesquisa aprofundada", it: "Ricerca approfondita", tr: "Derin araştırma", nl: "Diepgaand onderzoek",
  },
  "discovery.no_results": {
    en: "No results yet — try a broader search or search deeper.",
    pl: "Brak wyników — spróbuj szerszego wyszukiwania lub szukaj głębiej.",
    ru: "Пока нет результатов — попробуйте более широкий запрос или ищите глубже.",
    uk: "Поки немає результатів — спробуйте ширший запит або шукайте глибше.",
    ar: "لا توجد نتائج بعد — جرّب بحثًا أوسع أو ابحث بعمق أكبر.",
    fr: "Aucun résultat — élargissez la recherche ou cherchez plus loin.",
    de: "Noch keine Ergebnisse — versuchen Sie eine breitere oder tiefere Suche.",
    es: "Aún no hay resultados — prueba una búsqueda más amplia o más profunda.",
    pt: "Ainda sem resultados — tente uma busca mais ampla ou mais profunda.",
    it: "Ancora nessun risultato — prova una ricerca più ampia o più approfondita.",
    tr: "Henüz sonuç yok — daha geniş veya daha derin bir arama deneyin.",
    nl: "Nog geen resultaten — probeer een bredere of diepere zoekopdracht.",
  },
  "discovery.saved": {
    en: "Saved", pl: "Zapisane", ru: "Сохранённые", uk: "Збережені", ar: "المحفوظة", fr: "Enregistré",
    de: "Gespeichert", es: "Guardado", pt: "Salvos", it: "Salvati", tr: "Kaydedilenler", nl: "Opgeslagen",
  },
  "discovery.recent": {
    en: "Recent", pl: "Ostatnie", ru: "Недавние", uk: "Останні", ar: "الأخيرة", fr: "Récents",
    de: "Zuletzt", es: "Recientes", pt: "Recentes", it: "Recenti", tr: "Son", nl: "Recent",
  },
  "ask.empty_hint": {
    en: "Tasks, finance, relationships, notes, workflows — one connected graph, this workspace only.",
    pl: "Zadania, finanse, relacje, notatki, przepływy — jeden połączony graf, tylko ta przestrzeń.",
    ru: "Задачи, финансы, связи, заметки, процессы — один связанный граф, только это пространство.",
    uk: "Завдання, фінанси, зв’язки, нотатки, процеси — один зв’язаний граф, лише цей простір.",
    ar: "المهام والمالية والعلاقات والملاحظات وسير العمل — رسم واحد متصل، هذه المساحة فقط.",
    fr: "Tâches, finances, relations, notes, workflows — un seul graphe connecté, cet espace uniquement.",
    de: "Aufgaben, Finanzen, Beziehungen, Notizen, Workflows — ein verbundener Graph, nur dieser Workspace.",
    es: "Tareas, finanzas, relaciones, notas, flujos — un grafo conectado, solo este espacio.",
    pt: "Tarefas, finanças, relações, notas, fluxos — um grafo conectado, apenas este espaço.",
    it: "Attività, finanze, relazioni, note, flussi — un grafo connesso, solo questo spazio.",
    tr: "Görevler, finans, ilişkiler, notlar, akışlar — tek bağlı grafik, yalnızca bu çalışma alanı.",
    nl: "Taken, financiën, relaties, notities, workflows — één verbonden graph, alleen deze workspace.",
  },

  // ── Localized placeholder defaults for template fills ──
  "tpl.who_default": {
    en: "your ideal customers", pl: "Twoi idealni klienci", ru: "ваши идеальные клиенты", uk: "ваші ідеальні клієнти",
    ar: "عملاؤك المثاليون", fr: "vos clients idéaux", de: "Ihre idealen Kunden", es: "tus clientes ideales",
    pt: "seus clientes ideais", it: "i tuoi clienti ideali", tr: "ideal müşterileriniz", nl: "je ideale klanten",
  },
  "tpl.region_default": {
    en: "your region", pl: "Twój region", ru: "ваш регион", uk: "ваш регіон", ar: "منطقتك", fr: "votre région",
    de: "Ihrer Region", es: "tu región", pt: "sua região", it: "la tua regione", tr: "bölgeniz", nl: "je regio",
  },

  // ── Localized DYNAMIC suggestion frames ({who}/{region}/{base} filled from the profile) ──
  "tpl.discovery": {
    en: ["Find {who} in {region}", "Reviews and complaints about {who}"],
    pl: ["Znajdź {who} w {region}", "Opinie i skargi na temat {who}"],
    ru: ["Найти {who} в {region}", "Отзывы и жалобы о {who}"],
    uk: ["Знайти {who} у {region}", "Відгуки та скарги про {who}"],
    ar: ["ابحث عن {who} في {region}", "المراجعات والشكاوى حول {who}"],
    fr: ["Trouver {who} à {region}", "Avis et plaintes sur {who}"],
    de: ["{who} in {region} finden", "Bewertungen und Beschwerden über {who}"],
    es: ["Encontrar {who} en {region}", "Reseñas y quejas sobre {who}"],
    pt: ["Encontrar {who} em {region}", "Avaliações e reclamações sobre {who}"],
    it: ["Trova {who} a {region}", "Recensioni e reclami su {who}"],
    tr: ["{region} bölgesindeki {who} bul", "{who} hakkında yorumlar ve şikayetler"],
    nl: ["Vind {who} in {region}", "Reviews en klachten over {who}"],
  },
  "tpl.discovery_next": {
    en: ["Reviews and complaints about {who}", "Similar {who} in a new region", "{who} that recently changed or expanded"],
    pl: ["Opinie i skargi na temat {who}", "Podobni {who} w nowym regionie", "{who}, którzy niedawno się zmienili lub rozrośli"],
    ru: ["Отзывы и жалобы о {who}", "Похожие {who} в новом регионе", "{who}, которые недавно изменились или выросли"],
    uk: ["Відгуки та скарги про {who}", "Схожі {who} у новому регіоні", "{who}, що нещодавно змінилися або зросли"],
    ar: ["المراجعات والشكاوى حول {who}", "{who} مماثلون في منطقة جديدة", "{who} الذين تغيّروا أو توسّعوا مؤخرًا"],
    fr: ["Avis et plaintes sur {who}", "{who} similaires dans une nouvelle région", "{who} ayant récemment changé ou grandi"],
    de: ["Bewertungen und Beschwerden über {who}", "Ähnliche {who} in einer neuen Region", "{who}, die sich kürzlich verändert oder vergrößert haben"],
    es: ["Reseñas y quejas sobre {who}", "{who} similares en una región nueva", "{who} que cambiaron o crecieron recientemente"],
    pt: ["Avaliações e reclamações sobre {who}", "{who} semelhantes em uma nova região", "{who} que mudaram ou cresceram recentemente"],
    it: ["Recensioni e reclami su {who}", "{who} simili in una nuova regione", "{who} che sono cambiati o cresciuti di recente"],
    tr: ["{who} hakkında yorumlar ve şikayetler", "Yeni bir bölgede benzer {who}", "Yakın zamanda değişen veya büyüyen {who}"],
    nl: ["Reviews en klachten over {who}", "Vergelijkbare {who} in een nieuwe regio", "{who} die recent zijn veranderd of gegroeid"],
  },
  "tpl.discovery_broad": {
    en: ["{base} in {region}", "{base} with public contact details"],
    pl: ["{base} w {region}", "{base} z publicznymi danymi kontaktowymi"],
    ru: ["{base} в {region}", "{base} с публичными контактными данными"],
    uk: ["{base} у {region}", "{base} з публічними контактними даними"],
    ar: ["{base} في {region}", "{base} مع بيانات اتصال عامة"],
    fr: ["{base} à {region}", "{base} avec coordonnées publiques"],
    de: ["{base} in {region}", "{base} mit öffentlichen Kontaktdaten"],
    es: ["{base} en {region}", "{base} con datos de contacto públicos"],
    pt: ["{base} em {region}", "{base} com dados de contato públicos"],
    it: ["{base} a {region}", "{base} con contatti pubblici"],
    tr: ["{region} bölgesinde {base}", "Herkese açık iletişim bilgileriyle {base}"],
    nl: ["{base} in {region}", "{base} met openbare contactgegevens"],
  },
  "tpl.ask": {
    en: ["Show what needs attention today", "Summarize this week", "Draft a follow-up for a stalled item"],
    pl: ["Pokaż, co wymaga uwagi dzisiaj", "Podsumuj ten tydzień", "Napisz follow-up dla utkniętej sprawy"],
    ru: ["Покажи, что требует внимания сегодня", "Подведи итоги недели", "Составь напоминание по застопорившемуся делу"],
    uk: ["Покажи, що потребує уваги сьогодні", "Підсумуй цей тиждень", "Склади нагадування для застряглої справи"],
    ar: ["أظهر ما يحتاج إلى اهتمام اليوم", "لخّص هذا الأسبوع", "اكتب رسالة متابعة لعنصر متوقف"],
    fr: ["Montre ce qui nécessite mon attention aujourd’hui", "Résume cette semaine", "Rédige une relance pour un dossier bloqué"],
    de: ["Zeig, was heute Aufmerksamkeit braucht", "Fasse diese Woche zusammen", "Entwirf eine Nachfass-Nachricht für einen stockenden Vorgang"],
    es: ["Muestra qué necesita atención hoy", "Resume esta semana", "Redacta un seguimiento para un caso estancado"],
    pt: ["Mostre o que precisa de atenção hoje", "Resuma esta semana", "Escreva um follow-up para um item parado"],
    it: ["Mostra cosa richiede attenzione oggi", "Riepiloga questa settimana", "Scrivi un follow-up per un elemento fermo"],
    tr: ["Bugün dikkat gerektirenleri göster", "Bu haftayı özetle", "Takılmış bir öğe için takip mesajı yaz"],
    nl: ["Laat zien wat vandaag aandacht nodig heeft", "Vat deze week samen", "Schrijf een follow-up voor een vastgelopen item"],
  },
  "tpl.home_attention": {
    en: "What needs my attention right now? Rank by urgency and tell me exactly what to do.",
    pl: "Co wymaga mojej uwagi teraz? Uszereguj według pilności i powiedz dokładnie, co zrobić.",
    ru: "Что требует моего внимания прямо сейчас? Отсортируй по срочности и скажи, что именно делать.",
    uk: "Що потребує моєї уваги зараз? Відсортуй за терміновістю і скажи, що саме робити.",
    ar: "ما الذي يحتاج إلى انتباهي الآن؟ رتّبه حسب الأولوية وأخبرني بما يجب فعله بالضبط.",
    fr: "Qu’est-ce qui nécessite mon attention maintenant ? Classe par urgence et dis-moi quoi faire.",
    de: "Was braucht jetzt meine Aufmerksamkeit? Nach Dringlichkeit ordnen und mir genau sagen, was zu tun ist.",
    es: "¿Qué necesita mi atención ahora? Ordénalo por urgencia y dime exactamente qué hacer.",
    pt: "O que precisa da minha atenção agora? Ordene por urgência e diga exatamente o que fazer.",
    it: "Cosa richiede la mia attenzione ora? Ordina per urgenza e dimmi esattamente cosa fare.",
    tr: "Şu anda neyle ilgilenmeliyim? Aciliyete göre sırala ve tam olarak ne yapacağımı söyle.",
    nl: "Wat heeft nu mijn aandacht nodig? Rangschik op urgentie en zeg precies wat ik moet doen.",
  },
  "tpl.home_decisions": {
    en: "What decisions are waiting on me? Summarize each with the context I need, and recommend an action.",
    pl: "Jakie decyzje czekają na mnie? Podsumuj każdą z potrzebnym kontekstem i zaproponuj działanie.",
    ru: "Какие решения ждут меня? Кратко опиши каждое с нужным контекстом и предложи действие.",
    uk: "Які рішення чекають на мене? Стисло опиши кожне з потрібним контекстом і запропонуй дію.",
    ar: "ما القرارات التي تنتظرني؟ لخّص كلًّا منها بالسياق اللازم واقترح إجراءً.",
    fr: "Quelles décisions m’attendent ? Résume chacune avec le contexte utile et recommande une action.",
    de: "Welche Entscheidungen warten auf mich? Fasse jede mit dem nötigen Kontext zusammen und empfiehl eine Aktion.",
    es: "¿Qué decisiones me esperan? Resume cada una con el contexto necesario y recomienda una acción.",
    pt: "Quais decisões estão à minha espera? Resuma cada uma com o contexto necessário e recomende uma ação.",
    it: "Quali decisioni mi aspettano? Riepiloga ciascuna con il contesto necessario e consiglia un’azione.",
    tr: "Beni bekleyen kararlar neler? Her birini gerekli bağlamla özetle ve bir aksiyon öner.",
    nl: "Welke beslissingen wachten op mij? Vat elk samen met de nodige context en beveel een actie aan.",
  },
  "tpl.home_discovery": {
    en: "Find {who} in {region} on the web and bring back source-backed prospects.",
    pl: "Znajdź {who} w {region} w sieci i zwróć zweryfikowane kontakty.",
    ru: "Найди {who} в {region} в интернете и верни проверённые контакты.",
    uk: "Знайди {who} у {region} в інтернеті та поверни перевірені контакти.",
    ar: "ابحث عن {who} في {region} على الويب وأعد عملاء محتملين موثّقين بالمصادر.",
    fr: "Trouve {who} à {region} sur le web et rapporte des prospects sourcés.",
    de: "Finde {who} in {region} im Web und liefere quellenbasierte Kontakte.",
    es: "Encuentra {who} en {region} en la web y trae prospectos con fuentes.",
    pt: "Encontre {who} em {region} na web e traga leads com fontes.",
    it: "Trova {who} a {region} sul web e riporta contatti con fonti.",
    tr: "{region} bölgesindeki {who} web’de bul ve kaynaklı müşteri adayları getir.",
    nl: "Vind {who} in {region} op het web en lever onderbouwde leads.",
  },

  // ── Common buttons / verbs (single words — reused everywhere) ──
  "common.save":    { en: "Save", pl: "Zapisz", ru: "Сохранить", uk: "Зберегти", ar: "حفظ", fr: "Enregistrer", de: "Speichern", es: "Guardar", pt: "Salvar", it: "Salva", tr: "Kaydet", nl: "Opslaan" },
  "common.cancel":  { en: "Cancel", pl: "Anuluj", ru: "Отмена", uk: "Скасувати", ar: "إلغاء", fr: "Annuler", de: "Abbrechen", es: "Cancelar", pt: "Cancelar", it: "Annulla", tr: "İptal", nl: "Annuleren" },
  "common.delete":  { en: "Delete", pl: "Usuń", ru: "Удалить", uk: "Видалити", ar: "حذف", fr: "Supprimer", de: "Löschen", es: "Eliminar", pt: "Excluir", it: "Elimina", tr: "Sil", nl: "Verwijderen" },
  "common.edit":    { en: "Edit", pl: "Edytuj", ru: "Изменить", uk: "Редагувати", ar: "تعديل", fr: "Modifier", de: "Bearbeiten", es: "Editar", pt: "Editar", it: "Modifica", tr: "Düzenle", nl: "Bewerken" },
  "common.filter":  { en: "Filter", pl: "Filtruj", ru: "Фильтр", uk: "Фільтр", ar: "تصفية", fr: "Filtrer", de: "Filter", es: "Filtrar", pt: "Filtrar", it: "Filtra", tr: "Filtrele", nl: "Filter" },
  "common.search":  { en: "Search", pl: "Szukaj", ru: "Поиск", uk: "Пошук", ar: "بحث", fr: "Rechercher", de: "Suchen", es: "Buscar", pt: "Pesquisar", it: "Cerca", tr: "Ara", nl: "Zoeken" },
  "common.create":  { en: "Create", pl: "Utwórz", ru: "Создать", uk: "Створити", ar: "إنشاء", fr: "Créer", de: "Erstellen", es: "Crear", pt: "Criar", it: "Crea", tr: "Oluştur", nl: "Aanmaken" },
  "common.add":     { en: "Add", pl: "Dodaj", ru: "Добавить", uk: "Додати", ar: "إضافة", fr: "Ajouter", de: "Hinzufügen", es: "Añadir", pt: "Adicionar", it: "Aggiungi", tr: "Ekle", nl: "Toevoegen" },
  "common.remove":  { en: "Remove", pl: "Usuń", ru: "Убрать", uk: "Прибрати", ar: "إزالة", fr: "Retirer", de: "Entfernen", es: "Quitar", pt: "Remover", it: "Rimuovi", tr: "Kaldır", nl: "Verwijderen" },
  "common.assign":  { en: "Assign", pl: "Przypisz", ru: "Назначить", uk: "Призначити", ar: "تعيين", fr: "Attribuer", de: "Zuweisen", es: "Asignar", pt: "Atribuir", it: "Assegna", tr: "Ata", nl: "Toewijzen" },
  "common.approve": { en: "Approve", pl: "Zatwierdź", ru: "Одобрить", uk: "Схвалити", ar: "موافقة", fr: "Approuver", de: "Genehmigen", es: "Aprobar", pt: "Aprovar", it: "Approva", tr: "Onayla", nl: "Goedkeuren" },
  "common.reject":  { en: "Reject", pl: "Odrzuć", ru: "Отклонить", uk: "Відхилити", ar: "رفض", fr: "Rejeter", de: "Ablehnen", es: "Rechazar", pt: "Rejeitar", it: "Rifiuta", tr: "Reddet", nl: "Afwijzen" },
  "common.snooze":  { en: "Snooze", pl: "Odłóż", ru: "Отложить", uk: "Відкласти", ar: "تأجيل", fr: "Reporter", de: "Später", es: "Posponer", pt: "Adiar", it: "Posticipa", tr: "Ertele", nl: "Uitstellen" },
  "common.open":    { en: "Open", pl: "Otwórz", ru: "Открыть", uk: "Відкрити", ar: "فتح", fr: "Ouvrir", de: "Öffnen", es: "Abrir", pt: "Abrir", it: "Apri", tr: "Aç", nl: "Openen" },
  "common.close":   { en: "Close", pl: "Zamknij", ru: "Закрыть", uk: "Закрити", ar: "إغلاق", fr: "Fermer", de: "Schließen", es: "Cerrar", pt: "Fechar", it: "Chiudi", tr: "Kapat", nl: "Sluiten" },
  "common.back":    { en: "Back", pl: "Wstecz", ru: "Назад", uk: "Назад", ar: "رجوع", fr: "Retour", de: "Zurück", es: "Atrás", pt: "Voltar", it: "Indietro", tr: "Geri", nl: "Terug" },
  "common.next":    { en: "Next", pl: "Dalej", ru: "Далее", uk: "Далі", ar: "التالي", fr: "Suivant", de: "Weiter", es: "Siguiente", pt: "Próximo", it: "Avanti", tr: "İleri", nl: "Volgende" },

  // ── Sidebar / nav labels ──
  "nav.home":          { en: "Home", pl: "Start", ru: "Главная", uk: "Головна", ar: "الرئيسية", fr: "Accueil", de: "Start", es: "Inicio", pt: "Início", it: "Home", tr: "Ana Sayfa", nl: "Home" },
  "nav.ask":           { en: "Ask", pl: "Zapytaj", ru: "Спросить", uk: "Запитати", ar: "اسأل", fr: "Demander", de: "Fragen", es: "Preguntar", pt: "Perguntar", it: "Chiedi", tr: "Sor", nl: "Vragen" },
  "nav.graph":         { en: "Graph", pl: "Graf", ru: "Граф", uk: "Граф", ar: "الرسم البياني", fr: "Graphe", de: "Graph", es: "Grafo", pt: "Grafo", it: "Grafo", tr: "Grafik", nl: "Graph" },
  "nav.tasks":         { en: "Tasks", pl: "Zadania", ru: "Задачи", uk: "Завдання", ar: "المهام", fr: "Tâches", de: "Aufgaben", es: "Tareas", pt: "Tarefas", it: "Attività", tr: "Görevler", nl: "Taken" },
  "nav.decisions":     { en: "Decisions", pl: "Decyzje", ru: "Решения", uk: "Рішення", ar: "القرارات", fr: "Décisions", de: "Entscheidungen", es: "Decisiones", pt: "Decisões", it: "Decisioni", tr: "Kararlar", nl: "Beslissingen" },
  "nav.agents":        { en: "Agents", pl: "Agenci", ru: "Агенты", uk: "Агенти", ar: "الوكلاء", fr: "Agents", de: "Agenten", es: "Agentes", pt: "Agentes", it: "Agenti", tr: "Ajanlar", nl: "Agents" },
  "nav.discovery":     { en: "Discovery", pl: "Odkrywanie", ru: "Поиск", uk: "Пошук", ar: "الاكتشاف", fr: "Découverte", de: "Discovery", es: "Descubrimiento", pt: "Descoberta", it: "Scoperta", tr: "Keşif", nl: "Ontdekken" },
  "nav.automations":   { en: "Automations", pl: "Automatyzacje", ru: "Автоматизации", uk: "Автоматизації", ar: "الأتمتة", fr: "Automatisations", de: "Automationen", es: "Automatizaciones", pt: "Automações", it: "Automazioni", tr: "Otomasyonlar", nl: "Automatiseringen" },
  "nav.reports":       { en: "Reports", pl: "Raporty", ru: "Отчёты", uk: "Звіти", ar: "التقارير", fr: "Rapports", de: "Berichte", es: "Informes", pt: "Relatórios", it: "Report", tr: "Raporlar", nl: "Rapporten" },
  "nav.notifications": { en: "Notifications", pl: "Powiadomienia", ru: "Уведомления", uk: "Сповіщення", ar: "الإشعارات", fr: "Notifications", de: "Benachrichtigungen", es: "Notificaciones", pt: "Notificações", it: "Notifiche", tr: "Bildirimler", nl: "Meldingen" },
  "nav.inbox":         { en: "Inbox", pl: "Skrzynka", ru: "Входящие", uk: "Вхідні", ar: "الوارد", fr: "Boîte de réception", de: "Posteingang", es: "Bandeja", pt: "Caixa de entrada", it: "In arrivo", tr: "Gelen kutusu", nl: "Postvak" },
  "nav.notes":         { en: "Notes", pl: "Notatki", ru: "Заметки", uk: "Нотатки", ar: "الملاحظات", fr: "Notes", de: "Notizen", es: "Notas", pt: "Notas", it: "Note", tr: "Notlar", nl: "Notities" },
  "nav.emails":        { en: "Emails", pl: "E-maile", ru: "Письма", uk: "Листи", ar: "الرسائل", fr: "E-mails", de: "E-Mails", es: "Correos", pt: "E-mails", it: "Email", tr: "E-postalar", nl: "E-mails" },
  "nav.calls":         { en: "Calls", pl: "Połączenia", ru: "Звонки", uk: "Дзвінки", ar: "المكالمات", fr: "Appels", de: "Anrufe", es: "Llamadas", pt: "Chamadas", it: "Chiamate", tr: "Aramalar", nl: "Gesprekken" },
  "nav.canvas":        { en: "Canvas", pl: "Kanwa", ru: "Холст", uk: "Полотно", ar: "اللوحة", fr: "Canevas", de: "Canvas", es: "Lienzo", pt: "Tela", it: "Canvas", tr: "Tuval", nl: "Canvas" },
  "nav.team_oversight":{ en: "Team Oversight", pl: "Nadzór zespołu", ru: "Контроль команды", uk: "Нагляд за командою", ar: "إشراف الفريق", fr: "Supervision d’équipe", de: "Team-Übersicht", es: "Supervisión del equipo", pt: "Supervisão da equipe", it: "Supervisione team", tr: "Ekip Gözetimi", nl: "Teamtoezicht" },

  // ── Section labels ──
  "section.work":      { en: "Work", pl: "Praca", ru: "Работа", uk: "Робота", ar: "العمل", fr: "Travail", de: "Arbeit", es: "Trabajo", pt: "Trabalho", it: "Lavoro", tr: "Çalışma", nl: "Werk" },
  "section.workspace": { en: "Workspace", pl: "Przestrzeń", ru: "Пространство", uk: "Простір", ar: "مساحة العمل", fr: "Espace", de: "Workspace", es: "Espacio", pt: "Espaço", it: "Spazio", tr: "Çalışma alanı", nl: "Workspace" },
  "section.finance":   { en: "Finance", pl: "Finanse", ru: "Финансы", uk: "Фінанси", ar: "المالية", fr: "Finance", de: "Finanzen", es: "Finanzas", pt: "Finanças", it: "Finanza", tr: "Finans", nl: "Financiën" },
  "settings.you":  { en: "You", pl: "Ty", ru: "Вы", uk: "Ви", ar: "أنت", fr: "Vous", de: "Du", es: "Tú", pt: "Você", it: "Tu", tr: "Sen", nl: "Jij" },
  "settings.plan": { en: "Plan", pl: "Plan", ru: "Тариф", uk: "Тариф", ar: "الخطة", fr: "Formule", de: "Tarif", es: "Plan", pt: "Plano", it: "Piano", tr: "Plan", nl: "Abonnement" },
  "settings.title":{ en: "Settings", pl: "Ustawienia", ru: "Настройки", uk: "Налаштування", ar: "الإعدادات", fr: "Paramètres", de: "Einstellungen", es: "Ajustes", pt: "Configurações", it: "Impostazioni", tr: "Ayarlar", nl: "Instellingen" },

  // ── Generic empty / loading states ──
  "state.empty":    { en: "Nothing here yet", pl: "Jeszcze nic tu nie ma", ru: "Здесь пока пусто", uk: "Тут поки порожньо", ar: "لا شيء هنا بعد", fr: "Rien pour l’instant", de: "Noch nichts hier", es: "Aún no hay nada", pt: "Nada aqui ainda", it: "Ancora niente qui", tr: "Henüz burada bir şey yok", nl: "Nog niets hier" },
  "state.loading":  { en: "Loading…", pl: "Ładowanie…", ru: "Загрузка…", uk: "Завантаження…", ar: "جارٍ التحميل…", fr: "Chargement…", de: "Wird geladen…", es: "Cargando…", pt: "Carregando…", it: "Caricamento…", tr: "Yükleniyor…", nl: "Laden…" },

  // ── Language selector chrome ──
  "lang.follow_workspace": { en: "Follow workspace default", pl: "Zgodnie z domyślnym językiem przestrzeni", ru: "Как в рабочем пространстве", uk: "Як у робочому просторі", ar: "اتّبع لغة مساحة العمل", fr: "Langue par défaut de l’espace", de: "Workspace-Standard folgen", es: "Seguir el idioma del espacio", pt: "Seguir o idioma do espaço", it: "Usa la lingua dello spazio", tr: "Çalışma alanı varsayılanı", nl: "Volg workspace-standaard" },
  "lang.select": { en: "Language", pl: "Język", ru: "Язык", uk: "Мова", ar: "اللغة", fr: "Langue", de: "Sprache", es: "Idioma", pt: "Idioma", it: "Lingua", tr: "Dil", nl: "Taal" },

  // ── Public landing footer (marketing) ──
  "landing.tagline": {
    en: "Autonomous AI workspace platform. Built for teams that move fast.",
    pl: "Autonomiczna platforma AI. Stworzona dla zespołów, które działają szybko.",
    ru: "Платформа автономного ИИ-пространства. Для команд, которые двигаются быстро.",
    uk: "Платформа автономного ШІ-простору. Для команд, які працюють швидко.",
    ar: "منصة مساحة عمل ذكاء اصطناعي مستقلة. مبنية لفرق تتحرك بسرعة.",
    fr: "Plateforme d’espace de travail IA autonome. Conçue pour les équipes rapides.",
    de: "Autonome KI-Workspace-Plattform. Für Teams, die schnell handeln.",
    es: "Plataforma de espacio de trabajo con IA autónoma. Para equipos que van rápido.",
    pt: "Plataforma de espaço de trabalho com IA autônoma. Para equipes ágeis.",
    it: "Piattaforma di workspace IA autonoma. Per team che vanno veloci.",
    tr: "Otonom yapay zekâ çalışma alanı platformu. Hızlı hareket eden ekipler için.",
    nl: "Autonoom AI-workspaceplatform. Gebouwd voor teams die snel bewegen.",
  },
  "landing.footer.product":  { en: "Product", pl: "Produkt", ru: "Продукт", uk: "Продукт", ar: "المنتج", fr: "Produit", de: "Produkt", es: "Producto", pt: "Produto", it: "Prodotto", tr: "Ürün", nl: "Product" },
  "landing.footer.platform": { en: "Platform", pl: "Platforma", ru: "Платформа", uk: "Платформа", ar: "المنصة", fr: "Plateforme", de: "Plattform", es: "Plataforma", pt: "Plataforma", it: "Piattaforma", tr: "Platform", nl: "Platform" },
  "landing.footer.legal":    { en: "Legal", pl: "Prawne", ru: "Правовое", uk: "Правове", ar: "قانوني", fr: "Mentions légales", de: "Rechtliches", es: "Legal", pt: "Jurídico", it: "Legale", tr: "Yasal", nl: "Juridisch" },
  "landing.footer.contact":  { en: "Contact", pl: "Kontakt", ru: "Контакты", uk: "Контакти", ar: "اتصل بنا", fr: "Contact", de: "Kontakt", es: "Contacto", pt: "Contato", it: "Contatti", tr: "İletişim", nl: "Contact" },
  "landing.rights":          { en: "All rights reserved.", pl: "Wszelkie prawa zastrzeżone.", ru: "Все права защищены.", uk: "Усі права захищені.", ar: "جميع الحقوق محفوظة.", fr: "Tous droits réservés.", de: "Alle Rechte vorbehalten.", es: "Todos los derechos reservados.", pt: "Todos os direitos reservados.", it: "Tutti i diritti riservati.", tr: "Tüm hakları saklıdır.", nl: "Alle rechten voorbehouden." },

  // ── Tasks page ──
  "tasks.new":         { en: "New Task", pl: "Nowe zadanie", ru: "Новая задача", uk: "Нове завдання", ar: "مهمة جديدة", fr: "Nouvelle tâche", de: "Neue Aufgabe", es: "Nueva tarea", pt: "Nova tarefa", it: "Nuova attività", tr: "Yeni görev", nl: "Nieuwe taak" },
  "tasks.empty":       { en: "No tasks", pl: "Brak zadań", ru: "Нет задач", uk: "Немає завдань", ar: "لا توجد مهام", fr: "Aucune tâche", de: "Keine Aufgaben", es: "Sin tareas", pt: "Sem tarefas", it: "Nessuna attività", tr: "Görev yok", nl: "Geen taken" },
  "tasks.caught_up":   { en: "You're all caught up.", pl: "Wszystko na bieżąco.", ru: "Всё сделано.", uk: "Усе виконано.", ar: "أنجزت كل شيء.", fr: "Vous êtes à jour.", de: "Alles erledigt.", es: "Estás al día.", pt: "Está tudo em dia.", it: "Sei aggiornato.", tr: "Her şey tamam.", nl: "Je bent helemaal bij." },
  "tasks.filter.mine":    { en: "Mine", pl: "Moje", ru: "Мои", uk: "Мої", ar: "مهامي", fr: "Les miennes", de: "Meine", es: "Mías", pt: "Minhas", it: "Le mie", tr: "Benimkiler", nl: "Van mij" },
  "tasks.filter.all":     { en: "All", pl: "Wszystkie", ru: "Все", uk: "Усі", ar: "الكل", fr: "Toutes", de: "Alle", es: "Todas", pt: "Todas", it: "Tutte", tr: "Tümü", nl: "Alle" },
  "tasks.filter.overdue": { en: "Overdue", pl: "Zaległe", ru: "Просроченные", uk: "Прострочені", ar: "متأخرة", fr: "En retard", de: "Überfällig", es: "Vencidas", pt: "Atrasadas", it: "In ritardo", tr: "Gecikmiş", nl: "Te laat" },
  "tasks.filter.review":  { en: "Review", pl: "Do przeglądu", ru: "На проверке", uk: "На перевірці", ar: "قيد المراجعة", fr: "À revoir", de: "Zu prüfen", es: "Revisión", pt: "Revisão", it: "Da rivedere", tr: "İnceleme", nl: "Beoordelen" },

  // ── Decisions cockpit ──
  "decisions.empty":     { en: "No decisions waiting", pl: "Brak decyzji do podjęcia", ru: "Нет решений в ожидании", uk: "Немає рішень в очікуванні", ar: "لا قرارات في الانتظار", fr: "Aucune décision en attente", de: "Keine ausstehenden Entscheidungen", es: "Sin decisiones pendientes", pt: "Sem decisões pendentes", it: "Nessuna decisione in attesa", tr: "Bekleyen karar yok", nl: "Geen beslissingen in afwachting" },
  "decisions.approve_safe": { en: "Approve all safe", pl: "Zatwierdź bezpieczne", ru: "Одобрить безопасные", uk: "Схвалити безпечні", ar: "الموافقة على الآمنة", fr: "Approuver les sûres", de: "Alle sicheren genehmigen", es: "Aprobar las seguras", pt: "Aprovar as seguras", it: "Approva quelle sicure", tr: "Güvenli olanları onayla", nl: "Veilige goedkeuren" },

  // ── Notifications ──
  "notifications.mark_all":  { en: "Mark all read", pl: "Oznacz wszystkie jako przeczytane", ru: "Отметить всё прочитанным", uk: "Позначити все прочитаним", ar: "تعليم الكل كمقروء", fr: "Tout marquer comme lu", de: "Alle als gelesen markieren", es: "Marcar todo como leído", pt: "Marcar tudo como lido", it: "Segna tutto come letto", tr: "Tümünü okundu işaretle", nl: "Alles als gelezen markeren" },
  "notifications.caught_up": { en: "All caught up", pl: "Wszystko na bieżąco", ru: "Всё прочитано", uk: "Усе прочитано", ar: "لا جديد", fr: "Tout est à jour", de: "Alles gelesen", es: "Todo al día", pt: "Tudo em dia", it: "Tutto aggiornato", tr: "Her şey güncel", nl: "Helemaal bij" },

  // ── Agents / Activity ──
  "home.quick_prompts": { en: "Quick prompts", pl: "Szybkie polecenia", ru: "Быстрые запросы", uk: "Швидкі запити", ar: "أوامر سريعة", fr: "Invites rapides", de: "Schnellbefehle", es: "Sugerencias rápidas", pt: "Comandos rápidos", it: "Prompt rapidi", tr: "Hızlı komutlar", nl: "Snelle prompts" },
  "home.today":         { en: "Today", pl: "Dzisiaj", ru: "Сегодня", uk: "Сьогодні", ar: "اليوم", fr: "Aujourd’hui", de: "Heute", es: "Hoy", pt: "Hoje", it: "Oggi", tr: "Bugün", nl: "Vandaag" },

  // ── Help / Support agent ──
  "help.title":        { en: "Help & Support", pl: "Pomoc i wsparcie", ru: "Помощь и поддержка", uk: "Довідка та підтримка", ar: "المساعدة والدعم", fr: "Aide et support", de: "Hilfe & Support", es: "Ayuda y soporte", pt: "Ajuda e suporte", it: "Aiuto e supporto", tr: "Yardım ve destek", nl: "Hulp en ondersteuning" },
  "help.placeholder":  { en: "Ask a question about Mondaily…", pl: "Zadaj pytanie o Mondaily…", ru: "Задайте вопрос о Mondaily…", uk: "Поставте запитання про Mondaily…", ar: "اطرح سؤالاً عن Mondaily…", fr: "Posez une question sur Mondaily…", de: "Stellen Sie eine Frage zu Mondaily…", es: "Haz una pregunta sobre Mondaily…", pt: "Faça uma pergunta sobre o Mondaily…", it: "Fai una domanda su Mondaily…", tr: "Mondaily hakkında bir soru sorun…", nl: "Stel een vraag over Mondaily…" },
  "help.subtitle":     { en: "Answers use your workspace's real data. I can't change your account — I'll open a request for anything sensitive.", pl: "Odpowiedzi korzystają z rzeczywistych danych Twojej przestrzeni. Nie mogę zmieniać konta — dla wrażliwych spraw otworzę zgłoszenie.", ru: "Ответы основаны на реальных данных вашего пространства. Я не меняю аккаунт — по важным вопросам создам запрос.", uk: "Відповіді базуються на реальних даних простору. Я не змінюю акаунт — для важливих питань створю запит.", ar: "الإجابات تستند إلى بيانات مساحتك الحقيقية. لا يمكنني تغيير حسابك — سأفتح طلبًا لأي أمر حساس.", fr: "Les réponses utilisent les données réelles de votre espace. Je ne peux pas modifier votre compte — j'ouvrirai une demande pour tout élément sensible.", de: "Antworten nutzen die echten Daten Ihres Workspace. Ich kann Ihr Konto nicht ändern — für Sensibles öffne ich eine Anfrage.", es: "Las respuestas usan los datos reales de tu espacio. No puedo cambiar tu cuenta — abriré una solicitud para lo sensible.", pt: "As respostas usam os dados reais do seu espaço. Não posso alterar sua conta — abrirei uma solicitação para o que for sensível.", it: "Le risposte usano i dati reali del tuo spazio. Non posso modificare il tuo account — aprirò una richiesta per le cose sensibili.", tr: "Yanıtlar çalışma alanınızın gerçek verilerini kullanır. Hesabınızı değiştiremem — hassas konularda talep açarım.", nl: "Antwoorden gebruiken de echte gegevens van je workspace. Ik kan je account niet wijzigen — voor gevoelige zaken open ik een verzoek." },
  "help.create_ticket":{ en: "Create support request", pl: "Utwórz zgłoszenie", ru: "Создать запрос", uk: "Створити запит", ar: "إنشاء طلب دعم", fr: "Créer une demande", de: "Anfrage erstellen", es: "Crear solicitud", pt: "Criar solicitação", it: "Crea richiesta", tr: "Destek talebi oluştur", nl: "Verzoek aanmaken" },
  "help.ticket_created":{ en: "Support request created — our team will follow up.", pl: "Zgłoszenie utworzone — nasz zespół się odezwie.", ru: "Запрос создан — наша команда свяжется с вами.", uk: "Запит створено — наша команда зв’яжеться з вами.", ar: "تم إنشاء طلب الدعم — سيتابع فريقنا معك.", fr: "Demande créée — notre équipe vous recontactera.", de: "Anfrage erstellt — unser Team meldet sich.", es: "Solicitud creada — nuestro equipo te contactará.", pt: "Solicitação criada — nossa equipe entrará em contato.", it: "Richiesta creata — il nostro team ti ricontatterà.", tr: "Talep oluşturuldu — ekibimiz sizinle iletişime geçecek.", nl: "Verzoek aangemaakt — ons team neemt contact op." },
  "support.title": { en: "Support", pl: "Wsparcie", ru: "Поддержка", uk: "Підтримка", ar: "الدعم", fr: "Support", de: "Support", es: "Soporte", pt: "Suporte", it: "Supporto", tr: "Destek", nl: "Ondersteuning" },
  "support.my_requests": { en: "My support requests", pl: "Moje zgłoszenia", ru: "Мои обращения", uk: "Мої звернення", ar: "طلبات الدعم الخاصة بي", fr: "Mes demandes", de: "Meine Anfragen", es: "Mis solicitudes", pt: "Minhas solicitações", it: "Le mie richieste", tr: "Taleplerim", nl: "Mijn verzoeken" },
  "support.new_request": { en: "New request", pl: "Nowe zgłoszenie", ru: "Новое обращение", uk: "Нове звернення", ar: "طلب جديد", fr: "Nouvelle demande", de: "Neue Anfrage", es: "Nueva solicitud", pt: "Nova solicitação", it: "Nuova richiesta", tr: "Yeni talep", nl: "Nieuw verzoek" },
  "support.reply": { en: "Reply", pl: "Odpowiedz", ru: "Ответить", uk: "Відповісти", ar: "رد", fr: "Répondre", de: "Antworten", es: "Responder", pt: "Responder", it: "Rispondi", tr: "Yanıtla", nl: "Antwoorden" },
  "support.empty": { en: "No support requests yet.", pl: "Brak zgłoszeń.", ru: "Пока нет обращений.", uk: "Поки немає звернень.", ar: "لا توجد طلبات دعم بعد.", fr: "Aucune demande pour l'instant.", de: "Noch keine Anfragen.", es: "Aún no hay solicitudes.", pt: "Ainda sem solicitações.", it: "Ancora nessuna richiesta.", tr: "Henüz talep yok.", nl: "Nog geen verzoeken." },
  "support.status.open": { en: "Open", pl: "Otwarte", ru: "Открыто", uk: "Відкрито", ar: "مفتوح", fr: "Ouvert", de: "Offen", es: "Abierto", pt: "Aberto", it: "Aperto", tr: "Açık", nl: "Open" },
  "support.status.in_review": { en: "In review", pl: "W trakcie", ru: "На рассмотрении", uk: "На розгляді", ar: "قيد المراجعة", fr: "En cours", de: "In Prüfung", es: "En revisión", pt: "Em análise", it: "In esame", tr: "İncelemede", nl: "In behandeling" },
  "support.status.waiting_on_user": { en: "Waiting on you", pl: "Oczekuje na Ciebie", ru: "Ожидает вас", uk: "Очікує на вас", ar: "بانتظارك", fr: "En attente de vous", de: "Wartet auf Sie", es: "Esperándote", pt: "Aguardando você", it: "In attesa di te", tr: "Sizi bekliyor", nl: "Wacht op jou" },
  "support.status.resolved": { en: "Resolved", pl: "Rozwiązane", ru: "Решено", uk: "Вирішено", ar: "تم الحل", fr: "Résolu", de: "Gelöst", es: "Resuelto", pt: "Resolvido", it: "Risolto", tr: "Çözüldü", nl: "Opgelost" },
  "support.status.closed": { en: "Closed", pl: "Zamknięte", ru: "Закрыто", uk: "Закрито", ar: "مغلق", fr: "Fermé", de: "Geschlossen", es: "Cerrado", pt: "Fechado", it: "Chiuso", tr: "Kapalı", nl: "Gesloten" },
  "agents.subtitle": { en: "Agents prepare, you approve — every action is queued for your sign-off.", pl: "Agenci przygotowują, Ty zatwierdzasz — każda akcja czeka na Twoją zgodę.", ru: "Агенты готовят, вы одобряете — каждое действие ждёт вашего подтверждения.", uk: "Агенти готують, ви схвалюєте — кожна дія очікує вашого підтвердження.", ar: "الوكلاء يجهّزون، وأنت توافق — كل إجراء ينتظر موافقتك.", fr: "Les agents préparent, vous approuvez — chaque action attend votre validation.", de: "Agenten bereiten vor, Sie genehmigen — jede Aktion wartet auf Ihre Freigabe.", es: "Los agentes preparan, tú apruebas — cada acción espera tu visto bueno.", pt: "Os agentes preparam, você aprova — cada ação aguarda seu aval.", it: "Gli agenti preparano, tu approvi — ogni azione attende il tuo via libera.", tr: "Ajanlar hazırlar, siz onaylarsınız — her işlem onayınızı bekler.", nl: "Agents bereiden voor, jij keurt goed — elke actie wacht op je akkoord." },
};

/** Look up a translated string. Falls back to English, then to the key itself. Never throws. */
export function t(code: string | null | undefined, key: string): string {
  const lang = normalizeLang(code);
  const entry = TRANSLATIONS[key];
  const val = (entry?.[lang] ?? entry?.en) as string | undefined;
  return typeof val === "string" ? val : key;
}

/** Look up a translated LIST (e.g. localized suggestion frames). English fallback, then []. */
export function tList(code: string | null | undefined, key: string): string[] {
  const lang = normalizeLang(code);
  const entry = TRANSLATIONS[key];
  const val = (entry?.[lang] ?? entry?.en) as string[] | undefined;
  return Array.isArray(val) ? val : [];
}

/** Fill {placeholders} in a template with data. Data values are inserted verbatim (they're the
 *  user's own words — industry/region/customers — so they stay in whatever language they were typed). */
export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? "").replace(/\s+/g, " ").trim();
}

/** The list of translation keys that currently have any localization (for tests/coverage). */
export const TRANSLATION_KEYS = Object.keys(TRANSLATIONS);
