import type { PlayerTrend, PlayerTrendStat, PlayerTrendStatKey } from "@/lib/types";

const stat = (
  key: PlayerTrendStatKey,
  last_10: number | null,
  baseline: number | null,
  season: number | null,
  z: number | null = 0.3,
  changed = false
): PlayerTrendStat => ({
  stat: key,
  last_10,
  baseline,
  season,
  change:
    last_10 == null || baseline == null ? null : Math.round((last_10 - baseline) * 1000) / 1000,
  z,
  changed,
  // Ten games around the window's average, oldest first.
  games: last_10 == null ? [] : Array.from({ length: 10 }, (_, i) => last_10 + (i % 3) - 1),
});

/**
 * A qualified riser: MVP game score, points and turnovers (fewer) beat the usual
 * swings; rebounds, assists and the rest do not. TS% moved, but not enough.
 */
export function trendFixture(overrides: Partial<PlayerTrend> = {}): PlayerTrend {
  return {
    player_id: "player-1",
    full_name: "Stephen Curry",
    team_id: "team-gsw",
    season: "2025-26",
    games_played: 30,
    window_games: 10,
    baseline_games: 20,
    window_start_date: "2025-11-20",
    window_end_date: "2026-01-08",
    trend_direction: "up",
    trend_rank: 3,
    stats: [
      stat("mvp_game_score", 28.1, 22.6, 26.0, 2.8, true),
      stat("game_score", 24.8, 20.1, 23.0, 2.1, true),
      stat("points", 31.2, 26.0, 29.1, 2.5, true),
      stat("rebounds", 4.6, 4.8, 4.7),
      stat("assists", 6.4, 6.1, 6.3),
      stat("steals", 1.1, 1.0, 1.1),
      stat("blocks", 0.3, 0.4, 0.3),
      stat("three_pointers_made", 5.4, 4.2, 5.0, 1.9),
      stat("turnovers", 2.1, 3.1, 2.5, -2.2, true),
      stat("true_shooting_pct", 0.641, 0.592, 0.623, 1.2),
      stat("plus_minus", 6.3, 1.2, 4.4, 1.5),
      stat("minutes", 36.1, 33.0, 34.9, 2.4, true),
    ],
    ...overrides,
  };
}

/** The same player with some stats' fields replaced, keyed by stat. */
export function withStats(
  trend: PlayerTrend,
  changes: Partial<Record<PlayerTrendStatKey, Partial<PlayerTrendStat>>>
): PlayerTrend {
  return {
    ...trend,
    stats: trend.stats.map((entry) => ({ ...entry, ...changes[entry.stat] })),
  };
}
