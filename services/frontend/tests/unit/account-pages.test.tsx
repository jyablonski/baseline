import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The signed-in surfaces: header links, the Games page's pick columns, and the
 * Picks, Chat and Account pages. Session and flags are mocked at the hook, and
 * the server actions at the module, so each state a visitor can be in renders.
 */
const state = vi.hoisted(() => ({
  account: null as {
    name: string | null;
    image?: string | null;
    hasAccount: boolean;
    isAdmin?: boolean;
  } | null,
  flags: { chatbot: true, picks: true, isLoading: false },
  pathname: "/games",
  search: "date=2026-10-22",
  replace: vi.fn(),
  // Finals for a past day on /games; none unless a test sets them.
  finals: [] as Record<string, unknown>[],
  // Days with a Final game, for the picks calendar.
  gameDates: [] as string[],
}));
const actions = vi.hoisted(() => ({
  getProfileAction: vi.fn(),
  setTimezoneAction: vi.fn(),
  setTeamFollowAction: vi.fn(),
  setFollowOrderAction: vi.fn(),
  getPickSheetAction: vi.fn(),
  savePickAction: vi.fn(),
  removePickAction: vi.fn(),
  chatAction: vi.fn(),
  deleteAccountAction: vi.fn(),
  signOutAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn(), replace: state.replace }),
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@/lib/account", () => ({
  useAccount: () => ({ account: state.account, isLoading: false }),
  useFeatures: () => state.flags,
}));
vi.mock("@/app/account/actions", () => actions);

const game = {
  game_id: "g-1",
  season: "2026-27",
  game_date: "2026-10-22",
  start_time_et: "19:30:00",
  status: "Scheduled",
  home_team_id: "home",
  away_team_id: "away",
  home_team_abbreviation: "GSW",
  away_team_abbreviation: "LAL",
  home_team_name: "Golden State Warriors",
  away_team_name: "Los Angeles Lakers",
  arena: "Chase Center",
  home_moneyline: -150,
  away_moneyline: 130,
};

