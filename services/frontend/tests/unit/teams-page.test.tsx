import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/teams",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("season=2025-26"),
}));

const listTeams = vi.hoisted(() => vi.fn());
const listStandings = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  api: {
    listSeasons: async () => ({
      data: [{ season: "2025-26" }],
      meta: { total: 1, limit: 1, offset: 0 },
    }),
    listTeams: (...args: unknown[]) => listTeams(...args),
    listStandings: (...args: unknown[]) => listStandings(...args),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import TeamsPage from "@/app/teams/page";
import { Providers } from "@/components/providers";
import type { StandingRow } from "@/lib/types";

const EAST = ["DET", "BOS", "NYK", "CLE", "TOR", "ATL", "PHI", "ORL", "MIA", "CHI", "MIL"];

function standing(abbreviation: string, seed: number, conference = "East"): StandingRow {
  return {
    team_id: `t-${abbreviation}`,
    abbreviation,
    team_name: `${abbreviation} Team`,
    season: "2025-26",
    season_type: "Regular Season",
    as_of_date: "2026-04-12",
    conference,
    division: "Atlantic",
    division_rank: null,
    conference_rank: seed,
    playoff_seed: seed,
    wins: 70 - seed * 3,
    losses: 12 + seed * 3,
    win_pct: (70 - seed * 3) / 82,
    games_back: seed === 1 ? 0 : (seed - 1) * 3,
    conf_games_back: null,
    streak: seed === 1 ? "W5" : "L1",
    last_10: seed === 1 ? "8-2" : "5-5",
  } as StandingRow;
}

function renderPage() {
  return render(
    <Providers>
      <TeamsPage />
    </Providers>
  );
}

beforeEach(() => {
  listTeams.mockReset();
  listTeams.mockResolvedValue({ data: [], meta: { total: 0, limit: 30, offset: 0 } });
  listStandings.mockReset();
  // Out of order on purpose: the page sorts by seed.
  const rows = [
    ...EAST.map((abbr, index) => standing(abbr, index + 1)),
    standing("OKC", 1, "West"),
  ];
  listStandings.mockResolvedValue({
    data: rows.reverse(),
    meta: { total: rows.length, limit: 30, offset: 0 },
  });
});

describe("teams page", () => {
  it("ranks each conference by seed with the full standings columns", async () => {
    renderPage();
    const east = await screen.findByRole("region", { name: "Eastern Conference" });
    expect(listStandings).toHaveBeenCalledWith({ season: "2025-26" });
    expect(screen.getByRole("heading", { name: "Teams", level: 1 })).toBeInTheDocument();
    for (const header of ["W-L", "Win %", "GB", "Streak", "L10"]) {
      expect(within(east).getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
    const order = within(east)
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("link")[0].textContent?.trim());
    expect(order).toEqual(EAST);
    const leader = within(east).getByText("DET Team").closest("tr") as HTMLElement;
    expect(within(leader).getByText("67–15")).toBeInTheDocument();
    expect(within(leader).getByText("W5")).toBeInTheDocument();
    expect(within(leader).getByText("8-2")).toBeInTheDocument();
    // Team links keep the season on screen.
    expect(within(leader).getByRole("link", { name: "DET" })).toHaveAttribute(
      "href",
      "/teams/det-team?season=2025-26"
    );
    expect(
      within(screen.getByRole("region", { name: "Western Conference" })).getByText("OKC")
    ).toBeInTheDocument();
  });

  it("rules off the playoff and play-in seeds, and nothing under the last row", async () => {
    renderPage();
    const east = await screen.findByRole("region", { name: "Eastern Conference" });
    const ruled = within(east)
      .getAllByRole("row")
      .filter((row) => row.classList.contains("border-b-rule-strong"))
      .map((row) => within(row).getAllByRole("link")[0].textContent?.trim());
    // ATL is 6th, CHI 10th.
    expect(ruled).toEqual(["ATL", "CHI"]);
    // The West has one team, so no rule under it.
    const west = screen.getByRole("region", { name: "Western Conference" });
    expect(within(west).getByText("OKC").closest("tr")).not.toHaveClass("border-b-rule-strong");
  });

  it("plots offensive vs defensive rating under the standings", async () => {
    listTeams.mockResolvedValue({
      data: [
        {
          team_id: "t-BOS",
          abbreviation: "BOS",
          team_name: "Boston Celtics",
          conference: "East",
          division: "Atlantic",
          pts_scored_avg: 116.4,
          pts_allowed_avg: 109.2,
        },
      ],
      meta: { total: 1, limit: 30, offset: 0 },
    });
    renderPage();
    const plot = await screen.findByRole("heading", { name: "Team offensive vs defensive rating" });
    const east = screen.getByRole("region", { name: "Eastern Conference" });
    expect(east.compareDocumentPosition(plot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("explains an empty season", async () => {
    listStandings.mockResolvedValue({ data: [], meta: { total: 0, limit: 30, offset: 0 } });
    renderPage();
    expect(await screen.findByText("No standings yet")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Team offensive vs defensive rating" })
    ).not.toBeInTheDocument();
  });

  it("shows an error loading the standings", async () => {
    listStandings.mockRejectedValue(new Error("API down"));
    renderPage();
    await waitFor(() => expect(screen.getByText("API down")).toBeInTheDocument(), {
      timeout: 3000,
    });
  });
});
