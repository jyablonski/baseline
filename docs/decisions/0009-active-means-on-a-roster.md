# 0009: A player is active, and on a team, only as a current roster says

**Status:** Accepted. **Decided:** 2026-11-18.

## Context

Every Basketball-Reference scrape that met a player wrote his team and marked him active: rosters, contracts, injuries, box scores and play-by-play. Most of those pages name a team that is not his current one. A team's contracts page keeps players it waived and still pays, a play-by-play foul sits in the fouled team's column, and a backfilled box score is an old team. Nothing ever marked a player inactive. So Wembanyama and Luka landed on their last opponent, waived players moved back to the team paying them, and roster pages listed players the team had waived (PHI showed 27 active players). The daily pipeline did not run the roster scrape at all, so other scrapers were the only thing that moved players.

## Decision

- The roster scrape alone sets `source.players.team_id` and `is_active`. Other scrapers create a player they have not seen as inactive, and may fill an empty team, but never change either value (`ensure_player(..., from_roster=True)` is the only way).
- Active means on a current roster. After a roster scrape where all 30 team pages loaded with players, anyone no roster lists is marked inactive. If any page failed or came back empty, `is_active` is left alone that run.
- The daily pipeline runs the roster scrape just before contracts, under the same `enabled` gate.

## Consequences

- A waived or unsigned player keeps his last team but drops off every roster page, and the player search's active filter excludes him.
- A player signed after the morning roster scrape is inactive, with the team from his first box score or none, until the next day's run.
- One failed team page delays deactivation by a day rather than benching a whole roster.
- dbt tests `assert_player_team_matches_latest_game` and `assert_team_active_roster_size` guard both rules.
