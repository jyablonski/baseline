"""SQL for the read-only value report."""

from __future__ import annotations

from sqlalchemy import text

SELECT_VALUE_GAMES = text(
    """
    SELECT
        game_date,
        model_version,
        is_champion,
        is_backfilled,
        home_team_abbreviation,
        away_team_abbreviation,
        value_team_abbreviation,
        min_team_games,
        value_model_wp,
        value_market_wp,
        value_decimal_odds,
        edge_wp,
        expected_value,
        is_market_underdog,
        model_favors_underdog,
        is_value_pick,
        value_won,
        unit_profit
    FROM gold.fct_game_value
    ORDER BY game_date, model_version, expected_value DESC
    """
)
