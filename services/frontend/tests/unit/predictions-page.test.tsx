import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const scorecard = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
}));

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
});
