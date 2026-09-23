-- Seeded gold mart rows for API/MCP integration tests (no dbt required).

TRUNCATE gold.fct_prediction_scorecard, gold.fct_game_odds, gold.fct_game_predictions,
         gold.fct_standings, gold.fct_player_mvp_scores, gold.fct_player_season_stats, gold.fct_player_game_logs,
         gold.fct_team_game_results, gold.fct_games_schedule, gold.dim_players, gold.dim_teams
         RESTART IDENTITY CASCADE;

INSERT INTO gold.dim_teams (
    team_id, abbreviation, team_name, city, nickname, conference, division,
    arena_name, arena_latitude, arena_longitude,
    primary_color, alternate_color,
    current_contract_season, current_season_payroll, current_remaining_guaranteed
) VALUES
    ('7bf8726a-a852-452d-b81f-14839127c5fb', 'GSW', 'Golden State Warriors', 'San Francisco', 'Warriors', 'West', 'Pacific',
     'Chase Center', 37.76806, -122.38750, '#1D428A', '#FFC72C', '2024-25', 51000000, NULL),
    ('a79dabb2-26c5-443c-bbb4-cabdd8db5958', 'LAC', 'LA Clippers', 'Los Angeles', 'Clippers', 'West', 'Pacific',
     'Intuit Dome', 33.94510, -118.34310, '#C8102E', '#1D428A', NULL, NULL, NULL),
    ('a96f53b4-0f5c-4cb6-8b88-21ba05224cae', 'CHI', 'Chicago Bulls', 'Chicago', 'Bulls', 'East', 'Central',
     'United Center', 41.88056, -87.67417, '#CE1141', '#000000', NULL, NULL, NULL);

INSERT INTO gold.dim_players (
    player_id, first_name, last_name, full_name, is_active, position, height, weight,
    birth_date, team_id, from_year, to_year, career_games_played, first_game_date,
    last_game_date, first_season, last_season, seasons_played, career_ppg, career_rpg, career_apg,
    current_contract_season, current_contract_team_id, current_season_salary,
    current_remaining_guaranteed
) VALUES
    ('00000000-0000-4000-8000-000000000102', 'Kawhi', 'Leonard', 'Kawhi Leonard', TRUE, 'F', '6-7', 225,
     '1991-06-29', 'a79dabb2-26c5-443c-bbb4-cabdd8db5958', 2011, 2025, 3, '2024-10-22', '2024-10-25', '2024-25', '2024-25', 1, 27.3, 8.0, 5.0,
     '2024-25', 'a79dabb2-26c5-443c-bbb4-cabdd8db5958', 45000000, NULL),
    ('00000000-0000-4000-8000-000000000101', 'Stephen', 'Curry', 'Stephen Curry', TRUE, 'G', '6-2', 185,
     '1988-03-14', '7bf8726a-a852-452d-b81f-14839127c5fb', 2009, 2025, 2, '2024-10-22', '2024-10-25', '2024-25', '2024-25', 1, 30.5, 4.5, 7.5,
     '2024-25', '7bf8726a-a852-452d-b81f-14839127c5fb', 50000000, 101000000);

INSERT INTO gold.fct_team_game_results (
    game_id, season, season_type, game_date, arena, arena_city, arena_state, score_margin,
    home_team_id, home_team_abbreviation, home_team_name, home_score,
    away_team_id, away_team_abbreviation, away_team_name, away_score,
    winning_team_id, winner_location
) VALUES
    ('00000000-0000-4000-8000-000000000201', '2024-25', 'Regular Season', '2024-10-22',
     'Chase Center', 'San Francisco', 'CA', 10,
     '7bf8726a-a852-452d-b81f-14839127c5fb', 'GSW', 'Golden State Warriors', 120,
     'a79dabb2-26c5-443c-bbb4-cabdd8db5958', 'LAC', 'LA Clippers', 110,
     '7bf8726a-a852-452d-b81f-14839127c5fb', 'home'),
    ('00000000-0000-4000-8000-000000000202', '2024-25', 'Regular Season', '2024-10-23',
     'United Center', 'Chicago', 'IL', 7,
     'a96f53b4-0f5c-4cb6-8b88-21ba05224cae', 'CHI', 'Chicago Bulls', 105,
     'a79dabb2-26c5-443c-bbb4-cabdd8db5958', 'LAC', 'LA Clippers', 112,
     'a79dabb2-26c5-443c-bbb4-cabdd8db5958', 'away'),
    ('00000000-0000-4000-8000-000000000203', '2024-25', 'Regular Season', '2024-10-25',
     'Crypto.com Arena', 'Los Angeles', 'CA', 3,
     'a79dabb2-26c5-443c-bbb4-cabdd8db5958', 'LAC', 'LA Clippers', 118,
     '7bf8726a-a852-452d-b81f-14839127c5fb', 'GSW', 'Golden State Warriors', 115,
     'a79dabb2-26c5-443c-bbb4-cabdd8db5958', 'home');

