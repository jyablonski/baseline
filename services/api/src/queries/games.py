"""SQL against gold team and player game facts."""

from __future__ import annotations

from sqlalchemy import text

LIST_GAMES_COUNT = text(
    """
    SELECT count(*) AS total
    FROM gold.fct_team_game_results
    WHERE
        (CAST(:season AS text) IS NULL OR fct_team_game_results.season = :season)
        AND (CAST(:season_type AS text) IS NULL OR fct_team_game_results.season_type = :season_type)
        AND (CAST(:game_date AS date) IS NULL OR fct_team_game_results.game_date = :game_date)
    """
)

# Final games, newest first, with what a results list needs to label them:
# each side's conference (a playoff series across them is the Finals), the
# game's number within its playoff series, and its lead highlight.
LIST_GAMES = text(
    """
    WITH home_teams AS (
        SELECT
            dim_teams.team_id,
            dim_teams.arena_name,
            dim_teams.city,
            dim_teams.conference
        FROM gold.dim_teams
    ),

    away_teams AS (
        SELECT
            dim_teams.team_id,
            dim_teams.conference
        FROM gold.dim_teams
    ),

    -- Two teams meet in at most one series a season, so the pair numbers it.
    series_games AS (
        SELECT
            fct_team_game_results.game_id,
            row_number() OVER (
                PARTITION BY
                    fct_team_game_results.season,
                    least(fct_team_game_results.home_team_id, fct_team_game_results.away_team_id),
                    greatest(fct_team_game_results.home_team_id, fct_team_game_results.away_team_id)
                ORDER BY
                    fct_team_game_results.game_date,
                    fct_team_game_results.game_id
            ) AS series_game_number
        FROM gold.fct_team_game_results
        WHERE fct_team_game_results.season_type = 'Playoffs'
    ),

    lead_highlights AS (
        SELECT
            fct_daily_highlights.game_id,
            fct_daily_highlights.headline
        FROM gold.fct_daily_highlights
        WHERE fct_daily_highlights.game_rank = 1
    )

    SELECT
        fct_team_game_results.game_id,
        fct_team_game_results.season,
        fct_team_game_results.season_type,
        fct_team_game_results.game_date,
        coalesce(nullif(btrim(fct_team_game_results.arena), ''), home_teams.arena_name) AS arena,
        -- Only borrow the home team's city when the row is at the home team's
        -- own building. A neutral site names a real arena with a blank city, and
        -- filling that from the home team files a London or Mexico City game
        -- under Memphis or Detroit.
        CASE
            WHEN nullif(btrim(fct_team_game_results.arena), '') IS NULL
                OR btrim(fct_team_game_results.arena) = home_teams.arena_name
                THEN coalesce(nullif(btrim(fct_team_game_results.arena_city), ''), home_teams.city)
            ELSE nullif(btrim(fct_team_game_results.arena_city), '')
        END AS arena_city,
        fct_team_game_results.arena_state,
        fct_team_game_results.home_team_id,
        fct_team_game_results.home_team_abbreviation,
        fct_team_game_results.home_team_name,
        fct_team_game_results.home_score,
        fct_team_game_results.away_team_id,
        fct_team_game_results.away_team_abbreviation,
        fct_team_game_results.away_team_name,
        fct_team_game_results.away_score,
        fct_team_game_results.winning_team_id,
        fct_team_game_results.winner_location,
        fct_team_game_results.score_margin,
        home_teams.conference AS home_team_conference,
        away_teams.conference AS away_team_conference,
        series_games.series_game_number,
        lead_highlights.headline AS lead_highlight,
        fct_game_flow.largest_lead_blown,
        fct_game_upsets.winner_market_wp
    FROM gold.fct_team_game_results
    LEFT JOIN home_teams
        ON home_teams.team_id = fct_team_game_results.home_team_id
    LEFT JOIN away_teams
        ON away_teams.team_id = fct_team_game_results.away_team_id
    LEFT JOIN series_games
        ON series_games.game_id = fct_team_game_results.game_id
    LEFT JOIN lead_highlights
        ON lead_highlights.game_id = fct_team_game_results.game_id
    LEFT JOIN gold.fct_game_flow
        ON fct_game_flow.game_id = fct_team_game_results.game_id
    LEFT JOIN gold.fct_game_upsets
        ON fct_game_upsets.game_id = fct_team_game_results.game_id
    WHERE
        (CAST(:season AS text) IS NULL OR fct_team_game_results.season = :season)
        AND (CAST(:season_type AS text) IS NULL OR fct_team_game_results.season_type = :season_type)
        AND (CAST(:game_date AS date) IS NULL OR fct_team_game_results.game_date = :game_date)
    ORDER BY
        fct_team_game_results.game_date DESC,
        fct_team_game_results.game_id DESC
    LIMIT :limit OFFSET :offset
    """
)

