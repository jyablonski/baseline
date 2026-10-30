import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The day on screen lives in the URL, so the mock router keeps a real query
// string that `replace` updates and the page re-reads.
const nav = vi.hoisted(() => {
  let search = "season=2026-27";
  const listeners = new Set<() => void>();
  return {
    get: () => search,
    set: (next: string) => {
      search = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    replace: vi.fn(),
  };
});

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePathname: () => "/schedule",
    useRouter: () => ({
      push: vi.fn(),
      replace: (url: string) => {
        nav.replace(url);
        nav.set(url.split("?")[1] ?? "");
      },
    }),
    useSearchParams: () =>
      new URLSearchParams(useSyncExternalStore(nav.subscribe, nav.get, nav.get)),
  };
});

vi.mock("@/lib/api", () => ({
  api: {
    getGameInjuries: async () => ({ data: [], meta: { total: 0, limit: 0, offset: 0 } }),
    listSeasons: async () => ({
      data: [{ season: "2026-27" }],
      meta: { total: 1, limit: 1, offset: 0 },
    }),
    listScheduleDates: async (params: { from_date?: string } = {}) => {
      const data = [
        { game_date: "2026-10-22", season: "2026-27", game_count: 2 },
        { game_date: "2026-10-24", season: "2026-27", game_count: 1 },
      ].filter((day) => !params.from_date || day.game_date >= params.from_date);
      return { data, meta: { total: data.length, limit: data.length, offset: 0 } };
    },
    listSchedule: async (params: { from_date?: string } = {}) => ({
      data: [
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

function renderPage() {
  render(
    <Providers>
      <SchedulePage />
    </Providers>
  );
}

describe("schedule page", () => {
  // Rows go live and lock by the clock, so the clock is pinned: noon Eastern
  // two days before the fixtures' slate.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-20T16:00:00Z") });
    nav.set("season=2026-27");
    nav.replace.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

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
    expect(screen.getByRole("columnheader", { name: "Injuries" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GSW" })).toHaveAttribute(
      "href",
      "/teams/golden-state-warriors?season=2026-27"
    );
    expect(screen.queryByText("PBP →")).not.toBeInTheDocument();
    // A key player fills the cell; the other game has a dash.
    expect(screen.getAllByTestId("game-injuries").map((cell) => cell.textContent)).toEqual([
      "3 listed▾",
      "—",
    ]);
    expect(screen.getByTestId("injury-field")).toHaveClass("text-destructive");
    fireEvent.click(screen.getByRole("button", { name: "Injuries" }));
    expect(await screen.findByRole("dialog", { name: "Injuries" })).toHaveTextContent(
      "Red: one of them is out."
    );
    // NYK played last night: a badge beside its link, not inside it, and one legend.
    const badge = screen.getByRole("button", { name: "NYK played last night: vs PHI" });
    expect(badge.closest("a")).toBeNull();
    expect(screen.getAllByRole("button", { name: /played last night/ })).toHaveLength(1);
    expect(screen.getByText("Played last night")).toBeInTheDocument();
    // Every away slot makes room for a badge, so the "@" lines up down the table.
    for (const away of ["LAL", "NYK"]) {
      const slot = screen.getByRole("link", { name: away }).parentElement as HTMLElement;
      expect(slot.style.width).toContain("2.25rem");
    }
    // Two games that day, each time cell linking to its own game page. The day
    // header names the date, so the rows do not repeat it.
    expect(
      screen.getAllByTitle("Game preview").map((a) => [a.textContent, a.getAttribute("href")])
    ).toEqual([
      ["7:30 PM ET", "/games/0022600100"],
      ["TBD", "/games/0022600101"],
    ]);
    expect(screen.queryByText("Thu, Oct 22, 2026")).not.toBeInTheDocument();
    // The legend rides on the day's summary line.
    expect(screen.getByText("Played last night").closest("p")).toHaveTextContent(
      "2 games · B2BPlayed last night"
    );
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
    // The spread sits under the moneyline, and only where there is one.
    expect(screen.getAllByTestId("spread")).toHaveLength(1);
    expect(screen.getAllByTestId("spread")[0]).toHaveTextContent("GSW -3.5");
    // Only nationally televised games name a network.
    expect(screen.getByRole("columnheader", { name: "TV" })).toBeInTheDocument();
    expect(screen.getAllByTestId("national-tv")[0]).toHaveTextContent("ESPN, ABC");
    expect(screen.getAllByTestId("national-tv")[1]).toHaveTextContent("—");
    expect(screen.getAllByTestId("win-probability")[1]).toHaveTextContent("—");
    expect(screen.getAllByTestId("moneyline")[1]).toHaveTextContent("—");
    expect(screen.getByRole("heading", { name: "Schedule" }).parentElement).toHaveTextContent(
      "2026-27 schedule from today onward. Finished games are under Past Games."
    );
    expect(screen.getByRole("link", { name: "Past Games" })).toHaveAttribute("href", "/games");
    // What a column means is behind its heading, not spelled out above the table.
    expect(screen.queryByText(/pregame model estimate/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Win %" }));
    const help = await screen.findByRole("dialog", { name: "Win %" });
    expect(help).toHaveTextContent("pregame model estimate of each team's chance to win");
    expect(
      within(help).getByRole("link", { name: "How accurate is the model? →" })
    ).toHaveAttribute("href", "/predictions");
    for (const column of ["TV", "Odds"]) {
      expect(screen.getByRole("button", { name: column })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Moneyline" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Odds" }));
    const odds = await screen.findByRole("dialog", { name: "Odds" });
    expect(odds).toHaveTextContent("The consensus moneyline");
    expect(odds).toHaveTextContent("consensus point spread for the home team");
    expect(screen.queryByRole("button", { name: "Spread" })).not.toBeInTheDocument();
  });

  it("shows one day of games at a time and pages by game day in the URL", async () => {
    renderPage();
    // Oct 22 is two days out from the pinned clock: the soonest day, but not today.
    expect(
      await screen.findByRole("heading", { name: "Next up · Thursday, October 22" })
    ).toBeInTheDocument();
    expect(await screen.findByText("2 games")).toBeInTheDocument();
    // The later day is held back until asked for.
    expect(screen.queryByRole("link", { name: "MIA" })).not.toBeInTheDocument();
    const picker = screen.getByRole("group", { name: "Game day" });
    expect(within(picker).getByRole("button", { name: "Earlier game day" })).toBeDisabled();

    // Oct 23 has no games, so the arrow lands on Oct 24, kept in the URL with the season.
    fireEvent.click(within(picker).getByRole("button", { name: "Later game day" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/schedule?season=2026-27&date=2026-10-24");
    expect(
      await screen.findByRole("heading", { name: "Saturday, October 24" })
    ).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "MIA" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "GSW" })).not.toBeInTheDocument();
    expect(screen.getByText("1 game")).toBeInTheDocument();
    // Nobody on a back-to-back that day: no badge, no legend.
    expect(screen.queryByText("Played last night")).not.toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "Later game day" })).toBeDisabled();

    // Back to the soonest day drops the date from the URL.
    fireEvent.click(within(picker).getByRole("button", { name: "Earlier game day" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/schedule?season=2026-27");
    expect(
      await screen.findByRole("heading", { name: "Next up · Thursday, October 22" })
    ).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "GSW" })).toBeInTheDocument();
  });

  it("keeps the last day on screen, dimmed, while the next one loads", async () => {
    const { api } = await import("@/lib/api");
    const real = api.listSchedule;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(api, "listSchedule").mockImplementation(async (params = {}) => {
      if (params.from_date === "2026-10-24") await gate;
      return real(params);
    });
    renderPage();
    expect(await screen.findByRole("link", { name: "GSW" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Later game day" }));
    expect(
      await screen.findByRole("heading", { name: "Saturday, October 24" })
    ).toBeInTheDocument();
    // Oct 24 has not arrived: Oct 22's rows stay, dimmed, and no empty state flashes.
    expect(screen.getByRole("link", { name: "GSW" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GSW" }).closest("[aria-busy]")).toHaveAttribute(
      "aria-busy",
      "true"
    );
    expect(screen.queryByText("No games are scheduled for this date.")).not.toBeInTheDocument();

    release();
    expect(await screen.findByRole("link", { name: "MIA" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "GSW" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "MIA" }).closest("[aria-busy]")).toHaveAttribute(
      "aria-busy",
      "false"
    );
  });

  it("opens on the day in the URL, and says so when that day has no games", async () => {
    nav.set("season=2026-27&date=2026-10-23");
    renderPage();
    expect(await screen.findByText("No games are scheduled for this date.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Friday, October 23" })).toBeInTheDocument();
    const picker = screen.getByRole("group", { name: "Game day" });
    expect(within(picker).getByRole("button", { name: "Earlier game day" })).toBeEnabled();
    expect(within(picker).getByRole("button", { name: "Later game day" })).toBeEnabled();
  });

  it("calls the soonest day Today once its games are the ones being played", async () => {
    vi.setSystemTime(new Date("2026-10-22T16:00:00Z"));
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Today · Thursday, October 22" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Pick a game day/ }));
    const calendar = await screen.findByRole("dialog", { name: "October 2026" });
    expect(within(calendar).getByRole("button", { name: "Today" })).toBeDisabled();
    expect(within(calendar).getByRole("button", { name: "Fri, Oct 23, no games" })).toBeDisabled();
    fireEvent.click(within(calendar).getByRole("button", { name: "Sat, Oct 24" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/schedule?season=2026-27&date=2026-10-24");
  });

  it("calls a game live for three hours from tip, by the clock alone", async () => {
    // 7:45 PM EDT on the 22nd: the 7:30 game is on; the one with no tip time
    // locked at the start of the day and is never called live.
    vi.setSystemTime(new Date("2026-10-22T23:45:00Z"));
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByTestId("game-status")).toHaveLength(2);
    });
    const [live, unknown] = screen.getAllByTestId("game-status");
    expect(live).toHaveTextContent("Live");
    expect(unknown).toHaveTextContent("Awaiting final");
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
  });

  it("asks for games from the Eastern date three hours ago, not the server's", async () => {
    // 9 PM EDT on the 22nd: the server's UTC date is already the 23rd, but
    // that evening's games are on now.
    vi.setSystemTime(new Date("2026-10-23T01:00:00Z"));
    const { api } = await import("@/lib/api");
    const listSchedule = vi.spyOn(api, "listSchedule");
    const listScheduleDates = vi.spyOn(api, "listScheduleDates");
    renderPage();
    await waitFor(() => {
      expect(listScheduleDates).toHaveBeenCalledWith({
        season: "2026-27",
        from_date: "2026-10-22",
      });
      expect(listSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ from_date: "2026-10-22" })
      );
    });
  });
});
