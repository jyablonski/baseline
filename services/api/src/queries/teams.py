"""SQL against gold team dims and game results."""

from __future__ import annotations

from sqlalchemy import text

from queries.standings import RESOLVED_SEASON

TEAM_GAME_FILTERS = """
    (fct_team_game_results.home_team_id = :team_id OR fct_team_game_results.away_team_id = :team_id)
    AND (:season IS NULL OR fct_team_game_results.season = :season)
    AND (:since_season IS NULL OR fct_team_game_results.season >= :since_season)
    AND (
        :opponent_team_id IS NULL
        OR (
            (fct_team_game_results.home_team_id = :team_id AND fct_team_game_results.away_team_id = :opponent_team_id)
            OR (fct_team_game_results.away_team_id = :team_id AND fct_team_game_results.home_team_id = :opponent_team_id)
        )
    )
    AND (
        :location IS NULL
        OR (:location = 'home' AND fct_team_game_results.home_team_id = :team_id)
        OR (:location = 'away' AND fct_team_game_results.away_team_id = :team_id)
    )
    AND (:arena_city IS NULL OR fct_team_game_results.arena_city ILIKE :arena_city)
    AND (:season_type IS NULL OR fct_team_game_results.season_type = :season_type)
"""

TEAM_BY_ID = text(
    """
    SELECT
        team_id, abbreviation, team_name, conference, division, city, nickname,
        arena_name, arena_latitude, arena_longitude,
        primary_color, alternate_color,
        current_season_payroll, current_remaining_guaranteed,
        current_contract_season,
        salary_cap, luxury_tax, first_apron, second_apron,
        over_luxury_tax, over_first_apron, over_second_apron
    FROM gold.dim_teams
    WHERE team_id = :team_id
    """
)

TEAM_BY_ABBREVIATION = text(
    """
    SELECT
        team_id, abbreviation, team_name, conference, division, city, nickname,
        arena_name, arena_latitude, arena_longitude,
        primary_color, alternate_color,
        current_season_payroll, current_remaining_guaranteed,
        current_contract_season,
        salary_cap, luxury_tax, first_apron, second_apron,
        over_luxury_tax, over_first_apron, over_second_apron
    FROM gold.dim_teams
    WHERE upper(abbreviation) = upper(:abbreviation)
    """
)

LIST_TEAMS_COUNT = text("SELECT count(*) FROM gold.dim_teams")

# Regular Season points scored/allowed per game. Gold has no possessions or
# offensive rebounds, so this is not possession-adjusted ORtg/DRtg.
REGULAR_SEASON_SCORING = f"""
    SELECT
        appearances.team_id,
        round(avg(appearances.pts_scored)::numeric, 1) AS pts_scored_avg,
        round(avg(appearances.pts_allowed)::numeric, 1) AS pts_allowed_avg
    FROM (
        SELECT
            fct_team_game_results.home_team_id AS team_id,
            fct_team_game_results.home_score AS pts_scored,
            fct_team_game_results.away_score AS pts_allowed
        FROM gold.fct_team_game_results
        WHERE
            fct_team_game_results.season_type = 'Regular Season'
            AND fct_team_game_results.season = ({RESOLVED_SEASON})
            AND fct_team_game_results.home_score IS NOT NULL
            AND fct_team_game_results.away_score IS NOT NULL
        UNION ALL
        SELECT
            fct_team_game_results.away_team_id AS team_id,
            fct_team_game_results.away_score AS pts_scored,
            fct_team_game_results.home_score AS pts_allowed
        FROM gold.fct_team_game_results
        WHERE
            fct_team_game_results.season_type = 'Regular Season'
            AND fct_team_game_results.season = ({RESOLVED_SEASON})
            AND fct_team_game_results.home_score IS NOT NULL
            AND fct_team_game_results.away_score IS NOT NULL
    ) AS appearances
    GROUP BY appearances.team_id
"""