# Every date with a Final game, newest first, for the results date picker.
LIST_GAME_DATES = text(
    """
    SELECT
        fct_team_game_results.game_date,
        fct_team_game_results.season,
        count(*) AS game_count
    FROM gold.fct_team_game_results
    WHERE (CAST(:season AS text) IS NULL OR fct_team_game_results.season = :season)
    GROUP BY
        fct_team_game_results.game_date,
        fct_team_game_results.season
    ORDER BY fct_team_game_results.game_date DESC
    """
)

# Every date with a game still to be played from :from_date on, for the
# schedule's date picker. "Scheduled" means not Final, the same rule
# SCHEDULE_FILTERS applies for status=Scheduled.
LIST_SCHEDULE_DATES = text(
    """
    SELECT
        fct_games_schedule.game_date,
        fct_games_schedule.season,
        count(*) AS game_count
    FROM gold.fct_games_schedule
    WHERE
        fct_games_schedule.game_date >= :from_date
        AND (CAST(:season AS text) IS NULL OR fct_games_schedule.season = :season)
        AND lower(fct_games_schedule.status) NOT IN ('final', '3')
    GROUP BY
        fct_games_schedule.game_date,
        fct_games_schedule.season
    ORDER BY fct_games_schedule.game_date ASC
    """
)

GAME_EXISTS = text(
    """
    SELECT 1
    FROM gold.fct_team_game_results
    WHERE game_id = :game_id
    """
)

# Any game on the schedule, in any state. GAME_EXISTS covers Finals only.
GAME_ON_SCHEDULE = text(
    """
    SELECT 1
    FROM gold.fct_games_schedule
    WHERE fct_games_schedule.game_id = :game_id
    """
)

LIST_PLAY_BY_PLAY = text(
    """
    SELECT
        fct_play_by_play_scoring.game_id,
        fct_play_by_play_scoring.action_number,
        fct_play_by_play_scoring.period,
        fct_play_by_play_scoring.clock,
        fct_play_by_play_scoring.clock_remaining_seconds,
        fct_play_by_play_scoring.elapsed_seconds,
        fct_play_by_play_scoring.score_home,
        fct_play_by_play_scoring.score_away,
        fct_play_by_play_scoring.score_differential,
        fct_play_by_play_scoring.home_points,
        fct_play_by_play_scoring.away_points,
        fct_play_by_play_scoring.points_scored,
        fct_play_by_play_scoring.scoring_side,
        fct_play_by_play_scoring.team_id,
        fct_play_by_play_scoring.player_id,
        fct_play_by_play_scoring.action_type,
        fct_play_by_play_scoring.sub_type,
        fct_play_by_play_scoring.description
    FROM gold.fct_play_by_play_scoring
    WHERE fct_play_by_play_scoring.game_id = :game_id
    ORDER BY
        fct_play_by_play_scoring.elapsed_seconds,
        fct_play_by_play_scoring.action_number
    """
)

GET_GAME_FLOW = text(
    """
    WITH home_teams AS (
        SELECT
            team_id,
            primary_color,
            alternate_color
        FROM gold.dim_teams
    ),
    away_teams AS (
        SELECT
            team_id,
            primary_color,
            alternate_color
        FROM gold.dim_teams
    )
    SELECT
        fct_team_game_results.game_id,
        fct_team_game_results.season,
        fct_team_game_results.game_date,
        fct_team_game_results.home_team_id,
        fct_team_game_results.home_team_abbreviation,
        fct_team_game_results.home_team_name,
        home_teams.primary_color AS home_primary_color,
        home_teams.alternate_color AS home_alternate_color,
        fct_team_game_results.home_score,
        fct_team_game_results.away_team_id,
        fct_team_game_results.away_team_abbreviation,
        fct_team_game_results.away_team_name,
        away_teams.primary_color AS away_primary_color,
        away_teams.alternate_color AS away_alternate_color,
        fct_team_game_results.away_score,
        fct_team_game_results.winning_team_id,
        fct_game_flow.winning_team_abbreviation,
        fct_team_game_results.winner_location,
        fct_game_flow.scoring_play_count,
        fct_game_flow.max_home_lead,
        fct_game_flow.max_away_lead,
        fct_game_flow.max_lead,
        fct_game_flow.lead_changes,
        fct_game_flow.ties,
        fct_game_flow.home_lead_seconds,
        fct_game_flow.away_lead_seconds,
        fct_game_flow.tied_seconds,
        fct_game_flow.home_lead_pct,
        fct_game_flow.away_lead_pct,
        fct_game_flow.tied_pct,
        fct_game_flow.game_elapsed_seconds,
        fct_game_flow.biggest_run_team_abbreviation,
        fct_game_flow.biggest_run_winner_points,
        fct_game_flow.biggest_run_opponent_points,
        fct_game_flow.biggest_run_start_seconds,
        fct_game_flow.biggest_run_end_seconds,
        fct_game_flow.biggest_run_label,
        fct_game_flow.final_period,
        fct_game_flow.overtime_periods,
        fct_game_flow.went_to_overtime,
        fct_game_flow.largest_lead_blown,
        fct_game_flow.blown_lead_team_abbreviation,
        fct_game_flow.comeback_team_abbreviation,
        fct_game_flow.blown_lead_period,
        fct_game_flow.blown_lead_elapsed_seconds,
        fct_game_flow.is_wire_to_wire,
        fct_game_flow.winner_halftime_margin,
        fct_game_flow.winner_margin_entering_fourth
    FROM gold.fct_team_game_results
    LEFT JOIN gold.fct_game_flow
        ON fct_game_flow.game_id = fct_team_game_results.game_id
    LEFT JOIN home_teams
        ON home_teams.team_id = fct_team_game_results.home_team_id
    LEFT JOIN away_teams
        ON away_teams.team_id = fct_team_game_results.away_team_id
    WHERE fct_team_game_results.game_id = :game_id
    """
)

