import { expect, type Page } from "@playwright/test";

export const PRIMARY_NAV = [
  "Home",
  "Schedule",
  "Players",
  "Teams",
  "Ask",
  "Social",
  "About",
] as const;

export type MockApiOptions = {
  empty?: boolean;
  /** Answer every /api/v1 call with a 500 so ErrorState paths are reachable. */
  fail?: boolean;
  /** Delay every /api/v1 answer, so loading states actually paint. */
  delayMs?: number;
  /**
   * Pad the blown-leads fixture to this many rows, all blown by MIA. The
   * single default row cannot reproduce layout shifts that depend on a full
   * table's height.
   */
  collapseRows?: number;
};

/** Detail the failing mock returns; ErrorState renders it verbatim. */
export const API_FAILURE_DETAIL = "Warehouse unavailable";

export async function mockApi(page: Page, options: MockApiOptions = {}) {
  await page.addInitScript((opts: MockApiOptions) => {
    const empty = Boolean(opts.empty);
    const fail = Boolean(opts.fail);
    const delayMs = Number(opts.delayMs ?? 0);
    const collapseRows = Number(opts.collapseRows ?? 1);
    // Every intercepted URL, so specs can assert on the query params a control
    // actually sent rather than inferring it from unchanged mock rows.
    const calls: string[] = [];
    (window as unknown as { __API_CALLS__: string[] }).__API_CALLS__ = calls;
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.includes("/api/v1/")) {
        return originalFetch(input, init);
      }
      calls.push(url);
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (fail) {
        return json({ detail: "Warehouse unavailable" }, 500);
      }

      if (url.includes("/query")) {
        return json({
          answer: "Kawhi Leonard has 12 back-to-back sets",
          data: [],
          sql: "gold.fct_player_game_logs",
        });
      }

      if (url.includes("/status")) {
        return json({
          data: empty
            ? {
                last_scraped_at: null,
                player_count: 0,
                game_count: 0,
                season_count: 0,
                first_season: "2010-11",
                last_season: null,
              }
            : {
                last_scraped_at: "2026-09-04T04:12:00Z",
                player_count: 2314,
                game_count: 20486,
                season_count: 16,
                first_season: "2010-11",
                last_season: "2025-26",
              },
        });
      }

      // Social is matched ahead of /players and /teams: its paths are distinct,
      // but the generic branches below would swallow a future /social/players.
      if (url.includes("/social/")) {
        const page = (rows: unknown[]) =>
          json({ data: rows, meta: { total: rows.length, limit: 25, offset: 0 } });
        if (url.includes("/social/summary")) {
          return json({
            data: {
              post_count: empty ? 0 : 41,
              author_count: empty ? 0 : 33,
              reported_comment_count: empty ? 0 : 18204,
              captured_comment_count: empty ? 0 : 402,
              contested_post_count: empty ? 0 : 5,
              total_score: empty ? 0 : 120544,
              top_score: empty ? null : 12817,
              first_post_at: empty ? null : "2026-09-04T00:00:00Z",
              last_post_at: empty ? null : "2026-09-11T05:29:41Z",
              last_scraped_at: empty ? null : "2026-09-11T06:00:00Z",
            },
          });
        }
        if (url.includes("/comments")) {
          return page(
            empty
              ? []
              : [
                  {
                    reddit_id: "cmt1",
                    post_reddit_id: "zero1",
                    parent_id: "t3_zero1",
                    author: "DeadEyeDuncan21",
                    body: "Anyone whose case is built on a single conference finals run.",
                    score: 284,
                    created_utc: "2026-09-09T06:00:00Z",
                    permalink: "https://www.reddit.com/r/nba/comments/zero1/cmt1/",
                    is_top_level: true,
                    is_removed: false,
                    author_flair: ":bos-1: Celtics",
                    flair_scope: "team",
                    flair_team_abbreviation: "BOS",
                    flair_team_name: "Boston Celtics",
                  },
                ]
          );
        }
        if (url.includes("/social/posts")) {
          return page(
            empty
              ? []
              : [
                  {
                    reddit_id: "zero1",
                    subreddit: "nba",
                    title: "Most overrated players?",
                    author: "throwaway_hoopshead",
                    score: 0,
                    num_comments: 132,
                    created_utc: "2026-09-09T05:29:22Z",
                    permalink: "https://www.reddit.com/r/nba/comments/zero1/",
                    url: null,
                    flair: null,
                    is_self: true,
                    scraped_at: "2026-09-11T06:00:00Z",
                    tag: null,
                    source: "self",
                    content_type: "discussion",
                    is_contested: true,
                    discussion_ratio: 132,
                    captured_comment_count: 1,
                    top_comment_score: 284,
                    captured_comment_score: 284,
                    top_comment_leverage: null,
                    comment_concentration: null,
                    player_mentions: ["Jaylen Brown"],
                    team_mentions: ["Boston Celtics"],
                    author_flair: null,
                    flair_scope: null,
                    flair_team_abbreviation: null,
                    flair_team_name: null,
                  },
                ]
          );
        }
        if (url.includes("/social/entities")) {
          const isTeam = url.includes("entity_type=team");
          return page(
            empty
              ? []
              : [
                  {
                    entity_id: isTeam ? "team-1" : "player-1",
                    entity_name: isTeam ? "LA Clippers" : "Kawhi Leonard",
                    entity_abbreviation: isTeam ? "LAC" : null,
                    entity_nickname: isTeam ? "Clippers" : null,
                    post_count: 9,
                    comment_count: 63,
                    total_post_score: 41022,
                    top_post_score: 12817,
                    primary_color: isTeam ? "#C8102E" : null,
                    alternate_color: null,
                  },
                ]
          );
        }
        if (url.includes("/social/fanbases")) {
          return page(
            empty
              ? []
              : [
                  {
                    flair_scope: "team",
                    flair_team_id: "team-1",
                    flair_team_abbreviation: "LAL",
                    flair_team_nickname: "Lakers",
                    label: "Los Angeles Lakers",
                    document_count: 84,
                    post_count: 9,
                    comment_count: 75,
                    author_count: 61,
                    primary_color: "#552583",
                    alternate_color: null,
                  },
                ]
          );
        }
        if (url.includes("/social/facets")) {
          return page(
            empty
              ? []
              : [
                  { key: "discussion", post_count: 15, contested_post_count: 5 },
                  { key: "highlight", post_count: 12, contested_post_count: 0 },
                ]
          );
        }
        const composition = url.includes("/social/composition");
        return page(
          empty
            ? []
            : [
                {
                  key: composition ? "self" : "Charania",
                  post_count: 14,
                  self_post_count: 9,
                  link_post_count: 5,
                  total_score: 24108,
                  top_score: 5000,
                  avg_score: 1842,
                  median_score: 1842,
                  total_comments: 4000,
                  median_comments: 318,
                  median_discussion_ratio: 0.2,
                },
              ]
        );
      }

      if (url.includes("/season-stats")) {
        return json({
          data: empty
            ? []
            : [
                {
                  player_id: "00000000-0000-4000-8000-000000202695",
                  season: "2025-26",
                  games_played: 74,
                  ppg: 23.4,
                  rpg: 6.1,
                  apg: 3.2,
                },
              ],
          meta: { total: empty ? 0 : 1, limit: 50, offset: 0 },
        });
      }

      if (url.includes("/game-log")) {
        return json({
          data: empty
            ? []
            : [
                {
                  game_date: "2025-10-22",
                  opponent_abbreviation: "GSW",
                  location: "home",
                  result: "W",
                  minutes: 36.5,
                  points: 28,
                  rebounds: 8,
                  assists: 6,
                  is_back_to_back: false,
                },
              ],
          meta: { total: empty ? 0 : 1, limit: 500, offset: 0 },
        });
      }

      if (url.includes("/back-to-backs")) {
        return json({
          data: {
            player_id: "00000000-0000-4000-8000-000000202695",
            player_name: "Kawhi Leonard",
            total_back_to_backs: 12,
            games_played_in_b2b: 10,
            avg_pts_b2b: 24.1,
            avg_pts_non_b2b: 26.4,
          },
        });
      }

      if (url.includes("/players/compare/head-to-head")) {
        return json({
          data: {
            games_played: 0,
            players: [],
            games: [],
          },
        });
      }

      if (url.includes("/players/compare")) {
        return json({
          data: empty
            ? []
            : [
                {
                  player_id: "00000000-0000-4000-8000-000000202695",
                  full_name: "Kawhi Leonard",
                  team_abbreviation: "LAC",
                  position: "F",
                  career_games_played: 700,
                  seasons_played: 12,
                  first_season: "2011-12",
                  last_season: "2024-25",
                  career_ppg: 19.2,
                  career_rpg: 6.4,
                  career_apg: 3.0,
                },
                {
                  player_id: "00000000-0000-4000-8000-000000201939",
                  full_name: "Stephen Curry",
                  team_abbreviation: "GSW",
                  position: "G",
                  career_games_played: 1000,
                  seasons_played: 16,
                  first_season: "2009-10",
                  last_season: "2024-25",
                  career_ppg: 24.6,
                  career_rpg: 4.7,
                  career_apg: 6.4,
                },
              ],
          meta: { total: empty ? 0 : 2, limit: 2, offset: 0 },
        });
      }

      // Player ids are UUIDs since the provider-independent identity migration.
      const playerMatch = url.match(/\/players\/([0-9a-f-]{36})/i);
      if (playerMatch) {
        const playerId = playerMatch[1];
        const curry = playerId === "00000000-0000-4000-8000-000000201939";
        return json({
          data: {
            player_id: playerId,
            full_name: curry ? "Stephen Curry" : "Kawhi Leonard",
            position: curry ? "G" : "F",
            team_abbreviation: curry ? "GSW" : "LAC",
            is_active: true,
            first_name: curry ? "Stephen" : "Kawhi",
            last_name: curry ? "Curry" : "Leonard",
            career_games_played: curry ? 1000 : 700,
            seasons_played: curry ? 16 : 12,
            first_season: curry ? "2009-10" : "2011-12",
            last_season: "2024-25",
            career_ppg: curry ? 24.6 : 19.2,
            career_rpg: curry ? 4.7 : 6.4,
            career_apg: curry ? 6.4 : 3.0,
            current_season_salary: curry ? 55761217 : 45000000,
            current_remaining_guaranteed: curry ? 101000000 : 90000000,
            current_contract_season: "2024-25",
          },
        });
      }

      if (url.includes("/players")) {
        return json({
          data: empty
            ? []
            : [
                {
                  player_id: "00000000-0000-4000-8000-000000202695",
                  full_name: "Kawhi Leonard",
                  position: "F",
                  team_abbreviation: "LAC",
                  is_active: true,
                  career_games_played: 700,
                  career_ppg: 19.2,
                  mvp_season: "2025-26",
                  mvp_score: 21.4,
                  mvp_rank: 12,
                },
                {
                  player_id: "00000000-0000-4000-8000-000000201939",
                  full_name: "Stephen Curry",
                  position: "G",
                  team_abbreviation: "GSW",
                  is_active: true,
                  career_games_played: 1000,
                  career_ppg: 24.6,
                  mvp_season: "2025-26",
                  mvp_score: 24.9,
                  mvp_rank: 5,
                },
              ],
          meta: { total: empty ? 0 : 2, limit: 25, offset: 0 },
        });
      }

      if (url.includes("/teams/") && url.includes("/games")) {
        return json({
          data: empty
            ? []
            : [
                {
                  game_id: "0022400001",
                  season: "2025-26",
                  game_date: "2024-10-22",
                  location: "away",
                  opponent_abbreviation: "CHI",
                  team_score: 118,
                  opponent_score: 110,
                  is_win: true,
                },
              ],
          meta: { total: empty ? 0 : 1, limit: 82, offset: 0 },
        });
      }

      if (url.includes("/teams/") && url.includes("/record")) {
        return json({
          data: {
            team_id: 1610612744,
            team_name: "Golden State Warriors",
            wins: 10,
            losses: 5,
            win_pct: 0.667,
            games: 15,
          },
        });
      }

      if (/\/teams\/\d+/.test(url)) {
        return json({
          data: {
            team_id: 1610612744,
            abbreviation: "GSW",
            team_name: "Golden State Warriors",
            conference: "West",
            division: "Pacific",
            city: "San Francisco",
            nickname: "Warriors",
            arena_name: "Chase Center",
            arena_latitude: 37.76806,
            arena_longitude: -122.3875,
            current_season_payroll: 51000000,
            current_remaining_guaranteed: 120000000,
            current_contract_season: "2024-25",
            record_season: "2025-26",
            season_record: { wins: 50, losses: 32, win_pct: 0.61, games: 82 },
            play_in_record: { wins: 1, losses: 0, win_pct: 1, games: 1 },
            playoff_record: { wins: 4, losses: 4, win_pct: 0.5, games: 8 },
            luxury_tax: 170814000,
            first_apron: 178132000,
            second_apron: 188931000,
            over_luxury_tax: false,
            over_first_apron: false,
            over_second_apron: false,
            standing: {
              season: "2025-26",
              conference: "West",
              conference_rank: 1,
              wins: 50,
              losses: 32,
              games_back: 0,
            },
          },
        });
      }

      if (url.includes("/teams")) {
        return json({
          data: empty
            ? []
            : [
                {
                  team_id: 1610612744,
                  abbreviation: "GSW",
                  team_name: "Golden State Warriors",
                  conference: "West",
                  division: "Pacific",
                  city: "San Francisco",
                  nickname: "Warriors",
                  wins: 50,
                  losses: 32,
                  win_pct: 0.61,
                  pts_scored_avg: 114.8,
                  pts_allowed_avg: 112.1,
                },
                {
                  team_id: 1610612738,
                  abbreviation: "BOS",
                  team_name: "Boston Celtics",
                  conference: "East",
                  division: "Atlantic",
                  city: "Boston",
                  nickname: "Celtics",
                  wins: 61,
                  losses: 21,
                  win_pct: 0.744,
                  pts_scored_avg: 116.4,
                  pts_allowed_avg: 109.2,
                },
                {
                  team_id: 1610612748,
                  abbreviation: "MIA",
                  team_name: "Miami Heat",
                  conference: "East",
                  division: "Southeast",
                  city: "Miami",
                  nickname: "Heat",
                  wins: 44,
                  losses: 38,
                  win_pct: 0.537,
                  pts_scored_avg: 111.2,
                  pts_allowed_avg: 110.9,
                },
              ],
          meta: { total: empty ? 0 : 3, limit: 50, offset: 0 },
        });
      }

      if (url.includes("/standings")) {
        return json({
          data: empty
            ? []
            : [
                {
                  team_id: 1610612744,
                  abbreviation: "GSW",
                  team_name: "Golden State Warriors",
                  season: "2025-26",
                  season_type: "Regular Season",
                  as_of_date: "2025-04-13",
                  conference: "West",
                  division: "Pacific",
                  conference_rank: 1,
                  division_rank: 1,
                  wins: 50,
                  losses: 32,
                  win_pct: 0.61,
                  games_back: 0,
                  conf_games_back: 0,
                  streak: "W5",
                  last_10: "8-2",
                },
                {
                  team_id: 1610612741,
                  abbreviation: "CHI",
                  team_name: "Chicago Bulls",
                  season: "2025-26",
                  season_type: "Regular Season",
                  as_of_date: "2025-04-13",
                  conference: "East",
                  division: "Central",
                  conference_rank: 5,
                  division_rank: 2,
                  wins: 45,
                  losses: 37,
                  win_pct: 0.549,
                  games_back: 4,
                  conf_games_back: 4,
                  streak: "W2",
                  last_10: "5-5",
                },
              ],
          meta: { total: empty ? 0 : 2, limit: 50, offset: 0 },
        });
      }

      if (url.includes("/seasons")) {
        return json({
          data: empty ? [] : [{ season: "2025-26" }, { season: "2024-25" }],
          meta: { total: empty ? 0 : 2, limit: 2, offset: 0 },
        });
      }

      if (url.includes("/schedule")) {
        return json({
          data: empty
            ? []
            : [
                {
                  game_id: "0022500999",
                  season: "2025-26",
                  game_date: "2026-10-22",
                  status: "Scheduled",
                  home_team_id: 1610612744,
                  away_team_id: 1610612747,
                  home_team_abbreviation: "GSW",
                  away_team_abbreviation: "LAL",
                  arena: "Chase Center",
                  arena_city: "San Francisco",
                  prediction_model_version: "elo-v0",
                  home_win_probability: 0.62,
                  away_win_probability: 0.38,
                  home_moneyline: -150,
                  away_moneyline: 130,
                  home_spread: -3.5,
                },
              ],
          meta: { total: empty ? 0 : 1, limit: 50, offset: 0 },
        });
      }

      if (url.includes("/predictions/scorecard")) {
        return json({
          data: {
            champion_model_version: empty ? null : "elo-v0",
            rows: empty
              ? []
              : [
                  {
                    season: "2025-26",
                    model_name: "elo",
                    model_version: "elo-v0",
                    is_champion: true,
                    n: 1230,
                    logloss: 0.651,
                    brier: 0.228,
                    accuracy: 0.641,
                    home_always_accuracy: 0.552,
                    calibration_error: 0.031,
                    market_n: 900,
                    market_logloss: 0.62,
                    market_brier: 0.213,
                  },
                ],
          },
        });
      }

      if (url.includes("/games/0022400002/play-by-play")) {
        const events = [
          { period: 1, elapsed_seconds: 120, score_home: 2, score_away: 12 },
          { period: 2, elapsed_seconds: 900, score_home: 40, score_away: 61 },
          { period: 3, elapsed_seconds: 1900, score_home: 78, score_away: 90 },
          { period: 4, elapsed_seconds: 2700, score_home: 112, score_away: 113 },
          { period: 4, elapsed_seconds: 2870, score_home: 118, score_away: 115 },
        ].map((event, index) => ({
          game_id: "0022400002",
          action_number: index + 1,
          clock: null,
          ...event,
          score_differential: event.score_home - event.score_away,
        }));
        return json({ data: events, meta: { total: events.length, limit: 0, offset: 0 } });
      }

      if (url.includes("/play-by-play")) {
        return json({ data: [], meta: { total: 0, limit: 0, offset: 0 } });
      }

      // The comeback game the collapse table links to.
      if (url.includes("/box-score")) {
        return json({
          data: empty
            ? []
            : [
                {
                  player_id: "00000000-0000-4000-8000-000000202695",
                  player_name: "Kawhi Leonard",
                  team_id: "00000000-0000-4000-8000-000001610612746",
                  team_abbreviation: "LAC",
                  team_name: "LA Clippers",
                  location: "home",
                  minutes: 36,
                  points: 28,
                  rebounds: 8,
                  assists: 5,
                  field_goals_made: 10,
                  field_goals_attempted: 21,
                  field_goal_pct: 0.476,
                  three_pointers_made: 2,
                  three_pointers_attempted: 6,
                  three_point_pct: 0.333,
                  free_throws_made: 6,
                  free_throws_attempted: 8,
                  free_throw_pct: 0.75,
                  true_shooting_pct: 0.571,
                  plus_minus: -7,
                },
              ],
          meta: { total: empty ? 0 : 1, limit: 1, offset: 0 },
        });
      }

      if (url.includes("/games/0022400002/flow")) {
        return json({
          data: {
            game_id: "0022400002",
            season: "2025-26",
            game_date: "2024-11-02",
            home_team_abbreviation: "BOS",
            away_team_abbreviation: "MIA",
            home_score: 118,
            away_score: 115,
            winning_team_abbreviation: "BOS",
            has_play_by_play: true,
            scoring_play_count: 97,
            max_lead: 21,
            lead_changes: 4,
            ties: 3,
            home_lead_pct: 0.18,
            away_lead_pct: 0.74,
            tied_pct: 0.08,
            largest_lead_blown: 21,
            blown_lead_team_abbreviation: "MIA",
            comeback_team_abbreviation: "BOS",
            blown_lead_period: 3,
            winner_margin_entering_fourth: -9,
            is_wire_to_wire: false,
            overtime_periods: 0,
          },
        });
      }

      if (url.includes("/flow")) {
        return json({
          data: {
            game_id: "0022400001",
            season: "2025-26",
            game_date: "2024-10-22",
            home_team_id: 1610612744,
            away_team_id: 1610612747,
            home_team_abbreviation: "GSW",
            away_team_abbreviation: "LAL",
            has_play_by_play: false,
          },
        });
      }

      // Must precede the generic /games branch.
      if (url.includes("/games/collapses")) {
        const blownLeadTeam = new URL(url, window.location.origin).searchParams.get(
          "blown_lead_team"
        );
        const rows = empty
          ? []
          : [
              {
                game_id: "0022400002",
                season: "2025-26",
                game_date: "2024-11-02",
                home_team_abbreviation: "BOS",
                away_team_abbreviation: "MIA",
                home_score: 118,
                away_score: 115,
                largest_lead_blown: 21,
                blown_lead_team_abbreviation: "MIA",
                comeback_team_abbreviation: "BOS",
                blown_lead_period: 3,
                winner_margin_entering_fourth: -9,
                lead_changes: 4,
                overtime_periods: 0,
              },
            ];
        const padded =
          rows.length === 0
            ? rows
            : Array.from({ length: collapseRows }, (_, index) => ({
                ...rows[0],
                game_id: index === 0 ? rows[0].game_id : `002240100${index}`,
                largest_lead_blown: rows[0].largest_lead_blown - index,
              }));
        const filtered = blownLeadTeam
          ? padded.filter((row) => row.blown_lead_team_abbreviation === blownLeadTeam)
          : padded;
        return json({
          data: filtered,
          meta: { total: filtered.length, limit: 10, offset: 0 },
        });
      }

      if (url.includes("/games")) {
        return json({
          data: empty
            ? []
            : [
                {
                  game_id: "0022400001",
                  season: "2025-26",
                  season_type: "Regular Season",
                  game_date: "2024-10-22",
                  home_team_id: 1610612744,
                  away_team_id: 1610612747,
                  home_team_abbreviation: "GSW",
                  away_team_abbreviation: "LAL",
                  home_score: 120,
                  away_score: 110,
                  score_margin: 10,
                  arena_city: "San Francisco",
                },
              ],
          meta: { total: empty ? 0 : 1, limit: 10, offset: 0 },
        });
      }

      return json({ data: [] });
    };
  }, options);
}

/** Every /api/v1 URL the page has requested so far, in order. */
export async function apiCalls(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __API_CALLS__?: string[] }).__API_CALLS__ ?? []
  );
}

/** Wait until some request carried `fragment`, then return the matching URLs. */
export async function waitForApiCall(page: Page, fragment: string): Promise<string[]> {
  await expect
    .poll(async () => (await apiCalls(page)).filter((url) => url.includes(fragment)).length)
    .toBeGreaterThan(0);
  return (await apiCalls(page)).filter((url) => url.includes(fragment));
}

/** The most recent /api/v1 URL containing `fragment`, or undefined. */
export async function lastApiCall(page: Page, fragment: string): Promise<string | undefined> {
  const calls = await apiCalls(page);
  return calls.filter((url) => url.includes(fragment)).at(-1);
}

export function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

export async function expectPrimaryNav(page: Page) {
  const nav = primaryNav(page);
  for (const label of PRIMARY_NAV) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }
}

export async function expectNo2010Range(page: Page) {
  await expect(page.getByText(/2010-11/)).toHaveCount(0);
  await expect(page.getByText(/since 2010-11/i)).toHaveCount(0);
}