INSERT INTO gold.fct_player_game_logs (
    player_id, game_id, team_id, game_date, season, matchup, location, opponent_abbreviation,
    result, minutes, points, rebounds, assists, steals, blocks, turnovers,
    field_goals_made, field_goals_attempted, field_goal_pct,
    three_pointers_made, three_pointers_attempted, three_point_pct,
    free_throws_made, free_throws_attempted, free_throw_pct, plus_minus,
    season_type, mvp_box_score, mvp_game_score,
    is_back_to_back, season_game_number, career_game_number,
    player_name, team_abbreviation, team_name
) VALUES
    ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000201', 'a79dabb2-26c5-443c-bbb4-cabdd8db5958', '2024-10-22', '2024-25', 'LAC @ GSW', 'away', 'GSW',
     'L', 36.0, 28, 8, 5, 2, 1, 2, 10, 20, 0.500, 2, 5, 0.400, 6, 6, 1.000, -8, 'Regular Season', 25.4, 20.3,
     FALSE, 1, 1, 'Kawhi Leonard', 'LAC', 'LA Clippers'),
    ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000202', 'a79dabb2-26c5-443c-bbb4-cabdd8db5958', '2024-10-23', '2024-25', 'LAC @ CHI', 'away', 'CHI',
     'W', 34.0, 24, 7, 4, 1, 1, 1, 9, 18, 0.500, 1, 4, 0.250, 5, 5, 1.000, 6, 'Regular Season', 21.3, 25.6,
     TRUE, 2, 2, 'Kawhi Leonard', 'LAC', 'LA Clippers'),
    ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000203', 'a79dabb2-26c5-443c-bbb4-cabdd8db5958', '2024-10-25', '2024-25', 'LAC vs. GSW', 'home', 'GSW',
     'W', 38.0, 30, 9, 6, 2, 0, 3, 11, 22, 0.500, 3, 7, 0.429, 5, 6, 0.833, 4, 'Regular Season', 25.4, 30.5,
     FALSE, 3, 3, 'Kawhi Leonard', 'LAC', 'LA Clippers'),
    ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000201', '7bf8726a-a852-452d-b81f-14839127c5fb', '2024-10-22', '2024-25', 'GSW vs. LAC', 'home', 'LAC',
     'W', 35.0, 32, 4, 8, 1, 0, 3, 11, 23, 0.478, 6, 12, 0.500, 4, 4, 1.000, 10, 'Regular Season', 25.5, 30.6,
     FALSE, 1, 1, 'Stephen Curry', 'GSW', 'Golden State Warriors'),
    ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000203', '7bf8726a-a852-452d-b81f-14839127c5fb', '2024-10-25', '2024-25', 'GSW @ LAC', 'away', 'LAC',
     'L', 37.0, 29, 5, 7, 2, 0, 2, 10, 24, 0.417, 5, 13, 0.385, 4, 4, 1.000, -3, 'Regular Season', 23.1, 18.5,
     FALSE, 2, 2, 'Stephen Curry', 'GSW', 'Golden State Warriors');

INSERT INTO gold.fct_player_season_stats (
    player_id, season, games_played, first_game_date, last_game_date, ppg, rpg, apg
) VALUES
    ('00000000-0000-4000-8000-000000000102', '2024-25', 3, '2024-10-22', '2024-10-25', 27.3, 8.0, 5.0),
    ('00000000-0000-4000-8000-000000000101', '2024-25', 2, '2024-10-22', '2024-10-25', 30.5, 4.5, 7.5);

-- Same numbers the dbt e2e derives: Curry missed one of three GSW games.
INSERT INTO gold.fct_player_mvp_scores (
    player_id, season, season_type, team_id, games_played, team_games, wins, losses,
    win_pct, games_missed_pct, avg_box_score, avg_game_score, availability_multiplier,
    mvp_score, mvp_rank
) VALUES
    ('00000000-0000-4000-8000-000000000102', '2024-25', 'Regular Season', 'a79dabb2-26c5-443c-bbb4-cabdd8db5958',
     3, 3, 2, 1, 0.667, 0.000, 24.0, 25.5, 1.000, 25.5, 1),
    ('00000000-0000-4000-8000-000000000101', '2024-25', 'Regular Season', '7bf8726a-a852-452d-b81f-14839127c5fb',
     2, 3, 1, 1, 0.500, 0.333, 24.3, 24.5, 0.915, 22.5, 2),
    ('00000000-0000-4000-8000-000000000101', '2024-25', 'Playoffs', '7bf8726a-a852-452d-b81f-14839127c5fb',
     1, 1, 1, 0, 1.000, 0.000, 29.3, 35.2, 1.000, 35.2, 1);

