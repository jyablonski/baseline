# Data

scrape → `source` → dbt → `silver`/`gold` → REST and Cube.

Alembic owns `source` DDL, dbt owns silver and gold, Cube YAML sits on gold. Nothing auto-scrapes: scraper, dbt, and ml are on profile `tools`.

Until dbt builds gold, `GET /api/v1/status` fails and the UI shows `Scraped —`.

## First load

Not `refresh-daily` — the daily gate is off by default and only scrapes today's slate.

```bash
# teams, players, contracts, then this season's games / logs / standings
docker compose --profile tools run --rm --no-deps scraper python -m main scrape-all

# snapshots scrape-all skips
docker compose --profile tools run --rm --no-deps scraper python -m main scrape-injuries

# gold — required for REST, the UI, and Cube
make dbt

# optional Elo, once Regular Season Finals exist
make ml
```

Always pass `--no-deps` next to Tilt so Compose does not recreate Postgres.

Default ingest is the **current season only**. Backfill later with `--seasons 2010-11,2024-25`.

You're done when `curl -s localhost:8000/api/v1/status` returns JSON and `gold.fct_team_game_results` has rows.

## Scraper

Click CLI, `python -m main`. Upserts only — Alembic must have created the tables first.

| Command                           | Writes                                                             |
| --------------------------------- | ------------------------------------------------------------------ |
| `scrape-teams` / `scrape-players` | `source.teams`, `source.players`                                   |
| `scrape-games --season`           | `source.games`                                                     |
| `scrape-game-logs --season`       | `source.player_game_logs`                                          |
| `scrape-standings --season`       | `source.standings`                                                 |
| `scrape-contracts`                | `source.player_contracts`, `source.team_payroll`                   |
| `scrape-transactions [--season]`  | `source.transactions`, `source.transaction_participants`           |
| `scrape-injuries`                 | `source.player_injuries` — current snapshot, deletes leavers       |
| `scrape-odds`                     | `source.game_odds` — needs `ODDS_API_KEY`, else skipped            |
| `scrape-reddit`                   | `source.reddit_posts`, `source.reddit_comments` — needs `REDDIT_*` |
| `scrape-play-by-play`             | `source.play_by_play`                                              |
| `scrape-daily`                    | the whole basketball daily, ungated                                |
| `scrape-all [--seasons]`          | teams, players, contracts, then per-season data and transactions   |

All Basketball-Reference HTML goes through one shared conservative transport with retries. Identity is never guessed from a name alone.

**Play-by-play is today's Finals only.** The daily scrape passes today's Final game ids, then the same `dbt build` enriches them. Running `scrape-play-by-play` without `--game-id` backfills a whole season and is a deliberate manual operation — the full history is 8–10M rows.

## dbt

Project `nba_analytics`, Python 3.13. `make dbt` runs `deps` + `build`. E2E: `make test-dbt`.

Local `compose run` bind-mounts models and SQL, so YAML and SQL edits need no rebuild. Rebuild only after Dockerfile, lockfile, or package changes.

**Staging** views mirror source tables one-to-one. **Intermediate** models do the real work — enriched game logs, contract and injury name matching, transaction participant resolution, play-by-play parsing and scoring.

**Gold** holds the product tables: `dim_players`, `dim_teams`, `fct_player_game_logs`, `fct_player_season_stats`, `fct_player_mvp_scores`, `fct_team_game_results` (Final only), `fct_games_schedule`, `fct_standings`, `fct_player_contracts`, `fct_team_payroll`, `fct_game_predictions`, `fct_player_injuries`, `fct_game_odds`, `fct_play_by_play`, `fct_play_by_play_scoring`, `fct_game_flow`, `fct_reddit_posts`, `fct_reddit_comments`, `fct_reddit_entity_mentions`, `fct_reddit_flair`, `fct_transactions`, `fct_transaction_participants`, `fct_prediction_scorecard` (per-model evaluation metrics; see [ml.md](ml.md)), and `fct_game_upsets` (see below).

Materialization is a real decision here — see `services/dbt/AGENTS.md` for the policy. Two things to know:

