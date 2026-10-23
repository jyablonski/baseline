import { describe, expect, it } from "vitest";

import {
  contextLine,
  losingCard,
  recapHeadline,
  stageOf,
  starCard,
  turningPointCard,
  type Meeting,
} from "@/lib/game-story";
import type { BoxScoreRow, GameDetail, GameFlow } from "@/lib/types";

const GAME = {
  game_id: "g5",
  season: "2025-26",
  season_type: "Playoffs",
  game_date: "2026-06-13",
  status: "Final",
  home_team_id: "t-sas",
  away_team_id: "t-nyk",
  home_team_abbreviation: "SAS",
  away_team_abbreviation: "NYK",
  home_team_nickname: "Spurs",
  away_team_nickname: "Knicks",
  home_team_conference: "West",
  away_team_conference: "East",
  home_score: 90,
  away_score: 94,
  home_wins: 13,
  home_losses: 9,
  away_wins: 15,
  away_losses: 3,
} as GameDetail;

const meet = (
  id: string,
  date: string,
  away: number,
  home: number,
  type = "Playoffs"
): Meeting => ({
  game_id: id,
  game_date: date,
  season_type: type,
  home_team_abbreviation: "SAS",
  away_team_abbreviation: "NYK",
  home_score: home,
  away_score: away,
});

describe("stageOf", () => {
  it("calls a playoff series across conferences the Finals", () => {
    expect(stageOf("Playoffs", GAME)).toBe("NBA Finals");
    expect(stageOf("Playoffs", { ...GAME, home_team_conference: "East" })).toBe("Playoffs");
    expect(stageOf("PlayIn", GAME)).toBe("Play-In");
    expect(stageOf("Cup", GAME)).toBe("NBA Cup");
    expect(stageOf("Regular Season", GAME)).toBe("Regular Season");
  });
});

describe("recapHeadline", () => {
  const series = [
    meet("g1", "2026-06-03", 105, 95),
    meet("g2", "2026-06-05", 105, 104),
    meet("g3", "2026-06-08", 111, 115),
    meet("g4", "2026-06-10", 107, 106),
    meet("g5", "2026-06-13", 94, 90),
    // A later game never counts toward an earlier one's headline.
    meet("g6", "2026-06-16", 80, 120),
  ];

  it("names the clincher", () => {
    expect(recapHeadline(GAME, series)).toBe("Knicks win the NBA Finals, 4–1.");
    expect(contextLine(GAME, series)).toBe("NBA Finals, Game 5");
  });

  it("tells a series lead, a tie, and a team pulling within", () => {
    const g2 = {
      ...GAME,
      game_id: "g2",
      game_date: "2026-06-05",
      away_score: 105,
      home_score: 104,
    };
    expect(recapHeadline(g2, series)).toBe("Knicks take a 2–0 series lead.");
    const g3 = {
      ...GAME,
      game_id: "g3",
      game_date: "2026-06-08",
      away_score: 111,
      home_score: 115,
    };
    expect(recapHeadline(g3, series)).toBe("Spurs pull within 2–1.");
    const even = [meet("g1", "2026-06-03", 90, 100), meet("g2", "2026-06-05", 100, 90)];
    const g2even = {
      ...GAME,
      game_id: "g2",
      game_date: "2026-06-05",
      away_score: 100,
      home_score: 90,
    };
    expect(recapHeadline(g2even, even)).toBe("Knicks even the series at 1–1.");
  });

  it("is the plain result for a Cup or Play-In game, and nothing in the regular season", () => {
    expect(recapHeadline({ ...GAME, season_type: "Cup" }, [])).toBe(
      "Knicks beat the Spurs, 94–90."
    );
    expect(recapHeadline({ ...GAME, season_type: "PlayIn" }, [])).toBe(
      "Knicks beat the Spurs, 94–90."
    );
    // The scoreboard already says it.
    const regular = { ...GAME, season_type: "Regular Season" };
    expect(recapHeadline(regular, [])).toBeNull();
    expect(contextLine(regular, [])).toBeNull();
  });
});