LIST_TEAMS = text(
    f"""
    SELECT
        dim_teams.team_id,
        dim_teams.abbreviation,
        dim_teams.team_name,
        dim_teams.conference,
        dim_teams.division,
        dim_teams.city,
        dim_teams.nickname,
        fct_standings.wins,
        fct_standings.losses,
        fct_standings.win_pct,
        fct_standings.record_source,
        scoring.pts_scored_avg,
        scoring.pts_allowed_avg
    FROM gold.dim_teams
    LEFT JOIN gold.fct_standings
        ON fct_standings.team_id = dim_teams.team_id
        AND fct_standings.season = ({RESOLVED_SEASON})
        AND fct_standings.season_type = 'Regular Season'
    LEFT JOIN ({REGULAR_SEASON_SCORING}) AS scoring
        ON scoring.team_id = dim_teams.team_id
    ORDER BY
        dim_teams.conference,
        dim_teams.division,
        dim_teams.team_name
    LIMIT :limit OFFSET :offset
    """
)

LATEST_SEASON_FOR_TEAM = text(
    """
    SELECT max(season) AS season
    FROM gold.fct_team_game_results
    WHERE
        home_team_id = :team_id
        OR away_team_id = :team_id
    """
)

COMPUTE_RECORD = text(
    f"""
    SELECT
        count(*) AS games,
        count(*) FILTER (WHERE fct_team_game_results.winning_team_id = :team_id) AS wins
    FROM gold.fct_team_game_results
    WHERE
        {TEAM_GAME_FILTERS}
    """
)

COMPUTE_RECORDS_BY_SEASON_TYPE = text(
    """
    SELECT
        fct_team_game_results.season_type,
        count(*) AS games,
        count(*) FILTER (WHERE fct_team_game_results.winning_team_id = :team_id) AS wins
    FROM gold.fct_team_game_results
    WHERE
        (
            fct_team_game_results.home_team_id = :team_id
            OR fct_team_game_results.away_team_id = :team_id
        )
      AND fct_team_game_results.season = :season
    GROUP BY fct_team_game_results.season_type
    """
)

LIST_TEAM_GAMES_COUNT = text(
    f"""
    SELECT count(*) AS total
    FROM gold.fct_team_game_results
    WHERE
        {TEAM_GAME_FILTERS}
    """
)

LIST_TEAM_GAMES = text(
    f"""
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
        coalesce(nullif(btrim(fct_team_game_results.arena_city), ''), home_teams.city) AS arena_city,
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
        CASE
            WHEN fct_team_game_results.home_score IS NULL OR fct_team_game_results.away_score IS NULL THEN NULL
            WHEN fct_team_game_results.home_team_id = :team_id THEN fct_team_game_results.home_score - fct_team_game_results.away_score
            ELSE fct_team_game_results.away_score - fct_team_game_results.home_score
        END AS score_margin,
        CASE
            WHEN fct_team_game_results.home_team_id = :team_id THEN 'home'
            ELSE 'away'
        END AS location,
        CASE
            WHEN fct_team_game_results.home_team_id = :team_id THEN fct_team_game_results.away_team_id
            ELSE fct_team_game_results.home_team_id
        END AS opponent_team_id,
        CASE
            WHEN fct_team_game_results.home_team_id = :team_id THEN fct_team_game_results.away_team_abbreviation
            ELSE fct_team_game_results.home_team_abbreviation
        END AS opponent_abbreviation,
        CASE
            WHEN fct_team_game_results.home_team_id = :team_id THEN fct_team_game_results.away_team_name
            ELSE fct_team_game_results.home_team_name
        END AS opponent_name,
        CASE
            WHEN fct_team_game_results.home_team_id = :team_id THEN fct_team_game_results.home_score
            ELSE fct_team_game_results.away_score
        END AS team_score,
        CASE
            WHEN fct_team_game_results.home_team_id = :team_id THEN fct_team_game_results.away_score
            ELSE fct_team_game_results.home_score
        END AS opponent_score,
        (fct_team_game_results.winning_team_id = :team_id) AS is_win
    FROM gold.fct_team_game_results
    LEFT JOIN home_teams
        ON home_teams.team_id = fct_team_game_results.home_team_id
    WHERE
        {TEAM_GAME_FILTERS}
    ORDER BY
        fct_team_game_results.game_date DESC,
        fct_team_game_results.game_id DESC
    LIMIT :limit OFFSET :offset
    """
)

