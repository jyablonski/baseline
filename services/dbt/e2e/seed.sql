-- Sample source data for dbt e2e. Assumes Alembic source tables already exist.

TRUNCATE source.reddit_comments, source.reddit_posts, source.game_predictions,
    source.model_evaluations, source.model_artifacts, source.player_injuries_history,
    source.game_odds, source.player_injuries, source.standings,
    source.player_game_logs, source.play_by_play, source.games,
    source.player_contracts, source.team_payroll, source.players, source.teams
    RESTART IDENTITY CASCADE;

INSERT INTO source.model_artifacts (
    model_version, model_name, artifact, trained_at, is_champion
) VALUES ('elo-v0', 'elo', '{}'::jsonb, NOW(), TRUE);

INSERT INTO source.teams (
    team_id, canonical_slug, abbreviation, full_name, city, nickname, conference, division, scraped_at
) VALUES
    ('7bf8726a-a852-452d-b81f-14839127c5fb', 'golden-state-warriors', 'GSW', 'Golden State Warriors', 'San Francisco', 'Warriors', 'West', 'Pacific', NOW()),
    ('a79dabb2-26c5-443c-bbb4-cabdd8db5958', 'los-angeles-clippers', 'LAC', 'Los Angeles Clippers', 'Los Angeles', 'Clippers', 'West', 'Pacific', NOW()),
    ('a96f53b4-0f5c-4cb6-8b88-21ba05224cae', 'chicago-bulls', 'CHI', 'Chicago Bulls', 'Chicago', 'Bulls', 'East', 'Central', NOW());

INSERT INTO source.players (
    player_id, first_name, last_name, full_name, is_active, position, team_id,
    height, weight, birth_date, from_year, to_year, scraped_at
) VALUES
    ('22222222-2222-4222-8222-222222222222', 'Kawhi', 'Leonard', 'Kawhi Leonard', TRUE, 'F', 'a79dabb2-26c5-443c-bbb4-cabdd8db5958',
     '6-7', 225, '1991-06-29', 2011, 2025, NOW()),
    ('11111111-1111-4111-8111-111111111111', 'Stephen', 'Curry', 'Stephen Curry', TRUE, '1', '7bf8726a-a852-452d-b81f-14839127c5fb',
     '6-2', 185, '1988-03-14', 2009, 2025, NOW());

INSERT INTO source.games (
    game_id, season, season_type, game_date, home_team_id, away_team_id,
    home_score, away_score, arena, city, state, status, scraped_at
) VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2024-25', 'Regular Season', '2024-10-22',
     '7bf8726a-a852-452d-b81f-14839127c5fb', 'a79dabb2-26c5-443c-bbb4-cabdd8db5958', 120, 110, 'Chase Center', 'San Francisco', 'CA', 'Final', NOW()),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2024-25', 'Regular Season', '2024-10-23',
     'a96f53b4-0f5c-4cb6-8b88-21ba05224cae', 'a79dabb2-26c5-443c-bbb4-cabdd8db5958', 105, 112, 'United Center', 'Chicago', 'IL', 'Final', NOW()),
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '2024-25', 'Regular Season', '2024-10-25',
     'a79dabb2-26c5-443c-bbb4-cabdd8db5958', '7bf8726a-a852-452d-b81f-14839127c5fb', 118, 115, 'Crypto.com Arena', 'Los Angeles', 'CA', 'Final', NOW()),
    ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '2024-25', 'Regular Season', '2024-10-27',
     '7bf8726a-a852-452d-b81f-14839127c5fb', 'a96f53b4-0f5c-4cb6-8b88-21ba05224cae', NULL, NULL, 'Chase Center', 'San Francisco', 'CA', 'Scheduled', NOW()),
    -- GSW game Curry sits out: one missed game in three costs availability.
    ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '2024-25', 'Regular Season', '2024-10-30',
     '7bf8726a-a852-452d-b81f-14839127c5fb', 'a96f53b4-0f5c-4cb6-8b88-21ba05224cae', 110, 100, 'Chase Center', 'San Francisco', 'CA', 'Final', NOW()),
    -- Cup final and a playoff game: excluded from, and split out of, the Regular Season MVP score.
    ('ffffffff-ffff-4fff-8fff-ffffffffffff', '2024-25', 'Cup', '2024-12-17',
     'a79dabb2-26c5-443c-bbb4-cabdd8db5958', '7bf8726a-a852-452d-b81f-14839127c5fb', 125, 100, 'T-Mobile Arena', 'Las Vegas', 'NV', 'Final', NOW()),
    ('99999999-9999-4999-8999-999999999999', '2024-25', 'Playoffs', '2025-04-20',
     '7bf8726a-a852-452d-b81f-14839127c5fb', 'a79dabb2-26c5-443c-bbb4-cabdd8db5958', 101, 99, 'Chase Center', 'San Francisco', 'CA', 'Final', NOW());

