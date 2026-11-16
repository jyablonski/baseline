# Data

scrape → `source` → dbt → `silver`/`gold` → REST and Cube.

Alembic owns `source` DDL, dbt owns silver and gold, Cube YAML sits on gold. Nothing auto-scrapes: scraper, dbt, and ml are on profile `tools`.

Until dbt builds gold, `GET /api/v1/status` fails and the UI shows `Data as of —`.

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

Ingest is the **current season only**, and that is the only season the product supports ([decision 0001](decisions/0001-single-season.md)). `--seasons` exists to reload that season; loading other seasons is unsupported.

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
| `scrape-broadcasts`               | `source.game_broadcasts` — ESPN national TV, next 14 days, no key  |
| `scrape-reddit`                   | `source.reddit_posts`, `source.reddit_comments` — needs `REDDIT_*` |
| `scrape-play-by-play`             | `source.play_by_play`                                              |
| `scrape-daily`                    | the whole basketball daily, ungated                                |
| `scrape-all [--seasons]`          | teams, players, contracts, current-season data, transactions       |

All Basketball-Reference HTML goes through one shared conservative transport with retries. Identity is never guessed from a name alone.

**Play-by-play is today's Finals only.** The daily scrape passes every current-season Final with no play-by-play yet, chosen separately from the box-score list because BRef can post the two pages at different times. The same `dbt build` then enriches them. Running `scrape-play-by-play` without `--game-id` backfills a whole season and is a deliberate manual operation — the full history is 8–10M rows.

## dbt

Project `nba_analytics`, Python 3.13. `make dbt` runs `deps` + `build`. E2E: `make test-dbt`.

Local `compose run` bind-mounts models and SQL, so YAML and SQL edits need no rebuild. Rebuild only after Dockerfile, lockfile, or package changes.

**Staging** views mirror source tables one-to-one. **Intermediate** models do the real work — enriched game logs, contract and injury name matching, transaction participant resolution, play-by-play parsing and scoring.

**Gold** holds the product tables: `dim_players`, `dim_teams`, `fct_player_game_logs`, `fct_player_season_stats`, `fct_player_mvp_scores`, `fct_team_game_results` (Final only), `fct_games_schedule`, `fct_standings`, `fct_player_contracts`, `fct_team_payroll`, `fct_game_predictions`, `fct_player_injuries`, `fct_game_injuries`, `fct_game_odds`, `fct_play_by_play`, `fct_play_by_play_scoring`, `fct_game_flow`, `fct_reddit_posts`, `fct_reddit_comments`, `fct_reddit_entity_mentions`, `fct_reddit_flair`, `fct_transactions`, `fct_transaction_participants`, `fct_prediction_results`, `fct_prediction_scorecard` (per-model evaluation metrics; see [ml.md](ml.md)), `fct_game_upsets`, `fct_game_value`, `fct_game_injury_scores`, `fct_daily_highlights`, `fct_team_stat_splits`, `fct_player_trends`, and the injury marts (all below).

Materialization is a real decision here — see `services/dbt/AGENTS.md` for the policy. Two things to know:

- `int_play_by_play_events` is **incremental**. Its regex parsing costs ~2 minutes to rebuild in full, so changing its SQL needs `--full-refresh`.
- `fct_play_by_play` carries both the raw actions and the typed event detail. It absorbed a former sibling mart; dbt does not drop removed models, so an existing database needs a one-off `DROP TABLE gold.fct_play_by_play_events`.

### Feature marts

Each feature's marts, knobs and rules are documented with the feature:

| Marts                                                                                         | Doc                                                                                          |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `fct_player_mvp_scores`, `mvp_box_score` / `mvp_game_score` on game logs                      | [Players and MVP score](features/players.md)                                                 |
| `fct_player_trends`                                                                           | [Player trends](features/player-trends.md)                                                   |
| `fct_game_upsets`                                                                             | [Upsets](features/upsets.md)                                                                 |
| `fct_game_value`                                                                              | [Value picks](features/value-picks.md)                                                       |
| `fct_daily_highlights`                                                                        | [Daily highlights](features/daily-highlights.md)                                             |
| `fct_player_injuries`, `fct_game_injuries`, `fct_game_injury_scores`, `int_player_notability` | [Injuries](features/injuries.md)                                                             |
| `fct_games_schedule` (back-to-backs, national TV), `fct_game_odds`                            | [Schedule](features/schedule.md)                                                             |
| `fct_team_stat_splits`                                                                        | [Team stats](features/team-stats.md)                                                         |
| `fct_standings`                                                                               | [Teams and standings](features/teams.md)                                                     |
| `fct_game_flow`, `fct_play_by_play*`                                                          | [Game page](features/game-page.md), [Results and notables](features/results-and-notables.md) |
| `fct_game_predictions`, `fct_prediction_*`                                                    | [Predictions](features/predictions.md)                                                       |
| contracts, payroll, transactions                                                              | [Transactions and contracts](features/transactions-and-contracts.md)                         |
| `fct_reddit_*`                                                                                | [Social](features/social.md)                                                                 |

## Serving

**REST reads gold directly over SQL.** Games, players, teams, standings, schedule, game flow, and the predictions scorecard all work whether or not Cube is up.

`GET /api/v1/status` reports scrape watermarks and coverage counts from `source`; `GET /api/v1/features` (flags), the account routes and `/admin/*` also read `source`.

**Only Ask (`POST /api/v1/query`) and Chat go through Cube**, and only they and MCP depend on it. There is no gold-SQL fallback for those, by design.

Which route serves what is in each feature doc's Surfaces section.

## Gotchas

`score_margin` on gold games is the **unsigned winner margin**; team-game REST signs it for the requested team.

Feature-specific gotchas (standings derivation, transactions keys, salary snapshots, player positions) are in the feature docs above.