# Every game of one team's season in any state, for the team calendar. Without
# a season, the newest one the team has on the schedule. The back-to-back flag
# is computed over all the team's games before season_type narrows them, so a
# playoff opener the night after a play-in game still counts.
LIST_TEAM_SEASON_GAMES = text(
    """
    WITH target_seasons AS (
        SELECT
            coalesce(
                CAST(:season AS text),
                (
                    SELECT max(fct_games_schedule.season)
                    FROM gold.fct_games_schedule
                    WHERE
                        fct_games_schedule.home_team_id = :team_id
                        OR fct_games_schedule.away_team_id = :team_id
                )
            ) AS season
    ),

    team_games AS (
        SELECT
            fct_games_schedule.game_id,
            fct_games_schedule.season,
            fct_games_schedule.season_type,
            fct_games_schedule.game_date,
            fct_games_schedule.start_time_et,
            fct_games_schedule.status,
            fct_games_schedule.national_tv,
            fct_games_schedule.home_team_id = :team_id AS is_home,
            CASE
                WHEN fct_games_schedule.home_team_id = :team_id THEN fct_games_schedule.away_team_id
                ELSE fct_games_schedule.home_team_id
            END AS opponent_team_id,
            CASE
                WHEN fct_games_schedule.home_team_id = :team_id THEN fct_games_schedule.away_team_abbreviation
                ELSE fct_games_schedule.home_team_abbreviation
            END AS opponent_abbreviation,
            CASE
                WHEN fct_games_schedule.home_team_id = :team_id THEN fct_games_schedule.away_team_name
                ELSE fct_games_schedule.home_team_name
            END AS opponent_name,
            CASE
                WHEN fct_games_schedule.home_team_id = :team_id THEN fct_games_schedule.home_score
                ELSE fct_games_schedule.away_score
            END AS team_score,
            CASE
                WHEN fct_games_schedule.home_team_id = :team_id THEN fct_games_schedule.away_score
                ELSE fct_games_schedule.home_score
            END AS opponent_score,
            CASE
                WHEN fct_games_schedule.home_team_id = :team_id THEN fct_games_schedule.home_is_back_to_back
                ELSE fct_games_schedule.away_is_back_to_back
            END AS is_back_to_back
        FROM gold.fct_games_schedule
        INNER JOIN target_seasons
            ON target_seasons.season = fct_games_schedule.season
        WHERE
            fct_games_schedule.home_team_id = :team_id
            OR fct_games_schedule.away_team_id = :team_id
    )

    SELECT
        team_games.game_id,
        team_games.season,
        team_games.season_type,
        team_games.game_date,
        team_games.start_time_et,
        team_games.status,
        team_games.national_tv,
        team_games.is_home,
        team_games.opponent_team_id,
        team_games.opponent_abbreviation,
        team_games.opponent_name,
        team_games.team_score,
        team_games.opponent_score,
        CASE
            WHEN
                team_games.status <> 'Final'
                OR team_games.team_score IS NULL
                OR team_games.opponent_score IS NULL
                THEN NULL
            WHEN team_games.team_score > team_games.opponent_score THEN 'W'
            ELSE 'L'
        END AS result,
        -- The champion's pregame estimate, from this team's side.
        CASE
            WHEN team_games.is_home THEN fct_game_predictions.model_wp
            ELSE fct_game_predictions.away_wp
        END AS win_probability,
        team_games.is_back_to_back
    FROM team_games
    LEFT JOIN gold.fct_game_predictions
        ON fct_game_predictions.game_id = team_games.game_id
    WHERE CAST(:season_type AS text) IS NULL OR team_games.season_type = :season_type
    ORDER BY
        team_games.game_date,
        team_games.start_time_et NULLS LAST,
        team_games.game_id
    """
)


TEAM_STAT_METRICS = (
    "offensive_rating",
    "defensive_rating",
    "net_rating",
    "pace",
    "points_per_game",
    "opponent_points_per_game",
    "effective_fg_pct",
    "opponent_effective_fg_pct",
    "three_pointers_made_per_game",
    "three_point_pct",
    "three_point_attempt_rate",
    "free_throw_rate",
    "offensive_rebound_pct",
    "defensive_rebound_pct",
    "turnover_pct",
    "opponent_turnover_pct",
    "assist_rate",
)

_TEAM_STAT_COLUMNS = ",\n        ".join(
    f"fct_team_stat_splits.{metric},\n        fct_team_stat_splits.{metric}_rank"
    for metric in TEAM_STAT_METRICS
)

