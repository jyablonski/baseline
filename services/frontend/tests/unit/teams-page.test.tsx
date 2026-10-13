import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/teams",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("season=2025-26"),
}));

const listTeams = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    listSeasons: async () => ({
      data: [{ season: "2025-26" }],
      meta: { total: 1, limit: 1, offset: 0 },
    }),
    listTeams: (...args: unknown[]) => listTeams(...args),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import TeamsPage from "@/app/teams/page";
import { Providers } from "@/components/providers";
import type { TeamSummary } from "@/lib/types";

const TEAM_IDS = {
  BKN: "087804fc-096a-4432-b3cc-f20e5e37b1e7",
  BOS: "7927412c-868d-4650-b329-bdc07b20358c",
  DEN: "dee9acef-9d8a-4438-9a0d-fefcaf7cfe1a",
  GSW: "7bf8726a-a852-452d-b81f-14839127c5fb",
  MIN: "3cd9c269-597b-4eab-acb3-2d434f8b1280",
  NYK: "3cbdd44d-e2b2-458a-81cd-b3008d5ebb5b",
  OKC: "bc007f7f-f88d-4699-8325-e2f5a3e32183",
  PHI: "8ea71a5c-0ade-41c4-8558-1e1f76990f9c",
  POR: "250898d8-76ce-4f54-88de-ebcca751231d",
  TOR: "8f941860-dc83-4289-8ed8-7ea9417d53b8",
  UTA: "241af2e1-5322-427d-a549-9b318bba9cbf",
};

function team(
  partial: Partial<TeamSummary> & Pick<TeamSummary, "team_id" | "abbreviation" | "team_name">
): TeamSummary {
  return {
    conference: "East",
    division: "Atlantic",
    ...partial,
  };
}

function abbreviationOrder() {
  return screen
    .getAllByRole("link")
    .map((link) => link.textContent)
    .map((text) => text?.trim().match(/[A-Z]{3}/)?.[0])
    .filter((text): text is string => Boolean(text));
}

