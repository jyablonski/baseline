import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The day and view live in the URL, so the mock router keeps a real query
// string that `push` and `replace` update and the page re-reads.
const nav = vi.hoisted(() => {
  let search = "";
  const listeners = new Set<() => void>();
  const set = (next: string) => {
    search = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => search,
    set,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    push: vi.fn((url: string) => set(url.split("?")[1] ?? "")),
    replace: vi.fn((url: string) => set(url.split("?")[1] ?? "")),
  };
});

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePathname: () => "/games",
    useRouter: () => ({ push: nav.push, replace: nav.replace }),
    useSearchParams: () =>
      new URLSearchParams(useSyncExternalStore(nav.subscribe, nav.get, nav.get)),
  };
});

const api = vi.hoisted(() => ({
  listGames: vi.fn(),
  listGameDates: vi.fn(),
  listGameDays: vi.fn(),
  listSchedule: vi.fn(),
  listScheduleDates: vi.fn(),
  listBiggestCollapses: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    ...api,
    getGameInjuries: async () => ({ data: [], meta: { total: 0, limit: 0, offset: 0 } }),
    listSeasons: async () => ({
      data: [{ season: "2026-27" }],
      meta: { total: 1, limit: 1, offset: 0 },
    }),
    listTeams: async () => ({ data: [], meta: { total: 0, limit: 30, offset: 0 } }),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import GamesPage from "@/app/games/page";
import { Providers } from "@/components/providers";

function page<T>(data: T[]) {
  return { data, meta: { total: data.length, limit: data.length, offset: 0 } };
}

function final(gameId: string, date: string, overrides: Record<string, unknown> = {}) {
  return {
    game_id: gameId,
    season: "2026-27",
    season_type: "Regular Season",
    game_date: date,
    home_team_id: `h-${gameId}`,
    away_team_id: `a-${gameId}`,
    home_team_abbreviation: "SAS",
    away_team_abbreviation: "NYK",
    home_score: 90,
    away_score: 94,
    lead_highlight: "Knicks hold on in San Antonio",
    ...overrides,
  };
}

// Oct 22 is today on the pinned clock: one game already final, one tipped at
// 11 AM (live at noon), one tonight. Oct 24 has one more; Oct 23 none.
const FINALS: Record<string, unknown[]> = {
  "2026-10-20": [final("g-20", "2026-10-20")],
  "2026-10-21": [
    final("g-21a", "2026-10-21", { winner_market_wp: 0.3, largest_lead_blown: 14 }),
    final("g-21b", "2026-10-21", { winner_market_wp: 0.46, largest_lead_blown: 9 }),
  ],
  "2026-10-22": [
    final("g-22", "2026-10-22", {
      home_team_abbreviation: "DEN",
      away_team_abbreviation: "UTA",
      home_score: 120,
      away_score: 101,
      lead_highlight: "Jokić triple-double",
    }),
  ],
};

const SCHEDULE = [
  {
    game_id: "0022600100",
    season: "2026-27",
    game_date: "2026-10-22",
    start_time_et: "19:30",
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
    injuries_out: 1,
    injuries_listed: 2,
    has_key_injury: true,
    key_players_out: 1,
  },
  {
    game_id: "0022600101",
    season: "2026-27",
    game_date: "2026-10-22",
    start_time_et: "11:00",
    status: "Scheduled",
    home_team_id: 1610612738,
    away_team_id: 1610612752,
    home_team_abbreviation: "BOS",
    away_team_abbreviation: "NYK",
    home_team_name: "Boston Celtics",
    away_team_name: "New York Knicks",
    arena: "TD Garden",
    // Played at home last night; that game is not Final yet, so no score.
    away_is_back_to_back: true,
    away_last_night_opponent_abbreviation: "PHI",
    away_last_night_was_home: true,
  },
  {
    game_id: "0022600102",
    season: "2026-27",
    game_date: "2026-10-24",
    start_time_et: "19:00",
    status: "Scheduled",
    home_team_id: 1610612748,
    away_team_id: 1610612749,
    home_team_abbreviation: "MIA",
    away_team_abbreviation: "MIL",
    home_team_name: "Miami Heat",
    away_team_name: "Milwaukee Bucks",
    arena: "Kaseya Center",
  },
];

const DAYS = [
  { date: "2026-10-20", total: 1, final: 1, live: 0, scheduled: 0 },
  { date: "2026-10-21", total: 2, final: 2, live: 0, scheduled: 0 },
  { date: "2026-10-22", total: 3, final: 1, live: 1, scheduled: 1 },
  { date: "2026-10-24", total: 1, final: 0, live: 0, scheduled: 1 },
];

function renderPage() {
  return render(
    <Providers>
      <GamesPage />
    </Providers>
  );
}

function results() {
  return screen.queryAllByTestId("result-row");
}

beforeEach(() => {
  // Noon Eastern on Thursday, Oct 22.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-22T16:00:00Z") });
  nav.set("");
  nav.push.mockClear();
  nav.replace.mockClear();
  api.listGames.mockReset();
  api.listGames.mockImplementation(async ({ game_date }: { game_date: string }) =>
    page(FINALS[game_date] ?? [])
  );
  api.listGameDates.mockReset();
  api.listGameDates.mockResolvedValue(
    page([
      { game_date: "2026-10-22", season: "2026-27", game_count: 1 },
      { game_date: "2026-10-21", season: "2026-27", game_count: 2 },
      { game_date: "2026-10-20", season: "2026-27", game_count: 1 },
    ])
  );
  api.listGameDays.mockReset();
  api.listGameDays.mockImplementation(async ({ from, to }: { from: string; to: string }) =>
    page(DAYS.filter((day) => day.date >= from && day.date <= to))
  );
  api.listSchedule.mockReset();
  api.listSchedule.mockImplementation(async ({ from_date }: { from_date: string }) =>
    page(SCHEDULE.filter((game) => game.game_date >= from_date))
  );
  api.listScheduleDates.mockReset();
  api.listScheduleDates.mockResolvedValue(
    page([
      { game_date: "2026-10-22", season: "2026-27", game_count: 2 },
      { game_date: "2026-10-24", season: "2026-27", game_count: 1 },
    ])
  );
  api.listBiggestCollapses.mockReset();
  api.listBiggestCollapses.mockResolvedValue(page([]));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("games page", () => {
  it("opens on today, with view tabs and a week strip counted in one request", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Games", level: 1 })).toBeInTheDocument();
    const views = screen.getByRole("navigation", { name: "Games views" });
    expect(within(views).getByRole("link", { name: "Schedule & results" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(within(views).getByRole("link", { name: "Season notables" })).toHaveAttribute(
      "href",
      "/games?view=notables"
    );

    expect(
      await screen.findByRole("heading", { name: "Today · Thursday, October 22" })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByTestId("week-day").map((cell) => cell.textContent)).toEqual([
        "Mon 19No games",
        "Tue 201 final",
        "Wed 212 final",
        "Thu 22Today · 3",
        "Fri 23No games",
        "Sat 241 game",
        "Sun 25No games",
      ])
    );
    expect(api.listGameDays).toHaveBeenCalledTimes(1);
    expect(api.listGameDays).toHaveBeenCalledWith({ from: "2026-10-19", to: "2026-10-25" });
    const today = screen.getByRole("button", { name: /Thu 22/ });
    expect(today).toHaveAttribute("aria-current", "date");
    expect(today).toHaveClass("bg-primary");
  });

  it("lists a mixed day as finals, then live, then upcoming", async () => {
    renderPage();
    const [row] = await screen.findAllByTestId("result-row");
    expect(within(row).getByRole("link", { name: "DEN 120, UTA 101" })).toHaveAttribute(
      "href",
      "/games/g-22"
    );
    // The 11 AM game is under way, so it leads the table; tonight's follows.
    const times = screen.getAllByTitle("Game preview").map((link) => link.textContent);
    expect(times).toEqual(["11:00 AM ET", "7:30 PM ET"]);
    const [live] = screen.getAllByTestId("game-status");
    expect(live).toHaveTextContent("Live");
    // Under the time, not a column of its own.
    expect(screen.queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
    // Finals come before the table in the document.
    expect(
      row.compareDocumentPosition(screen.getByTestId("schedule-table")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByText("3 games · ET")).toBeInTheDocument();
    // An upcoming day carries the B2B legend and the schedule's footnote.
    expect(screen.getByText("Played last night")).toBeInTheDocument();
    expect(
      screen.getByText("Win % from Baseline's model; injuries in red include a key player.")
    ).toBeInTheDocument();
  });

  it("shows a past day's results, tagged, with no schedule request", async () => {
    nav.set("date=2026-10-21");
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Last night · Wednesday, October 21" })
    ).toBeInTheDocument();
    await waitFor(() => expect(results()).toHaveLength(2));
    expect(screen.getByText("2 games · final")).toBeInTheDocument();
    const [tagged, close] = results();
    expect(within(tagged).getByText("Upset")).toBeInTheDocument();
    expect(within(tagged).getByText("Comeback")).toHaveAttribute(
      "title",
      "NYK came back from 14 down"
    );
    expect(within(close).queryByText("Upset")).not.toBeInTheDocument();
    expect(api.listGames).toHaveBeenCalledWith({ game_date: "2026-10-21", limit: 20 });
    expect(api.listSchedule).not.toHaveBeenCalled();
    expect(screen.queryByText("Played last night")).not.toBeInTheDocument();
    expect(
      screen.getByText("Tags and notes from play-by-play. Click a game for the box score.")
    ).toBeInTheDocument();
  });

  it("shows a future day's schedule, with no results request", async () => {
    nav.set("date=2026-10-24");
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Saturday, October 24" })
    ).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "MIA" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "GSW" })).not.toBeInTheDocument();
    expect(screen.getByText("1 game · ET")).toBeInTheDocument();
    // Nobody on a back-to-back that day: no legend.
    expect(screen.queryByText("Played last night")).not.toBeInTheDocument();
    expect(api.listGames).not.toHaveBeenCalled();
  });

  it("says so on a day with no games and links to the next one", async () => {
    nav.set("date=2026-10-23");
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Tomorrow · Friday, October 23" })
    ).toBeInTheDocument();
    expect(await screen.findByText("No games on this date.")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Next games: Sat, Oct 24 →" })).toHaveAttribute(
      "href",
      "/games?date=2026-10-24"
    );
  });

  it("pushes each day and week into the URL, keeping other params", async () => {
    nav.set("mine=1");
    renderPage();
    await screen.findByRole("heading", { name: "Today · Thursday, October 22" });

    fireEvent.click(screen.getByRole("button", { name: /Wed 21/ }));
    expect(nav.push).toHaveBeenLastCalledWith("/games?mine=1&date=2026-10-21", {
      scroll: false,
    });
    expect(
      await screen.findByRole("heading", { name: "Last night · Wednesday, October 21" })
    ).toBeInTheDocument();

    // A week on from the 21st; the strip moves with it.
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(nav.push).toHaveBeenLastCalledWith("/games?mine=1&date=2026-10-28", {
      scroll: false,
    });
    await waitFor(() =>
      expect(api.listGameDays).toHaveBeenCalledWith({ from: "2026-10-26", to: "2026-11-01" })
    );

    // Back on today, the date drops out.
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    fireEvent.click(await screen.findByRole("button", { name: /Thu 22/ }));
    expect(nav.push).toHaveBeenLastCalledWith("/games?mine=1", { scroll: false });
  });

  it("picks a game day from the calendar", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Today · Thursday, October 22" });
    fireEvent.click(screen.getByRole("button", { name: /Pick a game day/ }));
    const calendar = await screen.findByRole("dialog", { name: "October 2026" });
    expect(within(calendar).getByRole("button", { name: "Today" })).toBeDisabled();
    await waitFor(() =>
      expect(within(calendar).getByRole("button", { name: "Sat, Oct 24" })).toBeEnabled()
    );
    expect(within(calendar).getByRole("button", { name: "Fri, Oct 23, no games" })).toBeDisabled();
    fireEvent.click(within(calendar).getByRole("button", { name: "Tue, Oct 20" }));
    expect(nav.push).toHaveBeenLastCalledWith("/games?date=2026-10-20", { scroll: false });
  });

  it("lists upcoming games with matchup, injuries, B2B badges and game links", async () => {
    nav.set("date=2026-10-22");
    renderPage();
    expect(await screen.findByRole("link", { name: "LAL" })).toBeInTheDocument();
    expect(screen.getAllByText("@")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "GSW" })).toHaveAttribute(
      "href",
      "/teams/golden-state-warriors?season=2026-27"
    );
    // A key player fills the cell; the other game has a dash.
    expect(screen.getAllByTestId("game-injuries").map((cell) => cell.textContent)).toEqual([
      "—",
      "3 listed▾",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Injuries" }));
    expect(await screen.findByRole("dialog", { name: "Injuries" })).toHaveTextContent(
      "Red: one of them is out."
    );
    // NYK played last night: a badge beside its link, not inside it.
    const badge = screen.getByRole("button", { name: "NYK played last night: vs PHI" });
    expect(badge.closest("a")).toBeNull();
    expect(screen.getAllByRole("button", { name: /played last night/ })).toHaveLength(1);
    expect(screen.getAllByTitle("Game preview").map((link) => link.getAttribute("href"))).toEqual([
      "/games/0022600101",
      "/games/0022600100",
    ]);
  });

  it("shows model win % and consensus odds, and dashes games without them", async () => {
    nav.set("date=2026-10-22");
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId("win-probability")).toHaveLength(2));
    const priced = 1;
    expect(screen.getAllByTestId("win-probability")[priced]).toHaveTextContent("38% / 62%");
    expect(screen.getAllByTestId("moneyline")[priced]).toHaveTextContent("+130 / -150");
    expect(screen.getAllByTestId("spread")).toHaveLength(1);
    expect(screen.getAllByTestId("spread")[0]).toHaveTextContent("GSW -3.5");
    expect(screen.getAllByTestId("national-tv")[priced]).toHaveTextContent("ESPN, ABC");
    expect(screen.getAllByTestId("national-tv")[0]).toHaveTextContent("—");
    expect(screen.getAllByTestId("win-probability")[0]).toHaveTextContent("—");
    fireEvent.click(screen.getByRole("button", { name: "Win %" }));
    const help = await screen.findByRole("dialog", { name: "Win %" });
    expect(help).toHaveTextContent("pregame model estimate of each team's chance to win");
    expect(
      within(help).getByRole("link", { name: "How accurate is the model? →" })
    ).toHaveAttribute("href", "/predictions");
  });

  it("keeps the last day on screen, dimmed, while the next one loads", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.listSchedule.mockImplementation(async ({ from_date }: { from_date: string }) => {
      if (from_date === "2026-10-24") await gate;
      return page(SCHEDULE.filter((game) => game.game_date >= from_date));
    });
    renderPage();
    expect(await screen.findByRole("link", { name: "GSW" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Sat 24/ }));
    expect(
      await screen.findByRole("heading", { name: "Saturday, October 24" })
    ).toBeInTheDocument();
    // Oct 24 has not arrived: Oct 22's rows stay, dimmed, and no empty state flashes.
    expect(screen.getByRole("link", { name: "GSW" }).closest("[aria-busy]")).toHaveAttribute(
      "aria-busy",
      "true"
    );
    expect(screen.queryByText("No games on this date.")).not.toBeInTheDocument();

    release();
    expect(await screen.findByRole("link", { name: "MIA" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "GSW" })).not.toBeInTheDocument();
  });

  it("keeps a late game on screen past midnight, from the Eastern date three hours ago", async () => {
    // 9 PM EDT on the 22nd: UTC is already the 23rd, but those games are on now.
    vi.setSystemTime(new Date("2026-10-23T01:00:00Z"));
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Today · Thursday, October 22" })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(api.listSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ from_date: "2026-10-22" })
      )
    );
  });

  it("shows an error from the day's results", async () => {
    nav.set("date=2026-10-21");
    api.listGames.mockRejectedValue(new Error("API down"));
    renderPage();
    expect(await screen.findByText("API down", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("switches to the season notables, with no week strip", async () => {
    nav.set("view=notables");
    renderPage();
    expect(await screen.findByRole("region", { name: "Season notables" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Season notables" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.queryByRole("group", { name: "Game days" })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(api.listBiggestCollapses).toHaveBeenCalledWith(
        expect.objectContaining({ season: "2026-27" })
      )
    );
    expect(screen.getByRole("link", { name: "Schedule & results" })).toHaveAttribute(
      "href",
      "/games"
    );
  });
});
