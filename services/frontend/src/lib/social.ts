import type { SocialEntity, SocialFacet, SocialFlair, SocialPost } from "@/lib/types";

export const SOCIAL_RANGES = [
  { key: "24h", label: "24h", days: 1 },
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
] as const;

export type SocialRangeKey = (typeof SOCIAL_RANGES)[number]["key"];

export const DEFAULT_SOCIAL_RANGE: SocialRangeKey = "24h";

// Highest score first. Discussion ratio floors a score of 0 to 1, so as the default
// it filled the first screen with downvoted threads; it stays one pick away in Sort.
export const DEFAULT_SOCIAL_SORT = "score";

export const SOCIAL_SORTS = [
  { key: "discussion", label: "Discussion ratio" },
  { key: "recent", label: "Most recent" },
  { key: "score", label: "Score" },
  { key: "comments", label: "Comments" },
  { key: "leverage", label: "Top-comment leverage" },
] as const;

// The API's buckets. "link" is an untagged link post, distinct from
// "discussion", which is an untagged self post.
export const CONTENT_TYPE_LABELS: Record<string, string> = {
  highlight: "Highlight",
  report: "Reporter",
  game_thread: "Game thread",
  discussion: "Discussion",
  link: "Link",
};

export function isSocialRange(value: string | null | undefined): value is SocialRangeKey {
  return SOCIAL_RANGES.some((range) => range.key === value);
}

/**
 * Inclusive UTC day bounds for a range, counting back from `anchor`. The anchor
 * day is partial (it stops at the newest post), so a range is that day plus
 * `days` whole days before it: "24h" on its own would be only the few hours
 * between midnight UTC and the last collection.
 */
export function rangeToDates(range: SocialRangeKey, anchor = new Date()) {
  const days = SOCIAL_RANGES.find((item) => item.key === range)?.days ?? 7;
  const to = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days);
  return { from_date: isoDay(from), to_date: isoDay(to) };
}

/**
 * The window just before `window`, the same number of days long, ending the
 * day before it starts. Both bounds are inclusive, as the API reads them.
 */
export function previousWindow(window: { from_date: string; to_date: string }) {
  const from = new Date(`${window.from_date}T00:00:00Z`);
  const to = new Date(`${window.to_date}T00:00:00Z`);
  const span = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  const previousTo = new Date(from);
  previousTo.setUTCDate(previousTo.getUTCDate() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setUTCDate(previousFrom.getUTCDate() - span);
  return { from_date: isoDay(previousFrom), to_date: isoDay(previousTo) };
}

export type SocialEntityKind = "player" | "team";

export type RisingEntity = {
  entity: SocialEntity;
  kind: SocialEntityKind;
  /** Posts naming it in this window, minus the window before. */
  gain: number;
  previous: number;
};

/**
 * The player or team whose post count grew most against the window before:
 * the biggest gain, then the bigger count now. Null when nothing grew, or when
 * there is nothing to compare against (no mentions at all the window before,
 * which is a gap in collection, not a surge).
 */
export function risingEntity(
  current: { kind: SocialEntityKind; entities: SocialEntity[] }[],
  previous: SocialEntity[]
): RisingEntity | null {
  if (previous.length === 0) return null;
  const before = new Map(previous.map((entity) => [entity.entity_id, entity.post_count]));
  let best: RisingEntity | null = null;
  for (const { kind, entities } of current) {
    for (const entity of entities) {
      const was = before.get(entity.entity_id) ?? 0;
      const gain = entity.post_count - was;
      if (gain <= 0) continue;
      if (
        best == null ||
        gain > best.gain ||
        (gain === best.gain && entity.post_count > best.entity.post_count)
      ) {
        best = { entity, kind, gain, previous: was };
      }
    }
  }
  return best;
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
