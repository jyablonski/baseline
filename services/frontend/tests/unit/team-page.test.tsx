import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamStatSplit } from "@/lib/types";

const replace = vi.fn();
let teamOverrides: Record<string, unknown> = {};
let search = "";

vi.mock("next/navigation", () => ({
  usePathname: () => "/teams/denver-nuggets",
  useRouter: () => ({ push: vi.fn(), replace }),
  useSearchParams: () => new URLSearchParams(search),
  useParams: () => ({ slug: "denver-nuggets" }),
}));

const statSplit = (overrides: Partial<TeamStatSplit>): TeamStatSplit => ({
  season: "2025-26",
  split: "season",
  games: 82,
  wins: 54,
  losses: 28,
  games_with_possessions: 82,
  team_count: 30,
  offensive_rating: 118.4,
  offensive_rating_rank: 6,
  defensive_rating: 108.6,
  defensive_rating_rank: 2,
  net_rating: 9.8,
  net_rating_rank: 3,
  pace: 97.2,
  pace_rank: 24,
  points_per_game: 115.1,
  points_per_game_rank: 8,
  opponent_points_per_game: 105.6,
  opponent_points_per_game_rank: 2,
  effective_fg_pct: 0.551,
  effective_fg_pct_rank: 11,
  opponent_effective_fg_pct: 0.52,
  opponent_effective_fg_pct_rank: 4,
  three_pointers_made_per_game: 12.4,
  three_pointers_made_per_game_rank: 19,
  three_point_pct: 0.362,
  three_point_pct_rank: 14,
  three_point_attempt_rate: 0.39,
  three_point_attempt_rate_rank: 20,
  free_throw_rate: 0.284,
  free_throw_rate_rank: 5,
  offensive_rebound_pct: 0.348,
  offensive_rebound_pct_rank: 1,
  defensive_rebound_pct: 0.72,
  defensive_rebound_pct_rank: 9,
  turnover_pct: 0.139,
  turnover_pct_rank: 17,
  opponent_turnover_pct: 0.162,
  opponent_turnover_pct_rank: 4,
  assist_rate: 0.583,
  assist_rate_rank: 22,
  ...overrides,
});

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
      ...teamOverrides,
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
    listInjuries: async () => ({
      data: [
        {
          player_id: "p-murray",
          player_name: "Jamal Murray",
          team_id: 1610612743,
          team_abbreviation: "DEN",
          injury_status: "Out",
          injury_detail: "Hamstring",
          description: "Out (Hamstring) - Murray will miss at least a week.",
          update_date: "2026-04-08",
          is_notable: true,
        },
      ],
      meta: { total: 1, limit: 1, offset: 0 },
    }),
    listTransactions: async () => ({
      data: [
        {
          transaction_key: "tx-1",
          transaction_date: "2025-07-06",
          season: "2025-26",
          description: "The Denver Nuggets traded a pick to the Minnesota Timberwolves.",
          team_count: 2,
          player_count: 0,
          source_url: "https://www.basketball-reference.com/leagues/NBA_2026_transactions.html",
          team_names: ["Denver Nuggets", "Minnesota Timberwolves"],
          team_abbreviations: ["DEN", "MIN"],
          player_names: [],
          linked_player_names: [],
        },
      ],
      meta: { total: 1, limit: 10, offset: 0 },
    }),
    getTeamStats: vi.fn(async () => ({
      data: [
        statSplit({}),
        statSplit({
          split: "home",
          games: 41,
          games_with_possessions: 40,
          net_rating: 12.1,
          net_rating_rank: 1,
        }),
      ],
      meta: { total: 2, limit: 2, offset: 0 },
    })),
    getTeamRoster: vi.fn(async () => ({
      data: [
        {
          player_id: "p-jokic",
          full_name: "Nikola Jokić",
          position: "C",
          jersey_number: "15",
          season: "2025-26",
          games_played: 70,
          minutes: 36.2,
          points: 29.6,
          rebounds: 12.7,
          assists: 10.2,
          steals: 1.4,
          blocks: 0.7,
          turnovers: 3.1,
          three_pointers_made: 1.9,
          true_shooting_pct: 0.664,
          plus_minus: 8.4,
          game_score: 27.3,
          mvp_score: 26.1,
          mvp_rank: 1,
        },
        {
          player_id: "p-murray",
          full_name: "Jamal Murray",
          position: "G",
          jersey_number: "27",
          season: "2025-26",
          games_played: 60,
          minutes: 34.0,
          points: 21.2,
          rebounds: 4.0,
          assists: 6.3,
          steals: 1.0,
          blocks: 0.4,
          turnovers: 2.2,
          three_pointers_made: 2.7,
          true_shooting_pct: 0.583,
          plus_minus: -1.5,
          game_score: 16.0,
          mvp_score: 13.4,
          mvp_rank: 41,
        },
        {
          player_id: "p-new",
          full_name: "New Signing",
          position: null,
          jersey_number: null,
          season: "2025-26",
          games_played: 0,
          minutes: null,
          points: null,
          rebounds: null,
          assists: null,
          steals: null,
          blocks: null,
          turnovers: null,
          three_pointers_made: null,
          true_shooting_pct: null,
          plus_minus: null,
          game_score: null,
          mvp_score: null,
          mvp_rank: null,
        },
      ],
      meta: { total: 3, limit: 3, offset: 0 },
    })),
    getTeamRecord: async () => ({ wins: 56, losses: 32, win_pct: 0.636, games: 88 }),
    getTeamSeasonGames: async () => ({
      data: [
        {
          game_id: "g-march",
          season: "2025-26",
          game_date: "2026-03-30",
          status: "Final",
          is_home: true,
          opponent_team_id: 1610612750,
          opponent_abbreviation: "MIN",
          team_score: 120,
          opponent_score: 101,
          result: "W",
          is_back_to_back: false,
        },
        {
          game_id: "g-april-loss",
          season: "2025-26",
          game_date: "2026-04-10",
          status: "Final",
          is_home: false,
          opponent_team_id: 1610612750,
          opponent_abbreviation: "MIN",
          team_score: 98,
          opponent_score: 110,
          result: "L",
          is_back_to_back: false,
        },
        {
          game_id: "g-april-next",
          season: "2025-26",
          game_date: "2026-04-11",
          start_time_et: "21:00",
          status: "Scheduled",
          is_home: true,
          opponent_team_id: 1610612750,
          opponent_abbreviation: "MIN",
          result: null,
          win_probability: 0.58,
          is_back_to_back: true,
        },
      ],
      meta: { total: 3, limit: 3, offset: 0 },
    }),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import TeamProfilePage from "@/app/teams/[slug]/page";
