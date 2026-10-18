import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/games/0042500405",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: "0042500405" }),
}));

const getGame = vi.fn();
const getGameFlow = vi.fn();
const getGamePlayByPlay = vi.fn();
const listGames = vi.fn();
const getGameBoxScore = vi.fn();
const getTeamGames = vi.fn();
const listSchedule = vi.fn();
const getGameInjuries = vi.fn();

const EMPTY_PAGE = { data: [], meta: { total: 0, limit: 0, offset: 0 } };

// The Finals game every flow and box-score test below opens.
const FINAL_GAME = {
  game_id: "0042500405",
  season: "2025-26",
  season_type: "Playoffs",
  game_date: "2026-06-13",
  start_time_et: "20:30",
  status: "Final",
  home_team_id: "t-sas",
  away_team_id: "t-nyk",
  home_team_abbreviation: "SAS",
  away_team_abbreviation: "NYK",
  home_team_name: "San Antonio Spurs",
  away_team_name: "New York Knicks",
  arena: "Frost Bank Center",
  national_tv: "ABC",
  home_score: 101,
  away_score: 108,
  home_wins: 2,
  home_losses: 2,
  away_wins: 2,
  away_losses: 2,
  home_streak: null,
  home_last_10: null,
  away_streak: null,
  away_last_10: null,
  home_win_probability: 0.6,
  away_win_probability: 0.4,
  market_home_wp: 0.45,
  lead_highlight: "Jalen Brunson scores 41",
  lead_highlight_detail: "41 pts, 7 ast. NYK 108, SAS 101.",
};

beforeEach(() => {
  getGame.mockResolvedValue(FINAL_GAME);
  getTeamGames.mockResolvedValue(EMPTY_PAGE);
  listSchedule.mockResolvedValue(EMPTY_PAGE);
  getGameInjuries.mockResolvedValue(EMPTY_PAGE);
});

