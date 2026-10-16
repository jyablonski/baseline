import { describe, expect, it } from "vitest";

import {
  formatBiggestRunCaption,
  formatFlowTooltipLabel,
  formatFlowTooltipPlay,
  formatFlowTooltipScore,
  formatGameClock,
  formatGameOption,
  formatMatchupTitle,
  parseIsoClockToSeconds,
  periodLabel,
  periodStartElapsed,
  quarterAxisTicks,
  selectBiggestRun,
} from "@/lib/game-flow";
import type { ScoringPlay } from "@/lib/game-flow";

const TEAM_HOME = "00000000-0000-4000-8000-000000000201";
const TEAM_AWAY = "00000000-0000-4000-8000-000000000202";

describe("parseIsoClockToSeconds", () => {
  it("parses V3 clocks", () => {
    expect(parseIsoClockToSeconds("PT11M32.00S")).toBe(692);
    expect(parseIsoClockToSeconds("PT32.00S")).toBe(32);
    expect(parseIsoClockToSeconds("PT11M")).toBe(660);
    expect(parseIsoClockToSeconds("PT1H1M1S")).toBe(3661);
  });

  it("parses mm:ss and rejects junk", () => {
    expect(parseIsoClockToSeconds("11:32")).toBe(692);
    expect(parseIsoClockToSeconds("")).toBeNull();
    expect(parseIsoClockToSeconds("nope")).toBeNull();
  });
});

