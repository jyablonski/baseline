import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    listSchedule: async (params: { from_date?: string } = {}) => ({
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
          home_team_name: "Golden State Warriors",
          away_team_name: "Los Angeles Lakers",
          arena: "Chase Center",
          national_tv: "ESPN, ABC",
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
          game_date: "2026-10-22",
          status: "Scheduled",
          home_team_id: 1610612738,
          away_team_id: 1610612752,
          home_team_abbreviation: "BOS",
          away_team_abbreviation: "NYK",
          home_team_name: "Boston Celtics",
          away_team_name: "New York Knicks",
          arena: "TD Garden",
        },
        {
          game_id: "0022600102",
          season: "2026-27",
          game_date: "2026-10-24",
          status: "Scheduled",
          home_team_id: 1610612748,
          away_team_id: 1610612749,
          home_team_abbreviation: "MIA",
          away_team_abbreviation: "MIL",
          home_team_name: "Miami Heat",
          away_team_name: "Milwaukee Bucks",
          arena: "Kaseya Center",
        },
      ].filter((game) => !params.from_date || game.game_date >= params.from_date),
      meta: { total: 3, limit: 50, offset: 0 },
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
      "/teams/golden-state-warriors?season=2026-27"
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
    // Only nationally televised games name a network.
    expect(screen.getByRole("columnheader", { name: "TV" })).toBeInTheDocument();
    expect(screen.getAllByTestId("national-tv")[0]).toHaveTextContent("ESPN, ABC");
    expect(screen.getAllByTestId("national-tv")[1]).toHaveTextContent("—");
    expect(screen.getAllByTestId("win-probability")[1]).toHaveTextContent("—");
    expect(screen.getAllByTestId("moneyline")[1]).toHaveTextContent("—");
    expect(screen.getAllByTestId("spread")[1]).toHaveTextContent("—");
    expect(screen.getByRole("heading", { name: "Schedule" }).parentElement).toHaveTextContent(
      "2026-27 schedule from today onward."
    );
    // What a column means is behind its heading, not spelled out above the table.
    expect(screen.queryByText(/pregame model estimate/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Win %" }));
    const help = await screen.findByRole("dialog", { name: "Win %" });
    expect(help).toHaveTextContent("pregame model estimate of each team's chance to win");
    expect(
      within(help).getByRole("link", { name: "How accurate is the model? →" })
    ).toHaveAttribute("href", "/predictions");
    for (const column of ["TV", "Moneyline", "Spread"]) {
      expect(screen.getByRole("button", { name: column })).toBeInTheDocument();
    }
  });

  it("shows one day of games at a time and pages by game day", async () => {
    render(
      <Providers>
        <SchedulePage />
      </Providers>
    );
    expect(await screen.findByText("Thu, Oct 22, 2026 · 2 games")).toBeInTheDocument();
    // The later day is fetched but held back until asked for.
    expect(screen.queryByText("Kaseya Center")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← Prev day" })).toBeDisabled();

    // Oct 23 has no games, so Next lands on Oct 24.
    fireEvent.click(screen.getByRole("button", { name: "Next day →" }));
    expect(await screen.findByText("Sat, Oct 24, 2026 · 1 game")).toBeInTheDocument();
    expect(screen.getByText("Kaseya Center")).toBeInTheDocument();
    expect(screen.queryByText("Chase Center")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next day →" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "← Prev day" }));
    expect(await screen.findByText("Thu, Oct 22, 2026 · 2 games")).toBeInTheDocument();
    expect(screen.getByText("Chase Center")).toBeInTheDocument();
  });
});
