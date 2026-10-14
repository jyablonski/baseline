import { describe, expect, it } from "vitest";

import {
  askDisplayRows,
  askTableColumns,
  askTableLabel,
  formatAskCell,
  isAskNumericColumn,
} from "@/lib/ask-table";

describe("askTableColumns", () => {
  it("hides surrogate ids, filter dumps, and duplicate Cube keys", () => {
    const columns = askTableColumns([
      {
        player_id: 202695,
        full_name: "Kawhi Leonard",
        player_name: "Kawhi Leonard",
        season: "2025-26",
        total_b2b_games: 10,
        total_back_to_backs: 10,
        games_played_in_b2b: 10,
        avg_pts_b2b: 26.5,
        avg_pts_in_b2b: 26.5,
        avg_pts_non_b2b: 28.0,
      },
    ]);
    expect(columns).toEqual([
      "full_name",
      "season",
      "total_back_to_backs",
      "games_played_in_b2b",
      "avg_pts_b2b",
      "avg_pts_non_b2b",
    ]);
  });

  it("hides team_id, the full name beside an abbreviation, filters_applied, empty game_list, and folds W-L into record", () => {
    const columns = askTableColumns([
      {
        team_id: 1610612744,
        abbreviation: "GSW",
        team_name: "Golden State Warriors",
        wins: 0,
        losses: 0,
        game_list: [],
        filters_applied: { arena_city: "Chicago" },
      },
    ]);
    expect(columns).toEqual(["abbreviation", "record"]);
  });

  it("hides Cube-prefixed duplicates and empty leftover dims", () => {
    const columns = askTableColumns([
      {
        "Teams.team_name": "Golden State Warriors",
        team_name: "Golden State Warriors",
        position: null,
        height: "",
        current_season_salary: 62587158,
      },
    ]);
    expect(columns).toEqual(["team_name", "current_season_salary"]);
  });
});

describe("askDisplayRows", () => {
  it("replaces wins and losses with a record object", () => {
    expect(askDisplayRows([{ wins: 1, losses: 0, games: 1 }])).toEqual([
      { games: 1, record: { wins: 1, losses: 0 } },
    ]);
  });
});

describe("askTableLabel", () => {
  it("uses Baseline labels and falls back to a short Cube member", () => {
    expect(askTableLabel("full_name")).toBe("Player");
    expect(askTableLabel("win_pct")).toBe("Win %");
    expect(askTableLabel("current_season_salary")).toBe("Salary");
    expect(askTableLabel("Teams.team_name")).toBe("Team");
    expect(askTableLabel("abbreviation")).toBe("Team");
    expect(askTableLabel("mystery_stat")).toBe("mystery stat");
  });
});

describe("formatAskCell", () => {
  it("renders dashes and JSON objects", () => {
    expect(formatAskCell(null)).toBe("—");
    expect(formatAskCell(26.5)).toBe("26.5");
    expect(formatAskCell({ wins: 0 })).toBe('{"wins":0}');
  });

  it("marks money, rates, and counting stats as numeric columns", () => {
    expect(isAskNumericColumn("current_season_salary")).toBe(true);
    expect(isAskNumericColumn("win_pct")).toBe(true);
    expect(isAskNumericColumn("record")).toBe(true);
    expect(isAskNumericColumn("full_name")).toBe(false);
  });

  it("formats money, win %, records, dates, and per-game stats", () => {
    expect(formatAskCell(62587158, "current_season_salary")).toBe("$62.6M");
    expect(formatAskCell(221121390, "current_season_payroll")).toBe("$221.1M");
    expect(formatAskCell(1, "win_pct")).toBe("1.000");
    expect(formatAskCell(0.75, "win_pct")).toBe(".750");
    expect(formatAskCell({ wins: 1, losses: 0 }, "record")).toBe("1–0");
    expect(formatAskCell(0, "games_back")).toBe("—");
    expect(formatAskCell(10, "games_back")).toBe("10 GB");
    expect(formatAskCell("2025-10-21T00:00:00.000", "first_game_date")).toContain("2025");
    expect(formatAskCell(26.5, "avg_pts_b2b")).toBe(
      (26.5).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    );
  });
});
