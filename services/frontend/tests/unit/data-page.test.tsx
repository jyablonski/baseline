import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const scorecard = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/data",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getStatus: async () => ({
      last_scraped_at: "2026-10-23T12:04:00Z",
      next_scrape_at: "2026-10-24T12:00:00Z",
      player_count: 500,
      game_count: 16,
      season_count: 1,
      first_season: "2026-27",
      last_season: "2026-27",
    }),
    getPredictionScorecard: async () => ({
      champion_model_version: "elo-v1",
      rows: scorecard.rows,
    }),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import DataPage from "@/app/data/page";
import { Providers } from "@/components/providers";
import { PRIMARY_NAV } from "@/lib/nav";

const ELO = {
  season: "2026-27",
  model_name: "elo",
  model_version: "elo-v0",
  is_champion: false,
  n: 16,
  logloss: 0.592,
  brier: 0.206,
  accuracy: 0.63,
  home_always_accuracy: 0.63,
  calibration_error: 0.186,
  market_n: 16,
  market_logloss: 0.58,
  market_brier: 0.197,
};

function renderPage() {
  return render(
    <Providers>
      <DataPage />
    </Providers>
  );
}

describe("data page", () => {
  it("lays out sources, derived metrics, scores, models and limits", async () => {
    scorecard.rows = [ELO, { ...ELO, model_version: "elo-v1", is_champion: true, logloss: 0.612 }];
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "About the data" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent)).toEqual([
      "Sources",
      "How the data gets here",
      "What Baseline adds",
      "Baseline's own scores",
      "Win prediction models",
      "Known limits",
      "Developer",
    ]);

    // 12:04 UTC is 8:04 AM Eastern in daylight time.
    await waitFor(() => expect(screen.getByText("8:04 AM")).toBeInTheDocument());
    expect(screen.getAllByText("2026-27").length).toBeGreaterThan(0);

    const champion = await screen.findByRole("row", { name: /^Elo v1/ });
    expect(within(champion).getByText("On schedule")).toBeInTheDocument();
    expect(within(champion).getByText("0.612")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Sportsbook market/ })).toHaveTextContent("0.580");
    expect(screen.getByText(/16 games is too few/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Report it" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^mailto:/)
    );
  });

  it("explains an empty scorecard without operator jargon", async () => {
    scorecard.rows = [];
    renderPage();

    expect(await screen.findByText(/Nothing has been graded yet/)).toBeInTheDocument();
    expect(screen.queryByText(/too few to separate/)).not.toBeInTheDocument();
  });

  it("is not linked from the primary nav yet", () => {
    expect(PRIMARY_NAV.map((item) => item.href)).not.toContain("/data");
  });
});
