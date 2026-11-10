import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  games: [] as Record<string, unknown>[],
  gameCalls: [] as Record<string, unknown>[],
  weights: null as Record<string, unknown> | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/predictions",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getPredictionScorecard: async () => ({
      champion_model_version: "elo-v1",
      rows: data.rows,
    }),
    getLiveModelWeights: async () => data.weights,
    getPredictionCalibration: async () => [
      { bucket: "60–70%", predicted: 0.65, actual: 0.7, n: 16 },
    ],
    listTeams: async () => ({
      data: [
        { team_id: "t-por", abbreviation: "POR" },
        { team_id: "t-bos", abbreviation: "BOS" },
      ],
      meta: { total: 2, limit: 2, offset: 0 },
    }),
    listPredictionGames: async (params: { team?: string; limit: number; offset: number }) => {
      data.gameCalls.push(params);
      const games = data.games.filter(
        (game) =>
          !params.team ||
          game.home_team_abbreviation === params.team ||
          game.away_team_abbreviation === params.team
      );
      return {
        data: games.slice(params.offset, params.offset + params.limit),
        meta: { total: games.length, limit: params.limit, offset: params.offset },
      };
    },
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import PredictionsPage from "@/app/predictions/page";
import { Providers } from "@/components/providers";

const LIVE = {
  season: "2026-27",
  model_name: "elo",
  model_version: "elo-v1",
  is_champion: true,
  n: 71,
  logloss: 0.62,
  brier: 0.218,
  accuracy: 0.634,
  home_always_accuracy: 0.49,
  calibration_error: 0.107,
  market_n: 71,
  market_logloss: 0.6,
  market_brier: 0.197,
};

function game(index: number, overrides: Record<string, unknown> = {}) {
  return {
    game_id: `game-${index}`,
    game_date: "2026-10-29",
    home_team_abbreviation: "POR",
    away_team_abbreviation: "MEM",
    model_wp: 0.38,
    home_won: false,
    ...overrides,
  };
}

function renderPage() {
  render(
    <Providers>
      <PredictionsPage />
    </Providers>
  );
}

