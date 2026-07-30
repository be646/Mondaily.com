/**
 * Country reference data — the owner-supplied 2026 dataset (195 countries: population, land area
 * km², density /km²), loaded as a LOOKUP, deliberately not stored on records. A country field
 * stays a country name (the picker's canonical strings, matching existing data); the demographics
 * ride alongside for display and territory analysis, so no contact record carries three numbers
 * nobody edits.
 *
 * Tuples: [name, population, landKm2, density]. Values verbatim from the provided table.
 */
export type CountryFacts = { name: string; population: number; landKm2: number; density: number };

const ROWS: [string, number, number, number][] = [
  ["Afghanistan", 45047069, 652860, 69], ["Albania", 2751025, 27400, 100], ["Algeria", 48028334, 2381740, 20],
  ["Andorra", 83753, 470, 178], ["Angola", 40215179, 1246700, 32], ["Antigua and Barbuda", 94626, 440, 215],
  ["Argentina", 46003734, 2736690, 17], ["Armenia", 2930915, 28470, 103], ["Australia", 27227096, 7682300, 4],
  ["Austria", 9107266, 82409, 111], ["Azerbaijan", 10454855, 82658, 126], ["Bahamas", 404628, 10010, 40],
  ["Bahrain", 1675572, 760, 2205], ["Bangladesh", 177818044, 130170, 1366], ["Barbados", 282724, 430, 657],
  ["Belarus", 8937018, 202910, 44], ["Belgium", 11774642, 30280, 389], ["Belize", 428644, 22810, 19],
  ["Benin", 15170419, 112760, 135], ["Bhutan", 802214, 38117, 21], ["Bolivia", 12749291, 1083300, 12],
  ["Bosnia and Herzegovina", 3114242, 51000, 61], ["Botswana", 2603388, 566730, 5], ["Brazil", 213562666, 8358140, 26],
  ["Brunei", 469775, 5270, 89], ["Bulgaria", 6667659, 108560, 61], ["Burkina Faso", 24601700, 273600, 90],
  ["Burundi", 14729157, 25680, 574], ["Cabo Verde", 529630, 4030, 131], ["Cambodia", 18051219, 176520, 102],
  ["Cameroon", 30640817, 472710, 65], ["Canada", 40467728, 9093510, 4], ["Central African Republic", 5698984, 622980, 9],
  ["Chad", 21560380, 1259200, 17], ["Chile", 19945850, 743532, 27], ["China", 1412914089, 9388211, 150],
  ["Colombia", 53936226, 1109500, 49], ["Comoros", 899010, 1861, 483], ["Congo (Congo-Brazzaville)", 6637785, 341500, 19],
  ["Costa Rica", 5174789, 51060, 101], ["Côte d'Ivoire", 33494346, 318000, 105], ["Croatia", 3822345, 55960, 68],
  ["Cuba", 10892659, 106440, 102], ["Cyprus", 1382334, 9240, 150], ["Czechia (Czech Republic)", 10527781, 77240, 136],
  ["Democratic Republic of the Congo", 116452162, 2267050, 51], ["Denmark", 6023520, 42430, 142],
  ["Djibouti", 1199459, 23180, 52], ["Dominica", 65511, 750, 87], ["Dominican Republic", 11609500, 48320, 240],
  ["Ecuador", 18444506, 248360, 74], ["Egypt", 120101175, 995450, 121], ["El Salvador", 6391253, 20720, 308],
  ["Equatorial Guinea", 1984468, 28050, 71], ["Eritrea", 3682669, 101000, 36], ["Estonia", 1331062, 42390, 31],
  ["Eswatini (fmr. Swaziland)", 1269859, 17200, 74], ["Ethiopia", 138902185, 1000000, 139], ["Fiji", 937282, 18270, 51],
  ["Finland", 5621739, 303890, 18], ["France", 66746401, 547557, 122], ["Gabon", 2647399, 257670, 10],
  ["Gambia", 2884079, 10120, 285], ["Georgia", 3804642, 69490, 55], ["Germany", 83644258, 348560, 240],
  ["Ghana", 35697557, 227540, 157], ["Greece", 9897115, 128900, 77], ["Grenada", 117362, 340, 345],
  ["Guatemala", 18967978, 107160, 177], ["Guinea", 15441993, 245720, 63], ["Guinea-Bissau", 2297808, 28120, 82],
  ["Guyana", 840890, 196850, 4], ["Haiti", 12037506, 27560, 437], ["Holy See", 506, 0, 1265],
  ["Honduras", 11184760, 111890, 100], ["Hungary", 9585818, 90530, 106], ["Iceland", 402329, 100250, 4],
  ["India", 1476625576, 2973190, 497], ["Indonesia", 287886782, 1811570, 159], ["Iran", 93168497, 1628550, 57],
  ["Iraq", 48007437, 434320, 111], ["Ireland", 5356950, 68890, 78], ["Israel", 9647689, 21640, 446],
  ["Italy", 58926166, 294140, 200], ["Jamaica", 2833403, 10830, 262], ["Japan", 122427731, 364555, 336],
  ["Jordan", 11589532, 88780, 131], ["Kazakhstan", 21083626, 2699700, 8], ["Kenya", 58636412, 569140, 103],
  ["Kiribati", 138445, 810, 171], ["Kuwait", 5102773, 17820, 286], ["Kyrgyzstan", 7400465, 191800, 39],
  ["Laos", 7974017, 230800, 35], ["Latvia", 1835935, 62200, 30], ["Lebanon", 5897467, 10230, 576],
  ["Lesotho", 2389336, 30360, 79], ["Liberia", 5853949, 96320, 61], ["Libya", 7539851, 1759540, 4],
  ["Liechtenstein", 40368, 160, 252], ["Lithuania", 2797338, 62674, 45], ["Luxembourg", 687448, 2590, 265],
  ["Madagascar", 33522052, 581795, 58], ["Malawi", 22785535, 94280, 242], ["Malaysia", 36385115, 328550, 111],
  ["Maldives", 531517, 300, 1772], ["Mali", 25932275, 1220190, 21], ["Malta", 549011, 320, 1716],
  ["Marshall Islands", 35075, 180, 195], ["Mauritania", 5461319, 1030700, 5], ["Mauritius", 1265059, 2030, 623],
  ["Mexico", 132997658, 1943950, 68], ["Micronesia", 114183, 700, 163], ["Moldova", 2961253, 32850, 90],
  ["Monaco", 38087, 1, 25562], ["Mongolia", 3556798, 1553560, 2], ["Montenegro", 626233, 13450, 47],
  ["Morocco", 38762441, 446300, 87], ["Mozambique", 36639851, 786380, 47], ["Myanmar (formerly Burma)", 55184819, 653290, 84],
  ["Namibia", 3153246, 823290, 4], ["Nauru", 12101, 20, 605], ["Nepal", 29629410, 143350, 207],
  ["Netherlands", 18448775, 33720, 547], ["New Zealand", 5287479, 263310, 20], ["Nicaragua", 7097329, 120340, 59],
  ["Niger", 28814878, 1266700, 23], ["Nigeria", 242431832, 910770, 266], ["North Korea", 26633691, 120410, 221],
  ["North Macedonia", 1804063, 25220, 72], ["Norway", 5652989, 365268, 15], ["Oman", 5671458, 309500, 18],
  ["Pakistan", 259299791, 770880, 336], ["Palau", 17614, 460, 38], ["Palestine State", 5692790, 6020, 946],
  ["Panama", 4625718, 74340, 62], ["Papua New Guinea", 10947848, 452860, 24], ["Paraguay", 7095279, 397300, 18],
  ["Peru", 34922148, 1280000, 27], ["Philippines", 117724471, 298170, 395], ["Poland", 37843188, 306230, 124],
  ["Portugal", 10395362, 91590, 113], ["Qatar", 3173559, 11610, 273], ["Romania", 18800605, 230170, 82],
  ["Russia", 143394458, 16376870, 9], ["Rwanda", 14889693, 24670, 604], ["Saint Kitts and Nevis", 46992, 260, 181],
  ["Saint Lucia", 180488, 610, 296], ["Saint Vincent and the Grenadines", 99245, 390, 254], ["Samoa", 220528, 2830, 78],
  ["San Marino", 33605, 60, 560], ["Sao Tome and Principe", 244994, 960, 255], ["Saudi Arabia", 35165787, 2149690, 16],
  ["Senegal", 19366548, 192530, 101], ["Serbia", 6641964, 87460, 76], ["Seychelles", 134959, 460, 293],
  ["Sierra Leone", 8996745, 72180, 125], ["Singapore", 5905748, 700, 8437], ["Slovakia", 5451342, 48088, 113],
  ["Slovenia", 2114573, 20140, 105], ["Solomon Islands", 858288, 27990, 31], ["Somalia", 20305907, 627340, 32],
  ["South Africa", 65453084, 1213090, 54], ["South Korea", 51600388, 97230, 531], ["South Sudan", 12436037, 610952, 20],
  ["Spain", 47850793, 498800, 96], ["Sri Lanka", 23348315, 62710, 372], ["Sudan", 53282719, 1765048, 30],
  ["Suriname", 645256, 156000, 4], ["Sweden", 10701047, 410340, 26], ["Switzerland", 9007798, 39516, 228],
  ["Syria", 26472497, 183630, 144], ["Tajikistan", 10978599, 139960, 78], ["Tanzania", 72563780, 885800, 82],
  ["Thailand", 71559614, 510890, 140], ["Timor-Leste", 1436923, 14870, 97], ["Togo", 9930918, 54390, 183],
  ["Tonga", 103291, 720, 143], ["Trinidad and Tobago", 1513268, 5130, 295], ["Tunisia", 12415138, 155360, 80],
  ["Turkey", 87926082, 769630, 114], ["Turkmenistan", 7736632, 469930, 16], ["Tuvalu", 9362, 30, 312],
  ["Uganda", 52761469, 199810, 264], ["Ukraine", 39535849, 579320, 68], ["United Arab Emirates", 11574682, 83600, 138],
  ["United Kingdom", 69931528, 241930, 289], ["United States of America", 349035494, 9147420, 38],
  ["Uruguay", 3382537, 175020, 19], ["Uzbekistan", 37724223, 425400, 89], ["Vanuatu", 342564, 12190, 28],
  ["Venezuela", 28633711, 882050, 32], ["Vietnam", 102177431, 310070, 330], ["Yemen", 42961653, 527970, 81],
  ["Zambia", 22521915, 743390, 30], ["Zimbabwe", 17273580, 386850, 45],
];