SCHEDULE_FILTERS = """
    fct_games_schedule.game_date >= :from_date
    AND (:season IS NULL OR fct_games_schedule.season = :season)
    AND (
        :status IS NULL
        OR (
            lower(:status) = 'scheduled'
            AND lower(fct_games_schedule.status) NOT IN ('final', '3')
        )
        OR fct_games_schedule.status = :status
    )
    AND (
        :team_id IS NULL
        OR fct_games_schedule.home_team_id = :team_id
        OR fct_games_schedule.away_team_id = :team_id
    )
    AND (
        :opponent_team_id IS NULL
        OR (
            :team_id IS NOT NULL
            AND (
                (
                    fct_games_schedule.home_team_id = :team_id
                    AND fct_games_schedule.away_team_id = :opponent_team_id
                )
                OR (
                    fct_games_schedule.away_team_id = :team_id
                    AND fct_games_schedule.home_team_id = :opponent_team_id
                )
            )
        )
    )
    AND (
        :location IS NULL
        OR (
            :team_id IS NOT NULL
            AND (
                (:location = 'home' AND fct_games_schedule.home_team_id = :team_id)
                OR (:location = 'away' AND fct_games_schedule.away_team_id = :team_id)
            )
        )
    )
    AND (
        :arena_city IS NULL
        OR (
            CASE
                WHEN nullif(btrim(fct_games_schedule.arena), '') IS NULL
                    OR btrim(fct_games_schedule.arena) = home_teams.arena_name
                    THEN coalesce(nullif(btrim(fct_games_schedule.arena_city), ''), home_teams.city)
                ELSE nullif(btrim(fct_games_schedule.arena_city), '')
            END
        ) ILIKE :arena_city
    )
"""

LIST_SCHEDULE_COUNT = text(
    f"""
    WITH home_teams AS (
        SELECT
            team_id,
            arena_name,
            city
        FROM gold.dim_teams
    )
    SELECT count(*) AS total
    FROM gold.fct_games_schedule
    LEFT JOIN home_teams
        ON home_teams.team_id = fct_games_schedule.home_team_id
    WHERE {SCHEDULE_FILTERS}
    """
)


def _either_team(home_column: str, away_column: str) -> str:
    """Optional :team filter matching either side of a game."""
    return f"""(
            CAST(:team AS text) IS NULL
            OR :team IN (
                {home_column},
                {away_column}
            )
        )"""


def _pregame_records(game: str) -> str:
    """Each side's W-L entering `game`, for a CROSS JOIN LATERAL.

    From Final results dated before it, in the same season and season type.
    Today's fct_standings would be wrong for a past game: it is a
    season-to-date upsert.
    """
    return f"""
        SELECT
            count(*) FILTER (
                WHERE fct_team_game_results.winning_team_id = {game}.home_team_id
            ) AS home_wins,
            count(*) FILTER (
                WHERE
                    {game}.home_team_id IN (
                        fct_team_game_results.home_team_id,
                        fct_team_game_results.away_team_id
                    )
                    AND fct_team_game_results.winning_team_id <> {game}.home_team_id
            ) AS home_losses,
            count(*) FILTER (
                WHERE fct_team_game_results.winning_team_id = {game}.away_team_id
            ) AS away_wins,
            count(*) FILTER (
                WHERE
                    {game}.away_team_id IN (
                        fct_team_game_results.home_team_id,
                        fct_team_game_results.away_team_id
                    )
                    AND fct_team_game_results.winning_team_id <> {game}.away_team_id
            ) AS away_losses
        FROM gold.fct_team_game_results
        WHERE
            fct_team_game_results.season = {game}.season
            AND fct_team_game_results.season_type IS NOT DISTINCT FROM {game}.season_type
            AND fct_team_game_results.game_date < {game}.game_date
            AND (
                fct_team_game_results.home_team_id IN ({game}.home_team_id, {game}.away_team_id)
                OR fct_team_game_results.away_team_id IN ({game}.home_team_id, {game}.away_team_id)
            )
    """