- `int_play_by_play_events` is **incremental**. Its regex parsing costs ~2 minutes to rebuild in full, so changing its SQL needs `--full-refresh`.
- `fct_play_by_play` carries both the raw actions and the typed event detail. It absorbed a former sibling mart; dbt does not drop removed models, so an existing database needs a one-off `DROP TABLE gold.fct_play_by_play_events`.

### MVP score

A house metric, not an official award model. Knobs are the `mvp_*` vars in `services/dbt/dbt_project.yml`.

- **Game level** (`fct_player_game_logs.mvp_box_score` / `mvp_game_score`): Hollinger's Game Score with the terms the logs carry — points, FG and FT efficiency, rebounds at a single 0.4 weight (no ORB/DRB split), assists, steals, blocks, turnovers; no foul term. A win scales it up by `mvp_win_weight` (0.2), a loss scales it down. A log with no minutes is a DNP and scores null.
- **Season level** (`fct_player_mvp_scores`, player × season × season type): average game score × availability multiplier, ranked per season and season type. Regular Season and Playoffs only — play-in and the Cup final are left out.
- **Availability** compares games played to the games the player's latest team has played so far. The first 10% missed are free; past that the penalty ramps quadratically until 50% missed, where it caps at a quarter of the score.
- **Served** by REST (players directory, profile, compare, game log), Cube (`player_mvp_scores`, plus `season_type` / `mvp_box_score` / `mvp_game_score` on `player_game_logs`), and MCP (`get_mvp_ladder`, `get_player_mvp_scores`).

### Upsets

`fct_game_upsets` has one row per Final game with a captured pregame moneyline. The line is the bookmaker-average de-vigged win probability from the last odds scrape before tip-off. `is_upset` means the market underdog won. `upset_magnitude` is `-ln(winner_market_wp)` and ranks upsets within season and season type (`upset_rank`). The champion model's pregame WP rides along, so `model_called_upset` shows when the model had the underdog and the market did not.

**It is empty until the season produces Final games with captured lines.** There is no historical odds backfill. Odds history starts accruing with 2026-27, and only while `ODDS_API_KEY` is set.

How the history is kept: `scrape-odds` never writes an event that has already tipped, because the feed carries in-play prices that would overwrite the pregame line. Its prune only deletes _unstarted_ events that left the feed. So a played game keeps its last pregame row in `source.game_odds`. With one morning scrape a day, that row is a morning line, not a true close.

Served by Cube (`game_upsets`) and MCP (`get_biggest_upsets`). There is no REST route or page yet.

## Serving

**REST reads gold directly over SQL.** Games, players, teams, standings, schedule, game flow, and the predictions scorecard all work whether or not Cube is up.

`GET /api/v1/status` is the only endpoint that reads `source` — it reports scrape watermarks and coverage counts.

**Only `POST /api/v1/query` goes through Cube**, and only Ask and MCP depend on it. There is no gold-SQL fallback for those, by design.

Contracts and payroll have no route of their own: they arrive as columns on `dim_players` and `dim_teams`. Reddit is served by `/api/v1/social` and transactions by `/api/v1/transactions`. Odds and predictions ride on `GET /api/v1/schedule`: the champion row from `fct_game_predictions`, plus a per-game consensus from `fct_game_odds` (average vig-free home WP, a moneyline converted back from the average implied WP per side, and the median home spread). Only rows with a matched `game_id` count. `GET /api/v1/predictions/scorecard` serves `fct_prediction_scorecard`. Injuries have a gold mart but no REST route; they are reachable through Ask and MCP only.

## Gotchas

`score_margin` on gold games is the **unsigned winner margin**; team-game REST signs it for the requested team.

Salary and payroll are Basketball-Reference **remaining-year snapshots**, not a paid ledger.

Player `position` is a full name ("Point Guard") from `stg_players` onward. `source.players` keeps the roster code, which may be `PG`, an older `G-F`, or the `1`–`5` sort key an earlier scrape stored; all of them map to the same label.

`fct_standings` is a season-to-date upsert. Joining it onto a past game does not give you the standings as of that night.

Transactions are keyed by `sha256(transaction_date|description)`, so a reworded Basketball-Reference entry arrives as a new row rather than an edit. Draft picks are prose with no link on the source page and never become participants; a player named inside a pick clause is linked and is kept. A transaction naming a player that `scrape-players` has not seen yet drops that participant and picks it up on a later run — transactions reference players, they never create or reactivate them.