const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, "");

/**
 * The picker's canonical names (WORLD_COUNTRIES) don't always match the dataset's official ones —
 * "United States" vs "United States of America", "Czech Republic" vs "Czechia (Czech Republic)".
 * Aliases bridge them so a stored value always finds its facts.
 */
const ALIASES: [string, string][] = [
  ["United States", "United States of America"],
  ["Czech Republic", "Czechia (Czech Republic)"],
  ["Congo", "Congo (Congo-Brazzaville)"],
  ["Myanmar", "Myanmar (formerly Burma)"],
  ["Eswatini", "Eswatini (fmr. Swaziland)"],
  ["Palestine", "Palestine State"],
  ["Vatican City", "Holy See"],
  ["Ivory Coast", "Côte d'Ivoire"],
];

const byName = new Map<string, CountryFacts>();
for (const [name, population, landKm2, density] of ROWS) byName.set(norm(name), { name, population, landKm2, density });
for (const [alias, canonical] of ALIASES) {
  const f = byName.get(norm(canonical));
  if (f) byName.set(norm(alias), f);
}

/** Facts for a country name (picker-canonical or dataset-official), or null — never a guess. */
export function countryFacts(name: string | null | undefined): CountryFacts | null {
  if (!name) return null;
  return byName.get(norm(name)) ?? null;
}

/** "37.8M" / "83.8k" / "506" — compact population for tight UI. */
export function fmtPopulation(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}
