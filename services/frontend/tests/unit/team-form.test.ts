import { describe, expect, it } from "vitest";

import {
  lastTenFromGames,
  showsPlayIn,
  showsPlayoffs,
  standingsSeed,
  streakFromGames,
} from "@/lib/team-form";

describe("team form from Regular Season finals", () => {
  it("computes last 10 and streak from newest-first results", () => {
    const games = [
      { is_win: true },
      { result: "W" },
      { is_win: false },
      { result: "L" },
      { is_win: true },
      { is_win: true },
      { is_win: false },
      { is_win: true },
      { is_win: true },
      { is_win: false },
      { is_win: false },
    ];
    expect(lastTenFromGames(games)).toBe("6–4");
    expect(streakFromGames(games)).toBe("W2");
    expect(lastTenFromGames([])).toBeNull();
    expect(streakFromGames([])).toBeNull();
    expect(streakFromGames([{ result: "L" }, { result: "L" }, { is_win: true }])).toBe("L2");
    expect(lastTenFromGames([{ result: "P" }])).toBeNull();
  });
});

describe("standingsSeed", () => {
  it("prefers the settled play-in seed over record rank", () => {
    // POR finished 8th on record but won the 7/8 game.
    expect(standingsSeed({ playoff_seed: 7, conference_rank: 8 })).toBe(7);
    expect(standingsSeed({ playoff_seed: 10, conference_rank: 9 })).toBe(10);
  });

  it("falls back to record rank before the play-in is decided", () => {
    expect(standingsSeed({ playoff_seed: null, conference_rank: 8 })).toBe(8);
    expect(standingsSeed({ conference_rank: 3 })).toBe(3);
    expect(standingsSeed({ playoff_seed: null, conference_rank: null })).toBeNull();
  });
});

describe("showsPlayIn", () => {
  it("shows for a team that played or is scheduled for the play-in", () => {
    expect(showsPlayIn(1, [])).toBe(true);
    expect(showsPlayIn(0, [{ season_type: "Regular Season" }, { season_type: "PlayIn" }])).toBe(
      true
    );
  });

  it("hides for everyone else", () => {
    expect(showsPlayIn(0, [{ season_type: "Regular Season" }, { season_type: "Playoffs" }])).toBe(
      false
    );
    expect(showsPlayIn(0, [])).toBe(false);
  });
});

describe("showsPlayoffs", () => {
  const october = new Date(2026, 9, 17);

  it("hides before April of the season's second year", () => {
    expect(showsPlayoffs("2026-27", 0, [], october)).toBe(false);
    expect(showsPlayoffs("2026-27", 0, [], new Date(2027, 2, 31))).toBe(false);
  });

  it("shows from April on, and for past seasons", () => {
    expect(showsPlayoffs("2026-27", 0, [], new Date(2027, 3, 1))).toBe(true);
    expect(showsPlayoffs("2025-26", 0, [], october)).toBe(true);
  });

  it("shows early once there are playoff games, and hides without a season", () => {
    expect(showsPlayoffs("2026-27", 2, [], october)).toBe(true);
    expect(showsPlayoffs("2026-27", 0, [{ season_type: "Playoffs" }], october)).toBe(true);
    expect(showsPlayoffs(null, 0, [], october)).toBe(false);
  });
});
