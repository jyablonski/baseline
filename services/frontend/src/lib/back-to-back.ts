import type { ScheduledGame } from "@/lib/types";

/** One team's game the night before, when it is on the second night of a back-to-back. */
export type LastNight = {
  abbreviation: string;
  opponentAbbreviation: string | null;
  wasHome: boolean | null;
  /** Null while last night's game is not Final yet. */
  teamScore: number | null;
  opponentScore: number | null;
};

/** The given side's back-to-back, or null when that team did not play the day before. */
export function lastNight(game: ScheduledGame, side: "home" | "away"): LastNight | null {
  if (side === "home") {
    if (!game.home_is_back_to_back) return null;
    return {
      abbreviation: game.home_team_abbreviation ?? "Home",
      opponentAbbreviation: game.home_last_night_opponent_abbreviation ?? null,
      wasHome: game.home_last_night_was_home ?? null,
      teamScore: game.home_last_night_score ?? null,
      opponentScore: game.home_last_night_opponent_score ?? null,
    };
  }
  if (!game.away_is_back_to_back) return null;
  return {
    abbreviation: game.away_team_abbreviation ?? "Away",
    opponentAbbreviation: game.away_last_night_opponent_abbreviation ?? null,
    wasHome: game.away_last_night_was_home ?? null,
    teamScore: game.away_last_night_score ?? null,
    opponentScore: game.away_last_night_opponent_score ?? null,
  };
}

/**
 * "L 108–115 vs ORL" from the tired team's side: its own score first, "vs" at
 * home and "@" away. Without a final score yet it is just "vs ORL".
 */
export function lastNightResult(night: LastNight): string | null {
  if (!night.opponentAbbreviation) return null;
  const venue = night.wasHome === false ? "@" : "vs";
  const matchup = `${venue} ${night.opponentAbbreviation}`;
  if (night.teamScore === null || night.opponentScore === null) return matchup;
  const outcome = night.teamScore > night.opponentScore ? "W" : "L";
  return `${outcome} ${night.teamScore}–${night.opponentScore} ${matchup}`;
}
