"""SQL for current-snapshot replace (injuries, contracts) and upcoming-odds pruning."""

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

# A team's contracts page lists who it is paying now. A player traded or waived
# off it simply stops appearing, and an upsert alone leaves his old row behind,
# so he is counted on two payrolls. Scoped to one team: only a page that was
# just read says anything about that team's rows.
DELETE_STALE_PLAYER_CONTRACTS = text(
    """
    DELETE FROM source.player_contracts
    WHERE
        team_id = :team_id
        AND scraped_at < :scraped_at
    """
)
