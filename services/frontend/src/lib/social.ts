import type { SocialFacet, SocialFlair, SocialPost } from "@/lib/types";

export const SOCIAL_RANGES = [
  { key: "24h", label: "24h", days: 1 },
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
] as const;

export type SocialRangeKey = (typeof SOCIAL_RANGES)[number]["key"];

export const DEFAULT_SOCIAL_RANGE: SocialRangeKey = "7d";

// Newest first. Discussion ratio floors a score of 0 to 1, so as the default it
// filled the first screen with downvoted threads; it stays one pick away in Sort.
export const DEFAULT_SOCIAL_SORT = "recent";

export const SOCIAL_SORTS = [
  { key: "discussion", label: "Discussion ratio" },
  { key: "recent", label: "Most recent" },
  { key: "score", label: "Score" },
  { key: "comments", label: "Comments" },
  { key: "leverage", label: "Top-comment leverage" },
] as const;

// The API's four buckets. "link" is an untagged link post, distinct from
// "discussion", which is an untagged self post.
export const CONTENT_TYPE_LABELS: Record<string, string> = {
  highlight: "Highlight",
  report: "Reporter",
  discussion: "Discussion",
  link: "Link",
};

export function isSocialRange(value: string | null | undefined): value is SocialRangeKey {
  return SOCIAL_RANGES.some((range) => range.key === value);
}

/** Inclusive UTC day bounds for a range, counting back from `today`. */
export function rangeToDates(range: SocialRangeKey, today = new Date()) {
  const days = SOCIAL_RANGES.find((item) => item.key === range)?.days ?? 7;
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from_date: isoDay(from), to_date: isoDay(to) };
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function formatCount(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US");
}

/** "14h ago" / "3d ago". Batch data, so minutes are noise. */
export function relativeAge(value: string | null | undefined, now = new Date()) {
  if (!value) return "—";
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return "—";
  const hours = Math.floor((now.getTime() - then.getTime()) / 3_600_000);
  if (hours < 1) return "under 1h ago";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function facetCount(facets: SocialFacet[], key: string) {
  return facets.find((facet) => facet.key === key)?.post_count ?? 0;
}

export function totalFacetCount(facets: SocialFacet[]) {
  return facets.reduce((sum, facet) => sum + facet.post_count, 0);
}

/** The fan badge on an author, or null when they have none — about half of them. */
export function flairLabel(row: SocialFlair) {
  if (row.flair_scope === "team") return row.flair_team_abbreviation ?? row.flair_team_name ?? null;
  if (row.flair_scope === "league") return "r/NBA";
  return null;
}

export function postSourceLabel(post: SocialPost) {
  if (post.source === "self") return "Self post";
  return post.source ?? "No link";
}
