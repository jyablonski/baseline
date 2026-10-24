import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Signed-in or admin pages only redirect a crawler to sign-in; /api and
      // /mcp are machine endpoints. Crawl hints only: access is enforced elsewhere.
      disallow: ["/admin", "/account", "/signin", "/picks", "/chat", "/api/", "/mcp"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
