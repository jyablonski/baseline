"""SQL against gold player dims, game logs, and season stats."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import bindparam, text

COMPARE_STAT_COLUMNS = {
    "games_played": "career_games_played",
    "career_games_played": "career_games_played",
    "ppg": "career_ppg",
    "career_ppg": "career_ppg",
    "rpg": "career_rpg",
    "career_rpg": "career_rpg",
    "apg": "career_apg",
    "career_apg": "career_apg",
    "plus_minus": "career_avg_plus_minus",
    "career_plus_minus": "career_avg_plus_minus",
    "career_avg_plus_minus": "career_avg_plus_minus",
    "mvp": "mvp_score",
    "mvp_score": "mvp_score",
}

COMPARE_ORDER_EXPR = {
    "career_games_played": "dim_players.career_games_played",
    "career_ppg": "dim_players.career_ppg",
    "career_rpg": "dim_players.career_rpg",
    "career_apg": "dim_players.career_apg",
    "career_avg_plus_minus": "career_plus_minus.career_avg_plus_minus",
    "mvp_score": "regular_season_mvp.mvp_score",
}

PLAYER_SORT_ORDERS = {
    "name": ["dim_players.full_name"],
    "mvp": ["regular_season_mvp.mvp_rank NULLS LAST", "dim_players.full_name"],
}

# One season of the Regular Season MVP ladder: :season, else the latest season
# scored. Play-in and the Cup final are never in the ladder.
REGULAR_SEASON_MVP_CTES = """
    mvp_season AS (
        SELECT coalesce(:season, max(fct_player_mvp_scores.season)) AS season
        FROM gold.fct_player_mvp_scores
    ),
    regular_season_mvp AS (
        SELECT
            fct_player_mvp_scores.player_id,
            fct_player_mvp_scores.mvp_score,
            fct_player_mvp_scores.mvp_rank
        FROM gold.fct_player_mvp_scores
        INNER JOIN mvp_season ON fct_player_mvp_scores.season = mvp_season.season
        WHERE fct_player_mvp_scores.season_type = 'Regular Season'
    )"""

GAME_LOG_SORT_COLUMNS = {
    "game_date": "game_date",
    "date": "game_date",
    "opponent": "opponent_abbreviation",
    "opponent_abbreviation": "opponent_abbreviation",
    "location": "location",
    "result": "result",
    "minutes": "minutes",
    "points": "points",
    "rebounds": "rebounds",
    "assists": "assists",
    "steals": "steals",
    "blocks": "blocks",
    "turnovers": "turnovers",
    "plus_minus": "plus_minus",
    "mvp_game_score": "mvp_game_score",
    "is_back_to_back": "is_back_to_back",
}

PLAYER_EXISTS = text("SELECT 1 FROM gold.dim_players WHERE player_id = :player_id")

LIST_PLAYERS_COUNT = text(
    """
    SELECT count(*) AS total
    FROM gold.dim_players
    LEFT JOIN gold.dim_teams t ON t.team_id = dim_players.team_id
    WHERE
        (:search IS NULL OR dim_players.full_name ILIKE :search)
      AND (:active IS NULL OR dim_players.is_active = :active)
      AND (:team_id IS NULL OR dim_players.team_id = :team_id)
    """
)


def list_players_stmt(sort: str):
    order = PLAYER_SORT_ORDERS.get(sort)
    if order is None:
        raise ValueError(f"Unsupported player sort '{sort}'")
    order_by = ",\n        ".join(order)
    return text(
        f"""
    WITH {REGULAR_SEASON_MVP_CTES}
    SELECT
        dim_players.player_id,
        dim_players.full_name,
        dim_players.position,
        dim_teams.abbreviation AS team_abbreviation,
        dim_players.is_active,
        coalesce(dim_players.career_games_played, 0) AS career_games_played,
        dim_players.career_ppg,
        dim_players.career_rpg,
        dim_players.career_apg,
        mvp_season.season AS mvp_season,
        regular_season_mvp.mvp_score,
        regular_season_mvp.mvp_rank
    FROM gold.dim_players
    CROSS JOIN mvp_season
    LEFT JOIN gold.dim_teams ON dim_players.team_id = dim_teams.team_id
    LEFT JOIN regular_season_mvp ON dim_players.player_id = regular_season_mvp.player_id
    WHERE
        (:search IS NULL OR dim_players.full_name ILIKE :search)
        AND (:active IS NULL OR dim_players.is_active = :active)
        AND (:team_id IS NULL OR dim_players.team_id = :team_id)
    ORDER BY
        {order_by}
    LIMIT :limit OFFSET :offset
    """
    )


PLAYER_BY_ID = text(
    f"""
    WITH {REGULAR_SEASON_MVP_CTES}
    SELECT
        dim_players.player_id,
        dim_players.full_name,
        dim_players.position,
        dim_teams.abbreviation AS team_abbreviation,
        dim_players.is_active,
        dim_players.first_name,
        dim_players.last_name,
        dim_players.jersey_number,
        dim_players.height,
        dim_players.weight,
        dim_players.birth_date,
        coalesce(dim_players.career_games_played, 0) AS career_games_played,
        coalesce(dim_players.seasons_played, 0) AS seasons_played,
        dim_players.first_season,
        dim_players.last_season,
        dim_players.career_ppg,
        dim_players.career_rpg,
        dim_players.career_apg,
        dim_players.current_season_salary,
        dim_players.current_remaining_guaranteed,
        dim_players.current_contract_season,
        mvp_season.season AS mvp_season,
        regular_season_mvp.mvp_score,
        regular_season_mvp.mvp_rank
    FROM gold.dim_players
    CROSS JOIN mvp_season
    LEFT JOIN gold.dim_teams ON dim_players.team_id = dim_teams.team_id
    LEFT JOIN regular_season_mvp ON dim_players.player_id = regular_season_mvp.player_id
    WHERE dim_players.player_id = :player_id
    """
)

PLAYER_NAME = text(
    """
    SELECT
        player_id,
        full_name
    FROM gold.dim_players
    WHERE player_id = :player_id
    """
)

GAME_LOG_FILTERS = """
    player_id = :player_id
      AND (:season IS NULL OR season = :season)
      AND (:is_back_to_back IS NULL OR is_back_to_back = :is_back_to_back)
