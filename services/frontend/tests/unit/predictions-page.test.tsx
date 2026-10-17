import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const scorecard = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
}));
const listUpsets = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/predictions",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getPredictionScorecard: async () => ({
      champion_model_version: "elo-v0",
      rows: scorecard.rows,
    }),
    listSeasons: async () => ({
      data: [{ season: "2026-27" }, { season: "2025-26" }],
      meta: { total: 2, limit: 2, offset: 0 },
    }),
    listUpsets: (...args: unknown[]) => listUpsets(...args),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import PredictionsPage from "@/app/predictions/page";
import { Providers } from "@/components/providers";

const ELO = {
  season: "2025-26",
  model_name: "elo",
  model_version: "elo-v0",
  is_champion: true,
  n: 1230,
  logloss: 0.6512,
  brier: 0.2281,
  accuracy: 0.641,
  home_always_accuracy: 0.552,
  calibration_error: 0.031,
  market_n: 900,
  market_logloss: 0.6204,
  market_brier: 0.2133,
};

const UPSET = {
  game_id: "g-upset",
  season: "2026-27",
  season_type: "Regular Season",
  game_date: "2026-11-02",
  home_team_id: "t-nyk",
  home_team_abbreviation: "NYK",
  away_team_id: "t-sas",
  away_team_abbreviation: "SAS",
  home_score: 99,
  away_score: 104,
  winning_team_id: "t-sas",
  winner_location: "away",
  winner_market_wp: 0.28,
  model_winner_wp: 0.52,
  upset_magnitude: 1.27,
  upset_rank: 1,
  model_called_upset: true,
};

beforeEach(() => {
  listUpsets.mockReset();
  listUpsets.mockResolvedValue({ data: [], meta: { total: 0, limit: 25, offset: 0 } });
});

describe("predictions page", () => {
  it("scores each model against the market and always-home baselines", async () => {
    scorecard.rows = [
      ELO,
      { ...ELO, model_version: "elo-v1", is_champion: false, logloss: 0.598 },
      { ...ELO, model_name: "logit", model_version: "logit-v1", is_champion: false, logloss: 0.64 },
    ];
    render(
      <Providers>
        <PredictionsPage />
      </Providers>
    );
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "2025-26" })).toBeInTheDocument();
    });
    const eloRow = screen.getByRole("row", { name: /^Elo v0/ });
    expect(within(eloRow).getByText("On schedule")).toBeInTheDocument();
    expect(within(eloRow).getByText("0.651")).toBeInTheDocument();
    expect(within(eloRow).getByText("64%")).toBeInTheDocument();
    const shadowEloRow = screen.getByRole("row", { name: /^Elo v1/ });
    expect(within(shadowEloRow).queryByText("On schedule")).not.toBeInTheDocument();
    expect(within(shadowEloRow).getByText("0.598")).toBeInTheDocument();
    const logitRow = screen.getByRole("row", { name: /Logistic regression v1/ });
    expect(within(logitRow).queryByText("On schedule")).not.toBeInTheDocument();
    const marketRow = screen.getByRole("row", { name: /Sportsbook market/ });
    expect(within(marketRow).getByText("0.620")).toBeInTheDocument();
    const homeRow = screen.getByRole("row", { name: /Always pick the home team/ });
    expect(within(homeRow).getByText("55%")).toBeInTheDocument();
  });

  it("explains an empty scorecard without operator jargon", async () => {
    scorecard.rows = [];
    render(
      <Providers>
        <PredictionsPage />
      </Providers>
    );
    await waitFor(() => {
      expect(screen.getByText("No graded predictions yet")).toBeInTheDocument();
    });
    expect(screen.queryByText(/dbt|make |ml-train/i)).not.toBeInTheDocument();
  });

  it("lists the season's biggest upsets, each linked to its game", async () => {
    scorecard.rows = [];
    listUpsets.mockResolvedValue({ data: [UPSET], meta: { total: 1, limit: 25, offset: 0 } });
    render(
      <Providers>
        <PredictionsPage />
      </Providers>
    );
    const row = await screen.findByRole("row", { name: /SAS @ NYK/ });
    expect(listUpsets).toHaveBeenCalledWith({ season: "2026-27", limit: 25 });
    expect(within(row).getByRole("link", { name: "SAS @ NYK 104–99" })).toHaveAttribute(
      "href",
      "/games/g-upset"
    );
    expect(within(row).getByText("28%")).toBeInTheDocument();
    expect(within(row).getByText("52%")).toBeInTheDocument();
    expect(within(row).getByText("Called it")).toBeInTheDocument();
    expect(screen.getByLabelText("Season")).toHaveValue("2026-27");
  });

  it("says so honestly when there are no upsets yet", async () => {
    scorecard.rows = [];
    render(
      <Providers>
        <PredictionsPage />
      </Providers>
    );
    expect(await screen.findByText("No upsets yet this season")).toBeInTheDocument();
  });
});