# Notable players ruled out, per side, for upsets. Day To Day is left off on
# purpose: a game decided without someone is the point, not a doubt.
NOTABLE_ABSENCES_CTE = """
    notable_absences AS (
        SELECT
            fct_game_injuries.game_id,
            array_agg(fct_game_injuries.player_name ORDER BY fct_game_injuries.player_name)
                FILTER (WHERE fct_game_injuries.side = 'home') AS home_notable_out,
            array_agg(fct_game_injuries.player_name ORDER BY fct_game_injuries.player_name)
                FILTER (WHERE fct_game_injuries.side = 'away') AS away_notable_out
        FROM gold.fct_game_injuries
        WHERE
            fct_game_injuries.is_notable
            AND fct_game_injuries.injury_status IN ('Out', 'Out For Season')
            AND (CAST(:game_id AS uuid) IS NULL OR fct_game_injuries.game_id = :game_id)
        GROUP BY fct_game_injuries.game_id
    )"""


# Each game's report in numbers, for the schedule's Injuries column. Nearly every
# game has someone listed, so a cell only fills for a key player, Day To Day
# included. :game_id narrows it to one game for GET_GAME; NULL means all.
GAME_INJURY_COUNTS_CTE = """
    game_injury_counts AS (
        SELECT
            fct_game_injuries.game_id,
            count(*) FILTER (
                WHERE fct_game_injuries.injury_status IN ('Out', 'Out For Season')
            )::integer AS injuries_out,
            count(*) FILTER (
                WHERE fct_game_injuries.injury_status NOT IN ('Out', 'Out For Season')
            )::integer AS injuries_listed,
            bool_or(
                fct_game_injuries.is_key
                AND fct_game_injuries.injury_status IN ('Out', 'Out For Season', 'Day To Day')
            ) AS has_key_injury,
            count(*) FILTER (
                WHERE fct_game_injuries.is_key
                    AND fct_game_injuries.injury_status IN ('Out', 'Out For Season')
            )::integer AS key_players_out
        FROM gold.fct_game_injuries
        WHERE CAST(:game_id AS uuid) IS NULL OR fct_game_injuries.game_id = :game_id
        GROUP BY fct_game_injuries.game_id
    )"""

# The CTEs, columns, and joins every schedule-shaped read shares, so the
# schedule list and the single game cannot disagree about a game's odds.
SCHEDULE_CTES = f"""
    home_teams AS (
        SELECT
            team_id,
            arena_name,
            city
        FROM gold.dim_teams
    ),

    -- fct_game_odds is one row per event x bookmaker x market. Collapse books
    -- into a consensus: vig-free home WP for the market line, and the average
    -- vigged implied WP per side, which the repository turns back into a
    -- moneyline. Averaging American prices directly breaks across the +/-100
    -- boundary (-110 and +100 would average to -5).
    moneyline_odds AS (
        SELECT
            fct_game_odds.game_id,
            avg(fct_game_odds.home_market_wp) AS market_home_wp,
            avg(fct_game_odds.home_implied_wp) AS home_implied_wp,
            avg(fct_game_odds.away_implied_wp) AS away_implied_wp,
            count(DISTINCT fct_game_odds.bookmaker) AS odds_bookmaker_count,
            max(fct_game_odds.scraped_at) AS odds_updated_at
        FROM gold.fct_game_odds
        WHERE
            fct_game_odds.market = 'h2h'
            AND fct_game_odds.game_id IS NOT NULL
            AND (CAST(:game_id AS uuid) IS NULL OR fct_game_odds.game_id = :game_id)
        GROUP BY fct_game_odds.game_id
    ),

    spread_odds AS (
        SELECT
            fct_game_odds.game_id,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY fct_game_odds.spread_home) AS home_spread
        FROM gold.fct_game_odds
        WHERE
            fct_game_odds.market = 'spreads'
            AND fct_game_odds.game_id IS NOT NULL
            AND fct_game_odds.spread_home IS NOT NULL
            AND (CAST(:game_id AS uuid) IS NULL OR fct_game_odds.game_id = :game_id)
        GROUP BY fct_game_odds.game_id
    ),

{GAME_INJURY_COUNTS_CTE}
"""