INSERT INTO source.player_game_logs (
    player_id, game_id, team_id, game_date, season, matchup, wl, min,
    pts, reb, ast, stl, blk, tov, fgm, fga, fg_pct, fg3m, fg3a, fg3_pct,
    ftm, fta, ft_pct, plus_minus, scraped_at
) VALUES
    -- Kawhi: back-to-back on 10/22 and 10/23
    ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a79dabb2-26c5-443c-bbb4-cabdd8db5958', '2024-10-22', '2024-25', 'LAC @ GSW', 'L', 36.0,
     28, 8, 5, 2, 1, 2, 10, 20, 0.500, 2, 5, 0.400, 6, 6, 1.000, -8, NOW()),
    ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'a79dabb2-26c5-443c-bbb4-cabdd8db5958', '2024-10-23', '2024-25', 'LAC @ CHI', 'W', 34.0,
     24, 7, 4, 1, 1, 1, 9, 18, 0.500, 1, 4, 0.250, 5, 5, 1.000, 6, NOW()),
    ('22222222-2222-4222-8222-222222222222', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'a79dabb2-26c5-443c-bbb4-cabdd8db5958', '2024-10-25', '2024-25', 'LAC vs. GSW', 'W', 38.0,
     30, 9, 6, 2, 0, 3, 11, 22, 0.500, 3, 7, 0.429, 5, 6, 0.833, 4, NOW()),
    -- Curry
    ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7bf8726a-a852-452d-b81f-14839127c5fb', '2024-10-22', '2024-25', 'GSW vs. LAC', 'W', 35.0,
     32, 4, 8, 1, 0, 3, 11, 23, 0.478, 6, 12, 0.500, 4, 4, 1.000, 10, NOW()),
    ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '7bf8726a-a852-452d-b81f-14839127c5fb', '2024-10-25', '2024-25', 'GSW @ LAC', 'L', 37.0,
     29, 5, 7, 2, 0, 2, 10, 24, 0.417, 5, 13, 0.385, 4, 4, 1.000, -3, NOW()),
    -- Kawhi's Cup final line would top the ladder if it counted.
    ('22222222-2222-4222-8222-222222222222', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'a79dabb2-26c5-443c-bbb4-cabdd8db5958', '2024-12-17', '2024-25', 'LAC vs. GSW', 'W', 40.0,
     50, 10, 10, 5, 5, 0, 20, 25, 0.800, 5, 8, 0.625, 5, 5, 1.000, 25, NOW()),
    -- Playoffs
    ('11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999', '7bf8726a-a852-452d-b81f-14839127c5fb', '2025-04-20', '2024-25', 'GSW vs. LAC', 'W', 40.0,
     35, 6, 9, 2, 1, 4, 12, 25, 0.480, 6, 14, 0.429, 5, 6, 0.833, 2, NOW()),
    ('22222222-2222-4222-8222-222222222222', '99999999-9999-4999-8999-999999999999', 'a79dabb2-26c5-443c-bbb4-cabdd8db5958', '2025-04-20', '2024-25', 'LAC @ GSW', 'L', 41.0,
     30, 10, 4, 3, 1, 2, 11, 21, 0.524, 2, 6, 0.333, 6, 7, 0.857, -2, NOW());

INSERT INTO source.player_contracts (
    player_id, team_id, player_name, player_name_normalized, season, salary,
    is_fully_guaranteed, remaining_guaranteed, player_age, source_url, scraped_at
) VALUES
    ('11111111-1111-4111-8111-111111111111', '7bf8726a-a852-452d-b81f-14839127c5fb', 'Stephen Curry', 'stephen curry',
     '2024-25', 50000000, TRUE, 101000000, 36,
     'https://www.basketball-reference.com/contracts/GSW.html', NOW()),
    ('11111111-1111-4111-8111-111111111111', '7bf8726a-a852-452d-b81f-14839127c5fb', 'Stephen Curry', 'stephen curry',
     '2025-26', 51000000, TRUE, 101000000, 36,
     'https://www.basketball-reference.com/contracts/GSW.html', NOW()),
    ('22222222-2222-4222-8222-222222222222', 'a79dabb2-26c5-443c-bbb4-cabdd8db5958', 'Kawhi Leonard', 'kawhi leonard',
     '2024-25', 45000000, TRUE, 45000000, 33,
     'https://www.basketball-reference.com/contracts/LAC.html', NOW()),
    ('11111111-1111-4111-8111-111111111111', '7bf8726a-a852-452d-b81f-14839127c5fb', 'Stephen Curry', 'stephen curry',
     '2026-27', 52000000, TRUE, 52000000, 38,
     'https://www.basketball-reference.com/contracts/GSW.html', NOW());

