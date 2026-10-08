import { describe, expect, it } from "vitest";

import {
  axisTicks,
  foldName,
  isPicked,
  minGamesFor,
  playerValuePoints,
  plotLabel,
  VALUE_CATEGORIES,
} from "@/lib/player-value";
import type { PlayerValue } from "@/lib/types";

function row(
  rank: number,
  score: number,
  salary: number,
  overrides: Partial<PlayerValue> = {}
): PlayerValue {
  return {
    player_id: `p${rank}`,
    full_name: `Player ${rank}`,
    team_abbreviation: "GSW",
    mvp_season: "2025-26",
    mvp_score: score,
    mvp_rank: rank,
    games_played: 60,
    salary,
    salary_season: "2026-27",
    ...overrides,
  };
}

// 13 players. Ranks 1-3 are candidates whatever they earn. Below them p11
// produces far more than he is paid, p20 far less, and p12-p19 are paid in step
// with what they produce.
const LEAGUE = [
  row(1, 40, 52_000_000),
  row(2, 39, 51_000_000),
  row(3, 38, 50_000_000),
  row(11, 30, 2_000_000),
  ...Array.from({ length: 8 }, (_, index) =>
    row(12 + index, 28 - index * 2, 30_000_000 - index * 3_000_000)
  ),
  row(20, 5, 49_000_000),
];

describe("playerValuePoints", () => {
  it("sorts players into candidates, bargains, overpays, and the rest", () => {
    const byId = new Map(playerValuePoints(LEAGUE).map((point) => [point.player_id, point]));

    expect(byId.get("p1")?.category).toBe("mvp");
    // The lowest-paid candidate is still a candidate, not a bargain.
    expect(byId.get("p3")?.category).toBe("mvp");
    expect(byId.get("p11")?.category).toBe("undervalued");
    expect(byId.get("p20")?.category).toBe("overpaid");
    expect(byId.get("p12")?.category).toBe("fair");
    expect(byId.get("p19")?.category).toBe("fair");
  });

  it("measures the gap between production and pay in percentile points", () => {
    const byId = new Map(playerValuePoints(LEAGUE).map((point) => [point.player_id, point]));
    const bargain = byId.get("p11");
    // Outscores p12-p20 (9 of the 12 others) and out-earns nobody.
    expect(bargain?.score_percentile).toBeCloseTo(9 / 12);
    expect(bargain?.salary_percentile).toBe(0);
    expect(bargain?.value_gap).toBeCloseTo(0.75);
    expect(bargain?.salary_millions).toBe(2);

    const overpaid = byId.get("p20");
    expect(overpaid?.score_percentile).toBe(0);
    expect(overpaid?.value_gap).toBeCloseTo(-0.75);
    // Paid exactly in step: no gap at all.
    expect(byId.get("p12")?.value_gap).toBeCloseTo(0);
  });

  it("gives tied players the same percentile", () => {
    const points = playerValuePoints([row(11, 10, 5), row(12, 10, 5), row(13, 20, 9)]);
    expect(points[0].score_percentile).toBe(points[1].score_percentile);
    expect(points[0].value_gap).toBe(0);
  });

  it("leaves out players without enough games, and unusable numbers", () => {
    const points = playerValuePoints([
      ...LEAGUE,
      row(25, 45, 1_000_000, { games_played: 3 }),
      row(26, Number.NaN, 1_000_000),
    ]);
    expect(points).toHaveLength(LEAGUE.length);
    expect(points.some((point) => point.player_id === "p25")).toBe(false);
  });

  it("handles one player and none", () => {
    expect(playerValuePoints([])).toEqual([]);
    const [only] = playerValuePoints([row(40, 10, 5_000_000)]);
    expect(only.value_gap).toBe(0);
    expect(only.category).toBe("fair");
  });
});

describe("minGamesFor", () => {
  it("is 20 once the season is under way and half the leader's games before that", () => {
    expect(minGamesFor(LEAGUE)).toBe(20);
    expect(minGamesFor([row(1, 30, 5, { games_played: 7 })])).toBe(4);
    expect(minGamesFor([])).toBe(0);
  });
});

describe("isPicked", () => {
  it("matches a chosen player or anyone on a chosen team", () => {
    const [point] = playerValuePoints([row(40, 10, 5)]);
    expect(isPicked(point, new Set(["GSW"]), new Set())).toBe(true);
    expect(isPicked(point, new Set(["LAL"]), new Set(["p40"]))).toBe(true);
    expect(isPicked(point, new Set(["LAL"]), new Set())).toBe(false);
    expect(isPicked({ ...point, team_abbreviation: null }, new Set(["GSW"]), new Set())).toBe(
      false
    );
  });
});

describe("plotLabel", () => {
  it("shortens a name to what fits beside a dot", () => {
    expect(plotLabel("Shai Gilgeous-Alexander")).toBe("Gilgeous-Alexander");
    expect(plotLabel("Jaren Jackson Jr.")).toBe("Jackson Jr.");
    expect(plotLabel("Gary Trent Jr")).toBe("Trent Jr");
    expect(plotLabel("Nenê")).toBe("Nenê");
    expect(plotLabel("  Stephen Curry ")).toBe("Curry");
  });
});

describe("VALUE_CATEGORIES", () => {
  it("names every group once", () => {
    expect(VALUE_CATEGORIES.map((category) => category.key)).toEqual([
      "mvp",
      "undervalued",
      "overpaid",
      "fair",
    ]);
  });
});

describe("axisTicks", () => {
  it("covers the data with round, evenly spaced ticks", () => {
    expect(axisTicks(0, 31.5, 5)).toEqual([0, 5, 10, 15, 20, 25, 30, 35]);
    expect(axisTicks(0, 62.6, 10)).toEqual([0, 10, 20, 30, 40, 50, 60, 70]);
    // A value exactly on a tick does not add an empty band above it.
    expect(axisTicks(0, 30, 5).at(-1)).toBe(30);
    // Negative scores extend the axis down instead of being clipped.
    expect(axisTicks(-2.4, 12, 5)).toEqual([-5, 0, 5, 10, 15]);
    // One flat value still gets an axis with some height.
    expect(axisTicks(0, 0, 10)).toEqual([0, 10]);
  });
});

describe("foldName", () => {
  it("matches a name typed without its accents or capitals", () => {
    expect(foldName("Nikola Jokić")).toBe("nikola jokic");
    expect(foldName("  LUKA dončić ")).toBe("luka doncic");
    expect(foldName("Stephen Curry")).toBe("stephen curry");
  });
});