SCHEDULE_COLUMNS = """
        fct_games_schedule.game_id,
        fct_games_schedule.season,
        fct_games_schedule.season_type,
        fct_games_schedule.game_date,
        fct_games_schedule.start_time_et,
        fct_games_schedule.status,
        coalesce(nullif(btrim(fct_games_schedule.arena), ''), home_teams.arena_name) AS arena,
        -- Only borrow the home team's city when the row is at the home team's
        -- own building. A neutral site names a real arena with a blank city, and
        -- filling that from the home team files a London or Mexico City game
        -- under Memphis or Detroit.
        CASE
            WHEN nullif(btrim(fct_games_schedule.arena), '') IS NULL
                OR btrim(fct_games_schedule.arena) = home_teams.arena_name
                THEN coalesce(nullif(btrim(fct_games_schedule.arena_city), ''), home_teams.city)
            ELSE nullif(btrim(fct_games_schedule.arena_city), '')
        END AS arena_city,
        fct_games_schedule.arena_state,
        fct_games_schedule.home_team_id,
        fct_games_schedule.home_team_abbreviation,
        fct_games_schedule.home_team_name,
        fct_games_schedule.away_team_id,
        fct_games_schedule.away_team_abbreviation,
        fct_games_schedule.away_team_name,
        fct_games_schedule.national_tv,
        fct_games_schedule.home_is_back_to_back,
        fct_games_schedule.home_last_night_opponent_abbreviation,
        fct_games_schedule.home_last_night_was_home,
        fct_games_schedule.home_last_night_score,
        fct_games_schedule.home_last_night_opponent_score,
        fct_games_schedule.away_is_back_to_back,
        fct_games_schedule.away_last_night_opponent_abbreviation,
        fct_games_schedule.away_last_night_was_home,
        fct_games_schedule.away_last_night_score,
        fct_games_schedule.away_last_night_opponent_score,
        fct_game_predictions.model_version AS prediction_model_version,
        fct_game_predictions.model_wp AS home_win_probability,
        fct_game_predictions.away_wp AS away_win_probability,
        fct_game_predictions.as_of AS prediction_as_of,
        moneyline_odds.market_home_wp,
        moneyline_odds.home_implied_wp,
        moneyline_odds.away_implied_wp,
        moneyline_odds.odds_bookmaker_count,
        moneyline_odds.odds_updated_at,
        spread_odds.home_spread,
        coalesce(game_injury_counts.injuries_out, 0) AS injuries_out,
        coalesce(game_injury_counts.injuries_listed, 0) AS injuries_listed,
        coalesce(game_injury_counts.has_key_injury, FALSE) AS has_key_injury,
        coalesce(game_injury_counts.key_players_out, 0) AS key_players_out
"""

SCHEDULE_JOINS = """
    LEFT JOIN home_teams
        ON home_teams.team_id = fct_games_schedule.home_team_id
    -- One row per game: the mart keeps only the champion model's latest as_of.
    LEFT JOIN gold.fct_game_predictions
        ON fct_game_predictions.game_id = fct_games_schedule.game_id
    LEFT JOIN moneyline_odds
        ON moneyline_odds.game_id = fct_games_schedule.game_id
    LEFT JOIN spread_odds
        ON spread_odds.game_id = fct_games_schedule.game_id
    LEFT JOIN game_injury_counts
        ON game_injury_counts.game_id = fct_games_schedule.game_id
"""

LIST_SCHEDULE = text(
    f"""
    WITH {SCHEDULE_CTES}

    SELECT
        {SCHEDULE_COLUMNS}
    FROM gold.fct_games_schedule
    {SCHEDULE_JOINS}
    WHERE {SCHEDULE_FILTERS}
    ORDER BY
        fct_games_schedule.game_date ASC,
        fct_games_schedule.start_time_et ASC NULLS LAST,
        fct_games_schedule.game_id ASC
    LIMIT :limit OFFSET :offset
    """
)

