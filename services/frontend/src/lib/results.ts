import { utcDate } from "@/lib/calendar";
import { stageOf, type Stage } from "@/lib/game-story";
import type { GameDate, LeagueGame } from "@/lib/types";

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

/** A real calendar date: "2026-02-30" parses, but rolls over to March. */
function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = utcDate(value);
  // An impossible month is an Invalid Date, whose toISOString throws.
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * The date on screen and its neighbours with games. `requested` falls back to
 * the newest date when it is missing or not a real date; a requested date with no games is kept,
 * so the page can say so, and steps to the nearest game days around it.
 */
export function dayNavigation(dates: GameDate[], requested: string | null) {
  const days = dates.map((item) => item.game_date.slice(0, 10));
  const latest = days[0] ?? null;
  const current = requested && isCalendarDate(requested) ? requested : latest;
  if (!current) return { current: null, latest: null, older: null, newer: null };
  // Newest first, so older days come after the current one.
  const older = days.find((day) => day < current) ?? null;
  const newer = [...days].reverse().find((day) => day > current) ?? null;
  return { current, latest, older, newer };
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

/** Both sides of a result, winner first, with the margin in words. */
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
  const margin = winner.score != null && loser.score != null ? winner.score - loser.score : null;
  return {
    winner,
    loser,
    margin: margin == null ? null : `${winner.abbreviation} by ${margin}`,
  };
}
