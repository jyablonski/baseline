import { describe, expect, it } from "vitest";

import { dayNavigation } from "@/lib/calendar";
import {
  daySummary,
  formatDayShort,
  formatDayTitle,
  gameOdds,
  isUpsetWin,
  rankSlate,
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
      home: "2026-06-13",
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

  it("starts from the soonest day for the schedule, in whatever order the dates come", () => {
    const upcoming = ["2026-10-24", "2026-10-22", "2026-10-27", "2026-10-22"].map((game_date) => ({
      game_date,
    }));
    expect(dayNavigation(upcoming, null, "oldest")).toEqual({
      current: "2026-10-22",
      home: "2026-10-22",
      older: null,
      newer: "2026-10-24",
    });
    expect(dayNavigation(upcoming, "2026-10-24", "oldest")).toMatchObject({
      home: "2026-10-22",
      older: "2026-10-22",
      newer: "2026-10-27",
    });
    // Timestamps are cut to their day.
    expect(dayNavigation([{ game_date: "2026-10-22T00:00:00" }], null, "oldest").current).toBe(
      "2026-10-22"
    );
  });

  it("ignores a malformed date and handles no games at all", () => {
    expect(dayNavigation(DATES, "june").current).toBe("2026-06-13");
    // Shaped like a date but not one: never sent to the API.
    expect(dayNavigation(DATES, "2026-13-45").current).toBe("2026-06-13");
    expect(dayNavigation(DATES, "2026-02-30").current).toBe("2026-06-13");
    expect(dayNavigation([], null)).toEqual({
      current: null,
      home: null,
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
  it("puts the winner first", () => {
    const { winner, loser } = resultSides(GAME);
    expect([winner.abbreviation, loser.abbreviation]).toEqual(["SAS", "NYK"]);
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
  });
});

describe("game odds", () => {
  const game = (id: string, home: number, away: number): LeagueGame => ({
    game_id: id,
    season: "2025-26",
    game_date: "2026-10-20",
    home_team_id: `${id}-home`,
    away_team_id: `${id}-away`,
    home_team_abbreviation: `H${id}`,
    away_team_abbreviation: `A${id}`,
    home_score: home,
    away_score: away,
  });

  it("reads a missing or even line as no market favourite", () => {
    const odds = gameOdds(game("1", 100, 90));
    expect(odds.market).toBeNull();
    expect(odds.winnerMarketWp).toBeNull();
    expect(odds.isUpset).toBe(false);
    expect(gameOdds({ ...game("1", 100, 90), winner_market_wp: 0.5 }).market).toBeNull();
  });

  it("flags an away underdog's win as an upset, with the market's favourite", () => {
    const odds = gameOdds({ ...game("1", 100, 106), winner_market_wp: 0.39 });
    expect(odds.winner.abbreviation).toBe("A1");
    expect(odds.winnerMarketWp).toBeCloseTo(0.39);
    expect(odds.isUpset).toBe(true);
    expect(odds.market?.abbreviation).toBe("H1");
    expect(odds.market?.wp).toBeCloseTo(0.61);
  });

  it("needs a steep underdog for an upset and a 10-point deficit for a comeback", () => {
    const close = gameOdds({
      ...game("1", 100, 106),
      largest_lead_blown: 10,
      winner_market_wp: 0.46,
    });
    expect(close.isUpset).toBe(false);
    expect(close.isComeback).toBe(true);
    expect(gameOdds({ ...game("1", 100, 90), largest_lead_blown: 9 }).isComeback).toBe(false);
    expect(isUpsetWin(0.4)).toBe(true);
    expect(isUpsetWin(0.41)).toBe(false);
    expect(isUpsetWin(null)).toBe(false);
  });
});

describe("rank slate", () => {
  const game = (id: string, overrides: Partial<LeagueGame> = {}): LeagueGame => ({
    game_id: id,
    season: "2025-26",
    game_date: "2026-10-21",
    home_team_id: `${id}-home`,
    away_team_id: `${id}-away`,
    home_score: 110,
    away_score: 100,
    ...overrides,
  });

  it("puts upsets first, then comebacks, then the closest finishes", () => {
    const ranked = rankSlate([
      game("blowout", { home_score: 130, away_score: 95 }),
      game("close", { home_score: 101, away_score: 100 }),
      game("small-comeback", { largest_lead_blown: 11 }),
      game("long-shot", { winner_market_wp: 0.2 }),
      game("big-comeback", { largest_lead_blown: 25 }),
      game("upset", { winner_market_wp: 0.35, largest_lead_blown: 30 }),
      game("no-score", { home_score: null, away_score: null }),
    ]);
    expect(ranked.map((item) => item.game_id)).toEqual([
      "long-shot",
      "upset",
      "big-comeback",
      "small-comeback",
      "close",
      "blowout",
      "no-score",
    ]);
  });
});