INSERT INTO source.standings (
    team_id, season, season_type, as_of_date, conference, division,
    conference_rank, division_rank, wins, losses, win_pct, games_back,
    conf_games_back, streak, last_10, scraped_at
) VALUES
    ('7bf8726a-a852-452d-b81f-14839127c5fb', '2024-25', 'Regular Season', '2024-10-25', 'West', 'Pacific',
     1, 1, 3, 0, 1.000, 0.0, 0.0, 'W 3', '3-0', NOW()),
    ('a79dabb2-26c5-443c-bbb4-cabdd8db5958', '2024-25', 'Regular Season', '2024-10-25', 'West', 'Pacific',
     2, 2, 2, 1, 0.667, 1.5, 1.5, 'W 1', '2-1', NOW()),
    ('a96f53b4-0f5c-4cb6-8b88-21ba05224cae', '2024-25', 'Regular Season', '2024-10-25', 'East', 'Central',
     5, 3, 1, 2, 0.333, 4.0, 4.0, 'L 2', '1-2', NOW());

INSERT INTO source.team_payroll (
    team_id, season, total_salary,
    remaining_guaranteed, source_url, scraped_at
) VALUES
    ('7bf8726a-a852-452d-b81f-14839127c5fb', '2024-25', 51000000, 102000000,
     'https://www.basketball-reference.com/contracts/GSW.html', NOW()),
    ('7bf8726a-a852-452d-b81f-14839127c5fb', '2025-26', 51000000, 102000000,
     'https://www.basketball-reference.com/contracts/GSW.html', NOW()),
    ('a79dabb2-26c5-443c-bbb4-cabdd8db5958', '2024-25', 45000000, 45000000,
     'https://www.basketball-reference.com/contracts/LAC.html', NOW());

INSERT INTO source.player_injuries (
    player_id, team_id, player_name, player_name_normalized, update_date, description,
    source_url, scraped_at
) VALUES
    ('11111111-1111-4111-8111-111111111111', '7bf8726a-a852-452d-b81f-14839127c5fb', 'Stephen Curry', 'stephen curry', '2024-10-26', 'Out (Ankle) - Left ankle sprain',
     'https://www.basketball-reference.com/friv/injuries.fcgi', NOW());

INSERT INTO source.game_odds (
    odds_event_id, commence_time, home_team_name, away_team_name, game_id,
    bookmaker, market, home_price, away_price, home_implied_wp, away_implied_wp,
    home_market_wp, away_market_wp, spread_home, scraped_at
) VALUES
    ('evt-gsw-chi', '2024-10-27 19:00:00', 'Golden State Warriors', 'Chicago Bulls',
     'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'draftkings', 'h2h', -150, 130, 0.6, 0.4348, 0.58, 0.42, NULL, NOW());

INSERT INTO source.play_by_play (
    game_id, season, action_number, action_id, period, clock,
    score_home, score_away, team_id, player_id, action_type, sub_type,
    description, extras, scraped_at
) VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2024-25', 1, 1, 1, 'PT12M00.00S',
     NULL, NULL, NULL, NULL, 'period', 'start',
     'Start of 1st Period', NULL, NOW()),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2024-25', 2, 2, 1, 'PT11M30.00S',
     2, 0, '7bf8726a-a852-452d-b81f-14839127c5fb', '11111111-1111-4111-8111-111111111111', 'Made Shot', '2pt',
     'Curry 15'' Jump Shot (2 PTS)', NULL, NOW()),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2024-25', 3, 3, 1, 'PT11M00.00S',
     2, 2, 'a79dabb2-26c5-443c-bbb4-cabdd8db5958', '22222222-2222-4222-8222-222222222222', 'Made Shot', '2pt',
     'Leonard 12'' Jump Shot (2 PTS)', NULL, NOW()),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2024-25', 4, 4, 1, 'PT10M30.00S',
     2, 5, 'a79dabb2-26c5-443c-bbb4-cabdd8db5958', '22222222-2222-4222-8222-222222222222', 'Made Shot', '3pt',
     'Leonard 26'' 3PT (5 PTS)', NULL, NOW()),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2024-25', 5, 5, 1, 'PT10M00.00S',
     2, 5, '7bf8726a-a852-452d-b81f-14839127c5fb', '11111111-1111-4111-8111-111111111111', 'Missed Shot', '2pt',
     'MISS Curry 18'' Jump Shot', NULL, NOW()),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2024-25', 6, 6, 1, 'PT9M00.00S',
     5, 5, '7bf8726a-a852-452d-b81f-14839127c5fb', '11111111-1111-4111-8111-111111111111', 'Made Shot', '3pt',
     'Curry 25'' 3PT (5 PTS)', NULL, NOW()),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2024-25', 7, 7, 1, 'PT8M00.00S',
     8, 5, '7bf8726a-a852-452d-b81f-14839127c5fb', '11111111-1111-4111-8111-111111111111', 'Made Shot', '3pt',
     'Curry 27'' 3PT (8 PTS)', NULL, NOW()),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2024-25', 8, 8, 1, 'PT7M00.00S',
     11, 5, '7bf8726a-a852-452d-b81f-14839127c5fb', '11111111-1111-4111-8111-111111111111', 'Made Shot', '3pt',
     'Curry 26'' 3PT (11 PTS)', NULL, NOW()),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2024-25', 9, 9, 1, 'PT6M00.00S',
     13, 5, '7bf8726a-a852-452d-b81f-14839127c5fb', '11111111-1111-4111-8111-111111111111', 'Made Shot', '2pt',
     'Curry 8'' Driving Layup (13 PTS)', NULL, NOW()),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2024-25', 10, 10, 4, 'PT0M00.00S',
     16, 8, '7bf8726a-a852-452d-b81f-14839127c5fb', '11111111-1111-4111-8111-111111111111', 'Made Shot', '3pt',
     'Curry 24'' 3PT (16 PTS)', NULL, NOW());

