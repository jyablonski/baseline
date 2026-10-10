export const PRIMARY_NAV = [
  { href: "/", label: "Home" },
  { href: "/schedule", label: "Schedule" },
  { href: "/players", label: "Players" },
  { href: "/teams", label: "Teams" },
  { href: "/ask", label: "Ask" },
  { href: "/social", label: "Social" },
  { href: "/about", label: "About" },
] as const;

/**
 * The primary tabs for this visitor. Ask and Chat share one slot: Chat when
 * the chatbot is available, the rules-based Ask otherwise. Never both.
 */
export function primaryNav(chatbot: boolean) {
  return PRIMARY_NAV.map((item) =>
    item.href === "/ask" && chatbot ? { href: "/chat", label: "Chat" } : item
  );
}

export function isNavActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/players") return pathname === "/players" || pathname.startsWith("/players/");
  if (href === "/teams") return pathname === "/teams" || pathname.startsWith("/teams/");
  if (href === "/games") return pathname === "/games" || pathname.startsWith("/games/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function withSeason(href: string, season: string) {
  if (!season) return href;
  const [path, existing] = href.split("?");
  const params = new URLSearchParams(existing);
  params.set("season", season);
  return `${path}?${params.toString()}`;
}

export function slugifyName(name: string) {
  return name
    .normalize("NFC")
    .toLowerCase()
    .replace(/[.'’]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

/**
 * A dynamic segment as typed, not as sent. `useParams` hands back the
 * percent-encoded form, so "nikola-jokić" arrives as "nikola-joki%C4%87" and
 * would slugify into something no player matches.
 */
export function decodeRouteSlug(slug: string) {
  try {
    return decodeURIComponent(slug);
  } catch {
    // A stray "%" that is not an escape: use it as written.
    return slug;
  }
}

export function playerHref(name: string) {
  return `/players/${slugifyName(name)}`;
}

export function teamHref(name: string) {
  return `/teams/${slugifyName(name)}`;
}

export function isLegacyEntityId(value: string) {
  return (
    /^\d+$/.test(value) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