"""

LIST_GAME_LOGS_COUNT = text(
    f"""
    SELECT count(*) AS total
    FROM gold.fct_player_game_logs
    WHERE {GAME_LOG_FILTERS}
    """
)

LIST_SEASON_STATS_COUNT = text(
    """
    SELECT count(*) AS total
    FROM gold.fct_player_season_stats
    WHERE player_id = :player_id
    """
)

LIST_SEASON_STATS = text(
    """
    SELECT
        player_id,
        season,
        games_played,
        ppg,
        rpg,
        apg
    FROM gold.fct_player_season_stats
    WHERE player_id = :player_id
    ORDER BY season
    LIMIT :limit OFFSET :offset
    """
)

BACK_TO_BACK_STATS = text(
    """
    SELECT
        count(*) FILTER (WHERE is_back_to_back) AS total_back_to_backs,
        count(*) FILTER (
            WHERE
        is_back_to_back
        AND coalesce(minutes, 0) > 0
        ) AS games_played_in_b2b,
        count(*) FILTER (
            WHERE
        is_back_to_back
        AND coalesce(minutes, 0) = 0
        ) AS games_sat_in_b2b,
        round(
            avg(points) FILTER (WHERE is_back_to_back)::numeric, 1
        ) AS avg_pts_b2b,
        round(
            avg(points) FILTER (
                WHERE NOT coalesce(is_back_to_back, false)
            )::numeric,
            1
        ) AS avg_pts_non_b2b
    FROM gold.fct_player_game_logs
    WHERE player_id = :player_id
      AND (:season IS NULL OR season = :season)
    """
)


def list_game_logs_stmt(order_column: str, descending: bool):
    direction = "DESC" if descending else "ASC"
    return text(
        f"""
        SELECT
            game_id,
            game_date,
            season,
            season_type,
            coalesce(opponent_abbreviation, '') AS opponent_abbreviation,
            coalesce(location, '') AS location,
            coalesce(result, '') AS result,
            minutes,
            points,
            rebounds,
            assists,
            steals,
            blocks,
            turnovers,
            plus_minus,
            mvp_game_score,
            coalesce(is_back_to_back, false) AS is_back_to_back
        FROM gold.fct_player_game_logs
        WHERE {GAME_LOG_FILTERS}
        ORDER BY
        {order_column} {direction} NULLS LAST,
        career_game_number DESC
        LIMIT :limit OFFSET :offset
        """
    )


PLAYERS_BY_IDS = text(
    """
    SELECT
        dim_players.player_id,
        dim_players.full_name
    FROM gold.dim_players
    WHERE dim_players.player_id IN :player_ids
    """
).bindparams(bindparam("player_ids", expanding=True))

# Opposite-team meetings only (same game_id, not teammates). Warehouse logs start 2010-11.
HEAD_TO_HEAD_LOGS = text(
    """
    WITH left_logs AS (
        SELECT
            player_id,
            game_id,
            team_id
        FROM gold.fct_player_game_logs
        WHERE player_id = :player_a
    ),
    right_logs AS (
        SELECT
            player_id,
            game_id,
            team_id
        FROM gold.fct_player_game_logs
        WHERE player_id = :player_b
    ),
    opposed AS (
        SELECT left_logs.game_id
        FROM left_logs
        INNER JOIN right_logs ON left_logs.game_id = right_logs.game_id
        WHERE left_logs.team_id IS DISTINCT FROM right_logs.team_id
    )
    SELECT
        fct_player_game_logs.player_id,
        coalesce(fct_player_game_logs.player_name, '') AS full_name,
        fct_player_game_logs.game_id,
        fct_player_game_logs.game_date,
        fct_player_game_logs.season,
        coalesce(fct_player_game_logs.matchup, '') AS matchup,
        coalesce(fct_player_game_logs.team_abbreviation, '') AS team_abbreviation,
        coalesce(fct_player_game_logs.opponent_abbreviation, '') AS opponent_abbreviation,
        coalesce(fct_player_game_logs.location, '') AS location,
        coalesce(fct_player_game_logs.result, '') AS result,
        fct_player_game_logs.minutes,
        fct_player_game_logs.points,
        fct_player_game_logs.rebounds,
        fct_player_game_logs.assists,
        fct_player_game_logs.steals,
        fct_player_game_logs.blocks,
        fct_player_game_logs.turnovers,
        fct_player_game_logs.plus_minus
    FROM gold.fct_player_game_logs
    INNER JOIN opposed ON fct_player_game_logs.game_id = opposed.game_id
    WHERE fct_player_game_logs.player_id IN (:player_a, :player_b)
    ORDER BY
        fct_player_game_logs.game_date DESC,
        fct_player_game_logs.game_id,
        fct_player_game_logs.player_id
    """
)


def _mean(values: list[float | int | None]) -> float | None:
    present = [float(value) for value in values if value is not None]
    if not present:
        return None
    return round(sum(present) / len(present), 1)


def build_head_to_head(
    players: list[dict],
    logs: list[dict],
    player_ids: list[UUID],
) -> dict:
    names = {row["player_id"]: row["full_name"] for row in players}
    by_player: dict[UUID, list[dict]] = {player_id: [] for player_id in player_ids}
    games: list[dict] = []
    grouped: dict[str, dict] = {}

    for row in logs:
        player_id = row["player_id"]
        if player_id in by_player:
            by_player[player_id].append(row)
        game_id = row["game_id"]
        game = grouped.get(game_id)
        if game is None:
            game = {
                "game_id": game_id,
                "game_date": row["game_date"],
                "season": row["season"],
                "matchup": row["matchup"],
                "lines": [],
            }
            grouped[game_id] = game
            games.append(game)
        game["lines"].append(
            {
                "player_id": player_id,
                "full_name": names.get(player_id) or row["full_name"],
                "team_abbreviation": row["team_abbreviation"],
                "opponent_abbreviation": row["opponent_abbreviation"],
                "location": row["location"],
                "result": row["result"],
                "minutes": row["minutes"],
                "points": row["points"],
                "rebounds": row["rebounds"],
                "assists": row["assists"],
                "steals": row.get("steals"),
                "blocks": row.get("blocks"),
                "turnovers": row.get("turnovers"),
                "plus_minus": row.get("plus_minus"),
            }
        )

    for game in games:
        game["lines"].sort(key=lambda line: player_ids.index(line["player_id"]))

    averages = []
    for player_id in player_ids:
        rows = by_player[player_id]
        averages.append(
            {
                "player_id": player_id,
                "full_name": names[player_id],
                "games": len(rows),
                "mpg": _mean([row["minutes"] for row in rows]),
                "ppg": _mean([row["points"] for row in rows]),
                "rpg": _mean([row["rebounds"] for row in rows]),
                "apg": _mean([row["assists"] for row in rows]),
                "plus_minus": _mean([row.get("plus_minus") for row in rows]),
            }
        )

    return {
        "games_played": len(games),
        "players": averages,
        "games": games,
    }


def compare_players_stmt(order_column: str):
    order_expr = COMPARE_ORDER_EXPR.get(order_column)
    if order_expr is None:
        raise ValueError(f"Unsupported compare order column '{order_column}'")
    return text(
        f"""
        WITH career_plus_minus AS (
            SELECT
                player_id,
                round(avg(plus_minus)::numeric, 1) AS career_avg_plus_minus
            FROM gold.fct_player_game_logs
            WHERE player_id IN :player_ids
            GROUP BY player_id
        ),
        {REGULAR_SEASON_MVP_CTES},
        playoff_mvp AS (
            SELECT
                fct_player_mvp_scores.player_id,
                fct_player_mvp_scores.mvp_score,
                fct_player_mvp_scores.mvp_rank
            FROM gold.fct_player_mvp_scores
            INNER JOIN mvp_season ON fct_player_mvp_scores.season = mvp_season.season
            WHERE fct_player_mvp_scores.season_type = 'Playoffs'
        )
        SELECT
            dim_players.player_id,
            dim_players.full_name,
            dim_teams.abbreviation AS team_abbreviation,
            dim_players.position,
            coalesce(dim_players.career_games_played, 0) AS career_games_played,
            coalesce(dim_players.seasons_played, 0) AS seasons_played,
            dim_players.first_season,
            dim_players.last_season,
            dim_players.career_ppg,
            dim_players.career_rpg,
            dim_players.career_apg,
            career_plus_minus.career_avg_plus_minus,
            mvp_season.season AS mvp_season,
            regular_season_mvp.mvp_score,
            regular_season_mvp.mvp_rank,
            playoff_mvp.mvp_score AS playoff_mvp_score,
            playoff_mvp.mvp_rank AS playoff_mvp_rank
        FROM gold.dim_players
        CROSS JOIN mvp_season
        LEFT JOIN gold.dim_teams ON dim_players.team_id = dim_teams.team_id
        LEFT JOIN career_plus_minus ON dim_players.player_id = career_plus_minus.player_id
        LEFT JOIN regular_season_mvp ON dim_players.player_id = regular_season_mvp.player_id
        LEFT JOIN playoff_mvp ON dim_players.player_id = playoff_mvp.player_id
        WHERE dim_players.player_id IN :player_ids
        ORDER BY
        {order_expr} DESC NULLS LAST,
        dim_players.full_name
        """
    ).bindparams(bindparam("player_ids", expanding=True))
