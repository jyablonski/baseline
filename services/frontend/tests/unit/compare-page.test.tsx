import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPlayer = vi.fn();
const comparePlayers = vi.fn();
const comparePlayersHeadToHead = vi.fn();

const CURRY_ID = "11111111-1111-4111-8111-111111111111";
const DURANT_ID = "22222222-2222-4222-8222-222222222222";
const LEONARD_ID = "33333333-3333-4333-8333-333333333333";

let search = new URLSearchParams(`ids=${CURRY_ID}`);

vi.mock("next/navigation", () => ({
  usePathname: () => "/players/compare",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => search,
}));

vi.mock("@/lib/api", () => ({
  api: {
    comparePlayers: (...args: unknown[]) => comparePlayers(...args),
    comparePlayersHeadToHead: (...args: unknown[]) => comparePlayersHeadToHead(...args),
    searchPlayers: async () => ({ data: [], meta: { total: 0, limit: 8, offset: 0 } }),
    getPlayer: (...args: unknown[]) => getPlayer(...args),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import ComparePlayersPage from "@/app/players/compare/page";
import { Providers } from "@/components/providers";

const PLAYERS: Record<
  string,
  { player_id: string; full_name: string; position: string; team_abbreviation: string }
> = {
  [CURRY_ID]: {
    player_id: CURRY_ID,
    full_name: "Stephen Curry",
    position: "G",
    team_abbreviation: "GSW",
  },
  [DURANT_ID]: {
    player_id: DURANT_ID,
    full_name: "Kevin Durant",
    position: "F",
    team_abbreviation: "PHX",
  },
  [LEONARD_ID]: {
    player_id: LEONARD_ID,
    full_name: "Kawhi Leonard",
    position: "F",
    team_abbreviation: "LAC",
  },
};

function careerRow(id: string, extras: Record<string, number | null>) {
  const player = PLAYERS[id];
  return {
    ...player,
    career_games_played: extras.games,
    seasons_played: extras.seasons,
    career_ppg: extras.ppg,
    career_rpg: extras.rpg,
    career_apg: extras.apg,
    career_avg_plus_minus: extras.plus_minus,
  };
}

function renderPage() {
  return render(
    <Providers>
      <ComparePlayersPage />
    </Providers>
  );
}

describe("compare page", () => {
  beforeEach(() => {
    search = new URLSearchParams(`ids=${CURRY_ID}`);
    getPlayer.mockReset();
    comparePlayers.mockReset();
    comparePlayersHeadToHead.mockReset();
    getPlayer.mockImplementation(async (id: string) => ({
      ...PLAYERS[id],
      is_active: true,
      first_name: PLAYERS[id]?.full_name.split(" ")[0],
      last_name: PLAYERS[id]?.full_name.split(" ")[1],
      career_games_played: 100,
      seasons_played: 1,
      career_ppg: 25,
      career_rpg: 5,
      career_apg: 5,
    }));
    comparePlayers.mockResolvedValue({ data: [], meta: { total: 0, limit: 0, offset: 0 } });
    comparePlayersHeadToHead.mockResolvedValue({
      games_played: 0,
      players: [],
      games: [],
    });
  });

  it("shows full_name for a single selected id instead of #id", async () => {
    renderPage();

    await waitFor(() => {
      expect(getPlayer).toHaveBeenCalledWith(CURRY_ID);
    });
    expect(await screen.findByText("Stephen Curry")).toBeInTheDocument();
    expect(screen.queryByText(`#${CURRY_ID}`)).not.toBeInTheDocument();
    expect(comparePlayers).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Head-to-head" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Compare mode" })).not.toBeInTheDocument();
  });

  it("hides the head-to-head toggle when three players are selected", async () => {
    search = new URLSearchParams(`ids=${CURRY_ID},${DURANT_ID},${LEONARD_ID}`);
    comparePlayers.mockResolvedValue({
      data: [
        careerRow(DURANT_ID, {
          games: 79,
          seasons: 1,
          ppg: 25.9,
          rpg: 5.5,
          apg: 4.8,
          plus_minus: 4.1,
        }),
        careerRow(CURRY_ID, {
          games: 45,
          seasons: 1,
          ppg: 26.5,
          rpg: 3.5,
          apg: 4.7,
          plus_minus: 3.2,
        }),
        careerRow(LEONARD_ID, {
          games: 40,
          seasons: 1,
          ppg: 24.1,
          rpg: 6.2,
          apg: 3.8,
          plus_minus: 1.8,
        }),
      ],
      meta: { total: 3, limit: 3, offset: 0 },
    });

    renderPage();

    expect(await screen.findByRole("link", { name: "Kevin Durant" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Stephen Curry" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Head-to-head" })).not.toBeInTheDocument();
    expect(comparePlayersHeadToHead).not.toHaveBeenCalled();
    expect(comparePlayers).toHaveBeenCalled();
  });

  it("shows the toggle for two players and keeps career aggregates by default", async () => {
    search = new URLSearchParams(`ids=${CURRY_ID},${DURANT_ID}`);
    comparePlayers.mockResolvedValue({
      data: [
        careerRow(DURANT_ID, {
          games: 79,
          seasons: 1,
          ppg: 25.9,
          rpg: 5.5,
          apg: 4.8,
          plus_minus: 4.1,
        }),
        careerRow(CURRY_ID, {
          games: 45,
          seasons: 1,
          ppg: 26.5,
          rpg: 3.5,
          apg: 4.7,
          plus_minus: 3.2,
        }),
      ],
      meta: { total: 2, limit: 2, offset: 0 },
    });

    renderPage();

    expect(await screen.findByRole("button", { name: "Head-to-head" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Season" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Kevin Durant" })).toBeInTheDocument();
    expect(screen.getByText("79")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "+/-" })).toBeInTheDocument();
    expect(screen.getByText("+4.1")).toBeInTheDocument();
    expect(screen.getByText("+3.2")).toBeInTheDocument();
    expect(screen.getByText("+0.9")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "+/-" })).toBeInTheDocument();
    // Coverage is the latest season only, so nothing is described as career.
    expect(screen.queryByText(/career/i)).not.toBeInTheDocument();
    expect(comparePlayersHeadToHead).not.toHaveBeenCalled();
  });

  it("renders career +/- as an em dash when the average is missing", async () => {
    search = new URLSearchParams(`ids=${CURRY_ID},${DURANT_ID}`);
    comparePlayers.mockResolvedValue({
      data: [
        careerRow(DURANT_ID, {
          games: 79,
          seasons: 1,
          ppg: 25.9,
          rpg: 5.5,
          apg: 4.8,
          plus_minus: 4.1,
        }),
        careerRow(CURRY_ID, {
          games: 45,
          seasons: 1,
          ppg: 26.5,
          rpg: 3.5,
          apg: 4.7,
          plus_minus: null,
        }),
      ],
      meta: { total: 2, limit: 2, offset: 0 },
    });

    renderPage();

    expect(await screen.findByRole("link", { name: "Kevin Durant" })).toBeInTheDocument();
    expect(screen.getByText("+4.1")).toBeInTheDocument();
    const differenceCells = screen.getByText("Difference").closest("tr")?.querySelectorAll("td");
    // Player, Games, PPG, RPG, APG, then +/-.
    const plusMinusDiff = differenceCells?.[5];
    expect(plusMinusDiff?.textContent).toBe("—");
    expect(plusMinusDiff?.textContent).not.toBe("+0.0");
    expect(plusMinusDiff?.textContent).not.toBe("+0");
  });

  it("shows regular season and playoff MVP with league rank for the requested season", async () => {
    search = new URLSearchParams(`ids=${CURRY_ID},${DURANT_ID}&stat=mvp&season=2024-25`);
    comparePlayers.mockResolvedValue({
      data: [
        {
          ...careerRow(CURRY_ID, {
            games: 70,
            seasons: 1,
            ppg: 26.4,
            rpg: 4.5,
            apg: 6.1,
            plus_minus: 5.2,
          }),
          mvp_season: "2024-25",
          mvp_score: 27.3,
          mvp_rank: 2,
          playoff_mvp_score: 30.1,
          playoff_mvp_rank: 1,
        },
        {
          ...careerRow(DURANT_ID, {
            games: 65,
            seasons: 1,
            ppg: 25.0,
            rpg: 6.0,
            apg: 4.0,
            plus_minus: 4.0,
          }),
          mvp_season: "2024-25",
          mvp_score: 24.8,
          mvp_rank: 6,
          playoff_mvp_score: null,
          playoff_mvp_rank: null,
        },
      ],
      meta: { total: 2, limit: 2, offset: 0 },
    });

    renderPage();

    expect(await screen.findByRole("link", { name: "Kevin Durant" })).toBeInTheDocument();
    expect(comparePlayers).toHaveBeenCalledWith([CURRY_ID, DURANT_ID], "mvp", "2024-25");
    expect(screen.getByRole("columnheader", { name: /^MVP/ })).toHaveAttribute(
      "data-active",
      "true"
    );
    expect(screen.getByRole("columnheader", { name: "Playoff MVP" })).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText("#6")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
    const differenceCells = screen.getByText("Difference").closest("tr")?.querySelectorAll("td");
    expect(differenceCells?.[6]?.textContent).toBe("+2.5");
    expect(differenceCells?.[7]?.textContent).toBe("—");
    expect(screen.getByText(/2024-25 regular season and playoffs/)).toBeInTheDocument();
  });

  it("renders head-to-head averages and game logs after toggling", async () => {
    search = new URLSearchParams(`ids=${CURRY_ID},${DURANT_ID}`);
    comparePlayers.mockResolvedValue({
      data: [
        careerRow(DURANT_ID, {
          games: 79,
          seasons: 1,
          ppg: 25.9,
          rpg: 5.5,
          apg: 4.8,
          plus_minus: 4.1,
        }),
        careerRow(CURRY_ID, {
          games: 45,
          seasons: 1,
          ppg: 26.5,
          rpg: 3.5,
          apg: 4.7,
          plus_minus: 3.2,
        }),
      ],
      meta: { total: 2, limit: 2, offset: 0 },
    });
    comparePlayersHeadToHead.mockResolvedValue({
      games_played: 1,
      players: [
        {
          player_id: CURRY_ID,
          full_name: "Stephen Curry",
          games: 1,
          mpg: 36.0,
          ppg: 32.0,
          rpg: 4.0,
          apg: 8.0,
          plus_minus: 10.0,
        },
        {
          player_id: DURANT_ID,
          full_name: "Kevin Durant",
          games: 1,
          mpg: 38.0,
          ppg: 30.0,
          rpg: 9.0,
          apg: 6.0,
          plus_minus: -8.0,
        },
      ],
      games: [
        {
          game_id: "0022400001",
          game_date: "2024-10-22",
          season: "2024-25",
          matchup: "GSW vs. PHX",
          lines: [
            {
              player_id: CURRY_ID,
              full_name: "Stephen Curry",
              team_abbreviation: "GSW",
              opponent_abbreviation: "PHX",
              location: "home",
              result: "W",
              minutes: 36,
              points: 32,
              rebounds: 4,
              assists: 8,
              plus_minus: 10,
            },
            {
              player_id: DURANT_ID,
              full_name: "Kevin Durant",
              team_abbreviation: "PHX",
              opponent_abbreviation: "GSW",
              location: "away",
              result: "L",
              minutes: 38,
              points: 30,
              rebounds: 9,
              assists: 6,
              plus_minus: -8,
            },
          ],
        },
      ],
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Head-to-head" }));

    await waitFor(() => {
      expect(comparePlayersHeadToHead).toHaveBeenCalledWith([CURRY_ID, DURANT_ID]);
    });
    expect(await screen.findByText("GSW vs. PHX")).toBeInTheDocument();
    expect(screen.getByText("2024-25")).toBeInTheDocument();
    expect(screen.getByText("32.0")).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader", { name: "+/-" })).toHaveLength(2);
    expect(screen.getByText("+10.0")).toBeInTheDocument();
    expect(screen.getByText("-8.0")).toBeInTheDocument();
    expect(screen.getByText("+10")).toBeInTheDocument();
    expect(screen.getByText("-8")).toBeInTheDocument();
    expect(screen.getByText(/opposite teams/)).toBeInTheDocument();
    expect(screen.queryByText(/Totals cover seasons loaded/)).not.toBeInTheDocument();
  });

  it("shows an empty state when two players have no head-to-head meetings", async () => {
    search = new URLSearchParams(`ids=${CURRY_ID},${DURANT_ID}&view=h2h`);
    comparePlayersHeadToHead.mockResolvedValue({
      games_played: 0,
      players: [
        {
          player_id: CURRY_ID,
          full_name: "Stephen Curry",
          games: 0,
          mpg: null,
          ppg: null,
          rpg: null,
          apg: null,
          plus_minus: null,
        },
        {
          player_id: DURANT_ID,
          full_name: "Kevin Durant",
          games: 0,
          mpg: null,
          ppg: null,
          rpg: null,
          apg: null,
          plus_minus: null,
        },
      ],
      games: [],
    });

    renderPage();

    expect(
      await screen.findByText("No head-to-head games to show. Teammate games are not counted.")
    ).toBeInTheDocument();
    expect(comparePlayers).not.toHaveBeenCalled();
  });
});
