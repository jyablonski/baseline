import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const getPlayerGameLog = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/players/player-1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("season=2025-26"),
  useParams: () => ({ id: "player-1" }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    listSeasons: async () => ({
      data: [{ season: "2025-26" }],
      meta: { total: 1, limit: 1, offset: 0 },
    }),
    getPlayer: async () => ({
      player_id: "player-1",
      full_name: "Stephen Curry",
      first_name: "Stephen",
      last_name: "Curry",
      team_abbreviation: "GSW",
      jersey_number: "30",
      position: "PG",
      height: "6-2",
      weight: 185,
      birth_date: "1988-03-14",
      is_active: true,
      career_games_played: 1000,
      seasons_played: 16,
      career_ppg: 24.6,
      career_rpg: 4.7,
      career_apg: 6.4,
      mvp_season: "2025-26",
      mvp_score: 22.8,
      mvp_rank: 7,
    }),
    getPlayerBackToBacks: async () => ({
      player_id: "player-1",
      player_name: "Stephen Curry",
      total_back_to_backs: 2,
      games_played_in_b2b: 2,
      avg_pts_b2b: 28.6,
      avg_pts_non_b2b: 26.3,
    }),
    getPlayerGameLog: (...args: unknown[]) => getPlayerGameLog(...args),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import PlayerProfilePage from "@/app/players/[id]/page";
import { Providers } from "@/components/providers";

describe("player profile", () => {
  it("uses full identity metadata, recent points, and PBP log links", async () => {
    getPlayerGameLog.mockResolvedValue({
      data: [
        {
          game_id: "game-1",
          game_date: "2026-04-17",
          season: "2025-26",
          opponent_abbreviation: "PHX",
          location: "away",
          result: "L",
          minutes: 36,
          points: 17,
          rebounds: 4,
          assists: 4,
          steals: 2,
          blocks: 0,
          turnovers: 4,
          plus_minus: -13,
          season_type: "Regular Season",
          mvp_game_score: 12.4,
          is_back_to_back: false,
        },
      ],
      meta: { total: 1, limit: 10, offset: 0 },
    });

    render(
      <Providers>
        <PlayerProfilePage />
      </Providers>
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Stephen Curry" })).toBeInTheDocument();
    });
    const identity = screen.getByText("GSW").parentElement;
    expect(identity).toHaveTextContent("GSW");
    expect(identity).toHaveTextContent("#30");
    expect(identity).toHaveTextContent("PG");
    // Height is not shown: rosters have stored it as inches ("74.0") as well as "6-2".
    expect(identity).not.toHaveTextContent("6’2”");
    expect(identity).not.toHaveTextContent("6-2");
    expect(identity).toHaveTextContent("b. 14 Mar 1988");
    expect(identity).toHaveTextContent("Active");
    expect(screen.queryByText("Seasons")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Points in last 10 games" })).toBeInTheDocument();
    expect(screen.queryByText("Points per game by season")).not.toBeInTheDocument();
    expect(screen.getByText("2025-26 MVP rank")).toBeInTheDocument();
    expect(screen.getByText("#7")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "MVP" })).toBeInTheDocument();
    expect(screen.getByText("12.4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PBP" })).toHaveAttribute(
      "href",
      "/games/game-1?season=2025-26"
    );
  });
});
