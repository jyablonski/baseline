export type FormGame = {
  is_win?: boolean | null;
  result?: string | null;
};

function winFlag(game: FormGame): boolean | null {
  if (game.is_win === true) return true;
  if (game.is_win === false) return false;
  if (game.result === "W") return true;
  if (game.result === "L") return false;
  return null;
}

export function lastTenFromGames(games: FormGame[]): string | null {
  const recent = games.slice(0, 10);
  let wins = 0;
  let losses = 0;
  for (const game of recent) {
    const win = winFlag(game);
    if (win === true) wins += 1;
    else if (win === false) losses += 1;
  }
  if (wins + losses === 0) return null;
  return `${wins}–${losses}`;
}

export function streakFromGames(games: FormGame[]): string | null {
  if (games.length === 0) return null;
  const first = winFlag(games[0]);
  if (first == null) return null;
  let count = 0;
  for (const game of games) {
    const win = winFlag(game);
    if (win == null || win !== first) break;
    count += 1;
  }
  return `${first ? "W" : "L"}${count}`;
}

/**
 * "W6" → { length: 6, sentence: "has won 6 straight" }; null for anything that
 * is not a W/L streak.
 */
export function streakSentence(
  streak: string | null | undefined
): { length: number; sentence: string } | null {
  const match = /^([WL])(\d+)$/.exec(streak ?? "");
  if (!match) return null;
  return {
    length: Number(match[2]),
    sentence: `has ${match[1] === "W" ? "won" : "lost"} ${match[2]} straight`,
  };
}

// The play-in decides seeds 7-10, so a settled bracket outranks record order
// (POR 42-40 seeded 7th over PHX 45-37). Falls back to record rank mid-season.
export function standingsSeed(row: {
  playoff_seed?: number | null;
  conference_rank?: number | null;
}): number | null {
  return row.playoff_seed ?? row.conference_rank ?? null;
}

type RankedRow = {
  conference: string;
  team_name: string;
  win_pct?: number | null;
  playoff_seed?: number | null;
  conference_rank?: number | null;
};

/**
 * One conference ("east" / "west"), best seed first. Unseeded teams follow by
 * win %, then name, so an early-season table still reads top to bottom.
 */
export function conferenceStandings<T extends RankedRow>(rows: T[], conference: "east" | "west") {
  return rows
    .filter((row) => row.conference.toLowerCase().startsWith(conference))
    .sort((a, b) => {
      const seedA = standingsSeed(a);
      const seedB = standingsSeed(b);
      if (seedA != null && seedB != null) {
        return seedA - seedB || a.team_name.localeCompare(b.team_name);
      }
      if (seedA != null) return -1;
      if (seedB != null) return 1;
      const winDiff = (b.win_pct ?? -1) - (a.win_pct ?? -1);
      if (winDiff !== 0) return winDiff;
      return a.team_name.localeCompare(b.team_name);
    });
}

type PhaseGame = { season_type?: string | null };

/** Play-in only applies to teams on its slate: played one, or scheduled for one. */
export function showsPlayIn(playInGames: number, seasonGames: PhaseGame[]) {
  return playInGames > 0 || seasonGames.some((game) => game.season_type === "PlayIn");
}

/**
 * Playoffs mean nothing before April of the season's second year ("2026-27" ->
 * April 2027). From then on the KPI shows, "—" for a team that missed them.
 */
export function showsPlayoffs(
  season: string | null | undefined,
  playoffGames: number,
  seasonGames: PhaseGame[],
  now = new Date()
) {
  if (playoffGames > 0 || seasonGames.some((game) => game.season_type === "Playoffs")) return true;
  const startYear = Number.parseInt(season ?? "", 10);
  if (!Number.isFinite(startYear)) return false;
  // Month index 3 is April.
  return now >= new Date(startYear + 1, 3, 1);
}
