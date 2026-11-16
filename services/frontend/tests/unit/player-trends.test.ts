import { describe, expect, it } from "vitest";

import {
  biggestMover,
  changeTone,
  changedCount,
  formatTrendChange,
  formatTrendValue,
  headlineStats,
  risersAndFallers,
} from "@/lib/player-trends";
import type { PlayerTrendStat } from "@/lib/types";

import { trendFixture, withStats } from "./player-trend-fixture";

const stat = (overrides: Partial<PlayerTrendStat>): PlayerTrendStat => ({
  stat: "points",
  last_10: null,
  baseline: 20,
  season: null,
  change: 0,
  z: null,
  changed: false,
  games: [],
  ...overrides,
});

describe("changeTone", () => {
  it("judges only a change that beats the usual swings", () => {
    expect(changeTone(stat({ change: 8, z: 1.4, changed: false }))).toBe("neutral");
    expect(changeTone(stat({ change: 8, z: 2.4, changed: true }))).toBe("better");
    expect(changeTone(stat({ change: -8, z: -2.4, changed: true }))).toBe("worse");
  });

  it("reads fewer turnovers as better", () => {
    expect(changeTone(stat({ stat: "turnovers", change: -1, changed: true }))).toBe("better");
    expect(changeTone(stat({ stat: "turnovers", change: 1, changed: true }))).toBe("worse");
  });

  it("never judges minutes, or a missing change", () => {
    expect(changeTone(stat({ stat: "minutes", change: 12, changed: true }))).toBe("neutral");
    expect(changeTone(stat({ change: null, changed: true }))).toBe("neutral");
  });
});

describe("formatting", () => {
  it("shows TS% as a percent and its change in points", () => {
    expect(formatTrendValue("true_shooting_pct", 0.641)).toBe("64.1%");
    expect(formatTrendChange("true_shooting_pct", 0.049)).toBe("+4.9");
    expect(formatTrendValue("plus_minus", 6.3)).toBe("+6.3");
    expect(formatTrendValue("points", 31.2)).toBe("31.2");
    expect(formatTrendChange("turnovers", -1)).toBe("-1.0");
    expect(formatTrendValue("points", null)).toBe("—");
    expect(formatTrendChange("points", null)).toBe("—");
  });
});

describe("headlineStats", () => {
  it("leads with MVP game score, then the box stats that moved most", () => {
    // Points (z 2.5) and turnovers (-2.2) changed; minutes changed but is no box stat.
    expect(headlineStats(trendFixture()).map((entry) => entry.stat)).toEqual([
      "mvp_game_score",
      "points",
      "turnovers",
      "rebounds",
    ]);
  });

  it("fills with points, rebounds and assists when nothing moved", () => {
    const quiet = withStats(trendFixture(), {
      points: { changed: false },
      turnovers: { changed: false },
    });
    expect(headlineStats(quiet).map((entry) => entry.stat)).toEqual([
      "mvp_game_score",
      "points",
      "rebounds",
      "assists",
    ]);
  });
});

describe("biggestMover", () => {
  it("picks the changed box stat furthest past its swings", () => {
    expect(biggestMover(trendFixture())?.stat).toBe("points");
    const turnovers = withStats(trendFixture(), { turnovers: { z: -3.6 } });
    expect(biggestMover(turnovers)?.stat).toBe("turnovers");
  });

  it("is null when no box stat changed", () => {
    const quiet = withStats(trendFixture(), {
      points: { changed: false },
      turnovers: { changed: false },
    });
    expect(biggestMover(quiet)).toBeNull();
  });
});

describe("changedCount", () => {
  it("counts every stat flagged as changed", () => {
    expect(changedCount(trendFixture())).toBe(5);
  });
});

describe("risersAndFallers", () => {
  it("keeps the biggest moves each way and leaves steady players out", () => {
    const mvp = (id: string, direction: "up" | "down" | "steady", change: number) =>
      withStats(trendFixture({ player_id: id, trend_direction: direction }), {
        mvp_game_score: { change },
      });
    const { risers, fallers } = risersAndFallers(
      [
        mvp("a", "up", 3.1),
        mvp("b", "up", 9),
        mvp("c", "steady", 1),
        mvp("d", "down", -3.5),
        mvp("e", "down", -8),
        mvp("f", "up", 4),
        mvp("g", "up", 6),
      ],
      3
    );
    expect(risers.map((trend) => trend.player_id)).toEqual(["b", "g", "f"]);
    expect(fallers.map((trend) => trend.player_id)).toEqual(["e", "d"]);
  });
});
