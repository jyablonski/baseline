import { utcDate } from "@/lib/calendar";
import { stageOf, type Stage } from "@/lib/game-story";
import type { LeagueGame } from "@/lib/types";

// The /games results day. Dates are Eastern calendar dates ("2026-06-13"),
// newest first, as GET /api/v1/games/dates returns them.

const STAGE_LABEL: Record<Stage, string | null> = {
  "Regular Season": null,
  "NBA Cup": "NBA Cup",
  "Play-In": "Play-In",
  Playoffs: "Playoffs",
  "NBA Finals": "Finals",
};

/** "Saturday, June 13", with the year when it is not `yearOf`'s. */
export function formatDayTitle(date: string, yearOf?: string) {
  const sameYear = !yearOf || yearOf.slice(0, 4) === date.slice(0, 4);
  return utcDate(date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

/** "Sat, Jun 13" for the picker button. */
export function formatDayShort(date: string) {
  return utcDate(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The line under the day's title: the stage when every game shares one
 * ("Finals"), the series game when there is only one ("Game 5"), and the count.
 */
export function daySummary(games: LeagueGame[]) {
  const parts: string[] = [];
  const stages = new Set(games.map((game) => stageOf(game.season_type, game)));
  if (stages.size === 1) {
    const label = STAGE_LABEL[[...stages][0]];
    if (label) parts.push(label);
  }
  if (games.length === 1 && games[0].series_game_number != null) {
    parts.push(`Game ${games[0].series_game_number}`);
  }
  parts.push(`${games.length} ${games.length === 1 ? "game" : "games"}`);
  return parts.join(" · ");
}

/** Both sides of a result, winner first. */
export function resultSides(game: LeagueGame) {
  const home = {
    teamId: game.home_team_id,
    abbreviation: game.home_team_abbreviation ?? "Home",
    score: game.home_score,
  };
  const away = {
    teamId: game.away_team_id,
    abbreviation: game.away_team_abbreviation ?? "Away",
    score: game.away_score,
  };
  const homeWon =
    game.home_score != null && game.away_score != null
      ? game.home_score > game.away_score
      : game.winning_team_id === game.home_team_id;
  const [winner, loser] = homeWon ? [home, away] : [away, home];
  return { winner, loser };
}

/**
 * A win is an upset only when the market had the loser at 60% or better: a
 * 46% team winning is a coin flip, not a story. Steeper than the mart's
 * `is_upset`, which counts any underdog.
 */
export const UPSET_MAX_WP = 0.4;

/** A winner that trailed by this much came back. */
export const COMEBACK_MIN_DEFICIT = 10;

/** The winner's market WP is low enough to call the win an upset. */
export function isUpsetWin(winnerMarketWp: number | null | undefined) {
  return winnerMarketWp != null && winnerMarketWp <= UPSET_MAX_WP;
}

/**
 * How the market read a game once it is over: its favourite with that side's
 * WP on the morning line, and whether the win was an upset or a comeback.
 */
export function gameOdds(game: LeagueGame) {
  const { winner, loser } = resultSides(game);
  const homeWon = winner.teamId === game.home_team_id;
  const winnerMarketWp = game.winner_market_wp ?? null;
  // An even 50% is no favourite at all.
  const market =
    winnerMarketWp == null || winnerMarketWp === 0.5
      ? null
      : winnerMarketWp > 0.5
        ? { abbreviation: winner.abbreviation, wp: winnerMarketWp }
        : { abbreviation: loser.abbreviation, wp: 1 - winnerMarketWp };
  return {
    winner,
    loser,
    homeWon,
    winnerMarketWp,
    isUpset: isUpsetWin(winnerMarketWp),
    isComeback: (game.largest_lead_blown ?? 0) >= COMEBACK_MIN_DEFICIT,
    market,
  };
}

/**
 * One night's results, the ones that matter most first: upsets (the longest
 * shot first), then comebacks (the biggest deficit first), then the closest
 * finishes. Ties keep the API's order.
 */
export function rankSlate(games: LeagueGame[]) {
  const key = (game: LeagueGame) => {
    const odds = gameOdds(game);
    const margin =
      game.home_score != null && game.away_score != null
        ? Math.abs(game.home_score - game.away_score)
        : Infinity;
    return [
      odds.isUpset ? 0 : odds.isComeback ? 1 : 2,
      // An upset always has a line, so its WP is never null here.
      odds.isUpset
        ? (odds.winnerMarketWp as number)
        : odds.isComeback
          ? -(game.largest_lead_blown ?? 0)
          : 0,
      margin,
    ];
  };
  const keyed = games.map((game) => ({ game, key: key(game) }));
  keyed.sort((left, right) => {
    for (let index = 0; index < left.key.length; index++) {
      if (left.key[index] !== right.key[index]) return left.key[index] - right.key[index];
    }
    return 0;
  });
  return keyed.map(({ game }) => game);
}
