import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/schedule",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("season=2026-27"),
}));

vi.mock("@/lib/api", () => ({
  api: {
    listSeasons: async () => ({
      data: [{ season: "2026-27" }],
      meta: { total: 1, limit: 1, offset: 0 },
    }),
    listSchedule: async () => ({
      data: [
        {
          game_id: "0022600100",
          season: "2026-27",
          game_date: "2026-10-22",
          status: "Scheduled",
          home_team_id: 1610612744,
          away_team_id: 1610612747,
          home_team_abbreviation: "GSW",
          away_team_abbreviation: "LAL",
          arena: "Chase Center",
          prediction_model_version: "elo-v0",
          home_win_probability: 0.62,
          away_win_probability: 0.38,
          home_moneyline: -150,
          away_moneyline: 130,
          home_spread: -3.5,
        },
        {
          game_id: "0022600101",
          season: "2026-27",
          game_date: "2026-10-23",
          status: "Scheduled",
          home_team_id: 1610612738,
          away_team_id: 1610612752,
          home_team_abbreviation: "BOS",
          away_team_abbreviation: "NYK",
          arena: "TD Garden",
        },
      ],
      meta: { total: 2, limit: 50, offset: 0 },
    }),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import SchedulePage from "@/app/schedule/page";
import { Providers } from "@/components/providers";

describe("schedule page", () => {
  it("lists upcoming scheduled games with matchup and arena", async () => {
    render(
      <Providers>
        <SchedulePage />
      </Providers>
    );
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "LAL" })).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("Season")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LAL" })).toBeInTheDocument();
    expect(screen.getAllByText("@")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "GSW" })).toBeInTheDocument();
    expect(screen.getAllByText("Scheduled")).toHaveLength(2);
    expect(screen.getByText("Chase Center")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GSW" })).toHaveAttribute(
      "href",
      "/teams/1610612744?season=2026-27"
    );
    expect(screen.queryByText("PBP →")).not.toBeInTheDocument();
  });

  it("shows model win % and consensus odds, and dashes games without them", async () => {
    render(
      <Providers>
        <SchedulePage />
      </Providers>
    );
    await waitFor(() => {
      expect(screen.getAllByTestId("win-probability")).toHaveLength(2);
    });
    // Row 0 is priced; row 1 has neither a prediction nor odds.
    expect(screen.getAllByTestId("win-probability")[0]).toHaveTextContent("38% / 62%");
    expect(screen.getAllByTestId("moneyline")[0]).toHaveTextContent("+130 / -150");
    expect(screen.getAllByTestId("spread")[0]).toHaveTextContent("GSW -3.5");
    expect(screen.getAllByTestId("win-probability")[1]).toHaveTextContent("—");
    expect(screen.getAllByTestId("moneyline")[1]).toHaveTextContent("—");
    expect(screen.getAllByTestId("spread")[1]).toHaveTextContent("—");
    expect(screen.getByText(/not betting advice/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "How accurate is the model?" })).toHaveAttribute(
      "href",
      "/predictions"
    );
  });
});