vi.mock("@/lib/api", () => ({
  api: {
    getStatus: async () => ({ last_scraped_at: "2026-09-04T04:12:00Z" }),
    listSeasons: async () => ({
      data: [{ season: "2026-27" }],
      meta: { total: 1, limit: 1, offset: 0 },
    }),
    listScheduleDates: async () => ({
      data: [{ game_date: game.game_date, season: "2026-27", game_count: 1 }],
      meta: { total: 1, limit: 1, offset: 0 },
    }),
    listSchedule: async () => ({ data: [game], meta: { total: 1, limit: 50, offset: 0 } }),
    listGameDays: async () => ({ data: [], meta: { total: 0, limit: 0, offset: 0 } }),
    listGameDates: async () => ({
      data: state.gameDates.map((date) => ({ game_date: date, season: "2026-27", game_count: 1 })),
      meta: { total: state.gameDates.length, limit: 0, offset: 0 },
    }),
    listGames: async () => ({
      data: state.finals,
      meta: { total: state.finals.length, limit: 20, offset: 0 },
    }),
    listTeams: async () => ({
      data: [
        { team_id: "den", abbreviation: "DEN", team_name: "Denver Nuggets", city: "Denver" },
        { team_id: "bos", abbreviation: "BOS", team_name: "Boston Celtics", city: "Boston" },
        { team_id: "bkn", abbreviation: "BKN", team_name: "Brooklyn Nets", city: "Brooklyn" },
      ],
      meta: { total: 3, limit: 30, offset: 0 },
    }),
    listStandings: async () => ({
      data: [
        { team_id: "den", abbreviation: "DEN", team_name: "Denver Nuggets", win_pct: 0.9 },
        { team_id: "bos", abbreviation: "BOS", team_name: "Boston Celtics", win_pct: 0.8 },
        { team_id: "bkn", abbreviation: "BKN", team_name: "Brooklyn Nets", win_pct: 0.2 },
      ],
      meta: { total: 3, limit: 30, offset: 0 },
    }),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import AccountPage from "@/app/account/page";
import ChatPage from "@/app/chat/page";
import GamesPage from "@/app/games/page";
import PicksPage from "@/app/picks/page";
import { Header } from "@/components/layout/header";
import { Providers } from "@/components/providers";

const emptySummary = {
  wins: 0,
  losses: 0,
  pending: 0,
  net: 0,
  staked_open: 0,
  vs_model: 0,
  model_games: 0,
  market_games: 0,
  expected_wins: 0,
  vs_market: 0,
};

function sheet(picks: Record<string, unknown>[] = [], summary = emptySummary) {
  return { ok: true, data: { summary, picks } };
}

function pick(overrides: Record<string, unknown> = {}) {
  return {
    game_id: "g-1",
    picked_team_id: "home",
    stake: null,
    moneyline: -150,
    result: "pending",
    profit: null,
    model_correct: null,
    game_date: "2026-10-22",
    start_time_et: "19:30:00",
    home_team_id: "home",
    home_team_abbreviation: "GSW",
    home_score: null,
    away_team_id: "away",
    away_team_abbreviation: "LAL",
    away_score: null,
    created_at: "2026-10-09T12:00:00Z",
    ...overrides,
  };
}

function finalGame(
  gameId: string,
  home: string,
  away: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    game_id: gameId,
    season: "2026-27",
    season_type: "Regular Season",
    game_date: "2026-10-18",
    home_team_id: `h-${gameId}`,
    away_team_id: `a-${gameId}`,
    home_team_abbreviation: home,
    away_team_abbreviation: away,
    home_score: 120,
    away_score: 110,
    ...overrides,
  };
}

function quota(remaining: number, maxTurns = 6) {
  return {
    daily_limit: 10,
    remaining,
    resets_at: "2026-10-10T04:00:00Z",
    max_turns: maxTurns,
  };
}

function reply(answer: string, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: { answer, data: [], source: null, backend: "llm", quota: quota(9), ...extra },
  };
}

function profile(timezone: string | null = null, chat = quota(10), follows: unknown[] = []) {
  return {
    ok: true,
    data: { user: { created_at: "2026-10-03T12:00:00Z", timezone }, chat, follows },
  };
}

function followed(entityId: string, name: string | null, abbreviation: string | null) {
  return { entity_type: "team", entity_id: entityId, name, abbreviation, created_at: "" };
}

function page(node: React.ReactNode) {
  return render(<Providers>{node}</Providers>);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.account = { name: "Pat", hasAccount: true };
  state.flags = { chatbot: true, picks: true, isLoading: false };
  state.pathname = "/games";
  state.search = "date=2026-10-22";
  state.finals = [];
  state.gameDates = [];
  actions.getPickSheetAction.mockResolvedValue(sheet());
  actions.getProfileAction.mockResolvedValue(profile());
});

describe("header", () => {
  it("offers sign-in, returning to the current page, when signed out", () => {
    state.account = null;
    state.pathname = "/teams";
    page(<Header />);
    const nav = screen.getByRole("navigation", { name: "Account" });
    expect(within(nav).getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/signin?callbackUrl=%2Fteams"
    );
    expect(within(nav).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows Chat in the main tabs when the chatbot is available, and no Ask", () => {
    page(<Header />);
    const primary = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primary).getByRole("link", { name: "Chat" })).toHaveAttribute("href", "/chat");
    expect(within(primary).queryByRole("link", { name: "Ask" })).not.toBeInTheDocument();
    // One entry point, not a second link beside the profile.
    expect(screen.getAllByRole("link", { name: "Chat" })).toHaveLength(1);
  });

  it("shows Ask instead when the chatbot is off or has no model behind it", () => {
    state.flags = { chatbot: false, picks: true, isLoading: false };
    page(<Header />);
    const primary = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primary).getByRole("link", { name: "Ask" })).toHaveAttribute("href", "/ask");
    expect(screen.queryByRole("link", { name: "Chat" })).not.toBeInTheDocument();
  });

  it("gives a signed-in visitor a profile menu with their pages and sign-out", () => {
    page(<Header />);
    const nav = screen.getByRole("navigation", { name: "Account" });
    expect(within(nav).queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    // Closed until asked for.
    const trigger = within(nav).getByRole("button", { name: /Pat/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Your account" });
    // The header is on every page, so the menu never loads the pick sheet.
    expect(actions.getPickSheetAction).not.toHaveBeenCalled();
    expect(within(menu).getByRole("menuitem", { name: "Your picks" })).toHaveAttribute(
      "href",
      "/picks"
    );
    expect(within(menu).getByRole("menuitem", { name: "Account" })).toHaveAttribute(
      "href",
      "/account"
    );
    expect(within(menu).getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
  });

  it("shows the provider's picture, and the initial when there is none or it fails", () => {
    const picture = "https://avatars.githubusercontent.com/u/1?v=4";
    state.account = { name: "Pat", image: picture, hasAccount: true };
    const { container } = page(<Header />);
    const button = screen.getByRole("button", { name: "Pat" });
    expect(container.querySelector("img")).toHaveAttribute("src", picture);
    expect(within(button).queryByText("P")).not.toBeInTheDocument();

    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(within(button).getByText("P")).toBeInTheDocument();
  });

  it("closes the menu on Escape, an outside click, or choosing a page", () => {
    page(<Header />);
    const trigger = screen.getByRole("button", { name: /Pat/ });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    // A click inside the menu's own padding leaves it open.
    fireEvent.pointerDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Account" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("signs out from the menu and reloads the site", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    actions.signOutAction.mockResolvedValue(undefined);
    page(<Header />);
    fireEvent.click(screen.getByRole("button", { name: /Pat/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
    expect(actions.signOutAction).toHaveBeenCalledTimes(1);
  });

  it("drops picks from the menu when its flag is off", () => {
    state.flags = { chatbot: false, picks: false, isLoading: false };
    state.account = { name: null, hasAccount: true };
    page(<Header />);
    // No display name on file.
    fireEvent.click(screen.getByRole("button", { name: /Account/ }));
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "Your picks" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Account" })).toBeInTheDocument();
    expect(actions.getPickSheetAction).not.toHaveBeenCalled();
  });

  it("marks the profile as current on its own pages", () => {
    state.pathname = "/picks";
    page(<Header />);
    expect(screen.getByRole("button", { name: /Pat/ })).toHaveClass("ct-tab-active");
  });

  it("puts each followed team's logo in the header, linking to its page", async () => {
    state.pathname = "/teams/boston-celtics";
    actions.getProfileAction.mockResolvedValue(
      profile(null, quota(10), [
        followed("bos", "Boston Celtics", "BOS"),
        followed("den", "Denver Nuggets", "DEN"),
      ])
    );
    page(<Header />);
    const shortcuts = await screen.findByRole("navigation", { name: "Your teams" });
    const links = within(shortcuts).getAllByRole("link");
    // In the order set on Account.
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/teams/boston-celtics",
      "/teams/denver-nuggets",
    ]);
    expect(links[0]).toHaveAccessibleName("Boston Celtics");
    expect(links[0]).toHaveAttribute("aria-current", "page");
    expect(links[1]).not.toHaveAttribute("aria-current");

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const mobile = screen.getByRole("navigation", { name: "Your teams mobile" });
    fireEvent.click(within(mobile).getByRole("link", { name: "Denver Nuggets" }));
    expect(screen.queryByRole("navigation", { name: "Your teams mobile" })).not.toBeInTheDocument();
  });

  it("lists the same destinations flat in the mobile menu", () => {
    page(<Header />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(
      within(screen.getByRole("navigation", { name: "Primary mobile" })).getByRole("link", {
        name: "Chat",
      })
    ).toBeInTheDocument();
    const mobile = screen.getByRole("navigation", { name: "Account mobile" });
    expect(within(mobile).getByRole("link", { name: "Account" })).toBeInTheDocument();
    fireEvent.click(within(mobile).getByRole("link", { name: "Your picks" }));
    expect(screen.queryByRole("navigation", { name: "Account mobile" })).not.toBeInTheDocument();
  });
});

describe("games page picks", () => {
  // The fixture game tips at 7:30 PM Eastern on Oct 22 and locks from then, so
  // the clock is pinned two days before it; unpinned, these fail on the evening
  // of the fixture date.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-20T16:00:00Z") });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows an anonymous visitor the pick buttons, which lead to sign-in", async () => {
    state.account = null;
    page(<GamesPage />);
    expect(await screen.findByRole("link", { name: "GSW" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Your pick" })).toBeInTheDocument();
    // The steps stay out of the way until asked for.
    expect(screen.queryByText("Pick a winner")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Your picks →" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pick GSW" }));
    const steps = await screen.findByRole("dialog", { name: "How picks work" });
    expect(steps).toHaveTextContent("Pretend dollars, paid at the moneyline. Nothing is charged.");
    // Back to the same day after signing in.
    expect(within(steps).getByRole("link", { name: "Sign in to start" })).toHaveAttribute(
      "href",
      "/signin?callbackUrl=%2Fgames%3Fdate%3D2026-10-22"
    );
    expect(actions.savePickAction).not.toHaveBeenCalled();
    expect(actions.getPickSheetAction).not.toHaveBeenCalled();
  });

  it("shows no pick column when picks are switched off", async () => {
    state.flags = { chatbot: true, picks: false, isLoading: false };
    page(<GamesPage />);
    expect(await screen.findByRole("link", { name: "GSW" })).toBeInTheDocument();
    expect(screen.queryByText("Your pick")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Your pick" })).not.toBeInTheDocument();
    expect(actions.getPickSheetAction).not.toHaveBeenCalled();

    // Nor to an anonymous visitor: there is nothing to sign in for.
    state.account = null;
    page(<GamesPage />);
    await waitFor(() => expect(screen.getAllByRole("link", { name: "GSW" })).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "Your pick" })).not.toBeInTheDocument();
  });

  it("shows start times in the account's time zone, Eastern unless one is chosen", async () => {
    const { unmount } = page(<GamesPage />);
    expect(await screen.findByText("7:30 PM ET")).toBeInTheDocument();
    unmount();
    actions.getProfileAction.mockResolvedValue(profile("America/Los_Angeles"));
    page(<GamesPage />);
    expect(await screen.findByText("4:30 PM PDT")).toBeInTheDocument();
    expect(screen.queryByText("7:30 PM ET")).not.toBeInTheDocument();
  });

  it("lets a signed-in visitor pick a side with one click", async () => {
    actions.getPickSheetAction.mockResolvedValue(
      sheet([], { ...emptySummary, wins: 12, losses: 7, net: 37.15 })
    );
    actions.savePickAction.mockResolvedValue(sheet([pick()], { ...emptySummary, pending: 1 }));
    page(<GamesPage />);
    expect(await screen.findByText("Your pick")).toBeInTheDocument();
    // The record and net live on the picks page, not here.
    expect(screen.getByRole("link", { name: "Your picks →" })).toHaveAttribute("href", "/picks");
    fireEvent.click(screen.getByRole("button", { name: "Your pick" }));
    const steps = await screen.findByRole("dialog", { name: "How picks work" });
    expect(steps).toHaveTextContent("Track your net");
    // Already signed in, so there is nothing to start.
    expect(within(steps).queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(within(steps).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // No balance is given to anyone, so none is shown.
    expect(screen.queryByText(/balance|available/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pick GSW" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Pick GSW" })).toHaveAttribute(
        "aria-pressed",
        "true"
      )
    );
    expect(actions.savePickAction).toHaveBeenCalledWith("g-1", "home", null);
  });

  it("adds a stake to a saved pick from a popover on the game", async () => {
    actions.getPickSheetAction.mockResolvedValue(sheet([pick()]));
    actions.savePickAction.mockResolvedValue(
      sheet([pick({ stake: 50 })], { ...emptySummary, pending: 1, staked_open: 50 })
    );
    page(<GamesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Add stake" }));
    const editor = screen.getByTestId("stake-editor");
    expect(screen.getByRole("dialog", { name: "GSW to win" })).toHaveTextContent("−150");
    fireEvent.click(within(editor).getByRole("button", { name: "$50" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Save stake" }));
    // The editor closes, and the cell shows what is riding.
    expect(await screen.findByText("$50 to win $33.33")).toBeInTheDocument();
    expect(screen.queryByTestId("stake-editor")).not.toBeInTheDocument();
    expect(actions.savePickAction).toHaveBeenCalledWith("g-1", "home", 50);
    expect(screen.getByRole("button", { name: "Edit stake" })).toBeInTheDocument();
  });

  it("closes the stake popover on Escape or when the pick is removed", async () => {
    actions.getPickSheetAction.mockResolvedValue(sheet([pick()]));
    actions.removePickAction.mockResolvedValue(sheet());
    page(<GamesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Add stake" }));
    fireEvent.keyDown(screen.getByTestId("stake-editor"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("stake-editor")).not.toBeInTheDocument());
    expect(actions.savePickAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Add stake" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove pick" }));
    await waitFor(() => expect(actions.removePickAction).toHaveBeenCalledWith("g-1"));
    await waitFor(() => expect(screen.queryByTestId("stake-editor")).not.toBeInTheDocument());
  });

  it("says why when the picks cannot be loaded, instead of just hiding them", async () => {
    actions.getPickSheetAction.mockResolvedValue({
      ok: false,
      message: "Accounts are not available right now.",
    });
    page(<GamesPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Accounts are not available right now."
    );
    expect(screen.queryByText("Your pick")).not.toBeInTheDocument();
  });

  it("shows why a pick was refused", async () => {
    actions.savePickAction.mockResolvedValue({
      ok: false,
      message: "Picks for this game are locked.",
    });
    page(<GamesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Pick LAL" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Picks for this game are locked.");
  });

  it("clears a pick", async () => {
    actions.getPickSheetAction.mockResolvedValue(sheet([pick()]));
    actions.removePickAction.mockResolvedValue(sheet());
    page(<GamesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Clear pick/ }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Clear pick/ })).not.toBeInTheDocument()
    );
    expect(actions.removePickAction).toHaveBeenCalledWith("g-1");
  });
});

describe("games page settled picks", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-20T16:00:00Z") });
    state.search = "date=2026-10-18";
    state.finals = [finalGame("g-8", "GSW", "LAL"), finalGame("g-9", "BOS", "MIA")];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks each past game with the visitor's pick and how it went", async () => {
    actions.getPickSheetAction.mockResolvedValue(
      sheet([
        pick({ game_id: "g-8", picked_team_id: "h-g-8", home_team_id: "h-g-8", result: "won" }),
        pick({
          game_id: "g-9",
          picked_team_id: "a-g-9",
          away_team_id: "a-g-9",
          away_team_abbreviation: "MIA",
          result: "lost",
        }),
      ])
    );
    page(<GamesPage />);
    const won = await screen.findByText("✓ You: GSW");
    expect(won).toHaveClass("text-primary");
    expect(screen.getByText("✗ You: MIA")).toHaveClass("text-destructive");
    expect(screen.getByText(/Your settled picks show on the right/)).toBeInTheDocument();
  });

  it("leaves the cell empty on a game the visitor did not pick", async () => {
    actions.getPickSheetAction.mockResolvedValue(
      sheet([
        pick({ game_id: "g-8", picked_team_id: "h-g-8", home_team_id: "h-g-8", result: "won" }),
      ])
    );
    page(<GamesPage />);
    await screen.findByText("✓ You: GSW");
    const cells = screen.getAllByTestId("settled-pick");
    expect(cells).toHaveLength(2);
    expect(cells[1]).toBeEmptyDOMElement();
  });
});

