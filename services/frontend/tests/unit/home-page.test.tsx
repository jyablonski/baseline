import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listGames = vi.fn();
const listSchedule = vi.fn();
const listHighlights = vi.fn();
const listSocialPosts = vi.fn();
let searchParams = "season=2025-26";
let seasons = ["2025-26"];

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(searchParams),
}));

function standing(overrides: Record<string, unknown>) {
  return {
    season: "2025-26",
    season_type: "Regular Season",
    as_of_date: null,
    conference: "East",
    division: "Atlantic",
    division_rank: null,
    wins: 40,
    losses: 30,
    win_pct: 0.571,
    games_back: 3,
    conf_games_back: null,
    streak: "W1",
    last_10: "5-5",
    record_source: "games",
    ...overrides,
  };
}

const EAST = ["BOS", "NYK", "CLE", "ORL", "DET", "MIL", "IND", "ATL", "MIA", "PHI", "TOR"];

vi.mock("@/lib/api", () => ({
  api: {
    getStatus: async () => ({ last_scraped_at: "2026-10-08T02:27:00Z" }),
    listSeasons: async () => ({
      data: seasons.map((season) => ({ season })),
      meta: { total: seasons.length, limit: seasons.length, offset: 0 },
    }),
    listGames: (...args: unknown[]) => listGames(...args),
    listSchedule: (...args: unknown[]) => listSchedule(...args),
    listHighlights: (...args: unknown[]) => listHighlights(...args),
    getSocialSummary: async () => ({ last_post_at: "2026-01-13T05:00:00Z" }),
    listSocialPosts: (...args: unknown[]) => listSocialPosts(...args),
    listStandings: async () => ({
      data: [
        ...EAST.map((abbreviation, index) =>
          standing({
            team_id: `east-${abbreviation}`,
            abbreviation,
            team_name: `${abbreviation} Team`,
            conference_rank: index + 1,
            ...(abbreviation === "BOS"
              ? { wins: 56, losses: 26, games_back: 0, streak: "L1", last_10: "6-4" }
              : {}),
            ...(abbreviation === "NYK" ? { streak: "W5" } : {}),
          })
        ),
        standing({
          team_id: "west-OKC",
          abbreviation: "OKC",
          team_name: "Oklahoma City Thunder",
          conference: "West",
          conference_rank: 1,
        }),
      ],
      meta: { total: 12, limit: 50, offset: 0 },
    }),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import HomePage from "@/app/page";
import { Providers } from "@/components/providers";

function final(index: number, overrides: Record<string, unknown> = {}) {
  return {
    game_id: `game-${index}`,
    season: "2025-26",
    season_type: "Regular Season",
    game_date: "2026-01-12",
    home_team_id: `home-${index}`,
    away_team_id: `away-${index}`,
    home_team_abbreviation: `H${index}`,
    away_team_abbreviation: `A${index}`,
    home_score: 100 + index,
    away_score: 90 + index,
    winning_team_id: `home-${index}`,
    ...overrides,
  };
}

function scheduled(index: number, overrides: Record<string, unknown> = {}) {
  return {
    game_id: `next-${index}`,
    season: "2025-26",
    game_date: "2026-01-13",
    start_time_et: "19:30:00",
    status: "Scheduled",
    home_team_id: `nh-${index}`,
    away_team_id: `na-${index}`,
    home_team_abbreviation: `NH${index}`,
    away_team_abbreviation: `NA${index}`,
    ...overrides,
  };
}

function page<T>(data: T[]) {
  return { data, meta: { total: data.length, limit: 15, offset: 0 } };
}

function renderHome() {
  render(
    <Providers>
      <HomePage />
    </Providers>
  );
}

describe("home desk", () => {
  beforeEach(() => {
    // Only Date: faking timers too would stall react-query and waitFor.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-13T15:00:00Z"));
    listGames.mockResolvedValue(page([]));
    listSchedule.mockResolvedValue(page([]));
    listHighlights.mockReset();
    listHighlights.mockResolvedValue(page([]));
    listSocialPosts.mockResolvedValue(page([]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("carries the scrape stamp, which is no longer in the header", async () => {
    renderHome();
    expect(await screen.findByText("Scraped 8 Oct 2026, 02:27 UTC")).toBeInTheDocument();
  });

  it("shows last night's slate, capped, and leaves older games out", async () => {
    listGames.mockResolvedValue(
      page([
        ...Array.from({ length: 8 }, (_, index) => final(index)),
        final(99, { game_date: "2026-01-11" }),
      ])
    );
    renderHome();

    expect(await screen.findByRole("heading", { name: "Last night" })).toBeInTheDocument();
    expect(await screen.findByText("Mon 12 Jan · 8 games, 6 shown")).toBeInTheDocument();
    expect(listGames).toHaveBeenCalledWith({ season: "2025-26", limit: 15 });
    expect(screen.getAllByRole("link", { name: /game flow$/ })).toHaveLength(6);
    const card = screen.getByRole("link", { name: "A0 90, H0 100: game flow" });
    expect(card).toHaveAttribute("href", "/games/game-0");
    // Winner in bold, loser muted.
    expect(within(card).getByText("100").parentElement).toHaveClass("font-semibold");
    expect(within(card).getByText("90").parentElement).toHaveClass("text-ink-2");
    expect(screen.queryByText("H99")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All results →" })).toHaveAttribute("href", "/games");
  });

  it("features the day's highlights and notes each game's lead one", async () => {
    listGames.mockResolvedValue(page([final(0), final(1), final(2)]));
    const highlight = (index: number, overrides: Record<string, unknown>) => ({
      highlight_id: `hl-${index}`,
      game_id: `game-${index}`,
      game_date: "2026-01-12",
      season: "2025-26",
      detail: `H${index} 10${index}, A${index} 9${index}.`,
      score: 10 - index,
      ...overrides,
    });
    listHighlights.mockResolvedValue(
      page([
        highlight(0, {
          highlight_type: "win_streak",
          headline: "Thunder win 15th straight",
          is_featured: true,
        }),
        highlight(1, {
          highlight_type: "blown_lead",
          headline: "Heat blow a 22-point lead",
          is_featured: true,
        }),
        highlight(2, {
          highlight_type: "something_new",
          headline: "Jalen Brunson: 34 pts, 5 reb, 8 ast",
          is_featured: false,
        }),
      ])
    );
    renderHome();

    expect(await screen.findByRole("heading", { name: "What stood out" })).toBeInTheDocument();
    // Asked for the same night as the scores above it.
    expect(listHighlights).toHaveBeenCalledWith({
      season: "2025-26",
      game_date: "2026-01-12",
      limit: 15,
    });
    const cards = screen.getAllByRole("link", { name: /^(Win streak|Blown lead)/ });
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute("href", "/games/game-0");
    expect(within(cards[0]).getByText("H0 100, A0 90.")).toBeInTheDocument();
    // Bad news for its subject reads in the loss colour.
    expect(screen.getByText("Win streak")).toHaveClass("text-primary");
    expect(screen.getByText("Blown lead")).toHaveClass("text-destructive");
    // Every game gets its lead line under the score, featured or not.
    const quiet = screen.getByRole("link", { name: "A2 92, H2 102: game flow" });
    expect(within(quiet).getByText("Jalen Brunson: 34 pts, 5 reb, 8 ast")).toBeInTheDocument();
    expect(screen.queryByText("something new")).not.toBeInTheDocument();
  });

  it("leaves the highlights section out when nothing is featured", async () => {
    listGames.mockResolvedValue(page([final(0)]));
    renderHome();

    expect(await screen.findByRole("heading", { name: "Last night" })).toBeInTheDocument();
    await waitFor(() => expect(listHighlights).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { name: "What stood out" })).not.toBeInTheDocument();
  });

  it("reports a highlights failure without hiding the rest of the desk", async () => {
    listGames.mockResolvedValue(page([final(0)]));
    listHighlights.mockRejectedValue(new Error("Warehouse unavailable"));
    renderHome();

    // The query client retries once before giving up.
    expect(
      await screen.findByText("Warehouse unavailable", {}, { timeout: 4000 })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What stood out" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Standings" })).toBeInTheDocument();
  });

  it("does not call an older slate last night", async () => {
    listGames.mockResolvedValue(page([final(0, { game_date: "2026-01-10" })]));
    renderHome();

    expect(await screen.findByText("Sat 10 Jan · 1 game")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Latest results" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Last night" })).not.toBeInTheDocument();
  });

  it("lists today's games with logos and a reason to watch, capped", async () => {
    listGames.mockResolvedValue(page([final(0, { home_team_id: "na-1" })]));
    listSchedule.mockResolvedValue(
      page([
        scheduled(0, {
          away_team_id: "east-NYK",
          away_team_abbreviation: "NYK",
          national_tv: "ESPN, ABC",
        }),
        scheduled(1),
        scheduled(2, { home_team_id: "east-BOS", home_team_abbreviation: "BOS" }),
        ...Array.from({ length: 5 }, (_, index) => scheduled(index + 3)),
        scheduled(50, { game_date: "2026-01-14" }),
      ])
    );
    renderHome();

    const heading = await screen.findByRole("heading", { name: "Games today" });
    // Logo and abbreviation link to the team, as on the schedule page.
    const slate = within(heading.closest("section") as HTMLElement);
    const team = await slate.findByRole("link", { name: "NYK" });
    expect(team).toHaveAttribute("href", "/teams/nyk?season=2025-26");
    expect(team.querySelector("[aria-hidden]")).toHaveStyle({ width: "24px", height: "24px" });
    expect(await screen.findByText("Tue 13 Jan · ET")).toBeInTheDocument();
    // From today on the East coast, not the API server's UTC date.
    expect(listSchedule).toHaveBeenCalledWith({
      season: "2025-26",
      status: "Scheduled",
      from_date: "2026-01-13",
      limit: 15,
    });
    expect(screen.getAllByText("7:30 PM")).toHaveLength(6);
    // Only the nationally televised game carries a network tag.
    expect(screen.getAllByTitle(/^National TV:/)).toHaveLength(1);
    expect(screen.getByTitle("National TV: ESPN, ABC")).toHaveTextContent("ESPN, ABC");
    // A streak of three or more is worth a note; BOS on an L1 is not.
    expect(await screen.findByText("NYK W5")).toBeInTheDocument();
    expect(screen.getByText("NA1 on a back-to-back")).toBeInTheDocument();
    expect(screen.queryByText(/BOS L1/)).not.toBeInTheDocument();
    expect(screen.queryByText("NH50")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All 8 games →" })).toHaveAttribute(
      "href",
      "/schedule?season=2025-26"
    );
  });

  it("labels a future slate as next up", async () => {
    listSchedule.mockResolvedValue(page([scheduled(0, { game_date: "2026-01-15" })]));
    renderHome();

    expect(await screen.findByText("Thu 15 Jan · ET")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Next up" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Full schedule →" })).toBeInTheDocument();
  });

  it("shows every team in each conference with games back, last ten, and streak", async () => {
    renderHome();

    await waitFor(() => {
      expect(screen.getByText("56–26")).toBeInTheDocument();
    });
    const row = screen.getByText("56–26").closest("tr");
    expect(row).toHaveTextContent("1");
    expect(row).toHaveTextContent("BOS");
    expect(row).toHaveTextContent("6-4");
    expect(within(row as HTMLElement).getByText("L1")).toHaveClass("text-destructive");
    expect(screen.getByText("W5")).toHaveClass("text-primary");
    expect(screen.getByText("East")).toBeInTheDocument();
    // All of the conference, not a top-N cut.
    expect(screen.getByText("TOR")).toBeInTheDocument();
    // The play-in line sits under the sixth seed.
    expect(screen.getByText("MIL").closest("tr")).toHaveClass("border-b-rule-strong");
    expect(screen.getByText("OKC").closest("tr")).not.toHaveClass("border-b-rule-strong");
    expect(screen.getByRole("link", { name: "Full standings →" })).toHaveAttribute(
      "href",
      "/standings?season=2025-26"
    );
    expect(screen.queryByText("Season leaders")).not.toBeInTheDocument();
  });

  it("shows the day's top r/nba posts", async () => {
    listSocialPosts.mockResolvedValue(
      page([
        {
          reddit_id: "p1",
          title: "Wembanyama blocks three shots on one possession",
          score: 6204,
          num_comments: 512,
          permalink: "https://www.reddit.com/r/nba/comments/p1/",
          content_type: "highlight",
          is_contested: false,
        },
        {
          reddit_id: "p2",
          title: "Is Boston's defense actually a problem",
          score: 4,
          num_comments: 188,
          permalink: "https://www.reddit.com/r/nba/comments/p2/",
          content_type: "discussion",
          is_contested: true,
        },
      ])
    );
    renderHome();

    const link = await screen.findByRole("link", {
      name: "Wembanyama blocks three shots on one possession",
    });
    expect(link).toHaveAttribute("href", "https://www.reddit.com/r/nba/comments/p1/");
    // Long titles are cut to three lines; the full text stays on hover.
    expect(link).toHaveClass("line-clamp-3");
    expect(link).toHaveAttribute("title", "Wembanyama blocks three shots on one possession");
    expect(listSocialPosts).toHaveBeenCalledWith({
      from_date: "2026-01-12",
      to_date: "2026-01-13",
      sort: "score",
      limit: 3,
    });
    expect(screen.getByText("6,204")).toBeInTheDocument();
    expect(screen.getByText("Highlight")).toBeInTheDocument();
    expect(screen.getByText("Contested")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Social →" })).toHaveAttribute("href", "/social");
  });

  it("says so when the season has no games, schedule, or posts yet", async () => {
    searchParams = "";
    seasons = ["2026-27", "2025-26"];
    try {
      renderHome();
      expect(await screen.findByText("No games yet for this season.")).toBeInTheDocument();
      expect(await screen.findByText("No upcoming games on the schedule.")).toBeInTheDocument();
      expect(await screen.findByText("No posts have been collected yet.")).toBeInTheDocument();
      expect(listGames).toHaveBeenCalledWith({ season: "2026-27", limit: 15 });
      // No slate, so there is no night to ask about.
      expect(listHighlights).not.toHaveBeenCalled();
    } finally {
      searchParams = "season=2025-26";
      seasons = ["2025-26"];
    }
  });
});
