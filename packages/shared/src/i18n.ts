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
