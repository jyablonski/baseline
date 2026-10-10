import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The signed-in surfaces: header links, the schedule's pick column, and the
 * Picks, Chat and Account pages. Session and flags are mocked at the hook, and
 * the server actions at the module, so each state a visitor can be in renders.
 */
const state = vi.hoisted(() => ({
  account: null as { name: string | null; hasAccount: boolean; isAdmin?: boolean } | null,
  flags: { chatbot: true, picks: true, isLoading: false },
  pathname: "/schedule",
}));
const actions = vi.hoisted(() => ({
  getProfileAction: vi.fn(),
  getPickSheetAction: vi.fn(),
  savePickAction: vi.fn(),
  removePickAction: vi.fn(),
  chatAction: vi.fn(),
  deleteAccountAction: vi.fn(),
  signOutAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("season=2026-27"),
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
    listSchedule: async () => ({ data: [game], meta: { total: 1, limit: 50, offset: 0 } }),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import AccountPage from "@/app/account/page";
import ChatPage from "@/app/chat/page";
import PicksPage from "@/app/picks/page";
import SchedulePage from "@/app/schedule/page";
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

function page(node: React.ReactNode) {
  return render(<Providers>{node}</Providers>);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.account = { name: "Pat", hasAccount: true };
  state.flags = { chatbot: true, picks: true, isLoading: false };
  state.pathname = "/schedule";
  actions.getPickSheetAction.mockResolvedValue(sheet());
  actions.getProfileAction.mockResolvedValue({ ok: true, data: { chat: quota(10) } });
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

  it("gives a signed-in visitor a profile menu with their record, pages and sign-out", async () => {
    actions.getPickSheetAction.mockResolvedValue(
      sheet([], { ...emptySummary, wins: 12, losses: 7, pending: 2 })
    );
    page(<Header />);
    const nav = screen.getByRole("navigation", { name: "Account" });
    expect(within(nav).queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    // Closed until asked for.
    const trigger = within(nav).getByRole("button", { name: /Pat/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // The header is on every page, so the record is not fetched until it is wanted.
    expect(actions.getPickSheetAction).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Your account" });
    expect(await within(menu).findByTestId("profile-record")).toHaveTextContent(
      "12–7 · 2 open picks"
    );
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

  it("says singular for one open pick", async () => {
    actions.getPickSheetAction.mockResolvedValue(sheet([], { ...emptySummary, pending: 1 }));
    page(<Header />);
    fireEvent.click(screen.getByRole("button", { name: /Pat/ }));
    expect(await screen.findByTestId("profile-record")).toHaveTextContent("0–0 · 1 open pick");
  });

  it("drops picks from the menu when its flag is off", () => {
    state.flags = { chatbot: false, picks: false, isLoading: false };
    state.account = { name: null, hasAccount: true };
    page(<Header />);
    // No display name on file.
    fireEvent.click(screen.getByRole("button", { name: /Account/ }));
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "Your picks" })).not.toBeInTheDocument();
    expect(within(menu).queryByTestId("profile-record")).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Account" })).toBeInTheDocument();
    expect(actions.getPickSheetAction).not.toHaveBeenCalled();
  });

  it("marks the profile as current on its own pages", () => {
    state.pathname = "/picks";
    page(<Header />);
    expect(screen.getByRole("button", { name: /Pat/ })).toHaveClass("ct-tab-active");
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

describe("schedule picks", () => {
  it("shows no pick column to an anonymous visitor", async () => {
    state.account = null;
    page(<SchedulePage />);
    expect(await screen.findByText("Chase Center")).toBeInTheDocument();
    expect(screen.queryByText("Your pick")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pick-cell")).not.toBeInTheDocument();
    expect(actions.getPickSheetAction).not.toHaveBeenCalled();
  });

  it("shows no pick column when picks are switched off", async () => {
    state.flags = { chatbot: true, picks: false, isLoading: false };
    page(<SchedulePage />);
    expect(await screen.findByText("Chase Center")).toBeInTheDocument();
    expect(screen.queryByText("Your pick")).not.toBeInTheDocument();
    expect(actions.getPickSheetAction).not.toHaveBeenCalled();
  });

  it("lets a signed-in visitor pick a side with one click", async () => {
    actions.getPickSheetAction.mockResolvedValue(
      sheet([], { ...emptySummary, wins: 12, losses: 7, net: 37.15 })
    );
    actions.savePickAction.mockResolvedValue(sheet([pick()], { ...emptySummary, pending: 1 }));
    page(<SchedulePage />);
    expect(await screen.findByText("Your pick")).toBeInTheDocument();
    expect(screen.getByTestId("pick-record")).toHaveTextContent("Your record: 12–7, net +$37.15.");
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
    // With nothing settled the net is left out rather than shown as zero.
    expect(screen.getByTestId("pick-record")).toHaveTextContent("Your record: 0–0.");
  });

  it("adds a stake to a saved pick from a row under the game", async () => {
    actions.getPickSheetAction.mockResolvedValue(sheet([pick()]));
    actions.savePickAction.mockResolvedValue(
      sheet([pick({ stake: 50 })], { ...emptySummary, pending: 1, staked_open: 50 })
    );
    page(<SchedulePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Add stake" }));
    const editor = screen.getByTestId("stake-editor");
    expect(within(editor).getByText("Stake on GSW −150 (optional)")).toBeInTheDocument();
    fireEvent.click(within(editor).getByRole("button", { name: "$50" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Save stake" }));
    // The editor closes, and the cell shows what is riding.
    expect(await screen.findByText("$50 to win $33.33")).toBeInTheDocument();
    expect(screen.queryByTestId("stake-editor")).not.toBeInTheDocument();
    expect(actions.savePickAction).toHaveBeenCalledWith("g-1", "home", 50);
    expect(screen.getByRole("button", { name: "Edit stake" })).toBeInTheDocument();
  });

  it("closes the stake row on Cancel or when the pick is cleared", async () => {
    actions.getPickSheetAction.mockResolvedValue(sheet([pick()]));
    actions.removePickAction.mockResolvedValue(sheet());
    page(<SchedulePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Add stake" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("stake-editor")).not.toBeInTheDocument();
    expect(actions.savePickAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Add stake" }));
    fireEvent.click(screen.getByRole("button", { name: /Clear pick/ }));
    expect(screen.queryByTestId("stake-editor")).not.toBeInTheDocument();
    await waitFor(() => expect(actions.removePickAction).toHaveBeenCalledWith("g-1"));
  });

  it("says why when the picks cannot be loaded, instead of just hiding them", async () => {
    actions.getPickSheetAction.mockResolvedValue({
      ok: false,
      message: "Accounts are not available right now.",
    });
    page(<SchedulePage />);
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
    page(<SchedulePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Pick LAL" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Picks for this game are locked.");
  });

  it("clears a pick", async () => {
    actions.getPickSheetAction.mockResolvedValue(sheet([pick()]));
    actions.removePickAction.mockResolvedValue(sheet());
    page(<SchedulePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Clear pick/ }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Clear pick/ })).not.toBeInTheDocument()
    );
    expect(actions.removePickAction).toHaveBeenCalledWith("g-1");
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
          }),
          pick({ game_id: "fav", result: "won", home_score: 120, away_score: 110 }),
          pick({
            game_id: "lost",
            picked_team_id: "away",
            moneyline: 120,
            stake: 50,
            profit: -50,
            result: "lost",
            home_score: 101,
            away_score: 97,
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
        }
      )
    );
    page(<PicksPage />);
    expect(await screen.findByRole("heading", { name: "Pat", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Picking since Oct 2026")).toBeInTheDocument();

    expect(screen.getByText("2–1")).toBeInTheDocument();
    expect(screen.getByText("67% correct")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "67");
    expect(screen.getByText("+$109")).toBeInTheDocument();
    expect(
      screen.getByText("from 2 settled stakes · $100 riding on open picks")
    ).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("net games ahead of Baseline's model over 3")).toBeInTheDocument();
    // A net, never a balance: nobody is handed money to start with.
    expect(screen.queryByText(/balance|started at/i)).not.toBeInTheDocument();

    const [staked, plain] = screen.getAllByTestId("open-pick");
    expect(within(staked).getByText("LAL +104 at GSW")).toBeInTheDocument();
    expect(staked).toHaveTextContent("7:30 PM ET");
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
    expect(await screen.findByText("from 1 settled stake")).toBeInTheDocument();
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
      await screen.findByText("net games ahead of Baseline's model over 1")
    ).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
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
    actions.getProfileAction.mockResolvedValue({ ok: true, data: { chat: quota(10, 1) } });
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
    actions.getProfileAction.mockResolvedValue({ ok: true, data: { chat: quota(0) } });
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
    actions.getProfileAction.mockResolvedValue({ ok: true, data: { chat: quota(0) } });
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

  it("names the account, says what is kept, and offers sign-out", () => {
    page(<AccountPage />);
    expect(screen.getByText("Pat")).toBeInTheDocument();
    expect(
      screen.getByText(/Your email address and the text of your chat questions are not stored/)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
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
