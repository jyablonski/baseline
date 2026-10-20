"""SQL against gold.fct_standings, which already derives whatever the scrape left out."""

from __future__ import annotations

from sqlalchemy import text

RESOLVED_SEASON = """
    coalesce(
        :season,
        (
            SELECT max(season)
            FROM gold.fct_standings
        )
    )
"""

STANDINGS_SELECT = """
    fct_standings.team_id,
    fct_standings.abbreviation,
    fct_standings.team_name,
    fct_standings.season,
    fct_standings.season_type,
    fct_standings.as_of_date,
    fct_standings.conference,
    fct_standings.division,
    fct_standings.conference_rank,
    fct_standings.division_rank,
    fct_standings.wins,
    fct_standings.losses,
    fct_standings.win_pct,
    fct_standings.games_back,
    fct_standings.streak,
    fct_standings.last_10,
    fct_standings.record_source,
    fct_standings.playoff_seed
"""

STANDINGS_FROM = f"""
    FROM gold.fct_standings
    WHERE
        fct_standings.season = ({RESOLVED_SEASON})
        AND fct_standings.season_type = 'Regular Season'
        AND (:conference IS NULL OR upper(fct_standings.conference) = upper(:conference))
"""

LIST_STANDINGS_COUNT = text(
    f"""
    SELECT count(*) AS total
    {STANDINGS_FROM}
    """
)

LIST_STANDINGS = text(
    f"""
    SELECT
        {STANDINGS_SELECT}
    {STANDINGS_FROM}
    ORDER BY
        fct_standings.conference,
        coalesce(fct_standings.playoff_seed, fct_standings.conference_rank) NULLS LAST,
        fct_standings.win_pct DESC NULLS LAST,
        fct_standings.team_name
    LIMIT :limit OFFSET :offset
    """
)

TEAM_STANDING = text(
    f"""
    SELECT
        {STANDINGS_SELECT}
    {STANDINGS_FROM}
        AND fct_standings.team_id = :team_id
    LIMIT 1
    """
)
