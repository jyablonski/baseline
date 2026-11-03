import { describe, expect, it } from "vitest";

import {
  formatTeamStat,
  isOut,
  lastGames,
  nextGame,
  parseTeamTab,
  rankFill,
  rankTone,
  teamTabHref,
} from "@/lib/team-page";
import type { TeamSeasonGame } from "@/lib/types";

const game = (overrides: Partial<TeamSeasonGame>): TeamSeasonGame => ({
  game_id: "g",
  season: "2026-27",
  game_date: "2026-11-01",
  status: "Final",
  is_home: true,
  opponent_team_id: "t",
  is_back_to_back: false,
  ...overrides,
});

describe("team page helpers", () => {
  it("parses tabs and keeps other params in tab links", () => {
    expect(parseTeamTab("roster")).toBe("roster");
    expect(parseTeamTab("nope")).toBe("overview");
    expect(parseTeamTab(null)).toBe("overview");
    const params = new URLSearchParams("season=2026-27&tab=stats");
    expect(teamTabHref("/teams/x", params, "cap")).toBe("/teams/x?season=2026-27&tab=cap");
    expect(teamTabHref("/teams/x", params, "overview")).toBe("/teams/x?season=2026-27");
    expect(teamTabHref("/teams/x", new URLSearchParams(), "overview")).toBe("/teams/x");
  });

  it("formats each stat kind", () => {
    expect(formatTeamStat(9.8, "signed")).toBe("+9.8");
    expect(formatTeamStat(-3.25, "signed")).toBe("-3.3");
    expect(formatTeamStat(0.551, "pct")).toBe("55.1%");
    expect(formatTeamStat(0.284, "ratio")).toBe(".284");
    expect(formatTeamStat(118.44, "rating")).toBe("118.4");
    expect(formatTeamStat(null, "pct")).toBe("—");
  });

  it("fills toward 1st and tones by third", () => {
    expect(rankFill(1, 30)).toBe(1);
    expect(rankFill(30, 30)).toBe(0.04);
    expect(rankFill(null, 30)).toBe(0);
    expect(rankFill(1, 1)).toBe(1);
    expect(rankTone(10, 30)).toBe("good");
    expect(rankTone(15, 30)).toBe("middle");
    expect(rankTone(21, 30)).toBe("bad");
    expect(rankTone(1, 30, true)).toBe("neutral");
    expect(rankTone(null, 30)).toBe("neutral");
  });

  it("picks the last played games and the next one", () => {
    const games = [
      game({ game_id: "a", game_date: "2026-10-28", result: "W" }),
      game({ game_id: "b", game_date: "2026-11-01", result: "L" }),
      game({ game_id: "c", game_date: "2026-11-02", status: "Scheduled", start_time_et: "19:30" }),
      game({ game_id: "d", game_date: "2026-11-04", status: "Scheduled" }),
      // Postponed and never played: past today, so not "next".
      game({ game_id: "e", game_date: "2026-10-30", status: "Postponed" }),
    ];
    expect(lastGames(games).map((row) => row.game_id)).toEqual(["b", "a"]);
    expect(lastGames(games, 1).map((row) => row.game_id)).toEqual(["b"]);
    expect(nextGame(games, "2026-11-02")?.game_id).toBe("c");
    expect(nextGame(games, "2026-11-03")?.game_id).toBe("d");
    expect(nextGame(games, "2026-11-05")).toBeNull();
  });

  it("counts only ruled-out statuses as out", () => {
    expect(isOut({ injury_status: "Out" })).toBe(true);
    expect(isOut({ injury_status: "Out For Season" })).toBe(true);
    expect(isOut({ injury_status: "Day To Day" })).toBe(false);
  });
});
