import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/games/0042500405",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: "0042500405" }),
}));

const getGameFlow = vi.fn();
const getGamePlayByPlay = vi.fn();
const listGames = vi.fn();
const getGameBoxScore = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    listGames: (...args: unknown[]) => listGames(...args),
    getGameFlow: (...args: unknown[]) => getGameFlow(...args),
    getGamePlayByPlay: (...args: unknown[]) => getGamePlayByPlay(...args),
    getGameBoxScore: (...args: unknown[]) => getGameBoxScore(...args),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import GameFlowPage from "@/app/games/[id]/page";
import { GameFlowTooltip } from "@/components/charts/game-flow-chart";
import { FALLBACK_AWAY, FALLBACK_HOME } from "@/lib/team-colors";
import { Providers } from "@/components/providers";

const BOX_SCORE_ROW = {
  player_id: "p1",
  player_name: "Victor Wembanyama",
  team_id: "t-sas",
  team_abbreviation: "SAS",
  team_name: "San Antonio Spurs",
  location: "home",
  minutes: 36,
  points: 28,
  rebounds: 14,
  assists: 3,
  field_goals_made: 10,
  field_goals_attempted: 21,
  field_goal_pct: 0.476,
  three_pointers_made: 2,
  three_pointers_attempted: 6,
  three_point_pct: 0.333,
  free_throws_made: 6,
  free_throws_attempted: 8,
  free_throw_pct: 0.75,
  true_shooting_pct: 0.571,
  plus_minus: -7,
  mvp_game_score: 31.4,
};

describe("game flow page", () => {
  it("shows empty play-by-play copy and no Recent final games filter", async () => {
    getGameFlow.mockResolvedValue({
      game_id: "0042500405",
      season: "2025-26",
      game_date: "2026-06-13",
      home_team_id: 1610612759,
      away_team_id: 1610612752,
      home_team_abbreviation: "SAS",
      away_team_abbreviation: "NYK",
      home_team_name: "San Antonio Spurs",
      away_team_name: "New York Knicks",
      has_play_by_play: false,
    });
    getGameBoxScore.mockResolvedValue({ data: [], meta: { total: 0, limit: 0, offset: 0 } });
    getGamePlayByPlay.mockResolvedValue({
      data: [],
      meta: { total: 0, limit: 0, offset: 0 },
    });

    render(
      <Providers>
        <GameFlowPage />
      </Providers>
    );

    await waitFor(() => {
      expect(screen.getByText("No PBP data available.")).toBeInTheDocument();
    });
    expect(screen.getByText("There's no scoring timeline for this game.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All recent final games →" })).toHaveAttribute(
      "href",
      "/games"
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent final games")).not.toBeInTheDocument();
    expect(screen.queryByText(/dbt/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/scrape/i)).not.toBeInTheDocument();
    expect(listGames).not.toHaveBeenCalled();
  });

  it("computes the biggest run from PBP and ignores a marathon gold label", async () => {
    getGameFlow.mockResolvedValue({
      game_id: "0042500405",
      season: "2025-26",
      game_date: "2026-06-13",
      home_team_id: 1610612759,
      away_team_id: 1610612752,
      home_team_abbreviation: "SAS",
      away_team_abbreviation: "NYK",
      home_team_name: "San Antonio Spurs",
      away_team_name: "New York Knicks",
      has_play_by_play: true,
      biggest_run_label: "NYK 79-59",
      biggest_run_start_seconds: 900,
      biggest_run_end_seconds: 2800,
    });
    getGameBoxScore.mockResolvedValue({ data: [], meta: { total: 0, limit: 0, offset: 0 } });
    getGamePlayByPlay.mockResolvedValue({
      data: [
        {
          game_id: "0042500405",
          action_number: 1,
          period: 1,
          clock: "PT11M50.00S",
          elapsed_seconds: 10,
          score_home: 0,
          score_away: 3,
          score_differential: -3,
          description: "J. Brunson 3PT Jump Shot (3 PTS)",
        },
        {
          game_id: "0042500405",
          action_number: 2,
          period: 1,
          clock: "PT11M40.00S",
          elapsed_seconds: 20,
          score_home: 1,
          score_away: 3,
          score_differential: -2,
        },
        {
          game_id: "0042500405",
          action_number: 3,
          period: 1,
          clock: "PT11M30.00S",
          elapsed_seconds: 30,
          score_home: 1,
          score_away: 6,
          score_differential: -5,
        },
        {
          game_id: "0042500405",
          action_number: 4,
          period: 1,
          clock: "PT11M20.00S",
          elapsed_seconds: 40,
          score_home: 2,
          score_away: 6,
          score_differential: -4,
        },
        {
          game_id: "0042500405",
          action_number: 5,
          period: 1,
          clock: "PT08M36.00S",
          elapsed_seconds: 60,
          score_home: 2,
          score_away: 16,
          score_differential: -14,
          description: "J. Brunson 2pt Driving Layup",
        },
      ],
      meta: { total: 5, limit: 5, offset: 0 },
    });

    render(
      <Providers>
        <GameFlowPage />
      </Providers>
    );

    await waitFor(() => {
      expect(screen.getByText("Biggest run: NYK 16-2")).toBeInTheDocument();
    });
    expect(screen.queryByText(/79-59/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PT08M36/)).not.toBeInTheDocument();
  });

  it("surfaces the PBP description on a scoring-play tooltip", () => {
    render(
      <GameFlowTooltip
        active
        payload={[
          {
            payload: {
              elapsed_seconds: 60,
              score_differential: -14,
              score_home: 2,
              score_away: 16,
              period: 1,
              clock: "PT08M36.00S",
              clock_remaining_seconds: 516,
              scoring_side: "away",
              player_name: null,
              action_type: "2pt",
              sub_type: "Driving Layup",
              description: "J. Brunson 2pt Driving Layup",
              away_abbreviation: "NYK",
              home_abbreviation: "SAS",
            },
          },
        ]}
      />
    );

    expect(screen.getByText("Q1 · 8:36")).toBeInTheDocument();
    const score = document.querySelector(".recharts-tooltip-item-value") as HTMLElement;
    expect(score).toHaveTextContent("NYK 16 – SAS 2 (-14)");
    // Abbreviations carry their side's plot colour, not the body ink.
    expect(within(score).getByText("NYK")).toHaveStyle({ color: FALLBACK_AWAY });
    expect(within(score).getByText("SAS")).toHaveStyle({ color: FALLBACK_HOME });
    expect(screen.getByText("J. Brunson 2pt Driving Layup")).toBeInTheDocument();
  });
});

