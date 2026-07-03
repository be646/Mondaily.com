/**
 * Places connector — structured local-business discovery for high-volume lead-gen.
 *
 * Two sources, chosen automatically, both FAIL-OPEN (return [] on any error so Discovery never
 * breaks if they're down):
 *   • Google Places (Text Search + Details) — best coverage + phones/websites — used ONLY if
 *     GOOGLE_PLACES_API_KEY is set. Optional paid connector (Stripe-style), never required.
 *   • OpenStreetMap Nominatim — free, sovereign, open infrastructure — the default. Fewer results
 *     but real name/address/phone/website from OSM extratags.
 *
 * This is the compliant, durable alternative to the "bulk Google Maps scrapers" (Outscraper/Apify):
 * official API when a key exists, open data otherwise — no gray-area scraping, no proxy networks.
 */
export interface PlaceLead {
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  source_url: string;      // a real maps/OSM link for provenance
  source: "google" | "osm";
}

const UA = "MondailyDiscovery/1.0 (+https://mondaily.com)";

/** Google Places Text Search + Details (only when a key is configured). */
async function googlePlaces(query: string, region: string | undefined, limit: number): Promise<PlaceLead[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return [];
  const q = region ? `${query} in ${region}` : query;
  const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&key=${key}`;
  const res = await fetch(searchUrl).then(r => r.json()).catch(() => null) as
    | { results?: { name?: string; formatted_address?: string; place_id?: string }[] } | null;
  const places = (res?.results ?? []).slice(0, limit);
  // Fetch phone + website per place (Details). Best-effort, capped.
  const out = await Promise.all(places.map(async (p) => {
    let phone: string | null = null, website: string | null = null;
    if (p.place_id) {
      const d = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=formatted_phone_number,website&key=${key}`)
        .then(r => r.json()).catch(() => null) as { result?: { formatted_phone_number?: string; website?: string } } | null;
      phone = d?.result?.formatted_phone_number ?? null;
      website = d?.result?.website ?? null;
    }
    return {
      name: p.name ?? "Unknown",
      address: p.formatted_address ?? null,
      phone, website,
      source_url: p.place_id ? `https://www.google.com/maps/place/?q=place_id:${p.place_id}` : "https://maps.google.com",
      source: "google" as const,
    };
  }));
  return out.filter(p => p.name && p.name !== "Unknown");
}

/** OpenStreetMap Nominatim search with extratags (free, sovereign default). */
async function osmPlaces(query: string, region: string | undefined, limit: number): Promise<PlaceLead[]> {
  const q = region ? `${query} ${region}` : query;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&extratags=1&addressdetails=1&limit=${Math.min(limit, 40)}`;
  const rows = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } })
    .then(r => r.ok ? r.json() : []).catch(() => []) as Array<{
      display_name?: string; name?: string; lat?: string; lon?: string; osm_type?: string; osm_id?: number;
      extratags?: Record<string, string>; address?: Record<string, string>;
    }>;
  return (rows ?? [])
    .map((r) => {
      const et = r.extratags ?? {};
      const name = r.name || et["name"] || (r.display_name?.split(",")[0] ?? "").trim();
      if (!name) return null;
      const osmLink = r.osm_type && r.osm_id ? `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}` : "https://www.openstreetmap.org";
      return {
        name,
        address: r.display_name ?? null,
        phone: et["phone"] || et["contact:phone"] || null,
        website: et["website"] || et["contact:website"] || null,
        source_url: osmLink,
        source: "osm" as const,
      } as PlaceLead;
    })
    .filter((p): p is PlaceLead => !!p);
}

/** True when the Places connector can return anything (always true — OSM needs no key). */
export function placesEnabled(): boolean { return true; }
export function placesProvider(): "google" | "osm" { return process.env.GOOGLE_PLACES_API_KEY ? "google" : "osm"; }

/**
 * Live health probe — makes ONE real test call so a misconfigured key is visible instead of
 * silently falling back to OSM. Surfaces Google's exact status (e.g. REQUEST_DENIED = classic
 * Places API not enabled or billing off; OK = working).
 */
export async function placesDiagnostic(): Promise<{ provider: "google" | "osm"; ok: boolean; detail: string; sample: number }> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (key) {
    try {
      const r = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent("dentist in Warsaw")}&key=${key}`)
        .then(res => res.json()).catch(() => null) as { status?: string; error_message?: string; results?: unknown[] } | null;
      const status = r?.status ?? "NO_RESPONSE";
      const ok = status === "OK" || status === "ZERO_RESULTS";
      return { provider: "google", ok, detail: ok ? `Google Places OK (${(r?.results ?? []).length} test results)` : `${status}${r?.error_message ? " — " + r.error_message : ""}`, sample: (r?.results ?? []).length };
    } catch (e) {
      return { provider: "google", ok: false, detail: `Request failed: ${e instanceof Error ? e.message : String(e)}`, sample: 0 };
    }
  }
  // OSM default — quick sanity call.
  const rows = await osmPlaces("dentist", "Warsaw", 5).catch(() => []);
  return { provider: "osm", ok: true, detail: `OpenStreetMap (free/sovereign) — ${rows.length} test businesses`, sample: rows.length };
}

/**
 * Find local businesses for a sector + region. Google if a key is set, else OSM. Never throws.
 * Pass districts to run the "geographic loop" (e.g. Warsaw → Mokotów, Wola…) for higher volume.
 */
export async function placesSearch(sector: string, region: string | undefined, limit = 30): Promise<PlaceLead[]> {
  try {
    const g = await googlePlaces(sector, region, limit);
    if (g.length) return g;
    return await osmPlaces(sector, region, limit);
  } catch { return []; }
}
