"""SQL against gold team and player game facts."""

from __future__ import annotations

from sqlalchemy import text

LIST_GAMES_COUNT = text(
    """
    SELECT count(*) AS total
    FROM gold.fct_team_game_results
    WHERE
        (:season IS NULL OR season = :season)
      AND (:season_type IS NULL OR season_type = :season_type)
    """
)

LIST_GAMES = text(
    """
    WITH home_teams AS (
        SELECT
            team_id,
            arena_name,
            city
        FROM gold.dim_teams
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
        fct_team_game_results.score_margin
    FROM gold.fct_team_game_results
    LEFT JOIN home_teams
        ON home_teams.team_id = fct_team_game_results.home_team_id
    WHERE
        (:season IS NULL OR fct_team_game_results.season = :season)
      AND (:season_type IS NULL OR fct_team_game_results.season_type = :season_type)
    ORDER BY
        fct_team_game_results.game_date DESC,
        fct_team_game_results.game_id DESC
    LIMIT :limit OFFSET :offset
    """
)

GAME_EXISTS = text(
    """
    SELECT 1
    FROM gold.fct_team_game_results
    WHERE game_id = :game_id
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

LIST_SCHEDULE_COUNT = text(
    """
    SELECT count(*) AS total
    FROM gold.fct_games_schedule
    WHERE fct_games_schedule.game_date >= :from_date
      AND (:season IS NULL OR fct_games_schedule.season = :season)
      AND (
          :status IS NULL
          OR (
              lower(:status) = 'scheduled'
              AND lower(fct_games_schedule.status) NOT IN ('final', '3')
          )
          OR fct_games_schedule.status = :status
      )
    """
)

LIST_SCHEDULE = text(
    """
    WITH home_teams AS (
        SELECT
            team_id,
            arena_name,
            city
        FROM gold.dim_teams
    )
    SELECT
        fct_games_schedule.game_id,
        fct_games_schedule.season,
        fct_games_schedule.season_type,
        fct_games_schedule.game_date,
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
        fct_games_schedule.away_team_name
    FROM gold.fct_games_schedule
    LEFT JOIN home_teams
        ON home_teams.team_id = fct_games_schedule.home_team_id
    WHERE fct_games_schedule.game_date >= :from_date
      AND (:season IS NULL OR fct_games_schedule.season = :season)
      AND (
          :status IS NULL
          OR (
              lower(:status) = 'scheduled'
              AND lower(fct_games_schedule.status) NOT IN ('final', '3')
          )
          OR fct_games_schedule.status = :status
      )
    ORDER BY
        fct_games_schedule.game_date ASC,
        fct_games_schedule.game_id ASC
    LIMIT :limit OFFSET :offset
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
# excluded rather than ranked last.
LIST_BIGGEST_COLLAPSES = text(
    """
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
    WHERE fct_game_flow.largest_lead_blown > 0
      AND (:season IS NULL OR fct_game_flow.season = :season)
      AND (:blown_lead_team IS NULL OR fct_game_flow.blown_lead_team_abbreviation = :blown_lead_team)
    ORDER BY
        fct_game_flow.largest_lead_blown DESC,
        fct_game_flow.game_date DESC
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
