// Shared auth for the self-hosted search/scrape appliance. When SOVEREIGN_SEARCH_KEY is set,
// every call carries a bearer token; the appliance's reverse proxy rejects anything without it,
// so the open Hetzner ports can't be abused. Unset = no header (local/dev, appliance open).
export function sovereignHeaders(): Record<string, string> {
  const key = process.env.SOVEREIGN_SEARCH_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}
