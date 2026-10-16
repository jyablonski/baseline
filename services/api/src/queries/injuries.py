"""SQL against gold injury marts."""

from __future__ import annotations

from sqlalchemy import text

# Status order for a list: who is out first, then the doubtful.
STATUS_ORDER = """
    CASE {status_column}
        WHEN 'Out For Season' THEN 1
        WHEN 'Out' THEN 2
        WHEN 'Day To Day' THEN 3
        ELSE 4
    END
"""

LIST_INJURIES = text(
    f"""
    SELECT
        fct_player_injuries.player_id,
        fct_player_injuries.player_name,
        fct_player_injuries.team_id,
        fct_player_injuries.team_abbreviation,
        fct_player_injuries.injury_status,
        fct_player_injuries.injury_detail,
        fct_player_injuries.description,
        fct_player_injuries.update_date,
        fct_player_injuries.is_notable
    FROM gold.fct_player_injuries
    WHERE
        (CAST(:team_id AS uuid) IS NULL OR fct_player_injuries.team_id = :team_id)
        AND (CAST(:notable AS boolean) IS NULL OR fct_player_injuries.is_notable = :notable)
    ORDER BY
        fct_player_injuries.team_abbreviation,
        fct_player_injuries.is_notable DESC,
        {STATUS_ORDER.format(status_column="fct_player_injuries.injury_status")},
        fct_player_injuries.player_name
    """
)

LIST_GAME_INJURIES = text(
    f"""
    SELECT
        fct_game_injuries.game_id,
        fct_game_injuries.side,
        fct_game_injuries.team_id,
        fct_game_injuries.player_id,
        fct_game_injuries.player_name,
        fct_game_injuries.injury_status,
        fct_game_injuries.injury_detail,
        fct_game_injuries.description,
        fct_game_injuries.update_date,
        fct_game_injuries.snapshot_date,
        fct_game_injuries.is_notable,
        fct_game_injuries.played
    FROM gold.fct_game_injuries
    WHERE fct_game_injuries.game_id = :game_id
    ORDER BY
        fct_game_injuries.side DESC,
        fct_game_injuries.is_notable DESC,
        {STATUS_ORDER.format(status_column="fct_game_injuries.injury_status")},
        fct_game_injuries.player_name
    """
)
