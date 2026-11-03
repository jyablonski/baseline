import type { PlayerInjury, TeamSeasonGame, TeamStatSplit, TeamStatSplitName } from "@/lib/types";

export const TEAM_TABS = ["overview", "stats", "roster", "schedule", "cap", "moves"] as const;
export type TeamTab = (typeof TEAM_TABS)[number];

export const TEAM_TAB_LABEL: Record<TeamTab, string> = {
  overview: "Overview",
  stats: "Stats",
  roster: "Roster",
  schedule: "Schedule",
  cap: "Cap",
  moves: "Moves",
};

export function parseTeamTab(value: string | null | undefined): TeamTab {
  return TEAM_TABS.find((tab) => tab === value) ?? "overview";
}

/** The team page URL for one tab; Overview is the bare path. Keeps every other param. */
export function teamTabHref(pathname: string, params: URLSearchParams, tab: TeamTab) {
  const next = new URLSearchParams(params);
  if (tab === "overview") next.delete("tab");
  else next.set("tab", tab);
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export const STAT_SPLITS: { value: TeamStatSplitName; label: string }[] = [
  { value: "season", label: "Season" },
  { value: "last_10", label: "Last 10" },
  { value: "home", label: "Home" },
  { value: "away", label: "Away" },
];

export type TeamStatKey =
  | "net_rating"
  | "offensive_rating"
  | "defensive_rating"
  | "pace"
  | "points_per_game"
  | "opponent_points_per_game"
  | "effective_fg_pct"
  | "opponent_effective_fg_pct"
  | "three_pointers_made_per_game"
  | "three_point_pct"
  | "three_point_attempt_rate"
  | "free_throw_rate"
  | "offensive_rebound_pct"
  | "defensive_rebound_pct"
  | "turnover_pct"
  | "opponent_turnover_pct"
  | "assist_rate";

export type StatFormat = "rating" | "signed" | "pct" | "ratio" | "count";

export type StatDefinition = {
  key: TeamStatKey;
  label: string;
  format: StatFormat;
  /** Pace has no better direction, so its rank is shown without a good/bad tone. */
  neutral?: boolean;
};

export const STAT_GROUPS: { title: string; stats: StatDefinition[] }[] = [
  {
    title: "Ratings",
    stats: [
      { key: "net_rating", label: "Net rating", format: "signed" },
      { key: "offensive_rating", label: "Offensive rating", format: "rating" },
      { key: "defensive_rating", label: "Defensive rating", format: "rating" },
      { key: "pace", label: "Pace", format: "rating", neutral: true },
    ],
  },
  {
    title: "Scoring",
    stats: [
      { key: "points_per_game", label: "Points per game", format: "rating" },
      { key: "opponent_points_per_game", label: "Opponent points per game", format: "rating" },
    ],
  },
  {
    title: "Shooting",
    stats: [
      { key: "effective_fg_pct", label: "Effective FG%", format: "pct" },
      { key: "opponent_effective_fg_pct", label: "Opponent effective FG%", format: "pct" },
      { key: "three_pointers_made_per_game", label: "3PT made per game", format: "count" },
      { key: "three_point_pct", label: "3PT%", format: "pct" },
      { key: "three_point_attempt_rate", label: "3PT attempt rate", format: "pct" },
      { key: "free_throw_rate", label: "Free throw rate", format: "ratio" },
    ],
  },
  {
    title: "Possession",
    stats: [
      { key: "offensive_rebound_pct", label: "Offensive rebound %", format: "pct" },
      { key: "defensive_rebound_pct", label: "Defensive rebound %", format: "pct" },
      { key: "turnover_pct", label: "Turnover %", format: "pct" },
      { key: "opponent_turnover_pct", label: "Opponent turnover %", format: "pct" },
      { key: "assist_rate", label: "Assist rate", format: "pct" },
    ],
  },
];

export const OVERVIEW_STATS: StatDefinition[] = STAT_GROUPS[0].stats;

export function formatTeamStat(value: number | null | undefined, format: StatFormat) {
  if (value == null || Number.isNaN(value)) return "—";
  if (format === "pct") return `${(value * 100).toFixed(1)}%`;
  if (format === "ratio") return value.toFixed(3).replace(/^0/, "");
  if (format === "signed") return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
  return value.toFixed(1);
}

export function statRank(split: TeamStatSplit, key: TeamStatKey): number | null {
  return split[`${key}_rank` as `${TeamStatKey}_rank`];
}

/** Share of the bar to fill: 1st fills it, last leaves a sliver. */
export function rankFill(rank: number | null, count: number) {
  if (rank == null || count <= 0) return 0;
  if (count === 1) return 1;
  return Math.max(0.04, (count - rank) / (count - 1));
}

export type RankTone = "good" | "middle" | "bad" | "neutral";

/** Top third reads good, bottom third bad, the rest middle. */
export function rankTone(rank: number | null, count: number, neutral = false): RankTone {
  if (neutral || rank == null || count <= 0) return "neutral";
  if (rank <= Math.ceil(count / 3)) return "good";
  if (rank > count - Math.ceil(count / 3)) return "bad";
  return "middle";
}

/** Played games newest first, at most `limit`. */
export function lastGames(games: TeamSeasonGame[], limit = 5) {
  return games
    .filter((game) => game.result != null)
    .sort((a, b) => b.game_date.localeCompare(a.game_date))
    .slice(0, limit);
}

/** The first game not yet Final on or after today (an Eastern date, YYYY-MM-DD). */
export function nextGame(games: TeamSeasonGame[], today: string) {
  return (
    [...games]
      .filter((game) => game.status !== "Final" && game.game_date.slice(0, 10) >= today)
      .sort(
        (a, b) =>
          a.game_date.localeCompare(b.game_date) ||
          (a.start_time_et ?? "").localeCompare(b.start_time_et ?? "")
      )[0] ?? null
  );
}

export function isOut(injury: Pick<PlayerInjury, "injury_status">) {
  return injury.injury_status === "Out" || injury.injury_status === "Out For Season";
}
