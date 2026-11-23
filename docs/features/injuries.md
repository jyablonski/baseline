---
summary: The injury report, who it flags as notable or key, and how one game's absences are scored.
status: current
code:
  - services/scraper/src/scrapers/injuries.py
  - services/scraper/src/scrapers/injuries_parse.py
  - services/dbt/macros/injury_status.sql
  - services/dbt/models/intermediate/int_player_injur*
  - services/dbt/models/intermediate/int_player_notability.*
  - services/dbt/models/marts/fct_player_injuries.*
  - services/dbt/models/marts/fct_game_injur*
  - services/api/src/queries/injuries.py
  - services/api/src/routers/injuries.py
  - services/frontend/src/components/injuries/
related:
  - docs/features/predictions.md
  - docs/decisions/0004-ingest-cadence-daily.md
  - docs/glossary.md
---

# Injuries

## What users see

- **Game page:** before the final, both teams' report for that game in the Before tip-off panel, from that morning's snapshot.
- **`/games`:** an Injuries column on today and later days that reads "3 listed" when a key player is Out or Day To Day (red when one is Out, grey otherwise) and opens both teams' report; other games show `—`, since nearly every game has someone listed.
- **Player page:** an injury badge while the player is listed.
- **Team page:** the injury report on Overview, and a badge on the Roster tab counting players ruled out.
- There is no injuries page.

## How it works

The scraper writes every injury scrape twice: an upsert into `source.player_injuries` (the current report, leavers deleted) and an append into `source.player_injuries_history`, one row per player, team, and scrape date. Basketball-Reference has no per-date archive, so the history only covers days the scrape ran: games before it began have no report, and that is not backfillable.

- **Status** is parsed from the note's lead by the `injury_status` macro: `Out`, `Day To Day`, `Out For Season`, or `Listed` for anything else, never a guess. `injury_detail` is the body part in the first parentheses.
- **Notable** (`int_player_notability`) means within the team's top `injury_notable_team_rank` (2) or the league's top `injury_notable_league_rank` (30) by average Regular Season game score, with at least `injury_notable_min_games` (3) games. Game score, not the MVP score, because the MVP score's availability penalty would demote exactly the injured stars this is for. A player notable this season or last counts, so opening night is not empty; a star who missed all of last season is not flagged until they have played this season.
- **Key** (`is_key`) is wider than notable: also the league's top `injury_key_league_rank` (100) by average game score. It only decides the `/games` Injuries column. Notable stays narrow because Elo v2 reads it as a feature.
- **`fct_player_injuries`** is the current report with status, body part, and `is_notable`.
- **`fct_game_injuries`** is one row per game and listed player for either team. A game reads the newest snapshot at most `injury_snapshot_max_age_days` (2) before the earlier of its date and today: a played game gets the report from that morning, an upcoming one today's, and a missed scrape does not leave a gap while a stale one is not trusted. Upcoming games only reach `injury_upcoming_days` (7) ahead. Once Final, `played` says whether the listed player logged minutes. It is the morning report, not the official inactive list: late scratches and returns are missed.
- **`fct_game_injury_scores`** is one row per game on a report: everyone missing rolled into one number per side, the injury input to Elo v3 ([ml.md](../ml.md)). Each listed player adds their average `mvp_box_score` from games before this one, in full if `Out` and at `injury_score_day_to_day_weight` (0.7) otherwise, the rate Day To Day players sat early in 2026-27. A player needs `injury_score_min_games` (3) this season and a game in the last `injury_score_recent_days` (14): a longer absence is already in the team's results. So the first week of a season scores 0 for everyone, and a game with no report has no row, which is not the same as a healthy game.

## Surfaces

- `GET /api/v1/injuries` (current report; `team_id` and `notable` filters) and `GET /api/v1/games/{game_id}/injuries`.
- Injury fields on `GET /api/v1/players/{id}`; `injuries_out`, `injuries_listed`, `has_key_injury` and `key_players_out` on schedule and game rows; `home_notable_out` / `away_notable_out` on upsets.
- Cube and MCP (`get_player_injuries`) still read the current report only.

## Knobs

`dbt_project.yml`: `injury_notable_*`, `injury_key_league_rank`, `injury_snapshot_max_age_days`, `injury_upcoming_days`, `injury_score_*`.

## Invariants

- **Notable stays narrow.** Elo v2 reads it as a feature, so widening it changes a model's predictions. Widen `is_key` instead, which only drives the `/games` column.
- Notability ranks on Game Score, not MVP score: MVP score's availability penalty would demote exactly the injured stars this is for.
- A game with no report has no injury score row. That is "unknown", not "healthy".

## Gotchas

- It is the **morning** report, not the official inactive list: late scratches and returns are missed ([0004](../decisions/0004-ingest-cadence-daily.md)).
- The first week of a season scores 0 for everyone in `fct_game_injury_scores` (nobody has the minimum games yet).
- A star who missed all of last season isn't notable until they've played this season.
- Replays of Elo v2 read `is_notable` as ranked on the season to date, not as of each game ([ml.md](../ml.md)).

## Out of scope

A standalone injuries page, hourly captures, and backfilling reports for days the scrape didn't run.
