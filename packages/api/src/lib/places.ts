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

interface NewPlace { id?: string; formattedAddress?: string; internationalPhoneNumber?: string; nationalPhoneNumber?: string; websiteUri?: string; displayName?: { text?: string } }

/** Places API (New) Text Search — phone + website come back in ONE call via the field mask.
 *  (Google deprecated the legacy Places API for new projects.) */
async function googlePlaces(query: string, region: string | undefined, limit: number): Promise<PlaceLead[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return [];
  const q = region ? `${query} in ${region}` : query;
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.nationalPhoneNumber,places.websiteUri",
    },
    body: JSON.stringify({ textQuery: q, maxResultCount: Math.min(limit, 20) }),
  }).then(r => r.json()).catch(() => null) as { places?: NewPlace[] } | null;
  return (res?.places ?? []).map((p) => ({
    name: p.displayName?.text ?? "Unknown",
    address: p.formattedAddress ?? null,
    phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    source_url: p.id ? `https://www.google.com/maps/place/?q=place_id:${p.id}` : "https://maps.google.com",
    source: "google" as const,
  })).filter(p => p.name !== "Unknown");
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
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id" },
        body: JSON.stringify({ textQuery: "dentist in Warsaw", maxResultCount: 5 }),
      });
      const j = await res.json().catch(() => null) as { places?: unknown[]; error?: { message?: string; status?: string } } | null;
      const ok = res.ok && Array.isArray(j?.places);
      const count = j?.places?.length ?? 0;
      return { provider: "google", ok, detail: ok ? `Google Places (New) OK (${count} test results)` : (j?.error?.message ?? `HTTP ${res.status}`), sample: count };
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
