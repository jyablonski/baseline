import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
const listGames = vi.hoisted(() => vi.fn());
const listGameDates = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/games",
  useRouter: () => ({ push: vi.fn(), replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("@/lib/api", () => ({
  api: {
    listGameDates: (...args: unknown[]) => listGameDates(...args),
    listGames: (...args: unknown[]) => listGames(...args),
    listTeams: async () => ({ data: [], meta: { total: 0, limit: 30, offset: 0 } }),
    listBiggestCollapses: async () => ({ data: [], meta: { total: 0, limit: 10, offset: 0 } }),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import GamesPage from "@/app/games/page";
import { Providers } from "@/components/providers";

const DATES = [
  { game_date: "2026-06-13", season: "2025-26", game_count: 1 },
  { game_date: "2026-06-10", season: "2025-26", game_count: 1 },
  { game_date: "2026-06-08", season: "2025-26", game_count: 1 },
];

const FINALS_GAME = {
  game_id: "g-finals-5",
  season: "2025-26",
  season_type: "Playoffs",
  game_date: "2026-06-13",
  home_team_id: "t-sas",
  away_team_id: "t-nyk",
  home_team_abbreviation: "SAS",
  away_team_abbreviation: "NYK",
  home_score: 90,
  away_score: 94,
  score_margin: 4,
  home_team_conference: "West",
  away_team_conference: "East",
  series_game_number: 5,
  lead_highlight: "Knicks win the NBA Finals",
};

function renderPage() {
  return render(
    <Providers>
      <GamesPage />
    </Providers>
  );
}

beforeEach(() => {
  navigation.search = "";
  navigation.replace.mockReset();
  listGameDates.mockReset();
  listGameDates.mockResolvedValue({ data: DATES, meta: { total: 3, limit: 3, offset: 0 } });
  listGames.mockReset();
  listGames.mockResolvedValue({ data: [FINALS_GAME], meta: { total: 1, limit: 20, offset: 0 } });
});

describe("games index", () => {
  it("opens on the latest day, winner first, each game linked to its page", async () => {
    renderPage();
    const row = await screen.findByTestId("result-row");
    expect(listGames).toHaveBeenCalledWith({ game_date: "2026-06-13", limit: 20 });
    expect(screen.getByRole("heading", { name: "Latest · Saturday, June 13" })).toBeInTheDocument();
    expect(screen.getByText("Finals · Game 5 · 1 game")).toBeInTheDocument();
    const link = within(row).getByRole("link", { name: "NYK 94, SAS 90" });
    expect(link).toHaveAttribute("href", "/games/g-finals-5");
    expect(within(row).queryByText("NYK by 4")).not.toBeInTheDocument();
    expect(within(row).getByText("Knicks win the NBA Finals")).toBeInTheDocument();
    expect(within(row).queryByText("Upset")).not.toBeInTheDocument();
    expect(within(row).queryByText("Comeback")).not.toBeInTheDocument();
    // Upcoming games live on the schedule; notables sit below the results.
    expect(screen.getByRole("link", { name: "schedule" })).toHaveAttribute("href", "/schedule");
    expect(screen.getByRole("heading", { name: "Season notables" })).toBeInTheDocument();
    // Nothing newer than the latest day.
    expect(screen.getByRole("button", { name: "Later game day" })).toBeDisabled();
  });

  it("tags a steep upset and a comeback, but not a near coin flip", async () => {
    listGames.mockResolvedValue({
      data: [
        { ...FINALS_GAME, winner_market_wp: 0.3, largest_lead_blown: 14 },
        { ...FINALS_GAME, game_id: "g-close", winner_market_wp: 0.46, largest_lead_blown: 9 },
      ],
      meta: { total: 2, limit: 20, offset: 0 },
    });
    renderPage();
    await screen.findAllByTestId("result-row");
    const [tagged, close] = screen.getAllByTestId("result-row");
    expect(within(tagged).getByText("Upset")).toBeInTheDocument();
    expect(within(tagged).getByText("Comeback")).toHaveAttribute(
      "title",
      "NYK came back from 14 down"
    );
    expect(within(close).queryByText("Upset")).not.toBeInTheDocument();
    expect(within(close).queryByText("Comeback")).not.toBeInTheDocument();
  });

  it("steps back a game day through the URL, and forward to latest without a date", async () => {
    renderPage();
    await screen.findByTestId("result-row");
    fireEvent.click(screen.getByRole("button", { name: "Earlier game day" }));
    expect(navigation.replace).toHaveBeenLastCalledWith("/games?date=2026-06-10", {
      scroll: false,
    });

    navigation.search = "date=2026-06-10&tab=upsets";
    navigation.replace.mockReset();
    renderPage();
    expect(await screen.findByRole("heading", { name: "Wednesday, June 10" })).toBeInTheDocument();
    expect(listGames).toHaveBeenCalledWith({ game_date: "2026-06-10", limit: 20 });
    const [later] = screen.getAllByRole("button", { name: "Later game day" }).slice(-1);
    fireEvent.click(later);
    // Back on the latest day the date drops out; the notables tab stays.
    expect(navigation.replace).toHaveBeenLastCalledWith("/games?tab=upsets", { scroll: false });
  });

  it("picks a game day from the month grid", async () => {
    renderPage();
    await screen.findByTestId("result-row");
    fireEvent.click(screen.getByRole("button", { name: /Pick a game day/ }));
    expect(await screen.findByText("June 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tue, Jun 9, no games" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sat, Jun 13" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "Mon, Jun 8" }));
    expect(navigation.replace).toHaveBeenLastCalledWith("/games?date=2026-06-08", {
      scroll: false,
    });
  });

  it("moves the month grid within the months that have games", async () => {
    listGameDates.mockResolvedValue({
      data: [...DATES, { game_date: "2026-05-30", season: "2025-26", game_count: 2 }],
      meta: { total: 4, limit: 4, offset: 0 },
    });
    navigation.search = "date=2026-06-08";
    renderPage();
    await screen.findByTestId("result-row");
    fireEvent.click(screen.getByRole("button", { name: /Pick a game day/ }));
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(await screen.findByText("May 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous month" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Latest" }));
    expect(navigation.replace).toHaveBeenLastCalledWith("/games", { scroll: false });
  });

  it("says so when a requested date had no games", async () => {
    navigation.search = "date=2026-06-09";
    listGames.mockResolvedValue({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
    renderPage();
    expect(await screen.findByText("No games were played on this date.")).toBeInTheDocument();
  });

  it("explains an empty warehouse", async () => {
    listGameDates.mockResolvedValue({ data: [], meta: { total: 0, limit: 0, offset: 0 } });
    renderPage();
    expect(await screen.findByText("No completed games to show yet.")).toBeInTheDocument();
  });

  it("shows an error loading the dates", async () => {
    listGameDates.mockRejectedValue(new Error("API down"));
    renderPage();
    expect(await screen.findByText("API down", {}, { timeout: 3000 })).toBeInTheDocument();
  });
});
