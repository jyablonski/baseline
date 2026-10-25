"""SQL for the hourly catch-up: games from one night still missing data."""

from __future__ import annotations

from sqlalchemy import text

# Games dated :game_date that are not yet Final, or are Final without a box
# score or without play-by-play. Keyed on the schedule rather than on Final
# status: a game BRef has not posted a score for is still 'Scheduled', and the
# daily selection (Final without logs) cannot see it at all.
#
# scripts/catch-up.sh runs the same rule in its pre-check so an hour with
# nothing missing exits without starting a container. Change both together.
#
# TODO(postponements): a postponed game keeps its original date and never gets
# a score, so it reads as pending all day and lands in the end-of-window alert.
# Exclude it here (and in the pre-check) once we have seen how BRef marks one
# on the schedule page.
SELECT_CATCH_UP_GAPS = text(
    """
    WITH home_teams AS (
        SELECT
            teams.team_id,
            teams.abbreviation
        FROM source.teams
    ),
    away_teams AS (
        SELECT
            teams.team_id,
            teams.abbreviation
        FROM source.teams
    ),
    night_games AS (
        SELECT
            games.game_id,
            games.home_team_id,
            games.away_team_id,
            games.status = 'Final' AS is_final,
            EXISTS (
                SELECT 1
                FROM source.player_game_logs
                WHERE player_game_logs.game_id = games.game_id
            ) AS has_box_score,
            EXISTS (
                SELECT 1
                FROM source.play_by_play
                WHERE play_by_play.game_id = games.game_id
            ) AS has_play_by_play
        FROM source.games
        WHERE games.game_date = :game_date
    )
    SELECT
        night_games.game_id,
        away_teams.abbreviation AS away_team,
        home_teams.abbreviation AS home_team,
        night_games.is_final,
        night_games.has_box_score,
        night_games.has_play_by_play
    FROM night_games
    LEFT JOIN home_teams
        ON night_games.home_team_id = home_teams.team_id
    LEFT JOIN away_teams
        ON night_games.away_team_id = away_teams.team_id
    WHERE
        NOT night_games.is_final
        OR NOT night_games.has_box_score
        OR NOT night_games.has_play_by_play
    ORDER BY
        home_teams.abbreviation,
        night_games.game_id
    """
)
