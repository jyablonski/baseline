import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { trendFixture } from "./player-trend-fixture";

const getPlayerGameLog = vi.fn();
const getPlayerTrend = vi.fn();
const listTransactions = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/players/stephen-curry",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("season=2025-26"),
  useParams: () => ({ slug: "stephen-curry" }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    listTransactions: (...args: unknown[]) => listTransactions(...args),
    findPlayerBySlug: async () => ({
      player_id: "player-1",
      full_name: "Stephen Curry",
      position: "PG",
      team_abbreviation: "GSW",
      is_active: true,
    }),
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
      injury_status: "Day To Day",
      injury_detail: "Ankle",
      injury_description: "Day To Day (Ankle) - Sprained his left ankle on Monday.",
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
    getPlayerTrend: (...args: unknown[]) => getPlayerTrend(...args),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import PlayerProfilePage from "@/app/players/[slug]/page";
import { Providers } from "@/components/providers";

beforeEach(() => {
  getPlayerTrend.mockReset();
  getPlayerTrend.mockResolvedValue(null);
});

describe("player profile", () => {
  it("uses full identity metadata, recent points, and PBP log links", async () => {
    listTransactions.mockResolvedValue({ data: [], meta: { total: 0, limit: 10, offset: 0 } });
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
    const injury = screen.getByTestId("player-injury");
    expect(injury).toHaveTextContent("Day To Day · Ankle");
    expect(injury).toHaveTextContent("Sprained his left ankle on Monday.");
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
    expect(screen.queryByText("Points per game by season")).not.toBeInTheDocument();
    expect(screen.getByText("2025-26 MVP rank")).toBeInTheDocument();
    expect(screen.getByText("#7")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "MVP" })).toBeInTheDocument();
    expect(screen.getByText("12.4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PBP" })).toHaveAttribute(
      "href",
      "/games/game-1?season=2025-26"
    );
    // No transactions on file: the section is left out entirely.
    expect(listTransactions).toHaveBeenCalledWith({ player_id: "player-1", limit: 10, offset: 0 });
    expect(screen.queryByRole("heading", { name: "Transactions" })).not.toBeInTheDocument();
    // Too few games for a trend: the API says null and the section is not drawn.
    expect(getPlayerTrend).toHaveBeenCalledWith("player-1");
    expect(screen.queryByTestId("player-trend")).not.toBeInTheDocument();
  });

  it("shows form against the earlier games once there are enough", async () => {
    listTransactions.mockResolvedValue({ data: [], meta: { total: 0, limit: 10, offset: 0 } });
    getPlayerGameLog.mockResolvedValue({ data: [], meta: { total: 0, limit: 10, offset: 0 } });
    getPlayerTrend.mockResolvedValue(trendFixture());
    render(
      <Providers>
        <PlayerProfilePage />
      </Providers>
    );
    const section = await screen.findByTestId("player-trend");
    expect(within(section).getByRole("heading", { name: "Form" })).toBeInTheDocument();
    expect(section).toHaveTextContent("▲ Trending up");
    expect(section).toHaveTextContent(
      "Last 10 games: 31.2 points a game, against 26.0 in the 20 games before."
    );

    // MVP game score, then the box stats that beat their usual swings.
    const tiles = within(section).getAllByTestId("trend-tile");
    expect(tiles.map((tile) => tile.querySelector("p")?.textContent)).toEqual([
      "MVP game score",
      "Points",
      "Turnovers",
      "Rebounds",
    ]);
    expect(tiles[0]).toHaveTextContent("28.1▲ +5.5prior 20: 22.6");
    // Fewer turnovers is good: green, and the arrow follows the number down.
    const turnovers = within(tiles[2]).getByText("▼ -1.0", { exact: false });
    expect(turnovers).toHaveAttribute("data-tone", "better");
    expect(tiles[3]).toHaveTextContent("4.6steady");
    expect(tiles[0].querySelector("[data-slot=sparkline]")).not.toBeNull();

    expect(section).toHaveTextContent("All stats5 of 12 changed");
    const rows = within(section).getAllByRole("row").slice(1);
    const cells = (label: string) =>
      within(rows.find((row) => row.textContent?.startsWith(label))!).getAllByRole("cell");
    expect(cells("TS%")[1]).toHaveTextContent("64.1%");
    // Moved, but within the usual swings.
    expect(cells("TS%")[3]).toHaveTextContent("steady");
    // Minutes beat the swings: the number shows, without a judgement.
    expect(within(cells("MIN")[3]).getByText("▲ +3.1")).toHaveAttribute("data-tone", "neutral");
  });

  it("shows the player's transactions once there are any", async () => {
    getPlayerGameLog.mockResolvedValue({ data: [], meta: { total: 0, limit: 10, offset: 0 } });
    listTransactions.mockResolvedValue({
      data: [
        {
          transaction_key: "tx-1",
          transaction_date: "2025-07-06",
          season: "2025-26",
          description: "The Golden State Warriors signed Stephen Curry to a contract extension.",
          team_count: 1,
          player_count: 1,
          source_url: "https://www.basketball-reference.com/leagues/NBA_2026_transactions.html",
          team_names: ["Golden State Warriors"],
          team_abbreviations: ["GSW"],
          player_names: ["Stephen Curry"],
          linked_player_names: ["Stephen Curry"],
        },
      ],
      meta: { total: 1, limit: 10, offset: 0 },
    });
    render(
      <Providers>
        <PlayerProfilePage />
      </Providers>
    );
    expect(await screen.findByRole("heading", { name: "Transactions" })).toBeInTheDocument();
    expect(
      screen.getByText("The Golden State Warriors signed Stephen Curry to a contract extension.")
    ).toBeInTheDocument();
  });
});
