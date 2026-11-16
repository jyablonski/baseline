---
summary: Games the market underdog won, ranked by how unlikely the morning line said they were.
status: current
code:
  - services/dbt/models/marts/fct_game_upsets.*
  - services/dbt/models/marts/fct_game_odds.*
  - services/dbt/models/intermediate/int_game_moneylines.*
  - services/scraper/src/scrapers/odds.py
  - services/cube/model/cubes/game_upsets.yml
related:
  - docs/features/results-and-notables.md
  - docs/features/picks.md
  - docs/decisions/0004-ingest-cadence-daily.md
---

# Upsets

## What users see

- **`/games`:** the Upsets tab of Season notables: the morning line's win % with "1 in N", the no-vig price, records entering the game and notable absences.
- **Home page:** results lead with upsets, longest shot first, with an Upset tag when the market had the loser at 60% or better.
- **Game page:** an "Upset" tag on the Before tip-off bar.
- **`/picks`:** a won pick on an upset is tagged "Called the upset".

## How it works

`fct_game_upsets` has one row per Final game with a captured pregame moneyline. The line is the bookmaker-average de-vigged win probability from the last odds scrape before tip-off. `is_upset` means the market underdog won. `upset_magnitude` is `-ln(winner_market_wp)` and ranks upsets within season and season type (`upset_rank`). The champion model's pregame WP rides along, so `model_called_upset` shows when the model had the underdog and the market did not.

How the line is kept: `scrape-odds` never writes an event that has already tipped, because the feed carries in-play prices that would overwrite the pregame line. Its prune only deletes _unstarted_ events that left the feed. So a played game keeps its last pregame row in `source.game_odds`.

## Surfaces

- `GET /api/v1/games/upsets`: biggest first (`season`, `season_type`, `team` for either side, `limit`, `offset`; no `season` means the newest season with any), with the winner's no-vig price (`winner_fair_moneyline`), each team's record entering the game, and notable absences.
- `GET /api/v1/games/{id}`: `is_upset`, `winner_market_wp`, `model_called_upset`. Picks from `GET /api/v1/account/picks` carry `is_upset`.
- Cube `game_upsets`, MCP `get_biggest_upsets`.

## Invariants

- **Empty, never an error**, where no line was captured. Every field above is null or empty then.
- There is no historical odds backfill. Odds history starts accruing with 2026-27, and only while `ODDS_API_KEY` is set.

## Gotchas

- With one morning scrape a day the "pregame line" is a **morning line, not a close**; never call it a closing line ([0004](../decisions/0004-ingest-cadence-daily.md)).
- A game with no captured line is never an upset and never tagged, even if the underdog won.

## Out of scope

An upsets page of its own (it lives on `/games`, the game page and `/picks`), and closing line value.
