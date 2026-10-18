import { describe, expect, it } from "vitest";

import {
  dayNavigation,
  daySummary,
  formatDayShort,
  formatDayTitle,
  resultSides,
} from "@/lib/results";
import type { LeagueGame } from "@/lib/types";

const DATES = ["2026-06-13", "2026-06-10", "2026-06-08"].map((game_date) => ({
  game_date,
  season: "2025-26",
  game_count: 1,
}));

const GAME: LeagueGame = {
  game_id: "g",
  season: "2025-26",
  season_type: "Regular Season",
  game_date: "2026-03-01",
  home_team_id: "t-sas",
  away_team_id: "t-nyk",
  home_team_abbreviation: "SAS",
  away_team_abbreviation: "NYK",
  home_score: 110,
  away_score: 104,
};

describe("formatDayTitle", () => {
  it("adds the year only when it differs from the reference date", () => {
    expect(formatDayTitle("2026-06-13")).toBe("Saturday, June 13");
    expect(formatDayTitle("2026-06-13", "2026-06-13")).toBe("Saturday, June 13");
    expect(formatDayTitle("2025-12-25", "2026-06-13")).toBe("Thursday, December 25, 2025");
    expect(formatDayShort("2026-06-13")).toBe("Sat, Jun 13");
  });
});

describe("dayNavigation", () => {
  it("defaults to the newest day and finds its neighbours", () => {
    expect(dayNavigation(DATES, null)).toEqual({
      current: "2026-06-13",
      latest: "2026-06-13",
      older: "2026-06-10",
      newer: null,
    });
    expect(dayNavigation(DATES, "2026-06-10")).toMatchObject({
      older: "2026-06-08",
      newer: "2026-06-13",
    });
  });

  it("keeps a day off and steps to the game days around it", () => {
    expect(dayNavigation(DATES, "2026-06-09")).toMatchObject({
      current: "2026-06-09",
      older: "2026-06-08",
      newer: "2026-06-10",
    });
  });

  it("ignores a malformed date and handles no games at all", () => {
    expect(dayNavigation(DATES, "june").current).toBe("2026-06-13");
    // Shaped like a date but not one: never sent to the API.
    expect(dayNavigation(DATES, "2026-13-45").current).toBe("2026-06-13");
    expect(dayNavigation(DATES, "2026-02-30").current).toBe("2026-06-13");
    expect(dayNavigation([], null)).toEqual({
      current: null,
      latest: null,
      older: null,
      newer: null,
    });
  });
});

describe("daySummary", () => {
  it("counts a regular-season slate without a stage", () => {
    expect(daySummary([GAME, { ...GAME, game_id: "h" }])).toBe("2 games");
  });

  it("names a shared stage and a lone series game", () => {
    const finals = {
      ...GAME,
      season_type: "Playoffs",
      home_team_conference: "West",
      away_team_conference: "East",
      series_game_number: 5,
    };
    expect(daySummary([finals])).toBe("Finals · Game 5 · 1 game");
    const playoffs = { ...finals, away_team_conference: "West" };
    expect(daySummary([playoffs, { ...playoffs, game_id: "h" }])).toBe("Playoffs · 2 games");
    expect(daySummary([finals, GAME])).toBe("2 games");
    expect(daySummary([{ ...GAME, season_type: "Cup" }])).toBe("NBA Cup · 1 game");
  });
});

describe("resultSides", () => {
  it("puts the winner first with the margin in words", () => {
    const { winner, loser, margin } = resultSides(GAME);
    expect([winner.abbreviation, loser.abbreviation, margin]).toEqual(["SAS", "NYK", "SAS by 6"]);
    expect(resultSides({ ...GAME, home_score: 99 }).winner.abbreviation).toBe("NYK");
  });

  it("falls back to the winning team without scores", () => {
    const sides = resultSides({
      ...GAME,
      home_score: null,
      away_score: null,
      home_team_abbreviation: undefined,
      winning_team_id: "t-nyk",
    });
    expect(sides.winner.abbreviation).toBe("NYK");
    expect(sides.loser.abbreviation).toBe("Home");
    expect(sides.margin).toBeNull();
  });
});