import { Providers } from "@/components/providers";
import { api } from "@/lib/api";

beforeEach(() => {
  teamOverrides = {};
  search = "";
  replace.mockClear();
  vi.mocked(api.getTeamStats).mockClear();
  vi.mocked(api.getTeamRoster).mockClear();
  // The season fixtures run through April 2026; the last game is still ahead.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 3, 10, 12) });
});

afterEach(() => {
  vi.useRealTimers();
});

function renderPage(tab?: string) {
  search = tab ? `tab=${tab}` : "";
  return render(
    <Providers>
      <TeamProfilePage />
    </Providers>
  );
}

describe("team profile", () => {
  it("heads every tab with the record, streak and next game", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("team-kpi-streak")).toHaveTextContent("Streak W1");
    });

    expect(screen.getByRole("link", { name: "Teams" })).toHaveAttribute("href", "/teams");
    expect(screen.getByRole("heading", { name: "Denver Nuggets" })).toBeInTheDocument();
    expect(screen.getByText("DEN · West · Ball Arena, Denver")).toBeInTheDocument();
    expect(screen.getByTestId("team-kpi-record")).toHaveTextContent("54–284th in West");
    expect(screen.getByTestId("team-kpi-play-in")).toHaveTextContent("Play-in 1–0");
    expect(screen.getByTestId("team-kpi-playoffs")).toHaveTextContent("Playoffs 2–4");
    const next = await screen.findByTestId("team-kpi-next");
    expect(next).toHaveTextContent("Next vs MIN Sat, Apr 11, 9:00 PM ET");
    expect(within(next).getByRole("link")).toHaveAttribute("href", "/games/g-april-next");

    const tabs = screen.getByRole("navigation", { name: "Team sections" });
    expect(within(tabs).getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(within(tabs).getByRole("link", { name: "Stats" })).toHaveAttribute(
      "href",
      "/teams/denver-nuggets?tab=stats"
    );
    // One player is out, so Roster carries a badge.
    expect(await within(tabs).findByLabelText("1 out")).toHaveTextContent("1");
  });

  it("opens on ratings with ranks, the last games, and the injury report", async () => {
    renderPage();
    const ratings = await screen.findByTestId("team-ratings");
    await waitFor(() => expect(ratings).toHaveTextContent("+9.8"));
    expect(ratings).toHaveTextContent("Net rating+9.83rd of 30");
    expect(ratings).toHaveTextContent("Defensive rating108.62nd of 30");
    expect(ratings).toHaveTextContent("Pace97.224th of 30");
    expect(api.getTeamStats).toHaveBeenCalledWith("1610612743");
    expect(api.getTeamRoster).not.toHaveBeenCalled();

    expect(screen.getByRole("heading", { name: "Last 2" })).toBeInTheDocument();
    const recent = screen.getAllByTestId("recent-game");
    // Newest first, the upcoming game left out.
    expect(recent[0]).toHaveTextContent("Fri, Apr 10@ MINL 98–110");
    expect(recent[1]).toHaveAttribute("href", "/games/g-march");
    expect(screen.getByRole("link", { name: "Full schedule →" })).toHaveAttribute(
      "href",
      "/teams/denver-nuggets?tab=schedule"
    );

    const injury = screen.getByTestId("injury-row");
    expect(injury).toHaveTextContent("Jamal Murray");
    expect(injury).toHaveTextContent("Out · Hamstring");
    expect(injury).toHaveTextContent("Updated Apr 8.");
    expect(screen.getByRole("link", { name: "Jamal Murray" })).toHaveAttribute(
      "href",
      "/players/jamal-murray"
    );
  });

  it("lists every team stat with its rank, by split", async () => {
    renderPage("stats");
    const stats = await screen.findByTestId("team-stats");
    expect(screen.getByText("Rank among 30 teams · bar fills toward 1st · 82 games")).toBeVisible();
    const rows = within(stats).getAllByTestId("team-stat-row");
    expect(rows[0]).toHaveTextContent("Net rating+9.83rd");
    expect(within(stats).getByRole("row", { name: /Offensive rebound %/ })).toHaveTextContent(
      "34.8%1st"
    );
    expect(within(stats).getByRole("row", { name: /Free throw rate/ })).toHaveTextContent(
      ".2845th"
    );
    expect(within(stats).getByRole("progressbar", { name: "Net rating rank" })).toHaveAttribute(
      "aria-valuenow",
      "93"
    );

    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(within(stats).getAllByTestId("team-stat-row")[0]).toHaveTextContent("+12.11st");
    // One home game has no rebound split, so the note says what the ratings cover.
    expect(screen.getByText(/cover 40 of 41 games/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Away" }));
    expect(screen.getByText("No games in this split yet.")).toBeInTheDocument();
  });

  it("shows the roster per game with injury status", async () => {
    renderPage("roster");
    const table = await screen.findByTestId("team-roster");
    expect(api.getTeamRoster).toHaveBeenCalledWith("1610612743");
    const [jokic, murray, signing] = within(table).getAllByTestId("roster-row");
    expect(jokic).toHaveTextContent(
      "Nikola JokićC7036.229.612.710.21.40.73.11.966.4%+8.427.326.1 · #1Active"
    );
    expect(murray).toHaveTextContent("-1.5");
    expect(within(murray).getByText("Out · Hamstring")).toHaveClass("text-destructive");
    expect(signing).toHaveTextContent("New Signing—0————————————Active");
    expect(screen.getByText(/Per game with DEN, 2025-26 Regular Season/)).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "TS%" })).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "MVP" })).toBeInTheDocument();
  });

  it("shows the season calendar on the Schedule tab", async () => {
    renderPage("schedule");
    const calendar = await screen.findByTestId("season-calendar");

    expect(within(calendar).getByRole("heading", { name: "April 2026" })).toBeInTheDocument();
    const loss = within(calendar).getByRole("link", { name: /Apr 10, 2026, at MIN, lost 98–110/ });
    expect(loss).toHaveAttribute("href", "/games/g-april-loss");
    const next = within(calendar).getByRole("link", { name: /Apr 11, 2026, vs MIN, 9:00 PM ET/ });
    expect(next).toHaveTextContent("58%");
    expect(next).toHaveTextContent("B2B");

    const previous = within(calendar).getByRole("button", { name: "Previous month" });
    expect(previous).toHaveTextContent("← Mar");
    expect(within(calendar).getByRole("button", { name: "Next month" })).toHaveTextContent("May →");
    fireEvent.click(previous);
    expect(within(calendar).getByRole("heading", { name: "March 2026" })).toBeInTheDocument();
    expect(
      within(calendar).getByRole("link", { name: /Mar 30, 2026, vs MIN, won 120–101/ })
    ).toBeInTheDocument();
    // March holds the first game, so there is nothing earlier to page to.
    expect(within(calendar).getByRole("button", { name: "Previous month" })).toBeDisabled();
  });

  it("shows cap position on the Cap tab", async () => {
    renderPage("cap");
    expect(await screen.findByText("Cap position · 2026-27")).toBeInTheDocument();
    expect(screen.getByText("Over 1st apron · tier 3 of 4")).toBeInTheDocument();
    expect(screen.getByText("Taxpayer mid-level exception")).toBeInTheDocument();
  });

  it("lists transactions on the Moves tab", async () => {
    renderPage("moves");
    const moves = await screen.findByRole("region", { name: "Recent moves" });
    await waitFor(() =>
      expect(moves).toHaveTextContent(
        "The Denver Nuggets traded a pick to the Minnesota Timberwolves."
      )
    );
    expect(moves).toHaveTextContent("Trade");
  });

  it("says how many games the rating tiles cover while they are partial", async () => {
    vi.mocked(api.getTeamStats).mockResolvedValueOnce({
      data: [statSplit({ games: 7, games_with_possessions: 2 })],
      meta: { total: 1, limit: 1, offset: 0 },
    });
    renderPage();
    const ratings = await screen.findByTestId("team-ratings");
    await waitFor(() => expect(ratings).toHaveTextContent("3rd of 30 · 2 of 7 games"));
  });

  it("reads an unknown tab as Overview", async () => {
    renderPage("bogus");
    expect(await screen.findByTestId("team-ratings")).toBeInTheDocument();
  });

  it("hides Play-in and Playoffs for a team not in them before April", async () => {
    vi.setSystemTime(new Date(2026, 9, 17));
    teamOverrides = {
      record_season: "2026-27",
      season_record: { wins: 0, losses: 0, games: 0, win_pct: 0 },
      play_in_record: null,
      playoff_record: null,
    };
    renderPage();
    expect(await screen.findByTestId("team-kpi-record")).toHaveTextContent("0–0");
    expect(screen.getByTestId("team-kpi-record")).not.toHaveTextContent("in West");
    expect(screen.queryByTestId("team-kpi-play-in")).not.toBeInTheDocument();
    expect(screen.queryByTestId("team-kpi-playoffs")).not.toBeInTheDocument();
  });
});
