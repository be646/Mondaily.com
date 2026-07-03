/**
 * Reddit connector — the best public source of buyer-intent ("looking for a lawyer in Warsaw").
 *
 * Reddit BLOCKS unauthenticated .json access (HTTP 403) from non-browsers, so this uses the
 * official OAuth app-only flow. It's an OPTIONAL connector: set REDDIT_CLIENT_ID +
 * REDDIT_CLIENT_SECRET (register a free "script" app at reddit.com/prefs/apps) to enable it.
 * FAIL-OPEN: with no credentials (or on any error) it returns [] and Discovery still surfaces
 * Reddit via the SearXNG `site:reddit.com` queries — the connector just makes it fresher/deeper.
 */
export interface RedditHit {
  title: string;
  text: string;
  url: string;         // full permalink
  author: string | null;
  subreddit: string | null;
  created_at: string | null;
}

const UA = "web:mondaily-discovery:1.0 (by /u/mondaily)";

let _token: { value: string; exp: number } | null = null;
async function appToken(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID, secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (_token && _token.exp > Date.now() + 30_000) return _token.value;
  try {
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) return null;
    const j = await res.json() as { access_token?: string; expires_in?: number };
    if (!j.access_token) return null;
    _token = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return _token.value;
  } catch { return null; }
}

/** True when Reddit OAuth credentials are configured. */
export function redditEnabled(): boolean { return !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET); }

/** Live health probe — confirms the OAuth credentials actually mint a token. */
export async function redditDiagnostic(): Promise<{ enabled: boolean; ok: boolean; detail: string }> {
  if (!redditEnabled()) return { enabled: false, ok: false, detail: "Not configured (REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET). SearXNG still covers Reddit publicly." };
  const token = await appToken();
  return token
    ? { enabled: true, ok: true, detail: "Reddit OAuth OK — buyer-intent posts will be pulled." }
    : { enabled: true, ok: false, detail: "Credentials set but token request failed — check the client id/secret and that the app type is 'script'." };
}

/** Search Reddit posts via the official OAuth API. `sort=new` surfaces fresh intent. */
export async function redditSearch(query: string, limit = 25): Promise<RedditHit[]> {
  if (process.env.REDDIT_DISABLE === "1") return [];
  const token = await appToken();
  if (!token) return []; // no creds → inert (SearXNG site:reddit.com still covers Reddit)
  try {
    const url = `https://oauth.reddit.com/search?q=${encodeURIComponent(query)}&limit=${Math.min(limit, 50)}&sort=new&type=link`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) return [];
    const data = await res.json() as { data?: { children?: { data?: Record<string, unknown> }[] } };
    return (data.data?.children ?? [])
      .map((c) => c.data)
      .filter((d): d is Record<string, unknown> => !!d)
      .map((d) => ({
        title: String(d.title ?? ""),
        text: String(d.selftext ?? "").slice(0, 1200),
        url: d.permalink ? `https://www.reddit.com${d.permalink}` : String(d.url ?? ""),
        author: d.author ? String(d.author) : null,
        subreddit: d.subreddit ? `r/${d.subreddit}` : null,
        created_at: typeof d.created_utc === "number" ? new Date((d.created_utc as number) * 1000).toISOString() : null,
      }))
      .filter((h) => h.url && (h.title || h.text));
  } catch { return []; }
}
