/**
 * THE canonical origin for this site — one declaration, three consumers.
 *
 * Every page declared `https://mondaily.com` while Vercel serves `https://www.mondaily.com` and
 * 308-redirects the apex to it. So every canonical link, every og:url and every sitemap entry
 * pointed at a URL that immediately redirects. Search engines tolerate that, but a self-referencing
 * canonical should resolve 200 — it is the one URL you are asserting is authoritative.
 *
 * The default is what actually serves today. If the Vercel primary domain is ever flipped to the
 * apex — which the rest of the codebase's intent suggests was the plan — set
 * NEXT_PUBLIC_SITE_URL=https://mondaily.com and this follows, with no other change anywhere.
 *
 * Declared in ONE place because it was previously copied into three, which is how they drift.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.mondaily.com")
  .replace(/\/+$/, "");