# One game in any state: the schedule row plus what only a single game needs.
# Records are each team's W-L entering the game (_pregame_records). Form
# (streak and last 10) has no as-of version, so it is only filled in before
# the game.
GET_GAME = text(
    f"""
    WITH {SCHEDULE_CTES},

    home_standings AS (
        SELECT
            fct_standings.team_id,
            fct_standings.season,
            fct_standings.streak,
            fct_standings.last_10
        FROM gold.fct_standings
        WHERE fct_standings.season_type = 'Regular Season'
    ),

    away_standings AS (
        SELECT
            fct_standings.team_id,
            fct_standings.season,
            fct_standings.streak,
            fct_standings.last_10
        FROM gold.fct_standings
        WHERE fct_standings.season_type = 'Regular Season'
    ),

    home_team_details AS (
        SELECT
            dim_teams.team_id,
            dim_teams.nickname,
            dim_teams.conference
        FROM gold.dim_teams
    ),

    away_team_details AS (
        SELECT
            dim_teams.team_id,
            dim_teams.nickname,
            dim_teams.conference
        FROM gold.dim_teams
    ),

    lead_highlights AS (
        SELECT
            fct_daily_highlights.game_id,
            fct_daily_highlights.headline,
            fct_daily_highlights.detail
        FROM gold.fct_daily_highlights
        WHERE
            fct_daily_highlights.game_id = :game_id
            AND fct_daily_highlights.game_rank = 1
    )

    SELECT
        {SCHEDULE_COLUMNS},
        fct_games_schedule.home_score,
        fct_games_schedule.away_score,
        pregame_records.home_wins,
        pregame_records.home_losses,
        pregame_records.away_wins,
        pregame_records.away_losses,
        CASE WHEN fct_games_schedule.status <> 'Final' THEN home_standings.streak END AS home_streak,
        CASE WHEN fct_games_schedule.status <> 'Final' THEN home_standings.last_10 END AS home_last_10,
        CASE WHEN fct_games_schedule.status <> 'Final' THEN away_standings.streak END AS away_streak,
        CASE WHEN fct_games_schedule.status <> 'Final' THEN away_standings.last_10 END AS away_last_10,
        lead_highlights.headline AS lead_highlight,
        lead_highlights.detail AS lead_highlight_detail,
        home_team_details.nickname AS home_team_nickname,
        home_team_details.conference AS home_team_conference,
        away_team_details.nickname AS away_team_nickname,
        away_team_details.conference AS away_team_conference,
        fct_game_upsets.is_upset,
        fct_game_upsets.winner_market_wp,
        fct_game_upsets.model_called_upset
    FROM gold.fct_games_schedule
    {SCHEDULE_JOINS}
    CROSS JOIN LATERAL ({_pregame_records("fct_games_schedule")}) AS pregame_records
    LEFT JOIN home_standings
        ON home_standings.team_id = fct_games_schedule.home_team_id
        AND home_standings.season = fct_games_schedule.season
    LEFT JOIN away_standings
        ON away_standings.team_id = fct_games_schedule.away_team_id
        AND away_standings.season = fct_games_schedule.season
    LEFT JOIN lead_highlights
        ON lead_highlights.game_id = fct_games_schedule.game_id
    LEFT JOIN home_team_details
        ON home_team_details.team_id = fct_games_schedule.home_team_id
    LEFT JOIN away_team_details
        ON away_team_details.team_id = fct_games_schedule.away_team_id
    -- Only Final games with a captured pregame line have a row.
    LEFT JOIN gold.fct_game_upsets
        ON fct_game_upsets.game_id = fct_games_schedule.game_id
    WHERE fct_games_schedule.game_id = :game_id
    """
)

LIST_SEASONS = text(
    """
    SELECT season FROM (
        SELECT DISTINCT season FROM gold.fct_team_game_results
        UNION
        SELECT DISTINCT season FROM gold.fct_player_game_logs
        UNION
        SELECT DISTINCT season FROM gold.fct_games_schedule
    ) seasons
    WHERE season IS NOT NULL
    ORDER BY season DESC
    """
)


# "Collapse of the season": the biggest lead a team held and still lost, most
# painful first. largest_lead_blown is 0 for wire-to-wire games, so those are
# excluded rather than ranked last. Every row is also the other side's
# comeback, so :team matches either side.
LIST_BIGGEST_COLLAPSES = text(
    f"""
    SELECT
        fct_game_flow.game_id,
        fct_game_flow.season,
        fct_game_flow.game_date,
        fct_game_flow.home_team_abbreviation,
        fct_game_flow.home_score,
        fct_game_flow.away_team_abbreviation,
        fct_game_flow.away_score,
        fct_game_flow.largest_lead_blown,
        fct_game_flow.blown_lead_team_abbreviation,
        fct_game_flow.comeback_team_abbreviation,
        fct_game_flow.blown_lead_period,
        fct_game_flow.winner_margin_entering_fourth,
        fct_game_flow.lead_changes,
        fct_game_flow.overtime_periods
    FROM gold.fct_game_flow
    WHERE
        fct_game_flow.largest_lead_blown > 0
        AND (CAST(:season AS text) IS NULL OR fct_game_flow.season = :season)
        AND {_either_team("fct_game_flow.blown_lead_team_abbreviation", "fct_game_flow.comeback_team_abbreviation")}
    ORDER BY
        fct_game_flow.largest_lead_blown DESC,
        fct_game_flow.game_date DESC,
        fct_game_flow.game_id
    LIMIT :limit OFFSET :offset
    """
)


