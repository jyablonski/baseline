import { describe, expect, it } from "vitest";

import {
  leagueRatingAverages,
  netLines,
  paddedDomain,
  ratingRanks,
  teamRatingPoints,
} from "@/lib/team-ratings";
import type { TeamSummary } from "@/lib/types";

const TEAM_A = "00000000-0000-4000-8000-000000000201";
const TEAM_B = "00000000-0000-4000-8000-000000000202";
const TEAM_C = "00000000-0000-4000-8000-000000000203";

function team(partial: Partial<TeamSummary> & Pick<TeamSummary, "team_id">): TeamSummary {
  return {
    abbreviation: "BOS",
    team_name: "Boston Celtics",
    conference: "East",
    division: "Atlantic",
    ...partial,
  };
}

describe("team ratings", () => {
  it("keeps only teams with finite Regular Season scoring averages", () => {
    expect(
      teamRatingPoints([
        team({ team_id: TEAM_A, pts_scored_avg: 116.4, pts_allowed_avg: 109.2 }),
        team({ team_id: TEAM_B, abbreviation: "NYK", pts_scored_avg: null, pts_allowed_avg: 110 }),
        team({
          team_id: TEAM_C,
          abbreviation: "BKN",
          pts_scored_avg: Number.NaN,
          pts_allowed_avg: 112,
        }),
      ])
    ).toEqual([
      {
        team_id: TEAM_A,
        abbreviation: "BOS",
        team_name: "Boston Celtics",
        pts_scored_avg: 116.4,
        pts_allowed_avg: 109.2,
      },
    ]);
  });

  it("averages plotted teams for the quadrant lines", () => {
    expect(
      leagueRatingAverages([
        {
          team_id: TEAM_A,
          abbreviation: "BOS",
          team_name: "Boston Celtics",
          pts_scored_avg: 110,
          pts_allowed_avg: 100,
        },
        {
          team_id: TEAM_B,
          abbreviation: "NYK",
          team_name: "New York Knicks",
          pts_scored_avg: 120,
          pts_allowed_avg: 110,
        },
      ])
    ).toEqual({ pts_scored_avg: 115, pts_allowed_avg: 105 });
    expect(leagueRatingAverages([])).toBeNull();
  });

  it("pads the axis domain so logos are not clipped", () => {
    const [min, max] = paddedDomain([110, 118]);
    expect(min).toBeLessThan(110);
    expect(max).toBeGreaterThan(118);
  });
});

describe("rating ranks and net lines", () => {
  const point = (team_id: string, scored: number, allowed: number) => ({
    team_id,
    abbreviation: team_id,
    team_name: team_id,
    pts_scored_avg: scored,
    pts_allowed_avg: allowed,
  });

  it("ranks most scored, fewest allowed, and biggest net first, sharing ties", () => {
    const ranks = ratingRanks([point("A", 120, 110), point("B", 110, 105), point("C", 110, 115)]);
    expect(ranks.get("A")).toEqual({ offense: 1, defense: 2, net: 1 });
    expect(ranks.get("B")).toEqual({ offense: 2, defense: 1, net: 2 });
    expect(ranks.get("C")).toEqual({ offense: 2, defense: 3, net: 3 });
  });

  it("draws net −10 and +10, clipped to the plot", () => {
    const lines = netLines([105, 125], [105, 125]);
    expect(lines.map((line) => line.net)).toEqual([-10, 10]);
    // Net +10 runs from (115, 105) to (125, 115): allowed = scored − 10.
    expect(lines.find((line) => line.net === 10)).toEqual({
      net: 10,
      from: { x: 115, y: 105 },
      to: { x: 125, y: 115 },
    });
    // A line that only touches a corner is left out.
    expect(netLines([105, 125], [105, 125], [20])).toEqual([]);
  });
});