describe("teams directory", () => {
  it("shows Regular Season W–L from game results when official ranks are missing", async () => {
    listTeams.mockResolvedValue({
      data: [
        {
          team_id: TEAM_IDS.BOS,
          abbreviation: "BOS",
          team_name: "Boston Celtics",
          conference: "East",
          division: "Atlantic",
          nickname: "Celtics",
          wins: 56,
          losses: 26,
          win_pct: 0.683,
          record_source: "games",
        },
      ],
      meta: { total: 1, limit: 1, offset: 0 },
    });
    render(
      <Providers>
        <TeamsPage />
      </Providers>
    );
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "BOS" })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "BOS" })).toHaveTextContent("BOS");
    expect(screen.getByRole("link", { name: "BOS" }).querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.nba.com/logos/nba/1610612738/primary/L/logo.svg"
    );
    expect(screen.getByRole("link", { name: "BOS" }).querySelector("img")).toHaveAttribute(
      "width",
      "24"
    );
    expect(listTeams).toHaveBeenCalledWith({ season: "2025-26" });
    expect(screen.queryByLabelText("Season")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Teams" })).toBeInTheDocument();
    expect(screen.getByText("56–26")).toBeInTheDocument();
    expect(screen.getByText(".683")).toBeInTheDocument();
    expect(screen.queryByText(/Official ranks aren't available yet/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Conference rank and Regular Season W–L are from game results/)
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Official ranks were not ingested/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Official standings were not ingested/)).not.toBeInTheDocument();
    expect(screen.queryByText(/30 clubs/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Records shown for/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /offensive vs defensive rating/i })
    ).not.toBeInTheDocument();
  });

  it("shows official standings W–L when ranks are present", async () => {
    listTeams.mockResolvedValue({
      data: [
        {
          team_id: TEAM_IDS.BOS,
          abbreviation: "BOS",
          team_name: "Boston Celtics",
          conference: "East",
          division: "Atlantic",
          nickname: "Celtics",
          wins: 61,
          losses: 21,
          win_pct: 0.744,
          record_source: "official",
        },
      ],
      meta: { total: 1, limit: 1, offset: 0 },
    });
    render(
      <Providers>
        <TeamsPage />
      </Providers>
    );
    await waitFor(() => {
      expect(screen.getByText("61–21")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Official ranks aren't available yet/)).not.toBeInTheDocument();
    // The record and win % columns are labelled once per conference.
    for (const conference of ["Eastern Conference", "Western Conference"]) {
      const section = screen.getByRole("heading", { name: conference }).closest("section")!;
      expect(within(section).getByText("W–L")).toBeInTheDocument();
      expect(within(section).getByText("Win %")).toBeInTheDocument();
    }
  });

  it("orders each division by Regular Season standings quality, not alphabetically", async () => {
    listTeams.mockResolvedValue({
      data: [
        team({
          team_id: TEAM_IDS.BKN,
          abbreviation: "BKN",
          team_name: "Brooklyn Nets",
          nickname: "Nets",
          wins: 20,
          losses: 62,
          win_pct: 0.244,
        }),
        team({
          team_id: TEAM_IDS.BOS,
          abbreviation: "BOS",
          team_name: "Boston Celtics",
          nickname: "Celtics",
          wins: 56,
          losses: 26,
          win_pct: 0.683,
        }),
        team({
          team_id: TEAM_IDS.NYK,
          abbreviation: "NYK",
          team_name: "New York Knicks",
          nickname: "Knicks",
          wins: 52,
          losses: 29,
          win_pct: 0.642,
        }),
        team({
          team_id: TEAM_IDS.PHI,
          abbreviation: "PHI",
          team_name: "Philadelphia 76ers",
          nickname: "76ers",
          wins: 45,
          losses: 37,
          win_pct: 0.549,
        }),
        team({
          team_id: TEAM_IDS.TOR,
          abbreviation: "TOR",
          team_name: "Toronto Raptors",
          nickname: "Raptors",
          wins: 46,
          losses: 36,
          win_pct: 0.561,
        }),
        team({
          team_id: TEAM_IDS.DEN,
          abbreviation: "DEN",
          team_name: "Denver Nuggets",
          conference: "West",
          division: "Northwest",
          nickname: "Nuggets",
          wins: 54,
          losses: 28,
          win_pct: 0.659,
        }),
        team({
          team_id: TEAM_IDS.MIN,
          abbreviation: "MIN",
          team_name: "Minnesota Timberwolves",
          conference: "West",
          division: "Northwest",
          nickname: "Timberwolves",
          wins: 49,
          losses: 33,
          win_pct: 0.598,
        }),
        team({
          team_id: TEAM_IDS.OKC,
          abbreviation: "OKC",
          team_name: "Oklahoma City Thunder",
          conference: "West",
          division: "Northwest",
          nickname: "Thunder",
          wins: 64,
          losses: 17,
          win_pct: 0.79,
        }),
        team({
          team_id: TEAM_IDS.POR,
          abbreviation: "POR",
          team_name: "Portland Trail Blazers",
          conference: "West",
          division: "Northwest",
          nickname: "Trail Blazers",
          wins: 42,
          losses: 40,
          win_pct: 0.512,
        }),
        team({
          team_id: TEAM_IDS.UTA,
          abbreviation: "UTA",
          team_name: "Utah Jazz",
          conference: "West",
          division: "Northwest",
          nickname: "Jazz",
          wins: 22,
          losses: 60,
          win_pct: 0.268,
        }),
      ],
      meta: { total: 10, limit: 10, offset: 0 },
    });
    render(
      <Providers>
        <TeamsPage />
      </Providers>
    );
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "BOS" })).toBeInTheDocument();
    });
    expect(abbreviationOrder()).toEqual([
      "BOS",
      "NYK",
      "TOR",
      "PHI",
      "BKN",
      "OKC",
      "DEN",
      "MIN",
      "POR",
      "UTA",
    ]);
  });

  it("prefers official division rank over W–L when ranks are on the payload", async () => {
    listTeams.mockResolvedValue({
      data: [
        team({
          team_id: TEAM_IDS.BOS,
          abbreviation: "BOS",
          team_name: "Boston Celtics",
          nickname: "Celtics",
          wins: 56,
          losses: 26,
          win_pct: 0.683,
          division_rank: 2,
        }),
        team({
          team_id: TEAM_IDS.NYK,
          abbreviation: "NYK",
          team_name: "New York Knicks",
          nickname: "Knicks",
          wins: 52,
          losses: 29,
          win_pct: 0.642,
          division_rank: 1,
        }),
      ],
      meta: { total: 2, limit: 2, offset: 0 },
    });
    render(
      <Providers>
        <TeamsPage />
      </Providers>
    );
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "NYK" })).toBeInTheDocument();
    });
    expect(abbreviationOrder()).toEqual(["NYK", "BOS"]);
  });

  it("plots offensive vs defensive rating under the conference columns when averages exist", async () => {
    listTeams.mockResolvedValue({
      data: [
        team({
          team_id: TEAM_IDS.BOS,
          abbreviation: "BOS",
          team_name: "Boston Celtics",
          nickname: "Celtics",
          wins: 56,
          losses: 26,
          win_pct: 0.683,
          pts_scored_avg: 116.4,
          pts_allowed_avg: 109.2,
        }),
        team({
          team_id: TEAM_IDS.GSW,
          abbreviation: "GSW",
          team_name: "Golden State Warriors",
          conference: "West",
          division: "Pacific",
          nickname: "Warriors",
          wins: 50,
          losses: 32,
          win_pct: 0.61,
          pts_scored_avg: 114.8,
          pts_allowed_avg: 112.1,
        }),
      ],
      meta: { total: 2, limit: 2, offset: 0 },
    });
    render(
      <Providers>
        <TeamsPage />
      </Providers>
    );
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Eastern Conference" })).toBeInTheDocument();
    });
    const plotHeading = screen.getByRole("heading", {
      name: "Team offensive vs defensive rating",
    });
    expect(plotHeading).toBeInTheDocument();
    expect(screen.queryByText(/possession-adjusted ORtg/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/defensive axis is inverted/i)).not.toBeInTheDocument();
    const east = screen.getByRole("heading", { name: "Eastern Conference" });
    expect(
      east.compareDocumentPosition(plotHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
