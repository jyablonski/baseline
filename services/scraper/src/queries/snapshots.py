"""SQL for current-snapshot replace (injuries) and upcoming-odds pruning."""

from __future__ import annotations

from sqlalchemy import text

DELETE_STALE_PLAYER_INJURIES = text(
    """
    DELETE FROM source.player_injuries
    WHERE scraped_at < :scraped_at
    """
)

# Only unstarted events are pruned. A started game drops off The Odds API
# feed, and its last pregame row is the only closing-ish line we will ever
# have for it, so it is kept as history rather than treated as stale.
DELETE_STALE_GAME_ODDS = text(
    """
    DELETE FROM source.game_odds
    WHERE
        scraped_at < :scraped_at
        AND commence_time > :now_utc
    """
)