# The tightest finishes: smallest final margin, then the most lead changes,
# then the most overtime. Lead changes need play-by-play; fct_game_flow
# coalesces them to 0 without it, so a game with no PBP reports null instead of
# claiming a wire-to-wire finish.
LIST_CLOSEST_GAMES = text(
    f"""
    SELECT
        fct_game_flow.game_id,
        fct_game_flow.season,
        fct_game_flow.game_date,
        fct_game_flow.home_team_abbreviation,
        fct_game_flow.home_score,
        fct_game_flow.away_team_abbreviation,
        fct_game_flow.away_score,
        fct_game_flow.winning_team_abbreviation,
        abs(fct_game_flow.home_score - fct_game_flow.away_score) AS final_margin,
        CASE
            WHEN fct_game_flow.scoring_play_count IS NOT NULL THEN fct_game_flow.lead_changes
        END AS lead_changes,
        fct_game_flow.overtime_periods
    FROM gold.fct_game_flow
    WHERE
        fct_game_flow.home_score IS NOT NULL
        AND fct_game_flow.away_score IS NOT NULL
        AND (CAST(:season AS text) IS NULL OR fct_game_flow.season = :season)
        AND {_either_team("fct_game_flow.home_team_abbreviation", "fct_game_flow.away_team_abbreviation")}
    ORDER BY
        final_margin ASC,
        lead_changes DESC NULLS LAST,
        fct_game_flow.overtime_periods DESC,
        fct_game_flow.game_date DESC,
        fct_game_flow.game_id
    LIMIT :limit OFFSET :offset
    """
)


# The most lopsided finals. Wire to wire needs play-by-play, so it is null,
# not false, for a game without it.
LIST_LARGEST_MARGINS = text(
    f"""
    SELECT
        fct_game_flow.game_id,
        fct_game_flow.season,
        fct_game_flow.game_date,
        fct_game_flow.home_team_abbreviation,
        fct_game_flow.home_score,
        fct_game_flow.away_team_abbreviation,
        fct_game_flow.away_score,
        fct_game_flow.winning_team_abbreviation,
        abs(fct_game_flow.home_score - fct_game_flow.away_score) AS final_margin,
        CASE
            WHEN fct_game_flow.scoring_play_count IS NOT NULL THEN fct_game_flow.is_wire_to_wire
        END AS is_wire_to_wire
    FROM gold.fct_game_flow
    WHERE
        fct_game_flow.home_score IS NOT NULL
        AND fct_game_flow.away_score IS NOT NULL
        AND (CAST(:season AS text) IS NULL OR fct_game_flow.season = :season)
        AND {_either_team("fct_game_flow.home_team_abbreviation", "fct_game_flow.away_team_abbreviation")}
    ORDER BY
        final_margin DESC,
        fct_game_flow.game_date DESC,
        fct_game_flow.game_id
    LIMIT :limit OFFSET :offset
    """
)


# Games the market underdog won, biggest surprise first. upset_magnitude is the
# winner's surprisal, comparable across seasons and season types, whereas
# upset_rank restarts within each season x season_type. Without a season this
# is the newest season that has any upsets. An upset's winner is the
# underdog, so its no-vig price is the mart's underdog_fair_moneyline.
LIST_UPSETS = text(
    f"""
    WITH latest_season AS (
        SELECT max(fct_game_upsets.season) AS season
        FROM gold.fct_game_upsets
        WHERE fct_game_upsets.is_upset
    ),

{NOTABLE_ABSENCES_CTE}

    SELECT
        fct_game_upsets.game_id,
        fct_game_upsets.season,
        fct_game_upsets.season_type,
        fct_game_upsets.game_date,
        fct_game_upsets.home_team_id,
        fct_game_upsets.home_team_abbreviation,
        fct_game_upsets.away_team_id,
        fct_game_upsets.away_team_abbreviation,
        fct_game_upsets.home_score,
        fct_game_upsets.away_score,
        fct_game_upsets.winning_team_id,
        fct_game_upsets.winner_location,
        fct_game_upsets.winner_market_wp,
        fct_game_upsets.underdog_fair_moneyline AS winner_fair_moneyline,
        fct_game_upsets.model_winner_wp,
        fct_game_upsets.upset_magnitude,
        fct_game_upsets.upset_rank,
        fct_game_upsets.model_called_upset,
        pregame_records.home_wins,
        pregame_records.home_losses,
        pregame_records.away_wins,
        pregame_records.away_losses,
        coalesce(notable_absences.home_notable_out, ARRAY[]::text[]) AS home_notable_out,
        coalesce(notable_absences.away_notable_out, ARRAY[]::text[]) AS away_notable_out
    FROM gold.fct_game_upsets
    CROSS JOIN latest_season
    CROSS JOIN LATERAL ({_pregame_records("fct_game_upsets")}) AS pregame_records
    LEFT JOIN notable_absences
        ON notable_absences.game_id = fct_game_upsets.game_id
    WHERE
        fct_game_upsets.is_upset
        AND fct_game_upsets.season = coalesce(CAST(:season AS text), latest_season.season)
        AND (CAST(:season_type AS text) IS NULL OR fct_game_upsets.season_type = :season_type)
        AND {_either_team("fct_game_upsets.home_team_abbreviation", "fct_game_upsets.away_team_abbreviation")}
    ORDER BY
        fct_game_upsets.upset_magnitude DESC,
        fct_game_upsets.game_date DESC,
        fct_game_upsets.game_id
    LIMIT :limit OFFSET :offset
    """
)


