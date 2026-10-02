import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const listGames = vi.fn();
let searchParams = "season=2025-26";
let seasons = ["2025-26"];

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(searchParams),
}));

vi.mock("@/lib/api", () => ({
  api: {
    listSeasons: async () => ({
      data: seasons.map((season) => ({ season })),
      meta: { total: seasons.length, limit: seasons.length, offset: 0 },
    }),
    getStatus: async () => ({
      last_scraped_at: null,
      player_count: 1,
      game_count: 1,
      season_count: 1,
      first_season: "2010-11",
      last_season: "2025-26",
    }),
    listGames: (...args: unknown[]) => listGames(...args),
    listStandings: async () => ({
      data: [
        {
          team_id: 1610612738,
          abbreviation: "BOS",
          team_name: "Boston Celtics",
          season: "2025-26",
          season_type: "Regular Season",
          as_of_date: null,
          conference: "East",
          division: "Atlantic",
          conference_rank: 1,
          division_rank: null,
          wins: 56,
          losses: 26,
          win_pct: 0.683,
          games_back: 0,
          conf_games_back: null,
          streak: null,
          last_10: null,
          record_source: "games",
        },
      ],
      meta: { total: 1, limit: 50, offset: 0 },
    }),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import HomePage from "@/app/page";
import { Providers } from "@/components/providers";

describe("home desk", () => {
  it("lists latest completed games across Regular Season, Play-in, and Playoffs", async () => {
    listGames.mockResolvedValue({
      data: [
        {
          game_id: "0042500407",
          season: "2025-26",
          season_type: "Playoffs",
          game_date: "2026-06-22",
          home_team_id: 1610612760,
          away_team_id: 1610612754,
          home_team_abbreviation: "OKC",
          away_team_abbreviation: "IND",
          home_score: 108,
          away_score: 91,
          score_margin: 17,
          arena_city: "Oklahoma City",
        },
        {
          game_id: "0052500121",
          season: "2025-26",
          season_type: "PlayIn",
          game_date: "2026-04-15",
          home_team_id: 1610612744,
          away_team_id: 1610612743,
          home_team_abbreviation: "GSW",
          away_team_abbreviation: "DEN",
          home_score: 121,
          away_score: 116,
          score_margin: 5,
          arena_city: "San Francisco",
        },
        {
          game_id: "0022501234",
          season: "2025-26",
          season_type: "Regular Season",
          game_date: "2026-04-12",
          home_team_id: 1610612738,
          away_team_id: 1610612744,
          home_team_abbreviation: "BOS",
          away_team_abbreviation: "GSW",
          home_score: 112,
          away_score: 108,
          score_margin: 4,
          arena_city: "Boston",
        },
      ],
      meta: { total: 3, limit: 10, offset: 0 },
    });

    render(
      <Providers>
        <HomePage />
      </Providers>
    );
    await waitFor(() => {
      expect(screen.getByText("56–26")).toBeInTheDocument();
    });
    expect(listGames).toHaveBeenCalledWith({
      season: "2025-26",
      limit: 10,
    });
    expect(screen.queryByLabelText("Season")).not.toBeInTheDocument();
    expect(screen.queryByText("Latest completed games this season.")).not.toBeInTheDocument();
    expect(screen.getByText(/^Coverage/)).toBeInTheDocument();
    expect(screen.getAllByText("2025-26").length).toBeGreaterThan(0);
    expect(screen.queryByText(/2010-11/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Regular Season Finals/)).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Type" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Playoffs" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Play-in" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Regular Season" })).toBeInTheDocument();
    expect(screen.getByText("IND")).toBeInTheDocument();
    expect(screen.getByText("OKC")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Margin" })).toBeInTheDocument();
    expect(screen.getByText("+17")).toBeInTheDocument();
    expect(screen.getByText("+4")).toBeInTheDocument();
    const snapshot = screen.getByText("56–26").closest("li");
    expect(snapshot).toHaveTextContent("1");
    expect(snapshot).toHaveTextContent("BOS");
    expect(snapshot?.querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.nba.com/logos/nba/1610612738/primary/L/logo.svg"
    );
    expect(screen.queryByText(/Official ranks aren't available yet/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Conference rank and Regular Season W–L are from game results/)
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Official ranks were not ingested/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Standings: rank, W–L, win %, GB, streak, last-10, as-of date.")
    ).toBeInTheDocument();
    expect(screen.queryByText("No standings yet")).not.toBeInTheDocument();
    expect(screen.queryByText(/Official standings were not ingested/)).not.toBeInTheDocument();
  });

  it("labels coverage with the current season before it has any games", async () => {
    searchParams = "";
    seasons = ["2026-27", "2025-26"];
    listGames.mockResolvedValue({ data: [], meta: { total: 0, limit: 10, offset: 0 } });
    try {
      render(
        <Providers>
          <HomePage />
        </Providers>
      );
      await waitFor(() => {
        expect(screen.getByText("No games yet for this season.")).toBeInTheDocument();
      });
      expect(screen.getByText(/^Coverage/).nextElementSibling).toHaveTextContent("2026-27");
    } finally {
      searchParams = "season=2025-26";
      seasons = ["2025-26"];
    }
  });
});
