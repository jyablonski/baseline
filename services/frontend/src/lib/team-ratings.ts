import type { TeamSummary } from "@/lib/types";

export type TeamRatingPoint = {
  team_id: string;
  abbreviation: string;
  team_name: string;
  pts_scored_avg: number;
  pts_allowed_avg: number;
  wins?: number | null;
  losses?: number | null;
};

/** League ranks, 1 the best: most scored, fewest allowed, biggest net. */
export type RatingRanks = { offense: number; defense: number; net: number };

export function teamRatingPoints(teams: TeamSummary[]): TeamRatingPoint[] {
  return teams.flatMap((team) => {
    const scored = team.pts_scored_avg;
    const allowed = team.pts_allowed_avg;
    if (
      scored == null ||
      allowed == null ||
      !Number.isFinite(scored) ||
      !Number.isFinite(allowed)
    ) {
      return [];
    }
    return [
      {
        team_id: team.team_id,
        abbreviation: team.abbreviation,
        team_name: team.team_name,
        pts_scored_avg: scored,
        pts_allowed_avg: allowed,
        wins: team.wins,
        losses: team.losses,
      },
    ];
  });
}

export function leagueRatingAverages(points: TeamRatingPoint[]) {
  const n = points.length;
  if (n === 0) return null;
  return {
    pts_scored_avg: points.reduce((sum, point) => sum + point.pts_scored_avg, 0) / n,
    pts_allowed_avg: points.reduce((sum, point) => sum + point.pts_allowed_avg, 0) / n,
  };
}

export function paddedDomain(values: number[], pad = 2): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 4);
  const extra = Math.max(pad, span * 0.12);
  return [min - extra, max + extra];
}

/** Points scored less points allowed, per game. */
export function netRating(point: TeamRatingPoint) {
  return point.pts_scored_avg - point.pts_allowed_avg;
}

/** Competition ranking ("1, 2, 2, 4"), so teams level on a number share a rank. */
function rankBy(points: TeamRatingPoint[], value: (point: TeamRatingPoint) => number) {
  return new Map(
    points.map((point) => [
      point.team_id,
      1 + points.filter((other) => value(other) > value(point)).length,
    ])
  );
}

export function ratingRanks(points: TeamRatingPoint[]): Map<string, RatingRanks> {
  const offense = rankBy(points, (point) => point.pts_scored_avg);
  const defense = rankBy(points, (point) => -point.pts_allowed_avg);
  const net = rankBy(points, netRating);
  return new Map(
    points.map((point) => [
      point.team_id,
      {
        offense: offense.get(point.team_id) ?? 0,
        defense: defense.get(point.team_id) ?? 0,
        net: net.get(point.team_id) ?? 0,
      },
    ])
  );
}

/**
 * The dashed equal-net diagonals, allowed = scored − net, clipped to the plot's
 * domains. A net that never crosses the plot is left out.
 */
export function netLines(
  xDomain: [number, number],
  yDomain: [number, number],
  nets: readonly number[] = NET_LINES
) {
  const [x0, x1] = xDomain;
  const [y0, y1] = yDomain;
  return nets.flatMap((net) => {
    const start = Math.max(x0, y0 + net);
    const end = Math.min(x1, y1 + net);
    if (end <= start) return [];
    return [{ net, from: { x: start, y: start - net }, to: { x: end, y: end - net } }];
  });
}

/** Ten either way marks a clearly good or bad team without crowding the plot. */
export const NET_LINES = [-10, 10] as const;
