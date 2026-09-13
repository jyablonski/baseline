import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/games",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    listGames: async () => ({
      data: [
        {
          game_id: "0042500405",
          season: "2025-26",
          game_date: "2026-06-13",
          home_team_abbreviation: "SAS",
          away_team_abbreviation: "NYK",
          home_score: 125,
          away_score: 108,
          score_margin: 17,
        },
      ],
      meta: { total: 1, limit: 15, offset: 0 },
    }),
    listBiggestCollapses: async () => ({
      data: [
        {
          game_id: "0042500410",
          season: "2025-26",
          game_date: "2026-06-10",
          home_team_abbreviation: "NYK",
          away_team_abbreviation: "SAS",
          home_score: 107,
          away_score: 106,
          largest_lead_blown: 29,
          blown_lead_team_abbreviation: "SAS",
          comeback_team_abbreviation: "NYK",
          blown_lead_period: 2,
          winner_margin_entering_fourth: -15,
        },
      ],
      meta: { total: 1, limit: 10, offset: 0 },
    }),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import GamesPage from "@/app/games/page";
import { Providers } from "@/components/providers";

describe("games index", () => {
  it("lists recent final games with play-by-play links", async () => {
    render(
      <Providers>
        <GamesPage />
      </Providers>
    );
    await waitFor(() => {
      expect(screen.getAllByRole("link", { name: "PBP →" }).length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("heading", { name: "Game flow" })).toBeInTheDocument();
    expect(screen.getByText("Recent final games")).toBeInTheDocument();
    // Scoped to the recent-games table: the collapse table below repeats these teams.
    const recent = within(screen.getAllByRole("table")[0]);
    expect(recent.getByText("Margin")).toBeInTheDocument();
    expect(recent.getByText("NYK")).toBeInTheDocument();
    expect(recent.getByText("SAS")).toBeInTheDocument();
    expect(recent.getByRole("link", { name: "PBP →" })).toHaveAttribute(
      "href",
      "/games/0042500405"
    );
    // The only select on this page is the blown-leads team filter; the games
    // table itself is still unfiltered.
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getByLabelText("Blew it")).toHaveValue("");
  });

  it("ranks the biggest blown leads under the recent games table", async () => {
    render(
      <Providers>
        <GamesPage />
      </Providers>
    );

    expect(screen.getByText("Biggest blown leads")).toBeInTheDocument();
    // The heading renders before either query settles; wait for both tables.
    await waitFor(() => {
      expect(screen.getAllByRole("table")).toHaveLength(2);
    });
    const collapses = within(screen.getAllByRole("table")[1]);
    const row = collapses.getByText("29").closest("tr");
    expect(row).toBeTruthy();
    expect(row!.textContent).toContain("SAS");
    // Opponent column: the team that completed the comeback.
    expect(within(row as HTMLElement).getByText("NYK", { exact: true })).toBeInTheDocument();
    expect(collapses.getByRole("columnheader", { name: "Opponent" })).toBeInTheDocument();
    expect(row!.textContent).toContain("Q2");
    expect(row!.textContent).toContain("SAS 106");
    expect(row!.textContent).toContain("NYK 107");
    expect(within(row as HTMLElement).getByRole("link")).toHaveAttribute(
      "href",
      "/games/0042500410"
    );
  });
});
