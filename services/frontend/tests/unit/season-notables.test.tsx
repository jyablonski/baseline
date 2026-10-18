import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  search: "",
  replace: vi.fn(),
}));
const listBiggestCollapses = vi.hoisted(() => vi.fn());
const listUpsets = vi.hoisted(() => vi.fn());
const listClosestGames = vi.hoisted(() => vi.fn());
const listLargestMargins = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/games",
  useRouter: () => ({ push: vi.fn(), replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("@/lib/api", () => ({
  api: {
    // The newest finished game decides the season, not the schedule.
    listGameDates: async () => ({
      data: [
        { game_date: "2026-11-02", season: "2026-27", game_count: 1 },
        { game_date: "2026-06-13", season: "2025-26", game_count: 1 },
      ],
      meta: { total: 2, limit: 2, offset: 0 },
    }),
    listGames: async () => ({ data: [], meta: { total: 0, limit: 20, offset: 0 } }),
    listTeams: async () => ({
      data: [
        { team_id: "t-sac", abbreviation: "SAC" },
        { team_id: "t-lal", abbreviation: "LAL" },
      ],
      meta: { total: 2, limit: 30, offset: 0 },
    }),
    listBiggestCollapses: (...args: unknown[]) => listBiggestCollapses(...args),
    listUpsets: (...args: unknown[]) => listUpsets(...args),
    listClosestGames: (...args: unknown[]) => listClosestGames(...args),
    listLargestMargins: (...args: unknown[]) => listLargestMargins(...args),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import GamesPage from "@/app/games/page";
import { Providers } from "@/components/providers";

const COLLAPSE = {
  game_id: "g-collapse",
  season: "2025-26",
  game_date: "2026-02-26",
  home_team_abbreviation: "LAL",
  home_score: 120,
  away_team_abbreviation: "SAC",
  away_score: 123,
  largest_lead_blown: 26,
  blown_lead_team_abbreviation: "LAL",
  comeback_team_abbreviation: "SAC",
  blown_lead_period: 2,
};

function page<T>(data: T[]) {
  return { data, meta: { total: data.length, limit: 10, offset: 0 } };
}

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
  listBiggestCollapses.mockReset();
  listUpsets.mockReset();
  listClosestGames.mockReset();
  listBiggestCollapses.mockResolvedValue(page([COLLAPSE]));
  listUpsets.mockResolvedValue(page([]));
  listClosestGames.mockResolvedValue(page([]));
  listLargestMargins.mockReset();
  listLargestMargins.mockResolvedValue(page([]));
});

describe("season notables", () => {
  it("opens on comebacks for the current season, each row linked to its game", async () => {
    renderPage();
    const row = await screen.findByTestId("notable-row");
    expect(listBiggestCollapses).toHaveBeenCalledWith({
      season: "2026-27",
      team: undefined,
      limit: 11,
      offset: 0,
    });
    expect(within(row).getByRole("link", { name: "SAC beat LAL, 123–120" })).toHaveAttribute(
      "href",
      "/games/g-collapse"
    );
    expect(within(row).getByText("trailed by 26 in Q2")).toBeInTheDocument();
    expect(within(row).getByText("26 pts")).toBeInTheDocument();
    expect(within(row).getByText("Won by 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Comebacks" })).toHaveAttribute("aria-current", "page");
    // A short page has no more to show.
    expect(
      screen.queryByRole("navigation", { name: "Notable games pages" })
    ).not.toBeInTheDocument();
  });

  it("links each tab, keeps the team, and always shows the newest season", async () => {
    navigation.search = "team=SAC&season=2025-26";
    renderPage();
    await screen.findByTestId("notable-row");
    expect(screen.getByRole("link", { name: "Upsets" })).toHaveAttribute(
      "href",
      "/games?team=SAC&season=2025-26&tab=upsets"
    );
    // A stale ?season= from Upcoming is ignored: older seasons have no notables.
    expect(screen.queryByLabelText("Season")).not.toBeInTheDocument();
    expect(listBiggestCollapses).toHaveBeenCalledWith({
      season: "2026-27",
      team: "SAC",
      limit: 11,
      offset: 0,
    });
    expect(screen.getByText("Came back")).toBeInTheDocument();
  });

  it("filters by team through the URL", async () => {
    renderPage();
    await screen.findByTestId("notable-row");
    await waitFor(() => expect(screen.getByRole("option", { name: "LAL" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Team"), { target: { value: "LAL" } });
    expect(navigation.replace).toHaveBeenCalledWith("/games?team=LAL", {
      scroll: false,
    });
  });

  it("pages ten at a time, ranking on from the page before", async () => {
    // Eleven rows means a next page; the eleventh is never shown.
    const first = Array.from({ length: 11 }, (_, index) => ({
      ...COLLAPSE,
      game_id: `g-${index}`,
    }));
    listBiggestCollapses.mockImplementation(async ({ offset }: { offset: number }) =>
      offset === 0 ? page(first) : page([{ ...COLLAPSE, game_id: "g-last" }])
    );
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId("notable-row")).toHaveLength(10));
    expect(screen.getByRole("button", { name: "← Prev" })).toBeDisabled();
    expect(screen.getByText("Page 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    await waitFor(() => expect(screen.getAllByTestId("notable-row")).toHaveLength(1));
    expect(listBiggestCollapses).toHaveBeenLastCalledWith({
      season: "2026-27",
      team: undefined,
      limit: 11,
      offset: 10,
    });
    expect(within(screen.getByTestId("notable-row")).getByText("11")).toBeInTheDocument();
    expect(screen.getByText("Page 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next →" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "← Prev" }));
    await waitFor(() => expect(screen.getAllByTestId("notable-row")).toHaveLength(10));
  });

  it("shows upsets with the odds in words", async () => {
    navigation.search = "tab=upsets";
    listUpsets.mockResolvedValue(
      page([
        {
          game_id: "g-upset",
          season: "2026-27",
          game_date: "2026-11-02",
          home_team_id: "t-den",
          home_team_abbreviation: "DEN",
          away_team_id: "t-was",
          away_team_abbreviation: "WAS",
          home_score: 112,
          away_score: 118,
          winner_location: "away",
          winner_market_wp: 0.08,
          upset_magnitude: 2.5,
          winner_fair_moneyline: 1100,
          model_called_upset: true,
        },
      ])
    );
    renderPage();
    const row = await screen.findByTestId("notable-row");
    expect(within(row).getByText("8%")).toBeInTheDocument();
    expect(within(row).getByText("1 in 13")).toBeInTheDocument();
    expect(within(row).getByText("+1100")).toBeInTheDocument();
    expect(within(row).getByText("Model called it")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Market win %" })).toBeInTheDocument();
  });

  it("ranks the largest margins with the final score in its own column", async () => {
    navigation.search = "tab=margins";
    listLargestMargins.mockResolvedValue(
      page([
        {
          game_id: "g-margin",
          game_date: "2025-12-12",
          home_team_abbreviation: "OKC",
          home_score: 141,
          away_team_abbreviation: "POR",
          away_score: 94,
          winning_team_abbreviation: "OKC",
          final_margin: 47,
          is_wire_to_wire: true,
        },
      ])
    );
    renderPage();
    const row = await screen.findByTestId("notable-row");
    expect(within(row).getByRole("link", { name: "OKC beat POR" })).toBeInTheDocument();
    expect(within(row).getAllByText("never trailed")[0]).toBeInTheDocument();
    expect(within(row).getByText("47 pts")).toBeInTheDocument();
    expect(within(row).getByText("141–94")).toBeInTheDocument();
    expect(listLargestMargins).toHaveBeenCalledWith({
      season: "2026-27",
      team: undefined,
      limit: 11,
      offset: 0,
    });
  });

  it("says plainly when a tab has nothing yet", async () => {
    navigation.search = "tab=upsets";
    renderPage();
    expect(
      await screen.findByText(
        "No upsets yet this season. An upset needs a final result and a pregame line."
      )
    ).toBeInTheDocument();
    expect(listUpsets).toHaveBeenCalledWith({
      season: "2026-27",
      team: undefined,
      limit: 11,
      offset: 0,
    });
  });

  it("names the team when its filter leaves nothing", async () => {
    navigation.search = "tab=closest&team=lal";
    renderPage();
    expect(await screen.findByText("No closest games involving LAL yet.")).toBeInTheDocument();
    expect(listClosestGames).toHaveBeenCalledWith({
      season: "2026-27",
      team: "LAL",
      limit: 11,
      offset: 0,
    });
  });

  it("shows an error from the list", async () => {
    listBiggestCollapses.mockRejectedValue(new Error("Cube is down"));
    renderPage();
    // The client retries once before giving up.
    expect(await screen.findByText("Cube is down", {}, { timeout: 3000 })).toBeInTheDocument();
  });
});
