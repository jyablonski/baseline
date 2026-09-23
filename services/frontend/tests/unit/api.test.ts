import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, api, queryErrorMessage } from "@/lib/api";

const PLAYER_A = "00000000-0000-4000-8000-000000000001";
const PLAYER_B = "00000000-0000-4000-8000-000000000002";
const TEAM_GSW = "7bf8726a-a852-452d-b81f-14839127c5fb";
const TEAM_LAL = "8cbd46d2-8092-4b1e-8b24-f31c7692cadd";
const GAME_A = "00000000-0000-4000-8000-000000000101";
const GAME_B = "00000000-0000-4000-8000-000000000102";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses envelopes and query strings", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/players/compare/head-to-head")) {
        return jsonResponse({
          data: {
            games_played: 1,
            players: [
              { player_id: PLAYER_A, full_name: "A", games: 1, mpg: 36, ppg: 20, rpg: 5, apg: 4 },
            ],
            games: [],
          },
        });
      }
      if (url.includes("/players/compare")) {
        return jsonResponse({
          data: [{ player_id: PLAYER_A, full_name: "A", career_games_played: 10 }],
        });
      }
      if (url.includes(`/players/${PLAYER_A}/game-log`)) {
        return jsonResponse([
          {
            game_date: "2024-10-22",
            opponent_abbreviation: "GSW",
            location: "home",
            result: "W",
            minutes: 30,
            points: 20,
            rebounds: 5,
            assists: 4,
            is_back_to_back: false,
          },
        ]);
      }
      if (url.includes(`/players/${PLAYER_A}/back-to-backs`)) {
        return jsonResponse({
          data: {
            player_id: PLAYER_A,
            player_name: "A",
            season: null,
            total_back_to_backs: 2,
            games_played_in_b2b: 2,
            avg_pts_b2b: 20,
            avg_pts_non_b2b: 22,
          },
        });
      }
      if (url.endsWith(`/players/${PLAYER_A}`)) {
        return jsonResponse({
          data: {
            player_id: PLAYER_A,
            full_name: "A",
            is_active: true,
            first_name: "A",
            last_name: "B",
            career_games_played: 1,
            seasons_played: 1,
            career_ppg: 1,
            career_rpg: 1,
            career_apg: 1,
          },
        });
      }
      if (url.includes("/players?")) {
        return jsonResponse({
          data: [
            {
              player_id: PLAYER_A,
              full_name: "Kawhi Leonard",
              position: "F",
              team_abbreviation: "LAC",
              is_active: true,
            },
          ],
          meta: { total: 1, limit: 25, offset: 0 },
        });
      }
      if (url.includes(`/teams/${TEAM_GSW}/games`)) {
        return jsonResponse({ data: [] });
      }
      if (url.includes(`/teams/${TEAM_GSW}/record`)) {
        return jsonResponse({
          data: { team_id: TEAM_GSW, team_name: "GSW", wins: 1, losses: 0, win_pct: 1 },
        });
      }
      if (url.endsWith(`/teams/${TEAM_GSW}`)) {
        return jsonResponse({
          team_id: TEAM_GSW,
          abbreviation: "GSW",
          team_name: "Warriors",
          conference: "West",
          division: "Pacific",
        });
      }
      if (url.includes("/teams")) {
        return jsonResponse({ data: [] });
      }
      if (url.includes("/standings")) {
        return jsonResponse({
          data: [
            {
              team_id: TEAM_GSW,
              abbreviation: "GSW",
              team_name: "Golden State Warriors",
              season: "2024-25",
              conference: "West",
              conference_rank: 1,
              games_back: 0,
            },
          ],
        });
      }
      if (url.includes("/seasons")) {
        return jsonResponse({ data: ["2024-25"] });
      }
      if (url.includes("/play-by-play")) {
        return jsonResponse({
          data: [
            {
              game_id: GAME_A,
              action_number: 2,
              elapsed_seconds: 30,
              score_home: 2,
              score_away: 0,
              score_differential: 2,
            },
          ],
        });
      }
      if (url.includes("/flow")) {
        return jsonResponse({
          data: {
            game_id: GAME_A,
            season: "2024-25",
            game_date: "2024-10-22",
            home_team_id: TEAM_GSW,
            away_team_id: TEAM_LAL,
            has_play_by_play: true,
            biggest_run_label: "GSW 11-0",
          },
        });
      }
      if (url.includes("/schedule")) {
        return jsonResponse({
          data: [
            {
              game_id: GAME_B,
              season: "2026-27",
              game_date: "2026-10-22",
              status: "Scheduled",
              home_team_id: TEAM_GSW,
              away_team_id: TEAM_LAL,
            },
          ],
        });
      }
      if (url.includes("/games")) {
        return jsonResponse({ data: null });
      }
      if (url.includes("/season-stats")) {
        return jsonResponse({
          data: [{ player_id: PLAYER_A, season: "2024-25", games_played: 3, ppg: 27.3 }],
        });
      }
      if (url.includes("/predictions/scorecard")) {
        return jsonResponse({
          data: { champion_model_version: "elo-v0", rows: [{ model_version: "elo-v0" }] },
        });
      }
      if (url.includes("/status")) {
        return jsonResponse({
          data: {
            last_scraped_at: "2026-09-04T04:12:00Z",
            player_count: 2,
            game_count: 3,
            season_count: 1,
            first_season: "2024-25",
            last_season: "2025-26",
          },
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      api.searchPlayers("kawhi", { active: true, team_id: TEAM_GSW, limit: 10, offset: 0 })
    ).resolves.toMatchObject({
      meta: { total: 1 },
    });
    await expect(api.getPlayer(PLAYER_A)).resolves.toMatchObject({ full_name: "A" });
    await expect(
      api.getPlayerGameLog(PLAYER_A, {
        season: "2024-25",
        is_back_to_back: true,
        sort: "points",
        order: "desc",
        limit: 10,
        offset: 0,
      })
    ).resolves.toMatchObject({
      data: [{ points: 20 }],
    });
    await expect(api.getPlayerBackToBacks(PLAYER_A)).resolves.toMatchObject({
      total_back_to_backs: 2,
    });
    await expect(api.comparePlayers([PLAYER_A, PLAYER_B], "games_played")).resolves.toMatchObject({
      data: [{ player_id: PLAYER_A }],
    });
    await expect(api.comparePlayersHeadToHead([PLAYER_A, PLAYER_B])).resolves.toMatchObject({
      games_played: 1,
      players: [{ player_id: PLAYER_A }],
    });
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes(`/players/compare/head-to-head?ids=${PLAYER_A}%2C${PLAYER_B}`)
      )
    ).toBe(true);
    await expect(api.listTeams()).resolves.toMatchObject({ data: [] });
    await expect(api.listTeams({ season: "2025-26" })).resolves.toMatchObject({ data: [] });
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes("/teams?season=2025-26"))
    ).toBe(true);
    await expect(api.getTeam(TEAM_GSW)).resolves.toMatchObject({ abbreviation: "GSW" });
    await expect(
      api.getTeamGames(TEAM_GSW, { location: "away", season_type: "Regular Season" })
    ).resolves.toMatchObject({ data: [] });
    await expect(
      api.getTeamGames(TEAM_GSW, { arena_city: "Denver", limit: 200 })
    ).resolves.toMatchObject({
      data: [],
    });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("arena_city=Denver"))).toBe(
      true
    );
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("limit=200"))).toBe(true);
    await expect(api.getTeamRecord(TEAM_GSW, { since_season: "2010-11" })).resolves.toMatchObject({
      wins: 1,
    });
    await expect(api.getTeamRecord(TEAM_GSW, { arena_city: "Denver" })).resolves.toMatchObject({
      wins: 1,
    });
    await expect(
      api.listStandings({ season: "2024-25", conference: "West" })
    ).resolves.toMatchObject({ data: [{ abbreviation: "GSW" }] });
    await expect(api.listSeasons()).resolves.toMatchObject({ data: [{ season: "2024-25" }] });
    await expect(
      api.listGames({ season: "2024-25", season_type: "Regular Season", limit: 8 })
    ).resolves.toMatchObject({
      data: [],
    });
    await expect(
      api.listSchedule({ season: "2026-27", status: "Scheduled", limit: 50 })
    ).resolves.toMatchObject({
      data: [{ status: "Scheduled" }],
    });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/v1/schedule"))).toBe(
      true
    );
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes("season_type=Regular+Season"))
    ).toBe(true);
    await expect(api.getGamePlayByPlay(GAME_A)).resolves.toMatchObject({
      data: [{ score_differential: 2 }],
    });
    await expect(api.getGameFlow(GAME_A)).resolves.toMatchObject({
      biggest_run_label: "GSW 11-0",
    });
    await expect(api.getPlayerSeasonStats(PLAYER_A)).resolves.toMatchObject({
      data: [{ season: "2024-25" }],
    });
    await expect(api.getStatus()).resolves.toMatchObject({
      last_scraped_at: "2026-09-04T04:12:00Z",
      player_count: 2,
    });
    await expect(api.getPredictionScorecard({ season: "2025-26" })).resolves.toMatchObject({
      champion_model_version: "elo-v0",
    });
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes("/api/v1/predictions/scorecard?season=2025-26")
      )
    ).toBe(true);
  });

  it("handles 204, error bodies, and timeouts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 }))
    );
    await expect(api.listTeams()).resolves.toMatchObject({ data: [] });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ detail: "Player not found" }), { status: 404 })
      )
    );
    await expect(api.getPlayer(PLAYER_B)).rejects.toMatchObject({
      status: 404,
      message: "Player not found",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 }))
    );
    await expect(api.getPlayer(PLAYER_B)).rejects.toMatchObject({ status: 500 });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("timed out", "TimeoutError");
      })
    );
    await expect(api.listTeams()).rejects.toMatchObject({
      message: expect.stringContaining("timed out"),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    await expect(api.listTeams()).rejects.toMatchObject({
      message: expect.stringContaining("Unable to load data"),
    });
  });

  it("handles NLP error and success bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ answer: "Not implemented", data: [], sql: null }, 501))
    );
    await expect(api.queryNlp("How many?")).rejects.toBeInstanceOf(ApiClientError);

    // Typed as fetch so mock.calls is a 2-tuple; the assertion below reads
    // calls[0][1], which does not exist on an untyped zero-arg mock.
    const nlpFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({ answer: "ok", data: [{ a: 1 }], sql: "select 1" })
    );
    vi.stubGlobal("fetch", nlpFetch);
    await expect(api.queryNlp("How many?", "2024-25")).resolves.toMatchObject({ sql: "select 1" });
    const body = JSON.parse(String((nlpFetch.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ question: "How many?", season: "2024-25" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: { answer: "nested" } }))
    );
    await expect(api.queryNlp("How many?")).resolves.toMatchObject({ answer: "nested" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 400))
    );
    await expect(api.queryNlp("How many?")).rejects.toBeInstanceOf(ApiClientError);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("timed out", "TimeoutError");
      })
    );
    await expect(api.queryNlp("How many?")).rejects.toMatchObject({
      message: expect.stringContaining("timed out"),
    });
  });

  it("maps unknown errors", () => {
    expect(queryErrorMessage(new ApiClientError("nope", 400))).toBe("nope");
    expect(queryErrorMessage(new Error("boom"))).toBe("boom");
    expect(queryErrorMessage("weird")).toBe("Something went wrong. Try again in a moment.");
  });
});
