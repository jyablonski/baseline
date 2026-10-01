export const PRIMARY_NAV = [
  { href: "/", label: "Home" },
  { href: "/schedule", label: "Schedule" },
  { href: "/players", label: "Players" },
  { href: "/teams", label: "Teams" },
  { href: "/ask", label: "Ask" },
  { href: "/social", label: "Social" },
  { href: "/about", label: "About" },
] as const;

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
