-- Local demo data for /schedule and /predictions. Local only; see `make seed-demo`.
--
-- Inserts, into the latest season already in source.games:
--   * two weeks of Scheduled games from today (ids 0000de30-...), so /schedule
--     has rows and `make ml` has something to score with the real Elo model;
--   * h2h + spreads odds for the first week of them (odds_event_id demo-...).
-- The /predictions scorecard is not faked: `make seed-demo` follows this with
-- `make ml-backfill`, which writes real walk-forward Elo for past Finals.
-- Everything is removed by scripts/demo/clean.sql, which `make seed-demo` runs
-- first so a rerun moves the schedule to the new "today".
BEGIN;

SELECT setseed(0.42);

CREATE TEMP TABLE demo_season ON COMMIT DROP AS
SELECT max(games.season) AS season
FROM source.games;

-- Shrunk season win%, used to make upcoming odds track real team quality.
CREATE TEMP TABLE demo_team_strength ON COMMIT DROP AS
WITH team_results AS (
    SELECT
        games.home_team_id AS team_id,
        (games.home_score > games.away_score)::int AS won
    FROM source.games
    INNER JOIN demo_season
        ON games.season = demo_season.season
    WHERE
        games.season_type = 'Regular Season'
        AND games.status = 'Final'

    UNION ALL

    SELECT
        games.away_team_id AS team_id,
        (games.away_score > games.home_score)::int AS won
    FROM source.games
    INNER JOIN demo_season
        ON games.season = demo_season.season
    WHERE
        games.season_type = 'Regular Season'
        AND games.status = 'Final'
)

SELECT
    teams.team_id,
    (coalesce(sum(team_results.won), 0) + 10.0) / (count(team_results.won) + 20.0) AS win_pct
FROM source.teams
LEFT JOIN team_results
    ON teams.team_id = team_results.team_id
GROUP BY teams.team_id;

-- Each day, shuffle the league and pair it off, so no team plays twice a day.
-- 4 to 8 games a day; arena is the home team's latest one.
INSERT INTO source.games (
    game_id,
    season,
    season_type,
    game_date,
    home_team_id,
    away_team_id,
    home_score,
    away_score,
    arena,
    city,
    state,
    status,
    scraped_at
)
WITH days AS (
    SELECT day_offset
    FROM generate_series(0, 13) AS day_offset
),

shuffled AS (
    SELECT
        days.day_offset,
        teams.team_id,
        row_number() OVER (PARTITION BY days.day_offset ORDER BY random()) AS slot
    FROM days
    CROSS JOIN source.teams
),

pairs AS (
    SELECT
        home_slots.day_offset,
        (home_slots.slot + 1) / 2 AS pair_number,
        home_slots.team_id AS home_team_id,
        away_slots.team_id AS away_team_id
    FROM shuffled AS home_slots
    INNER JOIN shuffled AS away_slots
        ON home_slots.day_offset = away_slots.day_offset
        AND away_slots.slot = home_slots.slot + 1
    WHERE home_slots.slot % 2 = 1
),

home_arenas AS (
    SELECT DISTINCT ON (games.home_team_id)
        games.home_team_id,
        games.arena,
        games.city,
        games.state
    FROM source.games
    WHERE games.arena IS NOT NULL
    ORDER BY
        games.home_team_id,
        games.game_date DESC
)

SELECT
    ('0000de30-0000-4000-8000-' || lpad((pairs.day_offset * 100 + pairs.pair_number)::text, 12, '0'))::uuid,
    demo_season.season,
    'Regular Season',
    current_date + pairs.day_offset,
    pairs.home_team_id,
    pairs.away_team_id,
    NULL,
    NULL,
    home_arenas.arena,
    home_arenas.city,
    home_arenas.state,
    'Scheduled',
    now()
FROM pairs
CROSS JOIN demo_season
LEFT JOIN home_arenas
    ON pairs.home_team_id = home_arenas.home_team_id
WHERE pairs.pair_number <= 4 + pairs.day_offset % 5;

-- Market view: log5 of the two win%s plus a home edge, jittered per game so it
-- disagrees with Elo a little. Books only post about a week out.
CREATE TEMP TABLE demo_market ON COMMIT DROP AS
WITH upcoming AS (
    SELECT
        games.game_id,
        games.game_date,
        games.home_team_id,
        games.away_team_id
    FROM source.games
    WHERE
        games.game_id::text LIKE '0000de30-%'
        AND games.game_date < current_date + 7
),