INSERT INTO gold.fct_games_schedule (
    game_id, season, season_type, game_date, status, arena, arena_city, arena_state,
    home_team_id, home_team_abbreviation, home_team_name, home_score,
    away_team_id, away_team_abbreviation, away_team_name, away_score
) VALUES
    ('00000000-0000-4000-8000-000000000204', '2024-25', 'Regular Season', CURRENT_DATE + 14, 'Scheduled',
     'Chase Center', 'San Francisco', 'CA',
     '7bf8726a-a852-452d-b81f-14839127c5fb', 'GSW', 'Golden State Warriors', NULL,
     'a79dabb2-26c5-443c-bbb4-cabdd8db5958', 'LAC', 'LA Clippers', NULL),
    ('00000000-0000-4000-8000-000000000205', '2024-25', 'Regular Season', CURRENT_DATE + 15, 'Scheduled',
     'Intuit Dome', 'Inglewood', 'CA',
     'a79dabb2-26c5-443c-bbb4-cabdd8db5958', 'LAC', 'LA Clippers', NULL,
     '7bf8726a-a852-452d-b81f-14839127c5fb', 'GSW', 'Golden State Warriors', NULL);

-- GAME_SCHEDULE carries a champion prediction and two books; the second
-- scheduled game carries neither, so the schedule must render it with nulls.
INSERT INTO gold.fct_game_predictions (
    game_id, as_of, model_name, model_version, home_team_id, away_team_id,
    model_wp, away_wp, market_wp, game_date, season, season_type, game_status, scraped_at
) VALUES
    ('00000000-0000-4000-8000-000000000204', CURRENT_DATE - 1, 'elo', 'elo-v0',
     '7bf8726a-a852-452d-b81f-14839127c5fb', 'a79dabb2-26c5-443c-bbb4-cabdd8db5958',
     0.6, 0.4, 0.62, CURRENT_DATE + 14, '2024-25', 'Regular Season', 'Scheduled', CURRENT_DATE - 1);

INSERT INTO gold.fct_game_odds (
    odds_event_id, commence_time, home_team_name, away_team_name, game_id, bookmaker, market,
    home_price, away_price, home_implied_wp, away_implied_wp, home_market_wp, away_market_wp,
    spread_home, scraped_at
) VALUES
    ('evt-204', CURRENT_DATE + 14, 'Golden State Warriors', 'LA Clippers',
     '00000000-0000-4000-8000-000000000204', 'draftkings', 'h2h',
     -150, 130, 0.6, 0.4347826, 0.58, 0.42, NULL, CURRENT_DATE - 1),
    ('evt-204', CURRENT_DATE + 14, 'Golden State Warriors', 'LA Clippers',
     '00000000-0000-4000-8000-000000000204', 'fanduel', 'h2h',
     -150, 130, 0.6, 0.4347826, 0.58, 0.42, NULL, CURRENT_DATE - 1),
    ('evt-204', CURRENT_DATE + 14, 'Golden State Warriors', 'LA Clippers',
     '00000000-0000-4000-8000-000000000204', 'draftkings', 'spreads',
     -110, -110, 0.5238095, 0.5238095, 0.5, 0.5, -3.5, CURRENT_DATE - 1),
    ('evt-204', CURRENT_DATE + 14, 'Golden State Warriors', 'LA Clippers',
     '00000000-0000-4000-8000-000000000204', 'fanduel', 'spreads',
     -110, -110, 0.5238095, 0.5238095, 0.5, 0.5, -4.5, CURRENT_DATE - 1),
    ('evt-unmatched', CURRENT_DATE + 14, 'Nowhere Team', 'Other Team',
     NULL, 'draftkings', 'h2h',
     100, -120, 0.5, 0.5454545, 0.48, 0.52, NULL, CURRENT_DATE - 1);

INSERT INTO gold.fct_prediction_scorecard (
    season, model_name, model_version, n, logloss, brier, accuracy, home_always_accuracy,
    calibration_error, market_n, market_logloss, market_brier
) VALUES
    ('2024-25', 'elo', 'elo-v0', 1200, 0.65, 0.23, 0.64, 0.55, 0.03, 900, 0.62, 0.21),
    ('2024-25', 'logit', 'logit-v1', 1200, 0.64, 0.225, 0.655, 0.55, 0.025, 900, 0.62, 0.21),
    ('2023-24', 'elo', 'elo-v0', 1230, 0.66, 0.235, 0.63, 0.54, 0.04, NULL, NULL, NULL);

INSERT INTO gold.fct_standings (
    team_id, abbreviation, team_name, season, season_type, as_of_date,
    conference, division, conference_rank, division_rank,
    wins, losses, win_pct, games_back, conf_games_back, streak, last_10
) VALUES
    ('7bf8726a-a852-452d-b81f-14839127c5fb', 'GSW', 'Golden State Warriors', '2024-25', 'Regular Season', '2025-04-13',
     'West', 'Pacific', 1, 1, 50, 32, 0.610, 0, 0, 'W5', '8-2'),
    ('a79dabb2-26c5-443c-bbb4-cabdd8db5958', 'LAC', 'LA Clippers', '2024-25', 'Regular Season', '2025-04-13',
     'West', 'Pacific', 2, 2, 48, 33, 0.593, 1.5, 1.5, 'L1', '6-4'),
    ('a96f53b4-0f5c-4cb6-8b88-21ba05224cae', 'CHI', 'Chicago Bulls', '2024-25', 'Regular Season', '2025-04-13',
     'East', 'Central', 5, 2, 45, 37, 0.549, 4, 4, 'W2', '5-5');
