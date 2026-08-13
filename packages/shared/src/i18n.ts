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
  "nav.calendar":      { en: "Calendar", pl: "Kalendarz", ru: "Календарь", uk: "Календар", ar: "التقويم", fr: "Calendrier", de: "Kalender", es: "Calendario", pt: "Calendário", it: "Calendario", tr: "Takvim", nl: "Agenda" },
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

  // ── Inbox / member chat ──
  "inbox.title": { en: "Inbox", pl: "Skrzynka", ru: "Входящие", uk: "Вхідні", ar: "الوارد", fr: "Boîte de réception", de: "Posteingang", es: "Bandeja", pt: "Caixa de entrada", it: "In arrivo", tr: "Gelen kutusu", nl: "Postvak" },
  "inbox.subtitle": { en: "Private messages with your workspace members.", pl: "Prywatne wiadomości z członkami przestrzeni.", ru: "Личные сообщения с участниками пространства.", uk: "Приватні повідомлення з учасниками простору.", ar: "رسائل خاصة مع أعضاء مساحة عملك.", fr: "Messages privés avec les membres de votre espace.", de: "Private Nachrichten mit Ihren Workspace-Mitgliedern.", es: "Mensajes privados con los miembros de tu espacio.", pt: "Mensagens privadas com os membros do seu espaço.", it: "Messaggi privati con i membri del tuo spazio.", tr: "Çalışma alanı üyelerinizle özel mesajlar.", nl: "Privéberichten met je workspace-leden." },
  "inbox.new_message": { en: "New message", pl: "Nowa wiadomość", ru: "Новое сообщение", uk: "Нове повідомлення", ar: "رسالة جديدة", fr: "Nouveau message", de: "Neue Nachricht", es: "Nuevo mensaje", pt: "Nova mensagem", it: "Nuovo messaggio", tr: "Yeni mesaj", nl: "Nieuw bericht" },
  "inbox.empty_title": { en: "No conversations yet", pl: "Brak rozmów", ru: "Пока нет бесед", uk: "Поки немає розмов", ar: "لا محادثات بعد", fr: "Aucune conversation", de: "Noch keine Unterhaltungen", es: "Aún no hay conversaciones", pt: "Ainda sem conversas", it: "Ancora nessuna conversazione", tr: "Henüz sohbet yok", nl: "Nog geen gesprekken" },
  "inbox.message_teammate": { en: "Message a teammate", pl: "Napisz do współpracownika", ru: "Написать коллеге", uk: "Написати колезі", ar: "راسل زميلاً", fr: "Écrire à un coéquipier", de: "Teammitglied schreiben", es: "Mensaje a un compañero", pt: "Enviar a um colega", it: "Scrivi a un collega", tr: "Bir ekip arkadaşına yaz", nl: "Bericht een teamgenoot" },
  "inbox.select_conversation": { en: "Select a conversation", pl: "Wybierz rozmowę", ru: "Выберите беседу", uk: "Виберіть розмову", ar: "اختر محادثة", fr: "Sélectionnez une conversation", de: "Unterhaltung auswählen", es: "Selecciona una conversación", pt: "Selecione uma conversa", it: "Seleziona una conversazione", tr: "Bir sohbet seçin", nl: "Selecteer een gesprek" },
  "inbox.no_messages": { en: "No messages yet — say hello.", pl: "Brak wiadomości — przywitaj się.", ru: "Пока нет сообщений — поздоровайтесь.", uk: "Поки немає повідомлень — привітайтеся.", ar: "لا رسائل بعد — ألقِ التحية.", fr: "Aucun message — dites bonjour.", de: "Noch keine Nachrichten — sag Hallo.", es: "Sin mensajes — saluda.", pt: "Sem mensagens — diga olá.", it: "Nessun messaggio — saluta.", tr: "Henüz mesaj yok — merhaba de.", nl: "Nog geen berichten — zeg hallo." },
  "inbox.write_message": { en: "Write a message…", pl: "Napisz wiadomość…", ru: "Напишите сообщение…", uk: "Напишіть повідомлення…", ar: "اكتب رسالة…", fr: "Écrire un message…", de: "Nachricht schreiben…", es: "Escribe un mensaje…", pt: "Escreva uma mensagem…", it: "Scrivi un messaggio…", tr: "Bir mesaj yaz…", nl: "Schrijf een bericht…" },
  "inbox.send": { en: "Send", pl: "Wyślij", ru: "Отправить", uk: "Надіслати", ar: "إرسال", fr: "Envoyer", de: "Senden", es: "Enviar", pt: "Enviar", it: "Invia", tr: "Gönder", nl: "Verzenden" },
  "inbox.search_members": { en: "Search members…", pl: "Szukaj członków…", ru: "Поиск участников…", uk: "Пошук учасників…", ar: "ابحث عن الأعضاء…", fr: "Rechercher des membres…", de: "Mitglieder suchen…", es: "Buscar miembros…", pt: "Buscar membros…", it: "Cerca membri…", tr: "Üye ara…", nl: "Zoek leden…" },

  // ── Calendar / meetings ──
  "cal.title": { en: "Calendar", pl: "Kalendarz", ru: "Календарь", uk: "Календар", ar: "التقويم", fr: "Calendrier", de: "Kalender", es: "Calendario", pt: "Calendário", it: "Calendario", tr: "Takvim", nl: "Agenda" },
  "cal.subtitle": { en: "Your Mondaily meetings.", pl: "Twoje spotkania Mondaily.", ru: "Ваши встречи Mondaily.", uk: "Ваші зустрічі Mondaily.", ar: "اجتماعات Mondaily الخاصة بك.", fr: "Vos réunions Mondaily.", de: "Ihre Mondaily-Meetings.", es: "Tus reuniones de Mondaily.", pt: "Suas reuniões do Mondaily.", it: "Le tue riunioni Mondaily.", tr: "Mondaily toplantılarınız.", nl: "Je Mondaily-vergaderingen." },
  "cal.new_meeting": { en: "New meeting", pl: "Nowe spotkanie", ru: "Новая встреча", uk: "Нова зустріч", ar: "اجتماع جديد", fr: "Nouvelle réunion", de: "Neues Meeting", es: "Nueva reunión", pt: "Nova reunião", it: "Nuova riunione", tr: "Yeni toplantı", nl: "Nieuwe vergadering" },
  "cal.empty": { en: "No upcoming meetings", pl: "Brak nadchodzących spotkań", ru: "Нет предстоящих встреч", uk: "Немає майбутніх зустрічей", ar: "لا اجتماعات قادمة", fr: "Aucune réunion à venir", de: "Keine anstehenden Meetings", es: "Sin reuniones próximas", pt: "Sem reuniões futuras", it: "Nessuna riunione in arrivo", tr: "Yaklaşan toplantı yok", nl: "Geen aankomende vergaderingen" },
  "cal.today": { en: "Today", pl: "Dzisiaj", ru: "Сегодня", uk: "Сьогодні", ar: "اليوم", fr: "Aujourd’hui", de: "Heute", es: "Hoy", pt: "Hoje", it: "Oggi", tr: "Bugün", nl: "Vandaag" },
  "cal.tomorrow": { en: "Tomorrow", pl: "Jutro", ru: "Завтра", uk: "Завтра", ar: "غدًا", fr: "Demain", de: "Morgen", es: "Mañana", pt: "Amanhã", it: "Domani", tr: "Yarın", nl: "Morgen" },
  "cal.title_field": { en: "Title", pl: "Tytuł", ru: "Название", uk: "Назва", ar: "العنوان", fr: "Titre", de: "Titel", es: "Título", pt: "Título", it: "Titolo", tr: "Başlık", nl: "Titel" },
  "cal.agenda": { en: "Agenda", pl: "Agenda", ru: "Повестка", uk: "Порядок денний", ar: "جدول الأعمال", fr: "Ordre du jour", de: "Agenda", es: "Agenda", pt: "Pauta", it: "Agenda", tr: "Gündem", nl: "Agenda" },
  "cal.end_before_start": { en: "The end time must be after the start time.", pl: "Czas zakończenia musi być późniejszy niż początek.", ru: "Время окончания должно быть позже начала.", uk: "Час завершення має бути пізніше початку.", ar: "يجب أن يكون وقت الانتهاء بعد وقت البدء.", fr: "L'heure de fin doit être postérieure à l'heure de début.", de: "Die Endzeit muss nach der Startzeit liegen.", es: "La hora de fin debe ser posterior a la de inicio.", pt: "A hora de término deve ser posterior à de início.", it: "L'ora di fine deve essere successiva a quella di inizio.", tr: "Bitiş saati başlangıçtan sonra olmalıdır.", nl: "De eindtijd moet na de starttijd liggen." },
  "cal.guests": { en: "Guests (outside your workspace)", pl: "Goście (spoza obszaru roboczego)", ru: "Гости (вне рабочего пространства)", uk: "Гості (поза робочим простором)", ar: "ضيوف (من خارج مساحة العمل)", fr: "Invités (hors de votre espace)", de: "Gäste (außerhalb Ihres Workspace)", es: "Invitados (fuera de tu espacio)", pt: "Convidados (fora do seu espaço)", it: "Ospiti (fuori dal tuo spazio)", tr: "Konuklar (çalışma alanı dışı)", nl: "Gasten (buiten je workspace)" },
  "cal.guest_placeholder": { en: "name@company.com", pl: "imie@firma.pl", ru: "name@company.com", uk: "name@company.com", ar: "name@company.com", fr: "nom@societe.com", de: "name@firma.de", es: "nombre@empresa.com", pt: "nome@empresa.com", it: "nome@azienda.com", tr: "ad@sirket.com", nl: "naam@bedrijf.nl" },
  "cal.guest_hint": { en: "They get an email invitation. No Mondaily account needed.", pl: "Otrzymają zaproszenie e-mailem. Konto Mondaily nie jest wymagane.", ru: "Они получат приглашение по электронной почте. Аккаунт Mondaily не нужен.", uk: "Вони отримають запрошення електронною поштою. Обліковий запис Mondaily не потрібен.", ar: "سيتلقون دعوة بالبريد الإلكتروني. لا حاجة لحساب Mondaily.", fr: "Ils recevront une invitation par e-mail. Aucun compte Mondaily requis.", de: "Sie erhalten eine E-Mail-Einladung. Kein Mondaily-Konto nötig.", es: "Recibirán una invitación por correo. No necesitan cuenta de Mondaily.", pt: "Receberão um convite por e-mail. Sem necessidade de conta Mondaily.", it: "Riceveranno un invito via e-mail. Nessun account Mondaily necessario.", tr: "E-posta ile davet alırlar. Mondaily hesabı gerekmez.", nl: "Ze krijgen een e-mailuitnodiging. Geen Mondaily-account nodig." },
  "cal.starts": { en: "Starts", pl: "Początek", ru: "Начало", uk: "Початок", ar: "يبدأ", fr: "Début", de: "Beginn", es: "Inicio", pt: "Início", it: "Inizio", tr: "Başlangıç", nl: "Begint" },
  "cal.ends": { en: "Ends", pl: "Koniec", ru: "Конец", uk: "Кінець", ar: "ينتهي", fr: "Fin", de: "Ende", es: "Fin", pt: "Fim", it: "Fine", tr: "Bitiş", nl: "Eindigt" },
  "cal.location": { en: "Location", pl: "Lokalizacja", ru: "Место", uk: "Місце", ar: "المكان", fr: "Lieu", de: "Ort", es: "Ubicación", pt: "Local", it: "Luogo", tr: "Konum", nl: "Locatie" },
  "cal.attendees": { en: "Attendees", pl: "Uczestnicy", ru: "Участники", uk: "Учасники", ar: "الحضور", fr: "Participants", de: "Teilnehmer", es: "Asistentes", pt: "Participantes", it: "Partecipanti", tr: "Katılımcılar", nl: "Deelnemers" },
  "cal.add_call": { en: "Add Mondaily call link", pl: "Dodaj link do połączenia Mondaily", ru: "Добавить ссылку на звонок Mondaily", uk: "Додати посилання на дзвінок Mondaily", ar: "أضف رابط مكالمة Mondaily", fr: "Ajouter un lien d’appel Mondaily", de: "Mondaily-Anruflink hinzufügen", es: "Añadir enlace de llamada Mondaily", pt: "Adicionar link de chamada Mondaily", it: "Aggiungi link chiamata Mondaily", tr: "Mondaily arama bağlantısı ekle", nl: "Mondaily-gesprekslink toevoegen" },
  "cal.calls_off": { en: "Calls aren't configured on this workspace.", pl: "Połączenia nie są skonfigurowane.", ru: "Звонки не настроены.", uk: "Дзвінки не налаштовані.", ar: "المكالمات غير مُهيأة.", fr: "Les appels ne sont pas configurés.", de: "Anrufe sind nicht konfiguriert.", es: "Las llamadas no están configuradas.", pt: "As chamadas não estão configuradas.", it: "Le chiamate non sono configurate.", tr: "Aramalar yapılandırılmamış.", nl: "Gesprekken zijn niet geconfigureerd." },
  "cal.join_call": { en: "Join call", pl: "Dołącz do rozmowy", ru: "Присоединиться", uk: "Приєднатися", ar: "انضم للمكالمة", fr: "Rejoindre l’appel", de: "Anruf beitreten", es: "Unirse a la llamada", pt: "Entrar na chamada", it: "Unisciti alla chiamata", tr: "Aramaya katıl", nl: "Deelnemen aan gesprek" },
  "cal.cancel_meeting": { en: "Cancel meeting", pl: "Odwołaj spotkanie", ru: "Отменить встречу", uk: "Скасувати зустріч", ar: "إلغاء الاجتماع", fr: "Annuler la réunion", de: "Meeting absagen", es: "Cancelar reunión", pt: "Cancelar reunião", it: "Annulla riunione", tr: "Toplantıyı iptal et", nl: "Vergadering annuleren" },
  "cal.repeat": { en: "Repeat", pl: "Powtarzaj", ru: "Повтор", uk: "Повтор", ar: "تكرار", fr: "Répéter", de: "Wiederholen", es: "Repetir", pt: "Repetir", it: "Ripeti", tr: "Tekrarla", nl: "Herhalen" },
  "cal.repeat_none": { en: "Doesn't repeat", pl: "Bez powtórzeń", ru: "Не повторять", uk: "Не повторювати", ar: "لا يتكرر", fr: "Ne se répète pas", de: "Keine Wiederholung", es: "No se repite", pt: "Não se repete", it: "Non si ripete", tr: "Tekrarlanmaz", nl: "Herhaalt niet" },
  "cal.repeat_daily": { en: "Daily", pl: "Codziennie", ru: "Ежедневно", uk: "Щодня", ar: "يوميًا", fr: "Tous les jours", de: "Täglich", es: "Diariamente", pt: "Diariamente", it: "Ogni giorno", tr: "Günlük", nl: "Dagelijks" },
  "cal.repeat_weekly": { en: "Weekly", pl: "Co tydzień", ru: "Еженедельно", uk: "Щотижня", ar: "أسبوعيًا", fr: "Toutes les semaines", de: "Wöchentlich", es: "Semanalmente", pt: "Semanalmente", it: "Ogni settimana", tr: "Haftalık", nl: "Wekelijks" },
  "cal.repeat_monthly": { en: "Monthly", pl: "Co miesiąc", ru: "Ежемесячно", uk: "Щомісяця", ar: "شهريًا", fr: "Tous les mois", de: "Monatlich", es: "Mensualmente", pt: "Mensalmente", it: "Ogni mese", tr: "Aylık", nl: "Maandelijks" },
  "cal.repeat_until": { en: "until", pl: "do", ru: "до", uk: "до", ar: "حتى", fr: "jusqu’au", de: "bis", es: "hasta", pt: "até", it: "fino al", tr: "bitiş", nl: "tot" },
  "cal.cancel_occurrence": { en: "Cancel this occurrence", pl: "Odwołaj to wystąpienie", ru: "Отменить это событие", uk: "Скасувати цю подію", ar: "إلغاء هذا الحدث", fr: "Annuler cette occurrence", de: "Diesen Termin absagen", es: "Cancelar esta repetición", pt: "Cancelar esta ocorrência", it: "Annulla questa ricorrenza", tr: "Bu tekrarı iptal et", nl: "Deze keer annuleren" },
  "cal.cancel_series": { en: "Cancel series", pl: "Odwołaj serię", ru: "Отменить серию", uk: "Скасувати серію", ar: "إلغاء السلسلة", fr: "Annuler la série", de: "Serie absagen", es: "Cancelar serie", pt: "Cancelar série", it: "Annulla serie", tr: "Diziyi iptal et", nl: "Reeks annuleren" },
  "cal.your_response": { en: "Your response", pl: "Twoja odpowiedź", ru: "Ваш ответ", uk: "Ваша відповідь", ar: "ردّك", fr: "Votre réponse", de: "Deine Antwort", es: "Tu respuesta", pt: "A sua resposta", it: "La tua risposta", tr: "Yanıtın", nl: "Jouw reactie" },
  "cal.rsvp_yes": { en: "Accept", pl: "Akceptuj", ru: "Принять", uk: "Прийняти", ar: "قبول", fr: "Accepter", de: "Zusagen", es: "Aceptar", pt: "Aceitar", it: "Accetta", tr: "Kabul et", nl: "Accepteren" },
  "cal.rsvp_maybe": { en: "Maybe", pl: "Może", ru: "Возможно", uk: "Можливо", ar: "ربما", fr: "Peut-être", de: "Vielleicht", es: "Quizás", pt: "Talvez", it: "Forse", tr: "Belki", nl: "Misschien" },
  "cal.rsvp_no": { en: "Decline", pl: "Odrzuć", ru: "Отклонить", uk: "Відхилити", ar: "رفض", fr: "Refuser", de: "Absagen", es: "Rechazar", pt: "Recusar", it: "Rifiuta", tr: "Reddet", nl: "Afwijzen" },
  "cal.rsvp_awaiting": { en: "awaiting", pl: "oczekuje", ru: "ожидают", uk: "очікують", ar: "بانتظار", fr: "en attente", de: "ausstehend", es: "pendiente", pt: "a aguardar", it: "in attesa", tr: "bekliyor", nl: "wachtend" },
  "cal.drag_hint": { en: "drag to another day to reschedule", pl: "przeciągnij na inny dzień, aby zmienić termin", ru: "перетащите на другой день, чтобы перенести", uk: "перетягніть на інший день, щоб перенести", ar: "اسحب إلى يوم آخر لإعادة الجدولة", fr: "glisser vers un autre jour pour reprogrammer", de: "zum Verschieben auf einen anderen Tag ziehen", es: "arrastra a otro día para reprogramar", pt: "arraste para outro dia para reagendar", it: "trascina su un altro giorno per riprogrammare", tr: "yeniden planlamak için başka bir güne sürükleyin", nl: "sleep naar een andere dag om te verzetten" },
  "cal.cancelled": { en: "Cancelled", pl: "Odwołane", ru: "Отменено", uk: "Скасовано", ar: "ملغى", fr: "Annulée", de: "Abgesagt", es: "Cancelada", pt: "Cancelada", it: "Annullata", tr: "İptal edildi", nl: "Geannuleerd" },
  "cal.draft_agenda": { en: "Draft agenda with AI", pl: "Napisz agendę z AI", ru: "Составить повестку с ИИ", uk: "Скласти порядок з ШІ", ar: "صياغة الأجندة بالذكاء الاصطناعي", fr: "Rédiger l’ordre du jour avec l’IA", de: "Agenda mit KI entwerfen", es: "Redactar agenda con IA", pt: "Rascunhar pauta com IA", it: "Bozza agenda con IA", tr: "Yapay zekâ ile gündem taslağı", nl: "Agenda opstellen met AI" },
  "cal.view_today": { en: "Today", pl: "Dzisiaj", ru: "Сегодня", uk: "Сьогодні", ar: "اليوم", fr: "Aujourd’hui", de: "Heute", es: "Hoy", pt: "Hoje", it: "Oggi", tr: "Bugün", nl: "Vandaag" },
  "cal.view_week": { en: "Week", pl: "Tydzień", ru: "Неделя", uk: "Тиждень", ar: "الأسبوع", fr: "Semaine", de: "Woche", es: "Semana", pt: "Semana", it: "Settimana", tr: "Hafta", nl: "Week" },
  "cal.view_month": { en: "Month", pl: "Miesiąc", ru: "Месяц", uk: "Місяць", ar: "الشهر", fr: "Mois", de: "Monat", es: "Mes", pt: "Mês", it: "Mese", tr: "Ay", nl: "Maand" },
  "cal.view_upcoming": { en: "Upcoming", pl: "Nadchodzące", ru: "Предстоящие", uk: "Майбутні", ar: "القادمة", fr: "À venir", de: "Anstehend", es: "Próximas", pt: "Próximas", it: "In arrivo", tr: "Yaklaşan", nl: "Aankomend" },
  "cal.more_count": { en: "+{n} more", pl: "+{n} więcej", ru: "+{n} ещё", uk: "+{n} ще", ar: "+{n} أخرى", fr: "+{n} de plus", de: "+{n} mehr", es: "+{n} más", pt: "+{n} mais", it: "+{n} altri", tr: "+{n} daha", nl: "+{n} meer" },
  "cal.brief_heading": { en: "Today’s brief", pl: "Podsumowanie dnia", ru: "Сводка на сегодня", uk: "Зведення на сьогодні", ar: "موجز اليوم", fr: "Résumé du jour", de: "Tagesüberblick", es: "Resumen de hoy", pt: "Resumo de hoje", it: "Riepilogo di oggi", tr: "Bugünün özeti", nl: "Overzicht van vandaag" },
  "cal.meetings_today": { en: "meetings today", pl: "spotkań dziś", ru: "встреч сегодня", uk: "зустрічей сьогодні", ar: "اجتماعات اليوم", fr: "réunions aujourd’hui", de: "Meetings heute", es: "reuniones hoy", pt: "reuniões hoje", it: "riunioni oggi", tr: "bugün toplantı", nl: "vergaderingen vandaag" },
  "cal.next_up": { en: "Next up", pl: "Następne", ru: "Далее", uk: "Далі", ar: "التالي", fr: "À suivre", de: "Als Nächstes", es: "A continuación", pt: "A seguir", it: "Prossimo", tr: "Sırada", nl: "Volgende" },
  "cal.overlaps": { en: "Overlaps", pl: "Nakładki", ru: "Наложения", uk: "Накладки", ar: "تداخلات", fr: "Chevauchements", de: "Überschneidungen", es: "Solapamientos", pt: "Sobreposições", it: "Sovrapposizioni", tr: "Çakışmalar", nl: "Overlappingen" },
  "cal.needs_agenda": { en: "Needs agenda", pl: "Brak agendy", ru: "Нужна повестка", uk: "Потрібен порядок", ar: "بحاجة لجدول", fr: "Sans ordre du jour", de: "Ohne Agenda", es: "Sin agenda", pt: "Sem pauta", it: "Senza agenda", tr: "Gündem gerek", nl: "Agenda nodig" },
  "cal.needs_call": { en: "No call link", pl: "Brak linku", ru: "Нет ссылки", uk: "Немає посилання", ar: "لا رابط مكالمة", fr: "Sans lien d’appel", de: "Kein Anruflink", es: "Sin enlace", pt: "Sem link", it: "Senza link", tr: "Arama linki yok", nl: "Geen gesprekslink" },
  "cal.all_clear": { en: "You’re all set for today.", pl: "Wszystko gotowe na dziś.", ru: "На сегодня всё готово.", uk: "На сьогодні все готово.", ar: "كل شيء جاهز لليوم.", fr: "Tout est prêt pour aujourd’hui.", de: "Für heute ist alles bereit.", es: "Todo listo para hoy.", pt: "Tudo pronto para hoje.", it: "Tutto pronto per oggi.", tr: "Bugün için her şey hazır.", nl: "Alles klaar voor vandaag." },
  "cal.meeting_brief": { en: "Meeting brief", pl: "Brief spotkania", ru: "Бриф встречи", uk: "Бриф зустрічі", ar: "موجز الاجتماع", fr: "Brief de réunion", de: "Meeting-Brief", es: "Resumen de reunión", pt: "Brief da reunião", it: "Brief riunione", tr: "Toplantı özeti", nl: "Vergaderbrief" },
  "cal.prepare": { en: "Prepare me for this meeting", pl: "Przygotuj mnie na to spotkanie", ru: "Подготовить меня к встрече", uk: "Підготувати мене до зустрічі", ar: "جهّزني لهذا الاجتماع", fr: "Préparez-moi à cette réunion", de: "Bereite mich auf dieses Meeting vor", es: "Prepárame para esta reunión", pt: "Prepare-me para esta reunião", it: "Preparami per questa riunione", tr: "Beni bu toplantıya hazırla", nl: "Bereid me voor op deze vergadering" },
  "cal.preparing": { en: "Preparing your brief…", pl: "Przygotowywanie…", ru: "Готовим…", uk: "Готуємо…", ar: "جارٍ التحضير…", fr: "Préparation…", de: "Wird vorbereitet…", es: "Preparando…", pt: "A preparar…", it: "Preparazione…", tr: "Hazırlanıyor…", nl: "Voorbereiden…" },
  "cal.prepare_hint": { en: "The Meeting Agent briefs you from real related records — you review before acting.", pl: "Agent Spotkań przygotuje Cię na podstawie powiązanych rekordów.", ru: "Агент встреч подготовит вас по связанным записям.", uk: "Агент зустрічей підготує вас за пов’язаними записами.", ar: "يجهّزك وكيل الاجتماعات من السجلات ذات الصلة الحقيقية.", fr: "L’agent de réunion vous prépare à partir des enregistrements liés réels.", de: "Der Meeting-Agent brieft dich aus echten verknüpften Datensätzen.", es: "El Agente de Reuniones te prepara con registros relacionados reales.", pt: "O Agente de Reuniões prepara-te a partir de registos relacionados reais.", it: "L’Agente Riunioni ti prepara dai record correlati reali.", tr: "Toplantı Ajanı sizi gerçek ilgili kayıtlardan hazırlar.", nl: "De Meeting-agent brieft je op basis van echte gerelateerde records." },
  "cal.refresh_brief": { en: "Refresh brief", pl: "Odśwież", ru: "Обновить", uk: "Оновити", ar: "تحديث", fr: "Actualiser", de: "Aktualisieren", es: "Actualizar", pt: "Atualizar", it: "Aggiorna", tr: "Yenile", nl: "Vernieuwen" },
  "cal.ai_summary": { en: "Agenda summary", pl: "Streszczenie agendy", ru: "Краткая повестка", uk: "Стислий порядок", ar: "ملخص الأجندة", fr: "Résumé de l’ordre du jour", de: "Agenda-Zusammenfassung", es: "Resumen de agenda", pt: "Resumo da pauta", it: "Riepilogo agenda", tr: "Gündem özeti", nl: "Agenda-samenvatting" },
  "cal.talking_points": { en: "Talking points", pl: "Punkty do omówienia", ru: "Тезисы", uk: "Тези", ar: "نقاط النقاش", fr: "Points à aborder", de: "Gesprächspunkte", es: "Puntos de conversación", pt: "Pontos de discussão", it: "Punti da discutere", tr: "Konuşma noktaları", nl: "Gesprekspunten" },
  "cal.follow_ups": { en: "Suggested follow-ups", pl: "Sugerowane działania", ru: "Предлагаемые задачи", uk: "Пропоновані задачі", ar: "متابعات مقترحة", fr: "Suivis suggérés", de: "Vorgeschlagene Follow-ups", es: "Seguimientos sugeridos", pt: "Ações sugeridas", it: "Follow-up suggeriti", tr: "Önerilen takipler", nl: "Voorgestelde follow-ups" },
  "cal.related_records": { en: "Related records", pl: "Powiązane rekordy", ru: "Связанные записи", uk: "Пов’язані записи", ar: "سجلات ذات صلة", fr: "Enregistrements liés", de: "Verwandte Datensätze", es: "Registros relacionados", pt: "Registros relacionados", it: "Record correlati", tr: "İlgili kayıtlar", nl: "Gerelateerde records" },
  "cal.no_related": { en: "No related records found", pl: "Brak powiązanych rekordów", ru: "Связанных записей нет", uk: "Пов’язаних записів немає", ar: "لا سجلات ذات صلة", fr: "Aucun enregistrement lié", de: "Keine verwandten Datensätze", es: "Sin registros relacionados", pt: "Nenhum registro relacionado", it: "Nessun record correlato", tr: "İlgili kayıt yok", nl: "Geen gerelateerde records" },
  "cal.ai_unavailable": { en: "AI prep isn’t available right now.", pl: "Przygotowanie AI jest niedostępne.", ru: "ИИ-подготовка сейчас недоступна.", uk: "ШІ-підготовка недоступна.", ar: "تحضير الذكاء الاصطناعي غير متاح الآن.", fr: "La préparation IA n’est pas disponible.", de: "KI-Vorbereitung ist gerade nicht verfügbar.", es: "La preparación con IA no está disponible.", pt: "A preparação com IA não está disponível.", it: "La preparazione IA non è disponibile.", tr: "Yapay zekâ hazırlığı şu an mevcut değil.", nl: "AI-voorbereiding is nu niet beschikbaar." },
  "cal.after_meeting": { en: "After the meeting", pl: "Po spotkaniu", ru: "После встречи", uk: "Після зустрічі", ar: "بعد الاجتماع", fr: "Après la réunion", de: "Nach dem Meeting", es: "Después de la reunión", pt: "Após a reunião", it: "Dopo la riunione", tr: "Toplantıdan sonra", nl: "Na de vergadering" },
  "cal.followup_task": { en: "Create follow-up task", pl: "Utwórz zadanie", ru: "Создать задачу", uk: "Створити задачу", ar: "إنشاء مهمة متابعة", fr: "Créer une tâche de suivi", de: "Follow-up-Aufgabe erstellen", es: "Crear tarea de seguimiento", pt: "Criar tarefa de acompanhamento", it: "Crea attività di follow-up", tr: "Takip görevi oluştur", nl: "Follow-uptaak maken" },
  "cal.draft_notes": { en: "Draft meeting notes", pl: "Szkic notatek", ru: "Черновик заметок", uk: "Чернетка нотаток", ar: "مسودة الملاحظات", fr: "Rédiger des notes", de: "Notizen entwerfen", es: "Redactar notas", pt: "Rascunhar notas", it: "Bozza note", tr: "Not taslağı", nl: "Notulen opstellen" },
  "cal.send_recap": { en: "Send recap", pl: "Wyślij podsumowanie", ru: "Отправить итоги", uk: "Надіслати підсумок", ar: "إرسال ملخص", fr: "Envoyer le récapitulatif", de: "Zusammenfassung senden", es: "Enviar resumen", pt: "Enviar resumo", it: "Invia riepilogo", tr: "Özet gönder", nl: "Samenvatting sturen" },
  "cal.coming_soon": { en: "Coming soon", pl: "Wkrótce", ru: "Скоро", uk: "Незабаром", ar: "قريبًا", fr: "Bientôt", de: "Demnächst", es: "Próximamente", pt: "Em breve", it: "Prossimamente", tr: "Yakında", nl: "Binnenkort" },
  "cal.meeting_agent": { en: "Meeting Agent", pl: "Meeting Agent", ru: "Meeting Agent", uk: "Meeting Agent", ar: "Meeting Agent", fr: "Meeting Agent", de: "Meeting Agent", es: "Meeting Agent", pt: "Meeting Agent", it: "Meeting Agent", tr: "Meeting Agent", nl: "Meeting Agent" },
  "cal.agent_monitoring": { en: "monitoring today", pl: "monitoruje dzisiaj", ru: "следит за сегодня", uk: "стежить за сьогодні", ar: "يراقب اليوم", fr: "surveille aujourd’hui", de: "beobachtet heute", es: "supervisa hoy", pt: "monitorando hoje", it: "monitora oggi", tr: "bugünü izliyor", nl: "houdt vandaag in de gaten" },
  "cal.agent_available": { en: "Available", pl: "Dostępny", ru: "Доступен", uk: "Доступний", ar: "متاح", fr: "Disponible", de: "Verfügbar", es: "Disponible", pt: "Disponível", it: "Disponibile", tr: "Kullanılabilir", nl: "Beschikbaar" },
  "cal.agent_on_demand": { en: "On demand", pl: "Na żądanie", ru: "По запросу", uk: "За запитом", ar: "عند الطلب", fr: "À la demande", de: "Auf Abruf", es: "Bajo demanda", pt: "Sob demanda", it: "Su richiesta", tr: "İsteğe bağlı", nl: "Op aanvraag" },
  "cal.prepared_by": { en: "Prepared by", pl: "Przygotowane przez", ru: "Подготовлено", uk: "Підготовлено", ar: "أعدّه", fr: "Préparé par", de: "Erstellt von", es: "Preparado por", pt: "Preparado por", it: "Preparato da", tr: "Hazırlayan", nl: "Voorbereid door" },
  "cal.agent_source": { en: "via Meeting Agent", pl: "przez Meeting Agent", ru: "через Meeting Agent", uk: "через Meeting Agent", ar: "عبر Meeting Agent", fr: "via Meeting Agent", de: "über Meeting Agent", es: "vía Meeting Agent", pt: "via Meeting Agent", it: "tramite Meeting Agent", tr: "Meeting Agent ile", nl: "via Meeting Agent" },
  "cal.prev": { en: "Previous", pl: "Poprzedni", ru: "Назад", uk: "Назад", ar: "السابق", fr: "Précédent", de: "Zurück", es: "Anterior", pt: "Anterior", it: "Precedente", tr: "Önceki", nl: "Vorige" },
  "cal.next": { en: "Next", pl: "Następny", ru: "Вперёд", uk: "Далі", ar: "التالي", fr: "Suivant", de: "Weiter", es: "Siguiente", pt: "Próximo", it: "Successivo", tr: "Sonraki", nl: "Volgende" },
  "cal.clear_day": { en: "A clear day — nothing scheduled.", pl: "Wolny dzień — nic zaplanowane.", ru: "Свободный день — ничего не запланировано.", uk: "Вільний день — нічого не заплановано.", ar: "يوم خالٍ — لا شيء مجدول.", fr: "Journée libre — rien de prévu.", de: "Ein freier Tag — nichts geplant.", es: "Un día libre — nada programado.", pt: "Um dia livre — nada agendado.", it: "Giornata libera — niente in agenda.", tr: "Boş bir gün — planlanmış bir şey yok.", nl: "Een vrije dag — niets gepland." },
  "cal.suggest_followups": { en: "Check open follow-ups", pl: "Sprawdź otwarte działania", ru: "Открытые задачи", uk: "Відкриті задачі", ar: "متابعات مفتوحة", fr: "Voir les suivis ouverts", de: "Offene Follow-ups prüfen", es: "Ver seguimientos abiertos", pt: "Ver acompanhamentos abertos", it: "Follow-up aperti", tr: "Açık takipler", nl: "Open follow-ups bekijken" },
  "cal.today_briefing": { en: "Today briefing", pl: "Brief dnia", ru: "Сводка дня", uk: "Зведення дня", ar: "موجز اليوم", fr: "Briefing du jour", de: "Tagesbriefing", es: "Resumen del día", pt: "Briefing de hoje", it: "Briefing di oggi", tr: "Günün özeti", nl: "Briefing van vandaag" },
  "cal.open_followups": { en: "Open follow-ups", pl: "Otwarte działania", ru: "Открытые задачи", uk: "Відкриті задачі", ar: "المتابعات المفتوحة", fr: "Suivis ouverts", de: "Offene Follow-ups", es: "Seguimientos abiertos", pt: "Acompanhamentos abertos", it: "Follow-up aperti", tr: "Açık takipler", nl: "Open follow-ups" },
  "cal.ai_meeting_brief": { en: "AI Meeting Brief", pl: "Brief spotkania AI", ru: "ИИ-бриф встречи", uk: "ШІ-бриф зустрічі", ar: "موجز الاجتماع بالذكاء", fr: "Brief IA de réunion", de: "KI-Meeting-Brief", es: "Resumen IA de reunión", pt: "Brief IA da reunião", it: "Brief IA riunione", tr: "Yapay zekâ toplantı özeti", nl: "AI-vergaderbrief" },
  "cal.edit_agenda": { en: "Add / edit agenda", pl: "Dodaj / edytuj agendę", ru: "Добавить / изменить повестку", uk: "Додати / змінити порядок", ar: "إضافة / تعديل الأجندة", fr: "Ajouter / modifier l’ordre du jour", de: "Agenda hinzufügen / bearbeiten", es: "Añadir / editar agenda", pt: "Adicionar / editar pauta", it: "Aggiungi / modifica agenda", tr: "Gündem ekle / düzenle", nl: "Agenda toevoegen / bewerken" },
  "cal.followups": { en: "Follow-ups", pl: "Działania", ru: "Задачи", uk: "Задачі", ar: "المتابعات", fr: "Suivis", de: "Follow-ups", es: "Seguimientos", pt: "Acompanhamentos", it: "Follow-up", tr: "Takipler", nl: "Follow-ups" },
  "cal.overdue": { en: "Overdue", pl: "Zaległe", ru: "Просрочено", uk: "Прострочено", ar: "متأخرة", fr: "En retard", de: "Überfällig", es: "Vencidas", pt: "Atrasadas", it: "Scadute", tr: "Gecikmiş", nl: "Te laat" },
  "cal.due_today": { en: "Due today", pl: "Na dziś", ru: "Срок сегодня", uk: "Термін сьогодні", ar: "مستحقة اليوم", fr: "Pour aujourd’hui", de: "Heute fällig", es: "Para hoy", pt: "Para hoje", it: "In scadenza oggi", tr: "Bugün", nl: "Vandaag" },
  "cal.related_meeting": { en: "Related to this meeting", pl: "Powiązane ze spotkaniem", ru: "Связано со встречей", uk: "Пов’язано із зустріччю", ar: "متعلق بهذا الاجتماع", fr: "Lié à cette réunion", de: "Zu diesem Meeting", es: "Relacionado con la reunión", pt: "Relacionado à reunião", it: "Correlato alla riunione", tr: "Bu toplantıyla ilgili", nl: "Bij deze vergadering" },
  "cal.suggested_followup": { en: "Suggested next follow-up", pl: "Sugerowane następne", ru: "Предлагаемое далее", uk: "Пропоноване далі", ar: "متابعة مقترحة", fr: "Suivi suggéré", de: "Vorgeschlagenes Follow-up", es: "Seguimiento sugerido", pt: "Acompanhamento sugerido", it: "Follow-up suggerito", tr: "Önerilen takip", nl: "Voorgestelde follow-up" },
  "cal.draft_tag": { en: "Draft", pl: "Szkic", ru: "Черновик", uk: "Чернетка", ar: "مسودة", fr: "Brouillon", de: "Entwurf", es: "Borrador", pt: "Rascunho", it: "Bozza", tr: "Taslak", nl: "Concept" },
  "cal.all_tasks": { en: "All tasks", pl: "Wszystkie zadania", ru: "Все задачи", uk: "Усі задачі", ar: "كل المهام", fr: "Toutes les tâches", de: "Alle Aufgaben", es: "Todas las tareas", pt: "Todas as tarefas", it: "Tutte le attività", tr: "Tüm görevler", nl: "Alle taken" },
  "cal.create_task": { en: "Create task", pl: "Utwórz zadanie", ru: "Создать задачу", uk: "Створити задачу", ar: "إنشاء مهمة", fr: "Créer une tâche", de: "Aufgabe erstellen", es: "Crear tarea", pt: "Criar tarefa", it: "Crea attività", tr: "Görev oluştur", nl: "Taak maken" },
  "cal.sig_related": { en: "Related records", pl: "Powiązane rekordy", ru: "Связанные записи", uk: "Пов’язані записи", ar: "سجلات ذات صلة", fr: "Enregistrements liés", de: "Verwandte Datensätze", es: "Registros relacionados", pt: "Registros relacionados", it: "Record correlati", tr: "İlgili kayıtlar", nl: "Gerelateerde records" },
  "cal.st_found": { en: "found", pl: "znaleziono", ru: "найдено", uk: "знайдено", ar: "موجود", fr: "trouvé(s)", de: "gefunden", es: "encontrados", pt: "encontrados", it: "trovati", tr: "bulundu", nl: "gevonden" },
  "cal.st_none_found": { en: "None found", pl: "Brak", ru: "Не найдено", uk: "Не знайдено", ar: "لا شيء", fr: "Aucun", de: "Keine", es: "Ninguno", pt: "Nenhum", it: "Nessuno", tr: "Bulunamadı", nl: "Geen" },
  "cal.agent_checks": { en: "Meeting Agent checks", pl: "Kontrole Meeting Agent", ru: "Проверки Meeting Agent", uk: "Перевірки Meeting Agent", ar: "فحوصات Meeting Agent", fr: "Vérifications Meeting Agent", de: "Meeting-Agent-Checks", es: "Comprobaciones de Meeting Agent", pt: "Verificações do Meeting Agent", it: "Controlli Meeting Agent", tr: "Meeting Agent kontrolleri", nl: "Meeting Agent-controles" },
  "cal.needs_attention": { en: "Needs attention", pl: "Wymaga uwagi", ru: "Требует внимания", uk: "Потребує уваги", ar: "يتطلب انتباهًا", fr: "À traiter", de: "Erfordert Aufmerksamkeit", es: "Requiere atención", pt: "Requer atenção", it: "Richiede attenzione", tr: "Dikkat gerekiyor", nl: "Vereist aandacht" },
  "cal.readiness": { en: "Meeting readiness", pl: "Gotowość spotkania", ru: "Готовность встречи", uk: "Готовність зустрічі", ar: "جاهزية الاجتماع", fr: "Préparation de la réunion", de: "Meeting-Bereitschaft", es: "Preparación de la reunión", pt: "Prontidão da reunião", it: "Prontezza riunione", tr: "Toplantı hazırlığı", nl: "Vergaderklaar" },
  "cal.sig_call": { en: "Call link", pl: "Link do rozmowy", ru: "Ссылка на звонок", uk: "Посилання на дзвінок", ar: "رابط المكالمة", fr: "Lien d’appel", de: "Anruflink", es: "Enlace de llamada", pt: "Link de chamada", it: "Link chiamata", tr: "Arama bağlantısı", nl: "Gesprekslink" },
  "cal.sig_prep": { en: "AI prep", pl: "Przygotowanie AI", ru: "ИИ-подготовка", uk: "ШІ-підготовка", ar: "تحضير الذكاء", fr: "Prépa IA", de: "KI-Vorbereitung", es: "Preparación IA", pt: "Preparo IA", it: "Prep IA", tr: "Yapay zekâ hazırlığı", nl: "AI-voorbereiding" },
  "cal.st_set": { en: "Set", pl: "Ustawiona", ru: "Есть", uk: "Є", ar: "محدّد", fr: "Défini", de: "Gesetzt", es: "Lista", pt: "Definida", it: "Impostata", tr: "Var", nl: "Ingesteld" },
  "cal.st_missing": { en: "Missing", pl: "Brak", ru: "Нет", uk: "Немає", ar: "غير محدّد", fr: "Manquant", de: "Fehlt", es: "Falta", pt: "Ausente", it: "Mancante", tr: "Eksik", nl: "Ontbreekt" },
  "cal.st_linked": { en: "Linked", pl: "Dodany", ru: "Есть", uk: "Є", ar: "مرتبط", fr: "Lié", de: "Verknüpft", es: "Vinculado", pt: "Vinculado", it: "Collegato", tr: "Bağlı", nl: "Gekoppeld" },
  "cal.st_none": { en: "None", pl: "Brak", ru: "Нет", uk: "Немає", ar: "لا يوجد", fr: "Aucun", de: "Keiner", es: "Ninguno", pt: "Nenhum", it: "Nessuno", tr: "Yok", nl: "Geen" },
  "cal.st_ready": { en: "Ready", pl: "Gotowe", ru: "Готово", uk: "Готово", ar: "جاهز", fr: "Prêt", de: "Bereit", es: "Listo", pt: "Pronto", it: "Pronto", tr: "Hazır", nl: "Klaar" },
  "cal.st_pending": { en: "Not run", pl: "Nieuruchomione", ru: "Не запущено", uk: "Не запущено", ar: "لم يُشغّل", fr: "Non exécuté", de: "Nicht ausgeführt", es: "Sin ejecutar", pt: "Não executado", it: "Non eseguito", tr: "Çalıştırılmadı", nl: "Niet uitgevoerd" },
  "cal.st_clear": { en: "Clear", pl: "Czysto", ru: "Нет", uk: "Немає", ar: "لا تعارض", fr: "Aucun", de: "Frei", es: "Sin choques", pt: "Livre", it: "Nessuno", tr: "Yok", nl: "Vrij" },
  "cal.st_overlap": { en: "Overlap", pl: "Nakładka", ru: "Наложение", uk: "Накладка", ar: "تداخل", fr: "Chevauchement", de: "Überschneidung", es: "Solapamiento", pt: "Sobreposição", it: "Sovrapposizione", tr: "Çakışma", nl: "Overlap" },
  "cal.next_action": { en: "Suggested next", pl: "Sugerowane dalej", ru: "Далее рекомендуется", uk: "Далі рекомендовано", ar: "الخطوة المقترحة", fr: "Prochaine étape", de: "Nächster Schritt", es: "Siguiente sugerido", pt: "Próximo sugerido", it: "Prossimo suggerito", tr: "Önerilen sonraki", nl: "Volgende suggestie" },
  "cal.you": { en: "You", pl: "Ty", ru: "Вы", uk: "Ви", ar: "أنت", fr: "Vous", de: "Du", es: "Tú", pt: "Você", it: "Tu", tr: "Sen", nl: "Jij" },
  "cal.call_ready": { en: "Ready to join", pl: "Gotowe do dołączenia", ru: "Готово к подключению", uk: "Готово до приєднання", ar: "جاهز للانضمام", fr: "Prêt à rejoindre", de: "Bereit zum Beitreten", es: "Listo para unirse", pt: "Pronto para entrar", it: "Pronto per entrare", tr: "Katılmaya hazır", nl: "Klaar om deel te nemen" },
  "cal.connecting": { en: "Connecting…", pl: "Łączenie…", ru: "Подключение…", uk: "З’єднання…", ar: "جارٍ الاتصال…", fr: "Connexion…", de: "Verbinden…", es: "Conectando…", pt: "Conectando…", it: "Connessione…", tr: "Bağlanıyor…", nl: "Verbinden…" },
  "cal.reconnecting": { en: "Reconnecting…", pl: "Ponowne łączenie…", ru: "Переподключение…", uk: "Повторне з’єднання…", ar: "إعادة الاتصال…", fr: "Reconnexion…", de: "Neu verbinden…", es: "Reconectando…", pt: "Reconectando…", it: "Riconnessione…", tr: "Yeniden bağlanıyor…", nl: "Opnieuw verbinden…" },
  "cal.left_call": { en: "You left the call", pl: "Opuściłeś rozmowę", ru: "Вы вышли из звонка", uk: "Ви вийшли з дзвінка", ar: "لقد غادرت المكالمة", fr: "Vous avez quitté l’appel", de: "Du hast den Anruf verlassen", es: "Saliste de la llamada", pt: "Você saiu da chamada", it: "Hai lasciato la chiamata", tr: "Aramadan ayrıldın", nl: "Je hebt het gesprek verlaten" },
  "cal.back_to_calendar": { en: "Back to calendar", pl: "Powrót do kalendarza", ru: "Назад к календарю", uk: "Назад до календаря", ar: "العودة إلى التقويم", fr: "Retour au calendrier", de: "Zurück zum Kalender", es: "Volver al calendario", pt: "Voltar ao calendário", it: "Torna al calendario", tr: "Takvime dön", nl: "Terug naar agenda" },
  "cal.leave": { en: "Leave", pl: "Wyjdź", ru: "Выйти", uk: "Вийти", ar: "مغادرة", fr: "Quitter", de: "Verlassen", es: "Salir", pt: "Sair", it: "Esci", tr: "Ayrıl", nl: "Verlaten" },
  "cal.share_screen": { en: "Share screen", pl: "Udostępnij ekran", ru: "Показать экран", uk: "Показати екран", ar: "مشاركة الشاشة", fr: "Partager l’écran", de: "Bildschirm teilen", es: "Compartir pantalla", pt: "Compartilhar tela", it: "Condividi schermo", tr: "Ekranı paylaş", nl: "Scherm delen" },
  "cal.stop_share": { en: "Stop sharing", pl: "Zatrzymaj udostępnianie", ru: "Остановить показ", uk: "Зупинити показ", ar: "إيقاف المشاركة", fr: "Arrêter le partage", de: "Teilen beenden", es: "Dejar de compartir", pt: "Parar de compartilhar", it: "Interrompi condivisione", tr: "Paylaşımı durdur", nl: "Delen stoppen" },
  "cal.devices": { en: "Devices", pl: "Urządzenia", ru: "Устройства", uk: "Пристрої", ar: "الأجهزة", fr: "Appareils", de: "Geräte", es: "Dispositivos", pt: "Dispositivos", it: "Dispositivi", tr: "Cihazlar", nl: "Apparaten" },
  "cal.microphone": { en: "Microphone", pl: "Mikrofon", ru: "Микрофон", uk: "Мікрофон", ar: "الميكروفون", fr: "Microphone", de: "Mikrofon", es: "Micrófono", pt: "Microfone", it: "Microfono", tr: "Mikrofon", nl: "Microfoon" },
  "cal.camera": { en: "Camera", pl: "Kamera", ru: "Камера", uk: "Камера", ar: "الكاميرا", fr: "Caméra", de: "Kamera", es: "Cámara", pt: "Câmera", it: "Fotocamera", tr: "Kamera", nl: "Camera" },
  "cal.connect_failed": { en: "Couldn't connect. Please try again.", pl: "Nie udało się połączyć. Spróbuj ponownie.", ru: "Не удалось подключиться. Повторите попытку.", uk: "Не вдалося підключитися. Спробуйте ще раз.", ar: "تعذّر الاتصال. حاول مرة أخرى.", fr: "Connexion impossible. Réessayez.", de: "Verbindung fehlgeschlagen. Bitte erneut versuchen.", es: "No se pudo conectar. Inténtalo de nuevo.", pt: "Não foi possível conectar. Tente novamente.", it: "Connessione non riuscita. Riprova.", tr: "Bağlanılamadı. Tekrar deneyin.", nl: "Kan geen verbinding maken. Probeer opnieuw." },
  "cal.based_on_details": { en: "Based only on the meeting details — no related workspace records found.", pl: "Tylko na podstawie szczegółów spotkania — brak powiązanych rekordów.", ru: "Только на основе деталей встречи — связанных записей нет.", uk: "Лише на основі деталей зустрічі — пов’язаних записів немає.", ar: "بناءً على تفاصيل الاجتماع فقط — لا سجلات ذات صلة.", fr: "Basé uniquement sur les détails de la réunion — aucun enregistrement lié.", de: "Nur auf Basis der Meeting-Details — keine verwandten Datensätze.", es: "Basado solo en los detalles de la reunión — sin registros relacionados.", pt: "Baseado apenas nos detalhes da reunião — sem registros relacionados.", it: "Basato solo sui dettagli della riunione — nessun record correlato.", tr: "Yalnızca toplantı ayrıntılarına dayalı — ilgili kayıt yok.", nl: "Alleen op basis van de vergaderdetails — geen gerelateerde records." },
  "cal.select_meeting": { en: "Select a meeting to see its brief", pl: "Wybierz spotkanie, aby zobaczyć brief", ru: "Выберите встречу, чтобы увидеть бриф", uk: "Виберіть зустріч, щоб побачити бриф", ar: "اختر اجتماعًا لعرض موجزه", fr: "Sélectionnez une réunion pour voir son brief", de: "Wählen Sie ein Meeting für den Brief", es: "Selecciona una reunión para ver su resumen", pt: "Selecione uma reunião para ver o brief", it: "Seleziona una riunione per vedere il brief", tr: "Özeti görmek için bir toplantı seçin", nl: "Selecteer een vergadering voor de brief" },
  "cal.sources_note": { en: "Grounded in your workspace records — no invented sources.", pl: "Na podstawie rekordów przestrzeni — bez zmyślonych źródeł.", ru: "На основе записей рабочей области — без выдуманных источников.", uk: "На основі записів робочої області — без вигаданих джерел.", ar: "مستند إلى سجلات مساحة عملك — دون مصادر مُختلقة.", fr: "Basé sur vos enregistrements — aucune source inventée.", de: "Basiert auf Ihren Workspace-Daten — keine erfundenen Quellen.", es: "Basado en tus registros — sin fuentes inventadas.", pt: "Baseado nos seus registros — sem fontes inventadas.", it: "Basato sui tuoi record — nessuna fonte inventata.", tr: "Çalışma alanı kayıtlarınıza dayalı — uydurma kaynak yok.", nl: "Gebaseerd op je workspace-records — geen verzonnen bronnen." },
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
