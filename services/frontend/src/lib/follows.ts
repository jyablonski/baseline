type TwoSided = {
  home_team_id?: string | null;
  away_team_id?: string | null;
};

/** Whether a followed team plays in this game. */
export function involvesFollowed(game: TwoSided, teamIds: ReadonlySet<string>) {
  return (
    (game.home_team_id != null && teamIds.has(game.home_team_id)) ||
    (game.away_team_id != null && teamIds.has(game.away_team_id))
  );
}

/**
 * The first `limit` games, except that every followed team's game makes the
 * cut, displacing the last of the others. The order is kept, so a short list
 * still reads by tip time or by how the slate was ranked.
 */
export function keepFollowed<T extends TwoSided>(
  games: T[],
  teamIds: ReadonlySet<string>,
  limit: number
): T[] {
  if (teamIds.size === 0) return games.slice(0, limit);
  const followed = games.filter((game) => involvesFollowed(game, teamIds)).slice(0, limit);
  const room = limit - followed.length;
  const others = games.filter((game) => !involvesFollowed(game, teamIds)).slice(0, room);
  const kept = new Set<T>([...followed, ...others]);
  return games.filter((game) => kept.has(game));
}

type NamedTeam = {
  team_id: string;
  abbreviation: string;
  team_name: string;
  city?: string | null;
};

/**
 * Teams matching a search by abbreviation, city or name, leaving out those
 * already followed. An abbreviation match ranks first, so "por" finds
 * Portland before anything that merely contains the letters.
 */
export function searchTeams<T extends NamedTeam>(
  teams: T[],
  query: string,
  followed: ReadonlySet<string>,
  limit = 6
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const open = teams.filter((team) => !followed.has(team.team_id));
  const byAbbreviation = open.filter((team) => team.abbreviation.toLowerCase().startsWith(needle));
  const byName = open.filter(
    (team) =>
      !byAbbreviation.includes(team) &&
      [team.team_name, team.city ?? ""].some((text) => text.toLowerCase().includes(needle))
  );
  return [...byAbbreviation, ...byName].slice(0, limit);
}

/** The order with the item at `index` moved one place up (-1) or down (+1). */
export function moveOne<T>(items: T[], index: number, step: -1 | 1): T[] {
  const target = index + step;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