vi.mock("@/lib/api", () => ({
  api: {
    getGame: (...args: unknown[]) => getGame(...args),
    getTeamGames: (...args: unknown[]) => getTeamGames(...args),
    listSchedule: (...args: unknown[]) => listSchedule(...args),
    getGameInjuries: (...args: unknown[]) => getGameInjuries(...args),
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
    expect(screen.getByRole("link", { name: "All results →" })).toHaveAttribute("href", "/games");
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
    fireEvent.click(screen.getByRole("button", { name: "Shooting %" }));
    const table = () => within(screen.getByRole("table"));
    const row = table().getByText("Victor Wembanyama").closest("tr") as HTMLElement;
    expect(within(row).getByText("10-21")).toBeInTheDocument();
    expect(within(row).getByText("47.6%")).toBeInTheDocument();
    expect(within(row).getByText("2-6")).toBeInTheDocument();
    expect(within(row).getByText("6-8")).toBeInTheDocument();
    expect(within(row).getByText("57.1%")).toBeInTheDocument();
    expect(within(row).getByText("-7")).toBeInTheDocument();
    expect(within(row).getByText("31.4")).toBeInTheDocument();

    // A player who never shot gets a blank rather than a 0.0% that reads as bad.
    const bench = table().getByText("Bench Guy").closest("tr") as HTMLElement;
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
    fireEvent.click(screen.getByRole("button", { name: "Shooting %" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Shooting %" }));

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
      // Header first, team totals last: neither sorts.
      const rows = screen.getAllByRole("row").slice(1, -1);
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

describe("game page states", () => {
  const SCHEDULED_GAME = {
    ...FINAL_GAME,
    season_type: "Regular Season",
    // Far enough ahead that it has not tipped whenever this runs.
    game_date: "2099-10-22",
    start_time_et: "19:30",
    status: "Scheduled",
    home_score: null,
    away_score: null,
    home_wins: 3,
    home_losses: 1,
    away_wins: 1,
    away_losses: 3,
    home_streak: "W2",
    home_last_10: "3-1",
    away_streak: "L1",
    away_last_10: "1-3",
    home_win_probability: 0.62,
    away_win_probability: 0.38,
    home_moneyline: -150,
    away_moneyline: 130,
    home_spread: -3.5,
    lead_highlight: null,
    lead_highlight_detail: null,
    home_team_nickname: "Spurs",
    away_team_nickname: "Knicks",
    home_team_conference: "West",
    away_team_conference: "East",
  };
  const FINALS_GAME = {
    ...FINAL_GAME,
    home_team_nickname: "Spurs",
    away_team_nickname: "Knicks",
    home_team_conference: "West",
    away_team_conference: "East",
  };
  const meeting = (
    id: string,
    date: string,
    seasonType: string,
    away: number,
    home: number,
    isWin: boolean
  ) => ({
    game_id: id,
    season: "2025-26",
    season_type: seasonType,
    game_date: date,
    home_team_abbreviation: "SAS",
    away_team_abbreviation: "NYK",
    home_score: home,
    away_score: away,
    is_win: isWin,
  });

  function renderPage() {
    render(
      <Providers>
        <GameFlowPage />
      </Providers>
    );
  }

  function finalWithoutFlow() {
    getGameFlow.mockResolvedValue({ ...FINAL_GAME, has_play_by_play: false });
    getGamePlayByPlay.mockResolvedValue(EMPTY_PAGE);
    getGameBoxScore.mockResolvedValue(EMPTY_PAGE);
  }

  it("previews a scheduled game: tip time, who wins, and before tip-off", async () => {
    getGame.mockResolvedValue(SCHEDULED_GAME);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Who wins?" })).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "New York Knicks @ San Antonio Spurs"
    );
    expect(screen.getByTestId("game-scoreline")).toHaveTextContent("7:30 PM");
    expect(screen.getByTestId("game-scoreline")).toHaveTextContent("ABC");
    const [nyk, sas] = screen.getAllByTestId("pick-card");
    expect(nyk).toHaveTextContent("New York Knicks+130");
    expect(nyk).toHaveTextContent("Implied 43%");
    expect(sas).toHaveTextContent("−150");
    expect(sas).toHaveTextContent("Implied 60%");
    expect(screen.getByText(/Spread SAS -3.5/)).toBeInTheDocument();

    expect(screen.getByTestId("before-form")).toHaveTextContent("NYK 1–3 (L1) · SAS 3–1 (W2)");
    expect(screen.getByTestId("before-model")).toHaveTextContent("NYK 38% · SAS 62%");
    expect(screen.queryByRole("heading", { name: "Game flow" })).not.toBeInTheDocument();
  });

  it("says so in one line when neither team has played yet, and calls it the opener", async () => {
    getGame.mockResolvedValue({
      ...SCHEDULED_GAME,
      home_wins: 0,
      home_losses: 0,
      away_wins: 0,
      away_losses: 0,
      home_streak: null,
      away_streak: null,
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("before-form")).toHaveTextContent("Neither team has played yet");
    });
    // The context waits for the season's meetings, so it lands a moment later.
    await waitFor(() => {
      expect(screen.getByTestId("game-meta")).toHaveTextContent("Season opener");
    });
  });

  it("locks the pick cards once tipped and says the score is still to come", async () => {
    getGame.mockResolvedValue({ ...SCHEDULED_GAME, game_date: "2020-01-01" });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/This game has tipped off/)).toBeInTheDocument();
    });
    expect(screen.getByTestId("game-scoreline")).toHaveTextContent("Tipped off");
    for (const card of screen.getAllByTestId("pick-card")) expect(card).toBeDisabled();
  });

  it("recaps a final: score, headline, standout, and how the calls did", async () => {
    finalWithoutFlow();
    getGame.mockResolvedValue({ ...FINALS_GAME, season_type: "Cup" });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("recap-headline")).toHaveTextContent(
        "Knicks beat the Spurs, 108–101."
      );
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "New York Knicks (W) @ San Antonio Spurs"
    );
    expect(screen.getByLabelText("NYK 108, winner")).toBeInTheDocument();
    expect(screen.getByLabelText("SAS 101")).toBeInTheDocument();
    const calls = screen.getAllByTestId("recap-call").map((call) => call.textContent);
    // The model had the home side and lost; the market had the winner.
    expect(calls).toEqual([
      "Model Had SAS at 60% before tip-off · Missed",
      "Market Had NYK at 55% before tip-off · Called it",
    ]);
    expect(screen.queryByRole("heading", { name: "Who wins?" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("upset-note")).not.toBeInTheDocument();
  });

  it("badges an upset with the winner's morning line, and says when the model saw it", async () => {
    finalWithoutFlow();
    getGame.mockResolvedValue({
      ...FINALS_GAME,
      season_type: "Regular Season",
      is_upset: true,
      winner_market_wp: 0.28,
      model_called_upset: true,
    });
    renderPage();

    const note = await screen.findByTestId("upset-note");
    expect(note).toHaveTextContent("Upset NYK won at 28% on the morning line");
    expect(note).toHaveTextContent("The model had NYK favoured");
    expect(note).not.toHaveTextContent(/closing/i);
    // A regular-season result has no headline: the scoreboard already says it.
    expect(screen.queryByTestId("recap-headline")).not.toBeInTheDocument();
  });

  it("tells a Finals game as the series: game number, record, and the clincher", async () => {
    finalWithoutFlow();
    getGame.mockResolvedValue(FINALS_GAME);
    getTeamGames.mockResolvedValue({
      data: [
        meeting("rs-1", "2026-03-01", "Regular Season", 114, 89, false),
        meeting("g1", "2026-06-03", "Playoffs", 105, 95, false),
        meeting("g2", "2026-06-05", "Playoffs", 105, 104, false),
        meeting("g3", "2026-06-08", "Playoffs", 111, 115, true),
        meeting("g4", "2026-06-10", "Playoffs", 107, 106, false),
        { ...meeting("0042500405", "2026-06-13", "Playoffs", 108, 101, false) },
      ],
      meta: { total: 6, limit: 20, offset: 0 },
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("recap-headline")).toHaveTextContent(
        "Knicks win the NBA Finals, 4–1."
      );
    });
    expect(screen.getByTestId("game-meta")).toHaveTextContent("NBA Finals, Game 5");
    expect(screen.getByRole("heading", { name: "Finals" })).toBeInTheDocument();
    expect(screen.getByTestId("series-record")).toHaveTextContent("NYK 4–1");
    const meetings = screen.getAllByTestId("series-meeting");
    expect(meetings).toHaveLength(5);
    expect(meetings[0]).toHaveTextContent(/^G1/);
    expect(within(meetings[2]).getByText("L")).toBeInTheDocument();
    expect(within(meetings[4]).queryByRole("link")).not.toBeInTheDocument();
    // The regular season sits in its own row beside the series.
    expect(screen.getByTestId("stage-record")).toHaveTextContent("Regular seasonNYK 1–0");
  });

  it("lists a regular-season series with this game marked and the others linked", async () => {
    getGame.mockResolvedValue(SCHEDULED_GAME);
    getTeamGames.mockResolvedValue({
      data: [meeting("g-earlier", "2099-10-02", "Regular Season", 100, 110, true)],
      meta: { total: 1, limit: 20, offset: 0 },
    });
    listSchedule.mockResolvedValue({
      data: [SCHEDULED_GAME, { ...SCHEDULED_GAME, game_id: "g-later", game_date: "2099-12-01" }],
      meta: { total: 2, limit: 20, offset: 0 },
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("series-record")).toHaveTextContent("SAS 1–0");
    });
    expect(screen.getByRole("heading", { name: "Season series" })).toBeInTheDocument();
    const meetings = screen.getAllByTestId("series-meeting");
    expect(meetings).toHaveLength(3);
    expect(within(meetings[0]).getByRole("link")).toHaveAttribute("href", "/games/g-earlier");
    expect(meetings[0]).toHaveTextContent("NYK 100 @ SAS 110");
    expect(meetings[1]).toHaveTextContent("This game");
    expect(within(meetings[2]).getByRole("link")).toHaveAttribute("href", "/games/g-later");
  });

  it("shows one team's box score at a time, with a totals row", async () => {
    getGameFlow.mockResolvedValue({ ...FINAL_GAME, has_play_by_play: false });
    getGamePlayByPlay.mockResolvedValue(EMPTY_PAGE);
    getGameBoxScore.mockResolvedValue({
      data: [
        BOX_SCORE_ROW,
        {
          ...BOX_SCORE_ROW,
          player_id: "p-nyk",
          player_name: "Jalen Brunson",
          team_id: "t-nyk",
          team_abbreviation: "NYK",
          team_name: "New York Knicks",
          location: "away",
          points: 41,
        },
      ],
      meta: { total: 2, limit: 2, offset: 0 },
    });
    getGame.mockResolvedValue(FINALS_GAME);
    renderPage();

    // The winner opens, labelled with nickname and score.
    const knicks = await screen.findByRole("button", { name: "Knicks 108" });
    expect(knicks).toHaveAttribute("aria-pressed", "true");
    // The recap cards: the winner's star, then the losing side's top scorer.
    const cards = screen.getAllByTestId("recap-card").map((card) => card.textContent);
    expect(cards[0]).toMatch(/^Star41Jalen Brunson/);
    expect(cards.at(-1)).toMatch(/^Spurs28Victor Wembanyama/);
    const table = () => within(screen.getByRole("table"));
    expect(table().getByText("Jalen Brunson")).toBeInTheDocument();
    expect(table().queryByText("Victor Wembanyama")).not.toBeInTheDocument();
    expect(screen.getByTestId("box-score-totals")).toHaveTextContent("Team");
    // Percentages wait for the Shooting % toggle.
    expect(screen.queryByRole("button", { name: "FG%" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Spurs 101" }));
    expect(table().getByText("Victor Wembanyama")).toBeInTheDocument();
    expect(table().queryByText("Jalen Brunson")).not.toBeInTheDocument();
    // +/- reads in the loss colour.
    expect(table().getByText("-7")).toHaveClass("text-destructive");

    // Sorted by a shooting column that is then hidden, the table falls back to
    // points, with the arrow on PTS.
    fireEvent.click(screen.getByRole("button", { name: "Shooting %" }));
    fireEvent.click(screen.getByRole("button", { name: /^FG%/ }));
    fireEvent.click(screen.getByRole("button", { name: "Shooting %" }));
    expect(screen.queryByRole("button", { name: /^FG%/ })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /PTS/ })).toHaveAttribute(
      "aria-sort",
      "descending"
    );
  });

  it("opens a final's injury report into each side's list", async () => {
    finalWithoutFlow();
    getGameInjuries.mockResolvedValue({
      data: [
        {
          game_id: "0042500405",
          side: "home",
          team_id: "t-sas",
          player_id: "p-fox",
          player_name: "De'Aaron Fox",
          injury_status: "Day To Day",
          injury_detail: "Hamstring",
          description: "Day To Day (Hamstring) - Questionable for Game 5.",
          update_date: "2026-06-12",
          snapshot_date: "2026-06-13",
          is_notable: true,
          played: true,
        },
        {
          game_id: "0042500405",
          side: "home",
          team_id: "t-sas",
          player_id: "p-bench",
          player_name: "Bench Guy",
          injury_status: "Out",
          injury_detail: "Knee",
          description: "Out (Knee) - Surgery.",
          update_date: "2026-05-01",
          snapshot_date: "2026-06-13",
          is_notable: false,
          played: false,
        },
      ],
      meta: { total: 2, limit: 2, offset: 0 },
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("injury-report")).toHaveTextContent("2 listed");
    });
    expect(screen.getByText(/from the morning of the game/)).toBeInTheDocument();
    expect(screen.getByTestId("injuries-away")).toHaveTextContent("Nobody listed.");
    const [fox, bench] = screen.getAllByTestId("injury-row");
    expect(fox).toHaveTextContent("Day To Day · Hamstring");
    expect(fox).toHaveTextContent("Played");
    expect(bench).toHaveTextContent("Did not play");
  });

  it("says a far-off game's injury report comes the week before", async () => {
    getGame.mockResolvedValue(SCHEDULED_GAME);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("injury-report")).toHaveTextContent(
        "Shows the week before the game"
      );
    });
  });

  it("says no report was on file for a final from before the reports began", async () => {
    finalWithoutFlow();
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("injury-report")).toHaveTextContent("None on file");
    });
  });

  it("reports a missing game instead of an empty page", async () => {
    getGame.mockRejectedValue(new Error("Game not found"));
    renderPage();
    // The page's query retries once before giving up.
    await waitFor(
      () => {
        expect(screen.getByText("Game not found")).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });
});
