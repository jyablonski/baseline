# 0007: Player trends compare the last 10 with the games before them

**Status:** Accepted. **Decided:** 2026-11-16.

## Context

The request was "last 10 games against the season average". On 2026-11-16 teams had played 11–14 games, so a player's last 10 were 75–90% of the season average they would be compared with: the comparison barely moves until late December.

## Decision

`fct_player_trends` compares the last 10 games with the player's games **before** them ("earlier games"). The season average is still shown beside them, for reference only. A trend is shown only once the player has enough earlier games (`trend_min_baseline_games`), and the UI shows nothing until then ([features/player-trends.md](../features/player-trends.md)).

## Consequences

- Trends appear about two weeks into a season instead of after two months, at the cost of a small early sample.
- Switching to "against the season average" is one CTE in the mart plus copy; nothing else depends on the choice.
