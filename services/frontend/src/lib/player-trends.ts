import { formatSignedMargin, formatStat } from "@/lib/format";
import type { PlayerTrend, PlayerTrendStat, PlayerTrendStatKey } from "@/lib/types";

type StatMeta = {
  /** Short, for tables and the team list ("PTS"). */
  label: string;
  /** Spelled out, for the headline tiles ("Points"). */
  name: string;
  /** Which way is better; minutes have none, so they are never coloured. */
  better: "higher" | "lower" | "neutral";
  /** A box-score line a reader recognises, rather than a composite or context. */
  isBoxStat: boolean;
};

const TREND_STATS: Record<PlayerTrendStatKey, StatMeta> = {
  mvp_game_score: {
    label: "MVP game score",
    name: "MVP game score",
    better: "higher",
    isBoxStat: false,
  },
  game_score: { label: "Game Score", name: "Game Score", better: "higher", isBoxStat: false },
  points: { label: "PTS", name: "Points", better: "higher", isBoxStat: true },
  rebounds: { label: "REB", name: "Rebounds", better: "higher", isBoxStat: true },
  assists: { label: "AST", name: "Assists", better: "higher", isBoxStat: true },
  steals: { label: "STL", name: "Steals", better: "higher", isBoxStat: true },
  blocks: { label: "BLK", name: "Blocks", better: "higher", isBoxStat: true },
  three_pointers_made: { label: "3PM", name: "Threes", better: "higher", isBoxStat: true },
  turnovers: { label: "TOV", name: "Turnovers", better: "lower", isBoxStat: true },
  true_shooting_pct: { label: "TS%", name: "True shooting", better: "higher", isBoxStat: true },
  plus_minus: { label: "+/-", name: "Plus-minus", better: "higher", isBoxStat: false },
  minutes: { label: "MIN", name: "Minutes", better: "neutral", isBoxStat: false },
};

// The box stats shown first when no change stands out, in this order.
const DEFAULT_HEADLINE: PlayerTrendStatKey[] = ["points", "rebounds", "assists"];

export const TREND_DIRECTION_LABEL: Record<PlayerTrend["trend_direction"], string> = {
  up: "Trending up",
  down: "Trending down",
  steady: "Steady",
};

export function trendStatLabel(stat: PlayerTrendStatKey): string {
  return TREND_STATS[stat].label;
}

export function trendStatName(stat: PlayerTrendStatKey): string {
  return TREND_STATS[stat].name;
}

/**
 * Better or worse only when the change beats the player's usual game-to-game
 * swings (the API's `changed`); minutes are never judged.
 */
export function changeTone(stat: PlayerTrendStat): "better" | "worse" | "neutral" {
  const better = TREND_STATS[stat.stat].better;
  if (better === "neutral" || !stat.changed || stat.change == null || stat.change === 0) {
    return "neutral";
  }
  const improved = better === "higher" ? stat.change > 0 : stat.change < 0;
  return improved ? "better" : "worse";
}

export function formatTrendValue(stat: PlayerTrendStatKey, value: number | null): string {
  if (value == null) return "—";
  if (stat === "true_shooting_pct") return `${(value * 100).toFixed(1)}%`;
  if (stat === "plus_minus") return formatSignedMargin(value, 1);
  return formatStat(value);
}

export function formatTrendChange(stat: PlayerTrendStatKey, change: number | null): string {
  if (change == null) return "—";
  // TS% moves in percentage points, not percent of itself.
  if (stat === "true_shooting_pct") return formatSignedMargin(change * 100, 1);
  return formatSignedMargin(change, 1);
}

export function trendStat(trend: PlayerTrend, key: PlayerTrendStatKey) {
  return trend.stats.find((stat) => stat.stat === key);
}

export function mvpTrendStat(trend: PlayerTrend): PlayerTrendStat | undefined {
  return trendStat(trend, "mvp_game_score");
}

const strength = (stat: PlayerTrendStat) => Math.abs(stat.z ?? 0);

/** The changed box stat furthest past its usual swings; null when none changed. */
export function biggestMover(trend: PlayerTrend): PlayerTrendStat | null {
  const moved = trend.stats.filter((stat) => TREND_STATS[stat.stat].isBoxStat && stat.changed);
  return moved.sort((a, b) => strength(b) - strength(a))[0] ?? null;
}

/**
 * The four headline tiles: MVP game score, then the three box stats that moved
 * most against their usual swings, filled out with points, rebounds and assists.
 */
export function headlineStats(trend: PlayerTrend): PlayerTrendStat[] {
  const box = trend.stats.filter((stat) => TREND_STATS[stat.stat].isBoxStat);
  const picked = box
    .filter((stat) => stat.changed)
    .sort((a, b) => strength(b) - strength(a))
    .slice(0, 3);
  for (const key of DEFAULT_HEADLINE) {
    if (picked.length >= 3) break;
    const stat = box.find((entry) => entry.stat === key);
    if (stat && !picked.includes(stat)) picked.push(stat);
  }
  const mvp = mvpTrendStat(trend);
  return mvp ? [mvp, ...picked] : picked;
}

export function changedCount(trend: PlayerTrend): number {
  return trend.stats.filter((stat) => stat.changed).length;
}

/** At most `limit` risers (biggest first) and fallers (biggest drop first); steady players are in neither. */
export function risersAndFallers(trends: PlayerTrend[], limit = 3) {
  // The API lists biggest riser first; sorting here keeps that for risers and
  // puts the biggest drop first for fallers.
  const change = (trend: PlayerTrend) => mvpTrendStat(trend)?.change ?? 0;
  const risers = trends
    .filter((trend) => trend.trend_direction === "up")
    .sort((a, b) => change(b) - change(a))
    .slice(0, limit);
  const fallers = trends
    .filter((trend) => trend.trend_direction === "down")
    .sort((a, b) => change(a) - change(b))
    .slice(0, limit);
  return { risers, fallers };
}