# Each game's lead highlight for one day, best first. Defaults to the newest
# day that has any: an off day or the offseason still has something to show.
LIST_DAILY_HIGHLIGHTS = text(
    """
    WITH latest_day AS (
        SELECT max(fct_daily_highlights.game_date) AS game_date
        FROM gold.fct_daily_highlights
        WHERE (:season IS NULL OR fct_daily_highlights.season = :season)
    )
    SELECT
        fct_daily_highlights.highlight_id,
        fct_daily_highlights.game_date,
        fct_daily_highlights.season,
        fct_daily_highlights.season_type,
        fct_daily_highlights.game_id,
        fct_daily_highlights.highlight_type,
        fct_daily_highlights.subject_type,
        fct_daily_highlights.player_id,
        fct_daily_highlights.player_name,
        fct_daily_highlights.team_id,
        fct_daily_highlights.team_abbreviation,
        fct_daily_highlights.home_team_abbreviation,
        fct_daily_highlights.away_team_abbreviation,
        fct_daily_highlights.home_score,
        fct_daily_highlights.away_score,
        fct_daily_highlights.headline,
        fct_daily_highlights.detail,
        fct_daily_highlights.stat_name,
        fct_daily_highlights.stat_value,
        fct_daily_highlights.score,
        fct_daily_highlights.day_rank,
        fct_daily_highlights.is_featured
    FROM gold.fct_daily_highlights
    CROSS JOIN latest_day
    WHERE
        fct_daily_highlights.game_rank = 1
        AND fct_daily_highlights.game_date = coalesce(CAST(:game_date AS date), latest_day.game_date)
        AND (:season IS NULL OR fct_daily_highlights.season = :season)
    ORDER BY
        fct_daily_highlights.day_rank,
        fct_daily_highlights.game_id
    LIMIT :limit
    """
)


LIST_BOX_SCORE = text(
    """
    SELECT
        fct_player_game_logs.player_id,
        fct_player_game_logs.player_name,
        fct_player_game_logs.team_id,
        fct_player_game_logs.team_abbreviation,
        fct_player_game_logs.team_name,
        fct_player_game_logs.location,
        fct_player_game_logs.minutes,
        fct_player_game_logs.points,
        fct_player_game_logs.rebounds,
        fct_player_game_logs.assists,
        fct_player_game_logs.field_goals_made,
        fct_player_game_logs.field_goals_attempted,
        fct_player_game_logs.field_goal_pct,
        fct_player_game_logs.three_pointers_made,
        fct_player_game_logs.three_pointers_attempted,
        fct_player_game_logs.three_point_pct,
        fct_player_game_logs.free_throws_made,
        fct_player_game_logs.free_throws_attempted,
        fct_player_game_logs.free_throw_pct,
        -- True shooting: points per shooting possession, where a possession is
        -- a field goal attempt plus the 0.44 of a free throw attempt that ends
        -- one. Null rather than zero when a player never shot.
        CASE
            WHEN coalesce(fct_player_game_logs.field_goals_attempted, 0)
                 + 0.44 * coalesce(fct_player_game_logs.free_throws_attempted, 0) > 0
            THEN round(
                fct_player_game_logs.points::numeric
                / (2 * (fct_player_game_logs.field_goals_attempted + 0.44 * fct_player_game_logs.free_throws_attempted)),
                3
            )
        END AS true_shooting_pct,
        fct_player_game_logs.plus_minus,
        fct_player_game_logs.mvp_game_score
    FROM gold.fct_player_game_logs
    WHERE fct_player_game_logs.game_id = :game_id
      -- Only players who actually checked in. A DNP is logged either as a null
      -- minute count or as a literal 0, and both appear in the warehouse.
      AND fct_player_game_logs.minutes IS NOT NULL
      AND fct_player_game_logs.minutes > 0
    ORDER BY
        CASE WHEN fct_player_game_logs.location = 'home' THEN 0 ELSE 1 END,
        fct_player_game_logs.minutes DESC NULLS LAST,
        fct_player_game_logs.points DESC NULLS LAST,
        fct_player_game_logs.player_name
    """
)