describe("predictions page", () => {
  beforeEach(() => {
    data.gameCalls = [];
    data.games = [game(1), game(2, { model_wp: 0.56, home_won: false })];
    data.weights = null;
  });

  it("names the live model and scores it against the two baselines", async () => {
    data.rows = [LIVE];
    renderPage();
    expect(
      await screen.findByText(/Elo v1 sets the win % on the/, { exact: false })
    ).toHaveTextContent("Elo v1 sets the win % on the schedule. Here is its record in 2026-27.");

    expect(screen.getByRole("heading", { name: "How accurate is the model?" })).toBeVisible();
    expect(screen.getAllByText("63%").length).toBeGreaterThan(0);
    expect(screen.getByText("45 of 71 games")).toBeInTheDocument();
    expect(screen.getByText("Slightly behind")).toBeInTheDocument();
    expect(screen.getByText("+14 pts")).toBeInTheDocument();
    expect(screen.getByText("the home team won 49% of games")).toBeInTheDocument();
  });

  it("names whichever model is live", async () => {
    data.rows = [{ ...LIVE, model_version: "elo-v2" }];
    renderPage();
    expect(await screen.findByText(/Elo v2 sets the win %/)).toBeInTheDocument();
  });

  it("shows what the model said beside what happened", async () => {
    data.rows = [LIVE];
    renderPage();
    const bucket = await screen.findByTestId("calibration-bucket");
    expect(bucket).toHaveTextContent("Home 60–70%");
    expect(bucket).toHaveTextContent("won 70%");
    expect(bucket).toHaveTextContent("(16 games)");

    const [hit, miss] = await screen.findAllByTestId("recent-call");
    expect(within(hit).getByRole("link", { name: "MEM 62% vs POR" })).toHaveAttribute(
      "href",
      "/games/game-1"
    );
    expect(within(hit).getByLabelText("Called it")).toBeInTheDocument();
    expect(miss).toHaveTextContent("POR 56% vs MEM");
    expect(within(miss).getByLabelText("Missed it")).toBeInTheDocument();
  });

  it("says what the live model weighs on its newest run", async () => {
    data.rows = [LIVE];
    data.weights = {
      model_version: "elo-v1",
      as_of: "2026-11-10T08:00:00",
      settings: { home_court_points: 1.3, home_games: 154, home_win_rate: 0.52 },
    };
    renderPage();
    const panel = await screen.findByTestId("model-weights");
    expect(within(panel).getByRole("heading")).toHaveTextContent("What goes into the number");
    expect(panel).toHaveTextContent("Worth 1.5 points");
    expect(panel).toHaveTextContent("Home teams have won 52% of the 154 games it has seen");
    expect(panel).toHaveTextContent("Injuries, rest, trades");
  });

  it("pages through every graded game ten at a time", async () => {
    data.rows = [LIVE];
    data.games = Array.from({ length: 25 }, (_, index) => game(index));
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId("recent-call")).toHaveLength(10));
    const pager = screen.getByRole("navigation", { name: "Recent calls pages" });
    expect(pager).toHaveTextContent("Page 1 of 3");
    expect(within(pager).getByRole("button", { name: "← Prev" })).toBeDisabled();

    fireEvent.click(within(pager).getByRole("button", { name: "Next →" }));
    // The pager names the new page at once but holds Next until its rows land.
    await waitFor(() =>
      expect(within(pager).getByRole("button", { name: "Next →" })).toBeEnabled()
    );
    expect(pager).toHaveTextContent("Page 2 of 3");
    fireEvent.click(within(pager).getByRole("button", { name: "Next →" }));
    await waitFor(() => expect(screen.getAllByTestId("recent-call")).toHaveLength(5));
    expect(pager).toHaveTextContent("Page 3 of 3");
    expect(within(pager).getByRole("button", { name: "Next →" })).toBeDisabled();
    expect(data.gameCalls).toContainEqual({ team: undefined, limit: 10, offset: 20 });

    fireEvent.click(within(pager).getByRole("button", { name: "← Prev" }));
    await waitFor(() => expect(pager).toHaveTextContent("Page 2 of 3"));
  });

  it("filters the calls to one team and starts it from the first page", async () => {
    data.rows = [LIVE];
    data.games = Array.from({ length: 12 }, (_, index) => game(index));
    renderPage();
    const pager = await screen.findByRole("navigation", { name: "Recent calls pages" });
    fireEvent.click(within(pager).getByRole("button", { name: "Next →" }));
    await waitFor(() => expect(screen.getAllByTestId("recent-call")).toHaveLength(2));

    const select = screen.getByRole("combobox", { name: "Team" });
    await waitFor(() =>
      expect(within(select).getByRole("option", { name: "BOS" })).toBeInTheDocument()
    );
    fireEvent.change(select, { target: { value: "BOS" } });
    expect(await screen.findByText("No graded games involving BOS yet.")).toBeInTheDocument();
    expect(data.gameCalls).toContainEqual({ team: "BOS", limit: 10, offset: 0 });

    fireEvent.change(select, { target: { value: "POR" } });
    await waitFor(() => expect(screen.getAllByTestId("recent-call")).toHaveLength(10));
    expect(data.gameCalls).toContainEqual({ team: "POR", limit: 10, offset: 0 });
  });

  it("keeps the metrics behind Details", async () => {
    data.rows = [LIVE];
    renderPage();
    const summary = (await screen.findByText("Accuracy Details")).closest("details");
    expect(summary).not.toHaveAttribute("open");
    expect(within(summary as HTMLElement).getByRole("row", { name: /^Elo v1/ })).toHaveTextContent(
      "0.620"
    );
    expect(
      within(summary as HTMLElement).getByRole("row", { name: /Sportsbook market/ })
    ).toHaveTextContent("0.600");
  });

  it("explains an empty scorecard without operator jargon", async () => {
    data.rows = [];
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("No graded predictions yet")).toBeInTheDocument();
    });
    expect(screen.queryByText(/ml-backfill|ml job|dbt|make /i)).not.toBeInTheDocument();
  });
});