# The mart holds only the current Regular Season, so there is no season to resolve.
LIST_TEAM_STAT_SPLITS = text(
    f"""
    SELECT
        fct_team_stat_splits.season,
        fct_team_stat_splits.split,
        fct_team_stat_splits.games,
        fct_team_stat_splits.wins,
        fct_team_stat_splits.losses,
        fct_team_stat_splits.games_with_possessions,
        fct_team_stat_splits.team_count,
        {_TEAM_STAT_COLUMNS}
    FROM gold.fct_team_stat_splits
    WHERE fct_team_stat_splits.team_id = :team_id
    ORDER BY
        CASE fct_team_stat_splits.split
            WHEN 'season' THEN 1
            WHEN 'last_10' THEN 2
            WHEN 'home' THEN 3
            ELSE 4
        END
    """
)

# The current roster (players whose team is this one), each with per-game stats
# from their Regular Season games for this team in the newest season. A player
# traded in brings only the games played here; one yet to play (or with only
# DNPs) has no team_logs row, so games_played is 0 and every average null.
LIST_TEAM_ROSTER = text(
    """
    WITH latest_season AS (
        SELECT max(fct_player_game_logs.season) AS season
        FROM gold.fct_player_game_logs
        WHERE fct_player_game_logs.season_type = 'Regular Season'
    ),

    team_logs AS (
        SELECT
            fct_player_game_logs.player_id,
            count(*) AS games_played,
            avg(fct_player_game_logs.minutes) AS minutes,
            avg(fct_player_game_logs.points) AS points,
            avg(fct_player_game_logs.rebounds) AS rebounds,
            avg(fct_player_game_logs.assists) AS assists,
            avg(fct_player_game_logs.steals) AS steals,
            avg(fct_player_game_logs.blocks) AS blocks,
            avg(fct_player_game_logs.turnovers) AS turnovers,
            avg(fct_player_game_logs.three_pointers_made) AS three_pointers_made,
            avg(fct_player_game_logs.plus_minus) AS plus_minus,
            avg(fct_player_game_logs.mvp_box_score) AS game_score,
            sum(fct_player_game_logs.points) AS total_points,
            sum(fct_player_game_logs.field_goals_attempted) AS total_field_goals_attempted,
            sum(fct_player_game_logs.free_throws_attempted) AS total_free_throws_attempted
        FROM gold.fct_player_game_logs
        INNER JOIN latest_season
            ON fct_player_game_logs.season = latest_season.season
        WHERE
            fct_player_game_logs.team_id = :team_id
            AND fct_player_game_logs.season_type = 'Regular Season'
            -- A DNP is not a game played; it adds no points or shots either.
            AND fct_player_game_logs.minutes > 0
        GROUP BY fct_player_game_logs.player_id
    )

    SELECT
        dim_players.player_id,
        dim_players.full_name,
        dim_players.position,
        dim_players.jersey_number,
        latest_season.season,
        coalesce(team_logs.games_played, 0) AS games_played,
        round(team_logs.minutes::numeric, 1) AS minutes,
        round(team_logs.points::numeric, 1) AS points,
        round(team_logs.rebounds::numeric, 1) AS rebounds,
        round(team_logs.assists::numeric, 1) AS assists,
        round(team_logs.steals::numeric, 1) AS steals,
        round(team_logs.blocks::numeric, 1) AS blocks,
        round(team_logs.turnovers::numeric, 1) AS turnovers,
        round(team_logs.three_pointers_made::numeric, 1) AS three_pointers_made,
        -- PTS / (2 * (FGA + 0.44 * FTA)); null without a shot attempt.
        round(
            team_logs.total_points
            / nullif(
                2 * (team_logs.total_field_goals_attempted + 0.44 * team_logs.total_free_throws_attempted),
                0
            ),
            3
        ) AS true_shooting_pct,
        round(team_logs.plus_minus::numeric, 1) AS plus_minus,
        round(team_logs.game_score::numeric, 1) AS game_score
    FROM gold.dim_players
    CROSS JOIN latest_season
    LEFT JOIN team_logs
        ON dim_players.player_id = team_logs.player_id
    WHERE
        dim_players.team_id = :team_id
        AND dim_players.is_active
    ORDER BY
        team_logs.minutes DESC NULLS LAST,
        dim_players.full_name
    """
)