INSERT INTO source.game_predictions (
    game_id, as_of, model_name, model_version, home_team_id, away_team_id,
    model_wp, market_wp, scraped_at
) VALUES
    ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '2024-10-26 12:00:00', 'elo', 'elo-v0',
     '7bf8726a-a852-452d-b81f-14839127c5fb', 'a96f53b4-0f5c-4cb6-8b88-21ba05224cae', 0.62, 0.58, NOW()),
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '2024-10-24 12:00:00', 'elo', 'elo-v0',
     'a79dabb2-26c5-443c-bbb4-cabdd8db5958', '7bf8726a-a852-452d-b81f-14839127c5fb', 0.47, 0.51, NOW());

INSERT INTO source.reddit_posts (
    reddit_id, subreddit, title, author, score, num_comments, created_utc,
    permalink, url, selftext, flair, author_flair, is_self, scraped_at
) VALUES
    (
        'abc123', 'nba', 'Game Thread: Clippers at Warriors', 'nba_mod',
        120, 2, '2024-10-22 02:00:00',
        'https://www.reddit.com/r/nba/comments/abc123/game_thread/',
        'https://www.reddit.com/r/nba/comments/abc123/game_thread/',
        'Tip-off discussion', 'Game Thread', ':gsw-1: Warriors', TRUE, NOW()
    );

INSERT INTO source.reddit_comments (
    reddit_id, post_reddit_id, parent_id, author, body, author_flair, score, created_utc,
    permalink, scraped_at
) VALUES
    (
        'cmt001', 'abc123', 't3_abc123', 'hoopsfan',
        'Kawhi looks locked in tonight.', ':chi-2: Bulls', 42, '2024-10-22 02:15:00',
        'https://www.reddit.com/r/nba/comments/abc123/game_thread/cmt001/',
        NOW()
    ),
    (
        'cmt002', 'abc123', 't1_cmt001', 'splash',
        'Curry answered immediately.', ':phi: Philippines', 18, '2024-10-22 02:16:00',
        'https://www.reddit.com/r/nba/comments/abc123/game_thread/cmt002/',
        NOW()
    ),
    (
        'cmt003', 'abc123', 't3_abc123', 'boxscorewatcher',
        'Stephen Curry and the Warriors closed it out.', '[LAC] Chris Paul', 9, '2024-10-22 02:17:00',
        'https://www.reddit.com/r/nba/comments/abc123/game_thread/cmt003/',
        NOW()
    ),
    (
        'cmt004', 'abc123', 't3_abc123', 'ghost',
        '[removed]', 'Clippers', 5, '2024-10-22 02:18:00',
        'https://www.reddit.com/r/nba/comments/abc123/game_thread/cmt004/',
        NOW()
    ),
    (
        'cmt005', 'abc123', 't3_abc123', 'aliasfan',
        'Rough night for the gsw bench.', ':sea-2: Supersonics', 12, '2024-10-22 02:19:00',
        'https://www.reddit.com/r/nba/comments/abc123/game_thread/cmt005/',
        NOW()
    ),
    (
        'cmt006', 'abc123', 't3_abc123', 'leaguewide',
        'Good game all round.', 'r/NBA', 3, '2024-10-22 02:20:00',
        'https://www.reddit.com/r/nba/comments/abc123/game_thread/cmt006/',
        NOW()
    );
