import type { MetadataRoute } from "next";

const SITE = "https://mondaily.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Don't index auth flows or API routes.
      disallow: ["/sign-in", "/sign-up", "/api/"],
    },
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