logits AS (
    SELECT
        upcoming.game_id,
        upcoming.game_date,
        upcoming.home_team_id,
        upcoming.away_team_id,
        ln(home_strength.win_pct / (1 - home_strength.win_pct))
        - ln(away_strength.win_pct / (1 - away_strength.win_pct))
        + 0.35
        + (random() - 0.5) * 0.4 AS home_logit
    FROM upcoming
    INNER JOIN demo_team_strength AS home_strength
        ON upcoming.home_team_id = home_strength.team_id
    INNER JOIN demo_team_strength AS away_strength
        ON upcoming.away_team_id = away_strength.team_id
)

SELECT
    logits.game_id,
    logits.game_date,
    logits.home_team_id,
    logits.away_team_id,
    least(greatest(1 / (1 + exp(-logits.home_logit)), 0.05), 0.95) AS home_wp
FROM logits;

INSERT INTO source.game_odds (
    odds_event_id,
    commence_time,
    home_team_name,
    away_team_name,
    game_id,
    bookmaker,
    market,
    home_price,
    away_price,
    home_implied_wp,
    away_implied_wp,
    home_market_wp,
    away_market_wp,
    spread_home,
    scraped_at
)
WITH book_lines AS (
    SELECT
        demo_market.game_id,
        demo_market.game_date,
        demo_market.home_team_id,
        demo_market.away_team_id,
        books.bookmaker,
        -- Each book shades the consensus by up to a point and a half.
        least(greatest(demo_market.home_wp + (random() - 0.5) * 0.03, 0.05), 0.95) AS home_wp,
        -- About 3 points of spread per 10% of win probability near a pick'em.
        round((-(demo_market.home_wp - 0.5) / 0.03) * 2) / 2 AS spread_home
    FROM demo_market
    CROSS JOIN (VALUES ('draftkings'), ('fanduel')) AS books (bookmaker)
),

-- 4.5% overround split evenly, then converted to American prices.
priced AS (
    SELECT
        book_lines.*,
        book_lines.home_wp + 0.0225 AS home_implied_wp,
        1 - book_lines.home_wp + 0.0225 AS away_implied_wp
    FROM book_lines
)

SELECT
    'demo-' || priced.game_id::text,
    priced.game_date + time '23:30',
    home_teams.full_name,
    away_teams.full_name,
    priced.game_id,
    priced.bookmaker,
    markets.market,
    CASE
        WHEN markets.market = 'spreads' THEN -110
        WHEN priced.home_implied_wp >= 0.5 THEN -round(100 * priced.home_implied_wp / (1 - priced.home_implied_wp))
        ELSE round(100 * (1 - priced.home_implied_wp) / priced.home_implied_wp)
    END,
    CASE
        WHEN markets.market = 'spreads' THEN -110
        WHEN priced.away_implied_wp >= 0.5 THEN -round(100 * priced.away_implied_wp / (1 - priced.away_implied_wp))
        ELSE round(100 * (1 - priced.away_implied_wp) / priced.away_implied_wp)
    END,
    CASE WHEN markets.market = 'spreads' THEN 0.5238095 ELSE priced.home_implied_wp END,
    CASE WHEN markets.market = 'spreads' THEN 0.5238095 ELSE priced.away_implied_wp END,
    CASE WHEN markets.market = 'spreads' THEN 0.5 ELSE priced.home_wp END,
    CASE WHEN markets.market = 'spreads' THEN 0.5 ELSE 1 - priced.home_wp END,
    CASE WHEN markets.market = 'spreads' THEN priced.spread_home END,
    now()
FROM priced
CROSS JOIN (VALUES ('h2h'), ('spreads')) AS markets (market)
INNER JOIN source.teams AS home_teams
    ON priced.home_team_id = home_teams.team_id
INNER JOIN source.teams AS away_teams
    ON priced.away_team_id = away_teams.team_id;

SELECT
    (SELECT count(*) FROM source.games WHERE game_id::text LIKE '0000de30-%') AS demo_games,
    (SELECT count(*) FROM source.game_odds WHERE odds_event_id LIKE 'demo-%') AS demo_odds_rows;

COMMIT;
