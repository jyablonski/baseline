import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/teams/denver-nuggets",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ slug: "denver-nuggets" }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    listSeasons: async () => ({
      data: [{ season: "2025-26" }],
      meta: { total: 1, limit: 1, offset: 0 },
    }),
    listTeams: async () => ({
      data: [
        {
          team_id: 1610612743,
          abbreviation: "DEN",
          team_name: "Denver Nuggets",
          conference: "West",
          division: "Northwest",
          city: "Denver",
        },
        {
          team_id: 1610612750,
          abbreviation: "MIN",
          team_name: "Minnesota Timberwolves",
          conference: "West",
          division: "Northwest",
          city: "Minneapolis",
        },
      ],
      meta: { total: 2, limit: 2, offset: 0 },
    }),
    getTeam: async () => ({
      team_id: 1610612743,
      abbreviation: "DEN",
      team_name: "Denver Nuggets",
      conference: "West",
      division: "Northwest",
      city: "Denver",
      nickname: "Nuggets",
      arena_name: "Ball Arena",
      standing: {
        conference: "West",
        conference_rank: 4,
        games_back: 10,
        wins: 54,
        losses: 28,
        last_10: "6-4",
        streak: "W1",
      },
      record_season: "2025-26",
      season_record: { wins: 54, losses: 28, games: 82, win_pct: 0.659 },
      play_in_record: { wins: 1, losses: 0, games: 1, win_pct: 1 },
      playoff_record: { wins: 2, losses: 4, games: 6, win_pct: 0.333 },
      current_season_payroll: 221_300_000,
      current_remaining_guaranteed: 429_100_000,
      current_contract_season: "2026-27",
      salary_cap: 164_961_000,
      luxury_tax: 200_428_000,
      first_apron: 209_015_000,
      second_apron: 221_686_000,
      over_luxury_tax: true,
      over_first_apron: true,
      over_second_apron: false,
    }),
    getTeamGames: async () => ({
      data: [
        {
          game_id: "0042500314",
          season: "2025-26",
          game_date: "2026-04-30",
          location: "home",
          home_team_id: 1610612743,
          away_team_id: 1610612750,
          home_score: 98,
          away_score: 110,
          team_score: 98,
          opponent_score: 110,
          opponent_abbreviation: "MIN",
          arena: "Ball Arena",
          score_margin: 12,
          is_win: false,
          result: "L",
        },
      ],
      meta: { total: 88, limit: 200, offset: 0 },
    }),
    listSchedule: async () => ({
      data: [],
      meta: { total: 0, limit: 10, offset: 0 },
    }),
    getTeamRecord: async () => ({ wins: 56, losses: 32, win_pct: 0.636, games: 88 }),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import TeamProfilePage from "@/app/teams/[slug]/page";
import { Providers } from "@/components/providers";

describe("team profile", () => {
  it("shows header form, cap position, filtered games, and a signed Margin", async () => {
    render(
      <Providers>
        <TeamProfilePage />
      </Providers>
    );
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "MIN" })).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: "Teams" })).toHaveAttribute("href", "/teams");
    expect(screen.getByRole("heading", { name: "Denver Nuggets" })).toBeInTheDocument();
    expect(screen.getByText(/DEN · West · Northwest · Ball Arena, Denver/)).toBeInTheDocument();
    const regularSeason = screen.getByTestId("team-kpi-regular-season");
    expect(regularSeason).toHaveTextContent("2025-26 Regular Season");
    expect(regularSeason.querySelector("dd")).toHaveTextContent("54–28 | 65.9%");
    expect(regularSeason).toHaveTextContent("82 games · 4th in West · 10 GB");
    expect(regularSeason).not.toHaveTextContent("81 games");
    expect(screen.getByTestId("team-kpi-play-in").querySelector("dd")).toHaveTextContent("1–0");
    expect(screen.getByTestId("team-kpi-play-in")).toHaveTextContent("1 GP");
    const playoffs = screen.getByTestId("team-kpi-playoffs");
    expect(playoffs.querySelector("dd")).toHaveTextContent("2–4");
    expect(playoffs).toHaveTextContent("6 GP");
    expect(playoffs.querySelector("dd")).not.toHaveTextContent("GP");
    expect(screen.queryByText(/Lost first round/i)).not.toBeInTheDocument();
    const lastTen = screen.getByTestId("team-kpi-last-10");
    expect(lastTen.querySelector("dt")).toHaveTextContent("Last 10");
    expect(lastTen.querySelector("dd")).toHaveTextContent("6-4");
    expect(lastTen).toHaveTextContent("Streak W1");

    expect(screen.getByText("Cap position · 2026-27")).toBeInTheDocument();
    expect(screen.getByText("Over 1st apron · tier 3 of 4")).toBeInTheDocument();
    expect(screen.getByText("Taxpayer mid-level exception")).toBeInTheDocument();

    expect(screen.queryByLabelText("Season")).not.toBeInTheDocument();
    expect(screen.getByText("Arena city")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "88 games · 56–32 | 63.6%" })).toBeInTheDocument();
    expect(screen.getByText("Margin")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PBP" })).toHaveAttribute(
      "href",
      "/games/0042500314?season=2025-26"
    );
    expect(screen.queryByText("MRG")).not.toBeInTheDocument();
    expect(screen.getByText("-12")).toBeInTheDocument();
    expect(screen.queryByText("+12")).not.toBeInTheDocument();
    expect(screen.getByText("Remaining schedule")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "home" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("button", { name: "all" })).toHaveClass("seg-btn-active");
  });
});