describe("games page for followed teams", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-20T16:00:00Z") });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("tints a followed team's game and offers to show only those", async () => {
    actions.getProfileAction.mockResolvedValue(
      profile(null, quota(10), [followed("home", "Golden State Warriors", "GSW")])
    );
    page(<GamesPage />);
    const row = (await screen.findByRole("link", { name: "GSW" })).closest("tr");
    const toggle = screen.getByRole("switch", { name: "Only my teams" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(row).toHaveAttribute("data-followed", "true");
    expect(row).toHaveClass("bg-tint");

    fireEvent.click(toggle);
    expect(state.replace).toHaveBeenCalledWith("/games?date=2026-10-22&mine=1", {
      scroll: false,
    });
  });

  it("says so when none of the followed teams play that day", async () => {
    state.search = "date=2026-10-22&mine=1";
    actions.getProfileAction.mockResolvedValue(
      profile(null, quota(10), [followed("other", "Denver Nuggets", "DEN")])
    );
    page(<GamesPage />);
    expect(await screen.findByText("None of your teams play on this date.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Only my teams" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    fireEvent.click(screen.getByRole("switch", { name: "Only my teams" }));
    expect(state.replace).toHaveBeenCalledWith("/games?date=2026-10-22", { scroll: false });
  });

  it("filters a past day's results to followed teams too", async () => {
    state.search = "date=2026-10-18&mine=1";
    state.finals = [
      finalGame("g-8", "GSW", "LAL", { home_team_id: "home", away_team_id: "away" }),
      finalGame("g-9", "BOS", "MIA"),
    ];
    actions.getProfileAction.mockResolvedValue(
      profile(null, quota(10), [followed("home", "Golden State Warriors", "GSW")])
    );
    page(<GamesPage />);
    expect(await screen.findByRole("link", { name: "GSW 120, LAL 110" })).toBeInTheDocument();
    expect(screen.getAllByTestId("result-row")).toHaveLength(1);
  });

  it("ignores the filter for a visitor who follows nobody", async () => {
    state.search = "date=2026-10-22&mine=1";
    page(<GamesPage />);
    expect(await screen.findByRole("link", { name: "GSW" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Only my teams" })).not.toBeInTheDocument();
  });
});

describe("picks page", () => {
  it("asks an anonymous visitor to sign in", () => {
    state.account = null;
    page(<PicksPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/signin?callbackUrl=%2Fpicks"
    );
    expect(actions.getPickSheetAction).not.toHaveBeenCalled();
  });

  it("says picks are paused when the flag is off, even to a signed-in user", () => {
    state.flags = { chatbot: true, picks: false, isLoading: false };
    page(<PicksPage />);
    expect(screen.getByText("Picks are paused")).toBeInTheDocument();
    expect(actions.getPickSheetAction).not.toHaveBeenCalled();
  });

  it("waits for the flags before deciding what to show", () => {
    state.flags = { chatbot: false, picks: false, isLoading: true };
    page(<PicksPage />);
    expect(screen.getByRole("status", { name: "Loading picks…" })).toBeInTheDocument();
    expect(screen.queryByText("Picks are paused")).not.toBeInTheDocument();
  });

  it("explains a session with no registered account", () => {
    state.account = { name: "Pat", hasAccount: false };
    page(<PicksPage />);
    expect(screen.getByText("Accounts are not available right now.")).toBeInTheDocument();
  });

  it("invites a first pick when there are none", async () => {
    state.account = { name: null, hasAccount: true };
    page(<PicksPage />);
    expect(
      await screen.findByRole("heading", { name: "Your picks", level: 1 })
    ).toBeInTheDocument();
    expect(screen.getAllByText("No picks yet").length).toBeGreaterThan(0);
    expect(screen.getByText("no finished games yet")).toBeInTheDocument();
    expect(screen.getByText("no finished games the model also called")).toBeInTheDocument();
    expect(screen.getByText("stakes are optional; nothing staked yet")).toBeInTheDocument();
    expect(screen.getByText("Nothing open. Picks lock when a game tips.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Settled" })).not.toBeInTheDocument();
  });

  it("shows the record, net, model comparison, best call and each pick", async () => {
    actions.getPickSheetAction.mockResolvedValue(
      sheet(
        [
          pick({ game_id: "open", picked_team_id: "away", moneyline: 104, stake: 100 }),
          pick({ game_id: "open-plain", moneyline: -131 }),
          pick({
            game_id: "dog",
            picked_team_id: "away",
            moneyline: 159,
            stake: 100,
            profit: 159,
            result: "won",
            home_score: 108,
            away_score: 112,
            is_upset: true,
          }),
          pick({
            game_id: "fav",
            result: "won",
            home_score: 120,
            away_score: 110,
            is_upset: false,
          }),
          pick({
            game_id: "lost",
            picked_team_id: "away",
            moneyline: 120,
            stake: 50,
            profit: -50,
            result: "lost",
            home_score: 101,
            away_score: 97,
            // An upset, but on the wrong side of it.
            is_upset: true,
          }),
          pick({
            game_id: "void",
            result: "void",
            moneyline: null,
            home_team_abbreviation: null,
            home_team_id: null,
          }),
        ],
        {
          wins: 2,
          losses: 1,
          pending: 2,
          net: 109,
          staked_open: 100,
          vs_model: 2,
          model_games: 3,
          market_games: 0,
          expected_wins: 0,
          vs_market: 0,
        }
      )
    );
    page(<PicksPage />);
    expect(
      await screen.findByRole("heading", { name: "Your picks", level: 1 })
    ).toBeInTheDocument();
    expect(screen.getByText("2026-27 season · stakes are pretend dollars")).toBeInTheDocument();

    expect(screen.getAllByText("2–1").length).toBeGreaterThan(0);
    expect(screen.getByText("67% correct")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "67");
    expect(screen.getByText("+$109")).toBeInTheDocument();
    expect(
      screen.getByText("from 2 settled stakes · $150 staked · $100 riding on open picks")
    ).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(
      screen.getByText("right when the model was wrong, minus the reverse")
    ).toBeInTheDocument();
    // A net, never a balance: nobody is handed money to start with.
    expect(screen.queryByText(/balance|started at/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Show/ }));
    const [staked, plain] = screen.getAllByTestId("open-pick");
    expect(within(staked).getByText("LAL +104 at GSW")).toBeInTheDocument();
    expect(staked).toHaveTextContent("Thu, Oct 22, 2026 · 7:30 PM ET");
    expect(within(staked).getByText("to win $104")).toBeInTheDocument();
    expect(within(plain).getByText("record only")).toBeInTheDocument();

    const [dog, fav, lost, voided] = screen.getAllByTestId("settled-pick");
    // The biggest payout is also the Best call tile.
    expect(screen.getAllByText("LAL +159 at GSW")).toHaveLength(2);
    expect(screen.getByText("$100 staked, won $159")).toBeInTheDocument();
    expect(within(dog).getByText("W")).toHaveClass("text-primary");
    expect(dog).toHaveTextContent("LAL 112–108");
    expect(within(dog).getByText("+$159")).toHaveClass("text-primary");
    expect(within(fav).getByText("GSW −150 vs LAL")).toBeInTheDocument();
    expect(within(lost).getByText("L")).toHaveClass("text-destructive");
    expect(within(lost).getByText("−$50")).toHaveClass("text-destructive");
    expect(within(voided).getByText("No longer scheduled")).toBeInTheDocument();
    expect(within(voided).getByTitle("Void")).toBeInTheDocument();
    // Only a won pick on an upset is tagged.
    expect(within(dog).getByTestId("called-upset")).toHaveTextContent("Called the upset");
    expect(screen.getAllByTestId("called-upset")).toHaveLength(1);
  });

  it("names the best call by its score when nothing was staked on it", async () => {
    actions.getPickSheetAction.mockResolvedValue(
      sheet(
        [
          pick({ result: "won", moneyline: 159, home_score: 120, away_score: 110 }),
          pick({
            game_id: "one",
            result: "lost",
            stake: 20,
            profit: -20,
            home_score: 1,
            away_score: 2,
          }),
        ],
        { ...emptySummary, wins: 1, losses: 1, net: -20 }
      )
    );
    page(<PicksPage />);
    expect(await screen.findByText("from 1 settled stake · $20 staked")).toBeInTheDocument();
    expect(screen.queryByText(/riding on open picks/)).not.toBeInTheDocument();
    // Twice: the Net tile and that pick's own row.
    expect(screen.getAllByText("−$20")).toHaveLength(2);
    expect(screen.getAllByText("GSW 120–110").length).toBeGreaterThan(0);
  });

  it("shows a deficit against the model with a minus, and level as zero", async () => {
    actions.getPickSheetAction.mockResolvedValue(
      sheet([pick({ result: "lost", home_score: 1, away_score: 2 })], {
        ...emptySummary,
        losses: 1,
        vs_model: -1,
        model_games: 1,
      })
    );
    const { unmount } = page(<PicksPage />);
    expect(await screen.findByText("−1")).toBeInTheDocument();
    unmount();
    actions.getPickSheetAction.mockResolvedValue(
      sheet([pick({ result: "won", home_score: 2, away_score: 1 })], {
        ...emptySummary,
        wins: 1,
        model_games: 1,
      })
    );
    page(<PicksPage />);
    expect(
      await screen.findByText("right when the model was wrong, minus the reverse")
    ).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("scores picks against the market once enough have a line", async () => {
    const settled = Array.from({ length: 12 }, (_, index) =>
      pick({ game_id: `g-${index}`, result: "won", home_score: 2, away_score: 1 })
    );
    actions.getPickSheetAction.mockResolvedValue(
      sheet(settled, {
        ...emptySummary,
        wins: 12,
        market_games: 11,
        expected_wins: 8.94,
        vs_market: 2.06,
      })
    );
    const { unmount } = page(<PicksPage />);
    expect(await screen.findByText("+2.1")).toBeInTheDocument();
    expect(
      screen.getByText("11 wins where the odds expected 8.9 · 1 without a line")
    ).toBeInTheDocument();
    unmount();

    // Too few priced picks reads as a dash, not a number.
    actions.getPickSheetAction.mockResolvedValue(
      sheet(settled.slice(0, 3), {
        ...emptySummary,
        wins: 3,
        market_games: 3,
        expected_wins: 2.1,
        vs_market: 0.9,
      })
    );
    page(<PicksPage />);
    expect(
      await screen.findByText("not enough finished picks with a line yet")
    ).toBeInTheDocument();
    expect(screen.queryByText("+0.9")).not.toBeInTheDocument();
  });

  it("shows each breakdown split against the odds", async () => {
    actions.getPickSheetAction.mockResolvedValue(
      sheet(
        [
          // A home favourite that won where the odds gave it 0.6.
          pick({ result: "won", home_score: 2, away_score: 1, market_wp: 0.6 }),
          // An away underdog with no line.
          pick({
            game_id: "dog",
            picked_team_id: "away",
            moneyline: 150,
            result: "lost",
            home_score: 2,
            away_score: 1,
          }),
        ],
        { ...emptySummary, wins: 1, losses: 1, market_games: 1, expected_wins: 0.6, vs_market: 0.4 }
      )
    );
    page(<PicksPage />);
    await screen.findAllByTestId("settled-pick");
    fireEvent.click(screen.getByRole("button", { name: /^Breakdown/ }));
    expect(await screen.findByText("Vs. odds")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Favorites/ })).toHaveTextContent("+0.4");
    // A split with no priced picks has nothing to compare.
    expect(screen.getByRole("button", { name: /^Underdogs/ })).toHaveTextContent("0–1–");
  });

  it("pages a long settled list instead of rendering a season at once", async () => {
    const many = Array.from({ length: 45 }, (_, index) =>
      pick({ game_id: `g-${index}`, result: "won", home_score: 2, away_score: 1 })
    );
    actions.getPickSheetAction.mockResolvedValue(sheet(many, { ...emptySummary, wins: 45 }));
    page(<PicksPage />);
    await waitFor(() => expect(screen.getAllByTestId("settled-pick")).toHaveLength(20));
    fireEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
    expect(screen.getAllByTestId("settled-pick")).toHaveLength(40);
    fireEvent.click(screen.getByRole("button", { name: "Show 5 more" }));
    expect(screen.getAllByTestId("settled-pick")).toHaveLength(45);
    expect(screen.queryByRole("button", { name: /Show .* more/ })).not.toBeInTheDocument();
  });

  it("summarises open picks and keeps them folded until asked", async () => {
    actions.getPickSheetAction.mockResolvedValue(
      sheet([pick({ game_date: "2099-01-05" })], { ...emptySummary, pending: 1 })
    );
    page(<PicksPage />);
    expect(await screen.findByText("1 open · first lock Jan 5, 7:30 PM")).toBeInTheDocument();
    expect(screen.queryByTestId("open-pick")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Show/ }));
    expect(screen.getByTestId("open-pick")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Hide/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("strips the last 20 results and says how they compare with the season", async () => {
    const newestWins = Array.from({ length: 25 }, (_, index) =>
      pick({
        game_id: `g-${index}`,
        result: index < 20 ? "won" : "lost",
        home_score: 2,
        away_score: 1,
      })
    );
    actions.getPickSheetAction.mockResolvedValue(
      sheet(newestWins, { ...emptySummary, wins: 20, losses: 5 })
    );
    page(<PicksPage />);
    expect(await screen.findByText("Last 20")).toBeInTheDocument();
    expect(screen.getAllByTestId("form-tile")).toHaveLength(20);
    expect(screen.getByText("20–0 over the last 20 · better than your season")).toBeInTheDocument();
  });

  it("filters the settled list, totals what is left, and clears the chips", async () => {
    actions.getPickSheetAction.mockResolvedValue(
      sheet(
        [
          pick({
            game_id: "gsw",
            stake: 10,
            profit: 6.66,
            result: "won",
            home_score: 2,
            away_score: 1,
            model_correct: false,
          }),
          pick({
            game_id: "lal",
            picked_team_id: "away",
            moneyline: 150,
            stake: 10,
            profit: -10,
            result: "lost",
            home_score: 2,
            away_score: 1,
            model_correct: true,
          }),
        ],
        { ...emptySummary, wins: 1, losses: 1, net: -3.34 }
      )
    );
    page(<PicksPage />);
    const summary = await screen.findByTestId("settled-summary");
    expect(summary).toHaveTextContent("2 picks · 1–1 · 50% correct · Net −$3.34 on $20 staked");

    fireEvent.change(screen.getByRole("combobox", { name: "Team" }), {
      target: { value: "GSW" },
    });
    expect(summary).toHaveTextContent("1 pick · 1–0 · 100% correct · Net +$6.66 on $10 staked");
    expect(screen.getAllByTestId("settled-pick")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Remove GSW filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Losses" }));
    expect(screen.getByRole("button", { name: "Losses" })).toHaveAttribute("aria-pressed", "true");
    expect(summary).toHaveTextContent("1 pick · 0–1");
    fireEvent.click(screen.getByRole("button", { name: "All" }));

    fireEvent.click(screen.getByRole("button", { name: /^Breakdown/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Underdogs/ }));
    expect(screen.getByRole("button", { name: "Remove Underdogs filter" })).toBeInTheDocument();
    expect(summary).toHaveTextContent("1 pick · 0–1");

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(summary).toHaveTextContent("2 picks · 1–1");

    fireEvent.click(screen.getByRole("button", { name: "Wins" }));
    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    expect(screen.getByText("No picks match these filters.")).toBeInTheDocument();
  });

  it("adds the model's call as a column when asked", async () => {
    actions.getPickSheetAction.mockResolvedValue(
      sheet(
        [
          pick({
            result: "won",
            home_score: 2,
            away_score: 1,
            model_correct: false,
          }),
          pick({ game_id: "none", result: "lost", home_score: 1, away_score: 2 }),
        ],
        { ...emptySummary, wins: 1, losses: 1 }
      )
    );
    page(<PicksPage />);
    const [called, uncalled] = await screen.findAllByTestId("settled-pick");
    fireEvent.click(screen.getByRole("switch", { name: "Show model" }));
    expect(screen.getByRole("columnheader", { name: "Model" })).toBeInTheDocument();
    // The model took the side that lost.
    expect(within(called).getByText("LAL L")).toHaveClass("text-destructive");
    expect(uncalled).toHaveTextContent("–");
  });

  it("shows the reason when the picks cannot be loaded", async () => {
    actions.getPickSheetAction.mockResolvedValue({
      ok: false,
      message: "This account has been blocked.",
    });
    page(<PicksPage />);
    expect(await screen.findByText("This account has been blocked.")).toBeInTheDocument();
  });
});

describe("chat page", () => {
  const field = () => screen.findByLabelText("Your question");
  async function ask(text: string) {
    const input = await field();
    fireEvent.change(input, { target: { value: text } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
  }

  it("asks an anonymous visitor to sign in", () => {
    state.account = null;
    page(<ChatPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/signin?callbackUrl=%2Fchat"
    );
    expect(screen.queryByLabelText("Your question")).not.toBeInTheDocument();
  });

  it("is replaced by a pointer to Ask when the chatbot is not available", () => {
    state.flags = { chatbot: false, picks: true, isLoading: false };
    page(<ChatPage />);
    expect(screen.getByText("Chat is not available")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ask a single question/ })).toHaveAttribute(
      "href",
      "/ask"
    );
    expect(screen.queryByLabelText("Your question")).not.toBeInTheDocument();
    expect(actions.getProfileAction).not.toHaveBeenCalled();
  });

  it("waits for the flags, and explains a session with no account", () => {
    state.flags = { chatbot: false, picks: false, isLoading: true };
    const { unmount } = page(<ChatPage />);
    expect(screen.getByRole("status", { name: "Loading chat…" })).toBeInTheDocument();
    unmount();
    state.flags = { chatbot: true, picks: true, isLoading: false };
    state.account = { name: "Pat", hasAccount: false };
    page(<ChatPage />);
    expect(screen.getByText("Accounts are not available right now.")).toBeInTheDocument();
  });

  it("opens with starter questions and the day's allowance as a meter", async () => {
    actions.chatAction.mockResolvedValue(reply("OKC."));
    page(<ChatPage />);
    const meter = await screen.findByRole("progressbar", { name: "Questions left today" });
    expect(meter).toHaveAttribute("aria-valuenow", "10");
    expect(screen.getByTestId("chat-quota")).toHaveTextContent("10 of 10 left");
    expect(screen.getByPlaceholderText("Ask about the data")).toBeInTheDocument();
    expect(screen.getByTestId("chat-turns")).toHaveTextContent(
      "The conversation is kept in this tab only."
    );
    // A starter is a real question: one click asks it.
    fireEvent.click(screen.getByRole("button", { name: "Who leads the West?" }));
    expect(await screen.findByText("OKC.")).toBeInTheDocument();
    expect(actions.chatAction).toHaveBeenCalledWith(
      [{ role: "user", content: "Who leads the West?" }],
      "2026-27"
    );
  });

  it("answers with a preview of the rows, their source, and follow-ups for it", async () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({
      team_abbreviation: `T${index + 1}`,
      wins: 60 - index,
    }));
    actions.chatAction.mockResolvedValue(
      reply("OKC leads the West.", { data: rows, source: "cube tool get_standings" })
    );
    page(<ChatPage />);
    await ask("  Who leads the West?  ");

    expect(await screen.findByText("OKC leads the West.")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "T1" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "T8" })).not.toBeInTheDocument();
    expect(screen.getByText(/Source: standings · 5 of 8 rows/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View full table" }));
    expect(screen.getByRole("cell", { name: "T8" })).toBeInTheDocument();
    expect(screen.getByText(/8 of 8 rows/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.queryByRole("cell", { name: "T8" })).not.toBeInTheDocument();

    expect(screen.getByTestId("chat-quota")).toHaveTextContent("9 of 10 left");
    expect(screen.getByTestId("chat-turns")).toHaveTextContent("Question 2 of 6");
    expect(screen.getByPlaceholderText("Ask a follow-up")).toHaveValue("");
    expect(actions.chatAction).toHaveBeenCalledWith(
      [{ role: "user", content: "Who leads the West?" }],
      "2026-27"
    );
    // The starters give way to follow-ups that fit a standings answer.
    expect(
      screen.queryByRole("button", { name: "What is Curry's salary?" })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "And the other conference?" }));
    await waitFor(() => expect(actions.chatAction).toHaveBeenCalledTimes(2));
    expect(actions.chatAction).toHaveBeenLastCalledWith(
      [
        { role: "user", content: "Who leads the West?" },
        { role: "assistant", content: "OKC leads the West." },
        { role: "user", content: "And the other conference?" },
      ],
      "2026-27"
    );
  });

  it("shows a short table whole, with no expander and a singular row", async () => {
    actions.chatAction.mockResolvedValue(
      reply("One row.", { data: [{ team_abbreviation: "OKC" }], source: null })
    );
    page(<ChatPage />);
    await ask("One?");
    expect(await screen.findByText("1 of 1 row")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View full table" })).not.toBeInTheDocument();
    // An answer from an unknown source suggests nothing rather than guessing.
    expect(screen.queryByLabelText("Suggested questions")).not.toBeInTheDocument();
  });

  it("leaves a failed exchange out of the context, then starts over on request", async () => {
    actions.chatAction
      .mockResolvedValueOnce(reply("OKC."))
      .mockResolvedValueOnce({ ok: false, message: "The answer service did not respond." })
      .mockResolvedValueOnce(reply("Denver."));
    page(<ChatPage />);
    const input = await field();
    const send = async (text: string) => {
      await ask(text);
      await waitFor(() => expect(input).toBeEnabled());
    };

    await send("Who leads the West?");
    expect(screen.getByText("No rows behind this answer.")).toBeInTheDocument();
    await send("And second?");
    expect(await screen.findByRole("alert")).toHaveTextContent("did not respond");
    // The failed question took no turn.
    expect(screen.getByTestId("chat-turns")).toHaveTextContent("Question 2 of 6");
    await send("Second in the West?");

    expect(actions.chatAction).toHaveBeenLastCalledWith(
      [
        { role: "user", content: "Who leads the West?" },
        { role: "assistant", content: "OKC." },
        { role: "user", content: "Second in the West?" },
      ],
      "2026-27"
    );
    expect(screen.getAllByTestId("chat-exchange")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(screen.queryByTestId("chat-exchange")).not.toBeInTheDocument();
    expect(screen.getByText("Nothing asked yet")).toBeInTheDocument();
  });

  it("closes the field when the conversation is full, until a new one starts", async () => {
    actions.getProfileAction.mockResolvedValue(profile(null, quota(10, 1)));
    actions.chatAction.mockResolvedValue(
      reply("OKC.", { quota: quota(9, 1), source: "cube tool get_standings" })
    );
    page(<ChatPage />);
    await ask("Who leads the West?");
    const input = await screen.findByPlaceholderText("This conversation is full");
    expect(input).toBeDisabled();
    expect(screen.getByTestId("chat-turns")).toHaveTextContent("This conversation is full.");
    // No follow-ups are offered into a conversation that cannot take them.
    expect(screen.queryByLabelText("Suggested questions")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(screen.getByPlaceholderText("Ask about the data")).toBeEnabled();
  });

  it("stops taking questions once the day's are used", async () => {
    actions.getProfileAction.mockResolvedValue(profile(null, quota(0)));
    page(<ChatPage />);
    const input = await screen.findByPlaceholderText("No questions left today");
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
    expect(screen.queryByLabelText("Suggested questions")).not.toBeInTheDocument();
  });

  it("ignores an empty question and re-reads the quota after a refusal", async () => {
    actions.chatAction.mockResolvedValue({
      ok: false,
      message: "You have used all of today's questions.",
    });
    page(<ChatPage />);
    const input = await field();
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(actions.chatAction).not.toHaveBeenCalled();

    await waitFor(() => expect(actions.getProfileAction).toHaveBeenCalledTimes(1));
    actions.getProfileAction.mockResolvedValue(profile(null, quota(0)));
    await ask("One more?");
    expect(await screen.findByRole("alert")).toHaveTextContent("used all of today's questions");
    await waitFor(() => expect(screen.getByTestId("chat-quota")).toHaveTextContent("0 of 10"));
  });

  it("still lets a visitor ask when the quota cannot be read", async () => {
    actions.getProfileAction.mockResolvedValue({ ok: false, message: "down" });
    page(<ChatPage />);
    expect(await field()).toBeEnabled();
    expect(screen.queryByTestId("chat-quota")).not.toBeInTheDocument();
  });
});

describe("account page", () => {
  it("asks an anonymous visitor to sign in", () => {
    state.account = null;
    page(<AccountPage />);
    expect(screen.getByText("You are not signed in.")).toBeInTheDocument();
  });

  it("names the account, says what is kept, and offers sign-out", async () => {
    page(<AccountPage />);
    expect(screen.getByText("Pat")).toBeInTheDocument();
    expect(await screen.findByTestId("member-since")).toHaveTextContent(
      "Member since October 3, 2026"
    );
    expect(screen.getByText(/Your email address is not stored/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("lets the visitor choose the time zone game times are shown in", async () => {
    actions.setTimezoneAction.mockResolvedValue({
      ok: true,
      data: { created_at: "2026-10-03T12:00:00Z", timezone: "America/Los_Angeles" },
    });
    page(<AccountPage />);
    const select = await screen.findByLabelText("Time zone");
    // Nothing chosen reads as Eastern.
    expect(select).toHaveValue("America/New_York");
    fireEvent.change(select, { target: { value: "America/Los_Angeles" } });
    await waitFor(() => expect(select).toHaveValue("America/Los_Angeles"));
    expect(actions.setTimezoneAction).toHaveBeenCalledWith("America/Los_Angeles");

    // Choosing Eastern again clears the setting rather than storing it.
    actions.setTimezoneAction.mockResolvedValue({ ok: false, message: "Try again." });
    fireEvent.change(select, { target: { value: "America/New_York" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again.");
    expect(actions.setTimezoneAction).toHaveBeenLastCalledWith(null);
    expect(select).toHaveValue("America/Los_Angeles");
  });

  it("lists the teams followed and unfollows one", async () => {
    actions.getProfileAction.mockResolvedValue(
      profile(null, quota(10), [
        followed("den", "Denver Nuggets", "DEN"),
        followed("gone", null, null),
      ])
    );
    actions.setTeamFollowAction.mockResolvedValue({
      ok: true,
      data: [followed("gone", null, null)],
    });
    page(<AccountPage />);
    expect(await screen.findByRole("link", { name: "Denver Nuggets" })).toHaveAttribute(
      "href",
      "/teams/denver-nuggets"
    );
    expect(screen.getByText("No longer in the league")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unfollow Denver Nuggets" }));
    await waitFor(() => expect(screen.getAllByTestId("followed-team")).toHaveLength(1));
    expect(actions.setTeamFollowAction).toHaveBeenCalledWith("den", false);
    expect(screen.getByText(/the teams you follow, and your time zone/)).toBeInTheDocument();
  });

  it("adds a team by search", async () => {
    actions.setTeamFollowAction.mockResolvedValue({
      ok: true,
      data: [followed("bos", "Boston Celtics", "BOS")],
    });
    page(<AccountPage />);
    expect(await screen.findByText(/You don.t follow any teams yet/)).toBeInTheDocument();
    expect(screen.getByText("0 teams")).toBeInTheDocument();
    const search = screen.getByRole("searchbox", { name: "Add a team" });
    fireEvent.change(search, { target: { value: "bos" } });
    const matches = await screen.findByRole("list", { name: "Matching teams" });
    expect(within(matches).getAllByRole("button")).toHaveLength(1);
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(screen.getAllByTestId("followed-team")).toHaveLength(1));
    expect(actions.setTeamFollowAction).toHaveBeenCalledWith("bos", true);
    // The box clears once the follow lands, and a followed team is no longer offered.
    expect(search).toHaveValue("");
    fireEvent.change(search, { target: { value: "bos" } });
    expect(await screen.findByText(/No team you don.t follow matches/)).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(await screen.findByText(/No team you don.t follow matches/)).toBeInTheDocument();
    // Leaving the box closes the results; coming back reopens them.
    fireEvent.blur(search);
    expect(screen.queryByRole("list", { name: "Matching teams" })).toBeNull();
    fireEvent.focus(search);
    expect(screen.getByRole("list", { name: "Matching teams" })).toBeInTheDocument();
  });

  it("moves a team up or down, and saves the whole order", async () => {
    actions.getProfileAction.mockResolvedValue(
      profile(null, quota(10), [
        followed("den", "Denver Nuggets", "DEN"),
        followed("bos", "Boston Celtics", "BOS"),
      ])
    );
    actions.setFollowOrderAction.mockResolvedValue({
      ok: true,
      data: [followed("bos", "Boston Celtics", "BOS"), followed("den", "Denver Nuggets", "DEN")],
    });
    page(<AccountPage />);
    expect(await screen.findByRole("button", { name: "Move DEN up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move BOS down" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move BOS up" }));
    await waitFor(() => expect(actions.setFollowOrderAction).toHaveBeenCalledWith(["bos", "den"]));
    await waitFor(() =>
      expect(screen.getAllByTestId("followed-team")[0]).toHaveTextContent("1BOSBoston Celtics")
    );

    actions.setFollowOrderAction.mockResolvedValue({
      ok: false,
      message: "The list of teams has changed. Reload and try again.",
    });
    fireEvent.click(screen.getByRole("button", { name: "Move DEN up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Reload and try again.");
  });

  it("links to admin for the owner and for nobody else", () => {
    const { unmount } = page(<AccountPage />);
    expect(screen.queryByRole("link", { name: /admin/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Admin" })).not.toBeInTheDocument();
    unmount();
    state.account = { name: "Pat", hasAccount: true, isAdmin: true };
    page(<AccountPage />);
    expect(screen.getByRole("link", { name: "Open admin →" })).toHaveAttribute("href", "/admin");
  });

  it("signs out and reloads the site, so nothing cached for the session survives", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    actions.signOutAction.mockResolvedValue(undefined);
    page(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
    expect(actions.signOutAction).toHaveBeenCalledTimes(1);
  });

  it("deletes the account only after a second, explicit confirmation", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    actions.deleteAccountAction.mockResolvedValue({ ok: true, data: null });
    page(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect(actions.deleteAccountAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("button", { name: "Yes, delete everything" })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete everything" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
    expect(actions.deleteAccountAction).toHaveBeenCalledTimes(1);
  });

  it("reports a failed delete and lets the visitor try again", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    actions.deleteAccountAction.mockResolvedValue({ ok: false, message: "Try again." });
    state.account = { name: null, hasAccount: true };
    page(<AccountPage />);
    expect(screen.getByText("your account")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete everything" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again.");
    expect(screen.getByRole("button", { name: "Yes, delete everything" })).toBeEnabled();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("picks calendar", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-26T16:00:00Z") });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows each day's record and net, and the game days with no pick", async () => {
    state.gameDates = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-25"];
    actions.getPickSheetAction.mockResolvedValue(
      sheet(
        [
          pick({ game_id: "open", game_date: "2026-10-27" }),
          pick({ game_id: "a", game_date: "2026-10-23", result: "won", stake: 10, profit: 6.67 }),
          pick({ game_id: "b", game_date: "2026-10-23", result: "won" }),
          pick({ game_id: "c", game_date: "2026-10-23", result: "lost", stake: 20, profit: -20 }),
          pick({ game_id: "d", game_date: "2026-10-21", result: "lost" }),
        ],
        { ...emptySummary, wins: 2, losses: 2, net: -13.33 }
      )
    );
    page(<PicksPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Calendar" }));
    expect(screen.getByRole("tab", { name: "Calendar" })).toHaveAttribute("aria-selected", "true");
    // Arrow keys move along the tabs.
    fireEvent.keyDown(screen.getByRole("tab", { name: "Calendar" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Settled" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Settled");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Settled" }), { key: "ArrowRight" });
    expect(await screen.findByRole("heading", { name: "October 2026" })).toBeInTheDocument();

    const day = (date: string) =>
      screen.getAllByTestId("pick-day").find((cell) => cell.dataset.date === date)!;
    expect(within(day("2026-10-23")).getByText("2–1")).toHaveClass("text-primary");
    expect(within(day("2026-10-23")).getByText("−$13.33")).toBeInTheDocument();
    expect(within(day("2026-10-21")).getByText("0–1")).toHaveClass("text-destructive");
    expect(within(day("2026-10-27")).getByText("1 open")).toBeInTheDocument();
    // Missed from the first pick on: the 22nd and 25th, not the 20th before it.
    expect(within(day("2026-10-22")).getByText("No picks")).toBeInTheDocument();
    expect(within(day("2026-10-25")).getByText("No picks")).toBeInTheDocument();
    expect(day("2026-10-20")).toBeUndefined();
    expect(within(day("2026-10-23")).getByRole("link")).toHaveAttribute(
      "href",
      "/games?date=2026-10-23"
    );
    expect(screen.getByTestId("calendar-summary")).toHaveTextContent(
      "2–2 in October · 50% correct · net −$13.33 · picked on 2 of 4 game days"
    );
  });
});