describe("box score", () => {
  it("renders shooting splits, true shooting, and plus-minus under the chart", async () => {
    getGameFlow.mockResolvedValue({
      game_id: "0042500405",
      season: "2025-26",
      game_date: "2026-06-13",
      home_team_abbreviation: "SAS",
      away_team_abbreviation: "NYK",
      home_team_name: "San Antonio Spurs",
      away_team_name: "New York Knicks",
      has_play_by_play: false,
    });
    getGamePlayByPlay.mockResolvedValue({ data: [], meta: { total: 0, limit: 0, offset: 0 } });
    getGameBoxScore.mockResolvedValue({
      data: [
        BOX_SCORE_ROW,
        {
          ...BOX_SCORE_ROW,
          player_id: "p2",
          player_name: "Bench Guy",
          minutes: 2,
          points: 0,
          field_goals_made: 0,
          field_goals_attempted: 0,
          field_goal_pct: null,
          three_pointers_made: 0,
          three_pointers_attempted: 0,
          three_point_pct: null,
          free_throws_made: 0,
          free_throws_attempted: 0,
          free_throw_pct: null,
          true_shooting_pct: null,
          plus_minus: -3,
        },
      ],
      meta: { total: 2, limit: 2, offset: 0 },
    });

    render(
      <Providers>
        <GameFlowPage />
      </Providers>
    );

    await waitFor(() => expect(screen.getByText("Box score")).toBeInTheDocument());
    const row = screen.getByText("Victor Wembanyama").closest("tr") as HTMLElement;
    expect(within(row).getByText("10-21")).toBeInTheDocument();
    expect(within(row).getByText("47.6%")).toBeInTheDocument();
    expect(within(row).getByText("2-6")).toBeInTheDocument();
    expect(within(row).getByText("6-8")).toBeInTheDocument();
    expect(within(row).getByText("57.1%")).toBeInTheDocument();
    expect(within(row).getByText("-7")).toBeInTheDocument();
    expect(within(row).getByText("31.4")).toBeInTheDocument();

    // A player who never shot gets a blank rather than a 0.0% that reads as bad.
    const bench = screen.getByText("Bench Guy").closest("tr") as HTMLElement;
    expect(within(bench).getAllByText("—").length).toBeGreaterThanOrEqual(4);

    // Points descending by default, so the leading scorer is the first row.
    const names = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.textContent ?? "");
    expect(names[0]).toContain("Victor Wembanyama");
    expect(names[1]).toContain("Bench Guy");
  });

  it("sorts on a clicked column and flips direction on a second click", async () => {
    getGameFlow.mockResolvedValue({
      game_id: "0042500405",
      home_team_abbreviation: "SAS",
      away_team_abbreviation: "NYK",
      has_play_by_play: false,
    });
    getGamePlayByPlay.mockResolvedValue({ data: [], meta: { total: 0, limit: 0, offset: 0 } });
    getGameBoxScore.mockResolvedValue({
      data: [
        BOX_SCORE_ROW,
        { ...BOX_SCORE_ROW, player_id: "p2", player_name: "Bench Guy", minutes: 2, points: 0 },
      ],
      meta: { total: 2, limit: 2, offset: 0 },
    });

    render(
      <Providers>
        <GameFlowPage />
      </Providers>
    );

    await waitFor(() => expect(screen.getByText("Box score")).toBeInTheDocument());
    const firstName = () => screen.getAllByRole("row")[1].textContent ?? "";

    fireEvent.click(screen.getByRole("button", { name: "Player" }));
    await waitFor(() => expect(firstName()).toContain("Bench Guy"));

    fireEvent.click(screen.getByRole("button", { name: "Player" }));
    await waitFor(() => expect(firstName()).toContain("Victor Wembanyama"));

    fireEvent.click(screen.getByRole("button", { name: "MIN" }));
    await waitFor(() => expect(firstName()).toContain("Victor Wembanyama"));
  });

  it("sorts on every column without throwing", async () => {
    getGameFlow.mockResolvedValue({
      game_id: "0042500405",
      home_team_abbreviation: "SAS",
      away_team_abbreviation: "NYK",
      has_play_by_play: false,
    });
    getGamePlayByPlay.mockResolvedValue({ data: [], meta: { total: 0, limit: 0, offset: 0 } });
    getGameBoxScore.mockResolvedValue({
      data: [
        BOX_SCORE_ROW,
        {
          ...BOX_SCORE_ROW,
          player_id: "p2",
          player_name: "Blank Line",
          minutes: 1,
          points: 0,
          rebounds: null,
          assists: null,
          field_goals_made: null,
          field_goals_attempted: null,
          field_goal_pct: null,
          three_pointers_made: null,
          three_pointers_attempted: null,
          three_point_pct: null,
          free_throws_made: null,
          free_throws_attempted: null,
          free_throw_pct: null,
          true_shooting_pct: null,
          plus_minus: null,
          mvp_game_score: null,
        },
      ],
      meta: { total: 2, limit: 2, offset: 0 },
    });

    render(
      <Providers>
        <GameFlowPage />
      </Providers>
    );
    await waitFor(() => expect(screen.getByText("Box score")).toBeInTheDocument());

    const headers = [
      "Player",
      "MIN",
      "PTS",
      "REB",
      "AST",
      "FG",
      "FG%",
      "3P",
      "3P%",
      "FT",
      "FT%",
      "TS%",
      "+/−",
      "MVP",
    ];
    for (const header of headers) {
      fireEvent.click(screen.getByRole("button", { name: header }));
      // A null stat sorts last whichever way the column is pointing, so the
      // player with a blank line never leads a descending stat column.
      const rows = screen.getAllByRole("row").slice(1);
      expect(rows).toHaveLength(2);
      if (header !== "Player" && header !== "MIN") {
        expect(rows[0].textContent).toContain("Victor Wembanyama");
      }
    }
  });

  it("says so when no player lines were loaded", async () => {
    getGameFlow.mockResolvedValue({
      game_id: "0042500405",
      home_team_abbreviation: "SAS",
      away_team_abbreviation: "NYK",
      has_play_by_play: false,
    });
    getGamePlayByPlay.mockResolvedValue({ data: [], meta: { total: 0, limit: 0, offset: 0 } });
    getGameBoxScore.mockResolvedValue({ data: [], meta: { total: 0, limit: 0, offset: 0 } });

    render(
      <Providers>
        <GameFlowPage />
      </Providers>
    );
    await waitFor(() =>
      expect(screen.getByText("No box score for this game.")).toBeInTheDocument()
    );
  });
});
