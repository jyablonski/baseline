"""SQL against the dbt-built, strictly as-of game feature relation."""

from __future__ import annotations

from sqlalchemy import text

SELECT_GAME_FEATURES = text(
    """
    SELECT
        game_id,
        season,
        season_type,
        game_date,
        home_team_id,
        away_team_id,
        home_won,
        home_games_before,
        away_games_before,
        point_diff_diff,
        win_pct_diff,
        last10_point_diff_diff,
        rest_days_diff,
        min_rest_days,
        travel_miles_diff,
        total_travel_miles,
        timezone_crossings_diff,
        total_timezone_crossings,
        h2h_games_before,
        h2h_home_win_pct
    FROM silver.int_game_features
    WHERE season_type = 'Regular Season'
    ORDER BY game_date, game_id
    """
)

# Elo v2's context per Regular Season game: back-to-backs from the as-of rest
# days, and notable players ruled out on the morning report. Day To Day is left
# out, as on the schedule's injury chip. An absence only counts while it is new,
# meaning the player logged minutes in the :recent_days before the game: by the
# time it is older the team's rating has absorbed it, and counting it again
# would charge the team twice. A game before the injury history began has no
# report and reads as zero out.
SELECT_GAME_CONTEXT = text(
    """
    WITH notable_out AS (
        SELECT
            fct_game_injuries.game_id,
            count(*) FILTER (WHERE fct_game_injuries.side = 'home') AS home_notable_out,
            count(*) FILTER (WHERE fct_game_injuries.side = 'away') AS away_notable_out
        FROM gold.fct_game_injuries
        WHERE
            fct_game_injuries.is_notable
            AND fct_game_injuries.injury_status IN ('Out', 'Out For Season')
            AND EXISTS (
                SELECT 1
                FROM gold.fct_player_game_logs
                WHERE
                    fct_player_game_logs.player_id = fct_game_injuries.player_id
                    AND fct_player_game_logs.minutes > 0
                    AND fct_player_game_logs.game_date
                        >= fct_game_injuries.game_date - CAST(:recent_days AS integer)
                    AND fct_player_game_logs.game_date < fct_game_injuries.game_date
            )
        GROUP BY fct_game_injuries.game_id
    )
    SELECT
        int_game_features.game_id,
        coalesce(int_game_features.home_rest_days = 1, false) AS home_back_to_back,
        coalesce(int_game_features.away_rest_days = 1, false) AS away_back_to_back,
        coalesce(notable_out.home_notable_out, 0) AS home_notable_out,
        coalesce(notable_out.away_notable_out, 0) AS away_notable_out
    FROM silver.int_game_features
    LEFT JOIN notable_out
        ON int_game_features.game_id = notable_out.game_id
    WHERE int_game_features.season_type = 'Regular Season'
    """
)