describe("period helpers", () => {
  it("maps regulation and OT starts", () => {
    expect(periodStartElapsed(1)).toBe(0);
    expect(periodStartElapsed(4)).toBe(2160);
    expect(periodStartElapsed(5)).toBe(2880);
    expect(periodStartElapsed(6)).toBe(3180);
    expect(periodLabel(1)).toBe("Q1");
    expect(periodLabel(5)).toBe("OT1");
  });

  it("builds quarter ticks through OT", () => {
    expect(quarterAxisTicks(4).map((tick) => tick.label)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(quarterAxisTicks(5).at(-1)).toEqual({ seconds: 2880, label: "OT1" });
  });
});

describe("biggest-run and matchup display", () => {
  it("formats a winner run caption", () => {
    expect(
      formatBiggestRunCaption({
        biggest_run_team_abbreviation: "NYK",
        biggest_run_winner_points: 16,
        biggest_run_opponent_points: 2,
      })
    ).toBe("Biggest run: NYK 16-2");
    expect(formatBiggestRunCaption({ biggest_run_label: "SAS 12-4" })).toBe(
      "Biggest run: SAS 12-4"
    );
    expect(formatBiggestRunCaption({ biggest_run_label: "Biggest run: NYK 16-2" })).toBe(
      "Biggest run: NYK 16-2"
    );
    expect(formatBiggestRunCaption({})).toBeNull();
  });

  it("marks the winner on the matchup title", () => {
    expect(
      formatMatchupTitle({
        away_team_name: "New York Knicks",
        home_team_name: "San Antonio Spurs",
        winner_location: "away",
      })
    ).toBe("New York Knicks (W) @ San Antonio Spurs");
    expect(
      formatMatchupTitle({
        away_team_abbreviation: "NYK",
        home_team_abbreviation: "SAS",
        winning_team_id: TEAM_HOME,
        home_team_id: TEAM_HOME,
        away_team_id: TEAM_AWAY,
      })
    ).toBe("NYK @ SAS (W)");
  });

  it("formats picker labels and axis ticks", () => {
    expect(formatGameOption({ game_id: "1" })).toBe("Away @ Home");
    expect(quarterAxisTicks(null)[0]).toEqual({ seconds: 0, label: "Q1" });
  });

  it("formats chart tooltip copy", () => {
    expect(
      formatFlowTooltipScore(9, {
        score_away: 44,
        score_home: 53,
        away_abbreviation: "NYK",
        home_abbreviation: "SAS",
      })
    ).toBe("NYK 44 – SAS 53 (+9)");
    expect(formatFlowTooltipScore(-2, { score_away: 12, score_home: 10 })).toBe(
      "Away 12 – Home 10 (-2)"
    );
    expect(formatFlowTooltipScore("n/a", { score_away: 1, score_home: 1 })).toBe(
      "Away 1 – Home 1 (n/a)"
    );
    expect(formatFlowTooltipLabel()).toBe("");
    expect(formatFlowTooltipLabel({ period: 3, clock: "PT08M36.00S" })).toBe("Q3 · 8:36");
    expect(
      formatFlowTooltipLabel({ period: 1, clock: "PT11M00.00S", clock_remaining_seconds: 660 })
    ).toBe("Q1 · 11:00");
    expect(formatFlowTooltipLabel({ period: null, clock: null })).toBe("");
    expect(
      formatFlowTooltipPlay({
        description: "Wembanyama 3' Driving Dunk (2 PTS)",
        player_name: "Victor Wembanyama",
        action_type: "2pt",
      })
    ).toBe("Wembanyama 3' Driving Dunk (2 PTS)");
    expect(
      formatFlowTooltipPlay({
        player_name: "J. Brunson",
        action_type: "2pt",
        sub_type: "Driving Layup",
      })
    ).toBe("J. Brunson 2-PT Driving Layup");
    expect(formatFlowTooltipPlay({ action_type: "Made Shot", sub_type: "3pt" })).toBe("3-PT");
    expect(formatFlowTooltipPlay({ description: "  1630167  " })).toBeNull();
    expect(formatFlowTooltipPlay({ description: "" })).toBeNull();
    expect(formatFlowTooltipPlay()).toBeNull();
  });

  it("formats remaining game clock from ISO durations", () => {
    expect(formatGameClock("PT08M36.00S")).toBe("8:36");
    expect(formatGameClock("PT32.00S")).toBe("0:32");
    expect(formatGameClock("PT11M")).toBe("11:00");
    expect(formatGameClock("11:32")).toBe("11:32");
    expect(formatGameClock("PT00M09.10S")).toBe("0:09.1");
    expect(formatGameClock(null, 516)).toBe("8:36");
    expect(formatGameClock("not-a-clock")).toBe("not-a-clock");
    expect(formatGameClock(null)).toBeNull();
  });

  it("falls back when names are missing and uses winning_team_id", () => {
    expect(
      formatMatchupTitle({
        away_team_id: TEAM_AWAY,
        home_team_id: TEAM_HOME,
        winning_team_id: TEAM_AWAY,
      })
    ).toBe("Away (W) @ Home");
    expect(formatBiggestRunCaption({ biggest_run_team_abbreviation: "NYK" })).toBeNull();
  });
});

function scoringSequence(plays: { home: number; away: number; elapsed?: number }[]): ScoringPlay[] {
  let scoreHome = 0;
  let scoreAway = 0;
  return plays.map((play, index) => {
    scoreHome += play.home;
    scoreAway += play.away;
    return {
      elapsed_seconds: play.elapsed ?? (index + 1) * 10,
      score_home: scoreHome,
      score_away: scoreAway,
    };
  });
}

describe("selectBiggestRun", () => {
  const teams = { homeAbbreviation: "SAS", awayAbbreviation: "NYK" };

  it("picks a 21-2 burst and rejects 31-15 and 79-59 marathons", () => {
    const events = scoringSequence([
      { away: 3, home: 0 },
      { away: 0, home: 1 },
      { away: 3, home: 0 },
      { away: 0, home: 1 },
      { away: 15, home: 0 },
      { away: 5, home: 6 },
      { away: 5, home: 7 },
      ...Array.from({ length: 22 }, () => ({ away: 2, home: 2 })),
      { away: 4, home: 0 },
    ]);
    expect(events.at(-1)).toMatchObject({ score_away: 79, score_home: 59 });
    const grindTo315 = scoringSequence([
      { away: 3, home: 0 },
      { away: 0, home: 1 },
      { away: 3, home: 0 },
      { away: 0, home: 1 },
      { away: 15, home: 0 },
      { away: 5, home: 6 },
      { away: 5, home: 7 },
    ]);
    expect(grindTo315.at(-1)).toMatchObject({ score_away: 31, score_home: 15 });

    const run = selectBiggestRun(events, teams);
    expect(run).toMatchObject({
      biggest_run_team_abbreviation: "NYK",
      biggest_run_winner_points: 21,
      biggest_run_opponent_points: 2,
      biggest_run_label: "NYK 21-2",
    });
    expect(run && run.biggest_run_end_seconds - run.biggest_run_start_seconds).toBeLessThan(80);
    expect(run?.biggest_run_label).not.toMatch(/79-59|31-15/);
  });

  it("excludes a 31-15 window even when it is the only large net", () => {
    const events = scoringSequence([
      { away: 2, home: 2 },
      { away: 2, home: 2 },
      { away: 3, home: 2 },
      { away: 3, home: 2 },
      { away: 3, home: 2 },
      { away: 3, home: 2 },
      { away: 3, home: 1 },
      { away: 3, home: 1 },
      { away: 3, home: 1 },
      { away: 6, home: 0 },
    ]);
    expect(events.at(-1)).toMatchObject({ score_away: 31, score_home: 15 });
    const run = selectBiggestRun(events, teams);
    expect(run).not.toBeNull();
    expect(
      (run?.biggest_run_winner_points ?? 0) + (run?.biggest_run_opponent_points ?? 0)
    ).toBeLessThan(25);
    expect(run?.biggest_run_label).not.toBe("NYK 31-15");
  });

  it("ranks 21-0 above 21-3 and 21-2 above a short 12-0", () => {
    const shutoutVsLeaky = scoringSequence([
      { away: 21, home: 0, elapsed: 30 },
      { away: 0, home: 3, elapsed: 40 },
      { away: 21, home: 0, elapsed: 200 },
      { away: 0, home: 3, elapsed: 240 },
    ]);
    expect(selectBiggestRun(shutoutVsLeaky, teams)?.biggest_run_label).toBe("NYK 21-0");

    const burstVsShort = scoringSequence([
      { away: 12, home: 0, elapsed: 20 },
      { away: 0, home: 0, elapsed: 80 },
      { away: 3, home: 0, elapsed: 200 },
      { away: 0, home: 1, elapsed: 210 },
      { away: 3, home: 0, elapsed: 220 },
      { away: 0, home: 1, elapsed: 230 },
      { away: 15, home: 0, elapsed: 240 },
    ]);
    expect(selectBiggestRun(burstVsShort, teams)?.biggest_run_label).toBe("NYK 21-2");
  });

  it("returns null when there is no scoring", () => {
    expect(selectBiggestRun([])).toBeNull();
  });

  it("breaks equal nets on shorter duration, then earlier start", () => {
    const shorterWins = scoringSequence([
      { away: 10, home: 0, elapsed: 400 },
      { away: 0, home: 10, elapsed: 800 },
      { away: 10, home: 0, elapsed: 810 },
    ]);
    expect(selectBiggestRun(shorterWins, teams)?.biggest_run_start_seconds).toBe(800);

    const earlierWins = scoringSequence([
      { away: 10, home: 0, elapsed: 100 },
      { away: 0, home: 10, elapsed: 200 },
      { away: 10, home: 0, elapsed: 300 },
    ]);
    expect(selectBiggestRun(earlierWins, teams)?.biggest_run_start_seconds).toBe(0);
  });
});