describe("turningPointCard", () => {
  const flow = {
    winning_team_abbreviation: "NYK",
    largest_lead_blown: 16,
    comeback_team_abbreviation: "NYK",
    blown_lead_period: 2,
    winner_margin_entering_fourth: -7,
    is_wire_to_wire: false,
    game_elapsed_seconds: 2880,
    max_lead: 16,
  } as GameFlow;
  const run = {
    biggest_run_team_abbreviation: "NYK",
    biggest_run_winner_points: 19,
    biggest_run_opponent_points: 5,
    biggest_run_start_seconds: 2400,
    biggest_run_end_seconds: 2880,
    biggest_run_start_index: 40,
    biggest_run_end_index: 52,
    biggest_run_label: "NYK 19-5",
  };

  it("leads with the run and the deficits it came back from, latest first", () => {
    expect(turningPointCard(flow, run)).toEqual({
      label: "Turning point",
      figure: "19–5",
      name: "NYK run",
      caption: "Closed the game after trailing by 7 entering Q4 and by 16 in Q2",
    });
    expect(turningPointCard(flow, { ...run, biggest_run_end_seconds: 2000 })?.caption).toBe(
      "Came back after trailing by 7 entering Q4 and by 16 in Q2"
    );
    // The deficit peaked in Q4, after the margin entering it: only the peak.
    const lateFlow = {
      ...flow,
      largest_lead_blown: 22,
      blown_lead_period: 4,
      winner_margin_entering_fourth: -14,
    };
    expect(turningPointCard(lateFlow, { ...run, biggest_run_end_seconds: 2000 })?.caption).toBe(
      "Came back after trailing by 22 in Q4"
    );
    expect(
      turningPointCard(
        { ...lateFlow, blown_lead_period: 5 },
        { ...run, biggest_run_end_seconds: 2000 }
      )?.caption
    ).toBe("Came back after trailing by 22 in overtime");
  });

  it("falls back to a wire-to-wire lead or the comeback alone, and to nothing", () => {
    const loserRun = { ...run, biggest_run_team_abbreviation: "SAS" };
    expect(turningPointCard({ ...flow, is_wire_to_wire: true }, loserRun)).toMatchObject({
      figure: "+16",
      name: "NYK max lead",
      caption: "Never trailed",
    });
    expect(turningPointCard(flow, loserRun)).toMatchObject({
      figure: "16",
      name: "point comeback",
      caption: "NYK won after trailing by 7 entering Q4 and by 16 in Q2",
    });
    expect(turningPointCard({ ...flow, largest_lead_blown: 3 }, loserRun)).toBeNull();
    expect(turningPointCard({ ...flow, largest_lead_blown: 3 }, run)?.caption).toBe(
      "Closed the game"
    );
  });
});

describe("star and losing cards", () => {
  const rows = [
    {
      player_name: "Dylan Harper",
      team_id: "t-sas",
      points: 25,
      rebounds: 5,
      assists: 4,
      field_goals_made: 10,
      field_goals_attempted: 19,
    },
    { player_name: "Victor Wembanyama", team_id: "t-sas", points: 19 },
    {
      player_name: "Jalen Brunson",
      team_id: "t-nyk",
      points: 45,
      rebounds: 3,
      assists: 3,
      field_goals_made: 16,
      field_goals_attempted: 29,
      mvp_game_score: 39.8,
    },
    { player_name: "OG Anunoby", team_id: "t-nyk", points: 12, mvp_game_score: 9.1 },
  ] as BoxScoreRow[];

  it("stars the winner's best game score", () => {
    expect(starCard(rows, GAME)).toEqual({
      label: "Star",
      figure: "45",
      name: "Jalen Brunson",
      caption: "3 reb, 3 ast · 16-29 FG · game score 39.8",
    });
  });

  it("names the losing side's top scorer under the team's name", () => {
    expect(losingCard(rows, GAME, "Spurs")).toEqual({
      label: "Spurs",
      figure: "25",
      name: "Dylan Harper",
      caption: "5 reb, 4 ast · 10-19 FG",
    });
    expect(losingCard([], GAME, "Spurs")).toBeNull();
  });
});
