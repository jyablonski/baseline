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

Ingest is the **current season only**, and that is the only season the product supports (AGENTS.md, Season scope). `--seasons` exists to reload that season; loading other seasons is unsupported.

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

**Play-by-play is today's Finals only.** The daily scrape passes today's Final game ids, then the same `dbt build` enriches them. Running `scrape-play-by-play` without `--game-id` backfills a whole season and is a deliberate manual operation — the full history is 8–10M rows.

## dbt

Project `nba_analytics`, Python 3.13. `make dbt` runs `deps` + `build`. E2E: `make test-dbt`.

Local `compose run` bind-mounts models and SQL, so YAML and SQL edits need no rebuild. Rebuild only after Dockerfile, lockfile, or package changes.

**Staging** views mirror source tables one-to-one. **Intermediate** models do the real work — enriched game logs, contract and injury name matching, transaction participant resolution, play-by-play parsing and scoring.

**Gold** holds the product tables: `dim_players`, `dim_teams`, `fct_player_game_logs`, `fct_player_season_stats`, `fct_player_mvp_scores`, `fct_team_game_results` (Final only), `fct_games_schedule`, `fct_standings`, `fct_player_contracts`, `fct_team_payroll`, `fct_game_predictions`, `fct_player_injuries`, `fct_game_injuries`, `fct_game_odds`, `fct_play_by_play`, `fct_play_by_play_scoring`, `fct_game_flow`, `fct_reddit_posts`, `fct_reddit_comments`, `fct_reddit_entity_mentions`, `fct_reddit_flair`, `fct_transactions`, `fct_transaction_participants`, `fct_prediction_scorecard` (per-model evaluation metrics; see [ml.md](ml.md)), `fct_game_upsets`, `fct_daily_highlights`, and the injury marts (all below).

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

Served by Cube (`game_upsets`), MCP (`get_biggest_upsets`), and REST: `GET /api/v1/games/upsets` lists upsets biggest first (`season`, `season_type`, `team` for either side, `limit`, `offset`; no `season` means the newest season with any), with the winner's no-vig price (`winner_fair_moneyline`), each team's record entering the game, and notable absences, `GET /api/v1/games/{id}` carries `is_upset`, `winner_market_wp` and `model_called_upset`, and each pick from `GET /api/v1/account/picks` carries `is_upset`. All three are null or empty where no line was captured, never an error. The frontend shows them in the `/games` Upsets tab, on the game page and in `/picks`.

### Daily highlights

`fct_daily_highlights` is the "what stood out" feed: one row per candidate highlight for every Final game, scored and ranked. Text is generated from a template per type, not by a model, so every card traces back to numbers in the row.

| Type                                           | Trigger                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `league_season_high`                           | Most of a stat (points, rebounds, assists, blocks, steals, threes) by anyone this season   |
| `season_high`                                  | A personal season high in one of those stats by a top-30 MVP-ladder player                 |
| `elite_game`                                   | Game score in the season's top 1%                                                          |
| `big_scoring_night`                            | 40 or more points                                                                          |
| `triple_double`                                | Double digits in three box-score stats                                                     |
| `scoring_duel`                                 | Both teams' top scorers at 30 or more                                                      |
| `win_streak` / `losing_streak`                 | A streak reaches 5 or more                                                                 |
| `win_streak_snapped` / `losing_streak_snapped` | A streak of 5 or more ends                                                                 |
| `blown_lead`                                   | A lead of 20 or more lost, or one in the season's top 5% that is at least 15               |
| `lead_changes`                                 | 20 or more lead changes                                                                    |
| `overtime`                                     | Any overtime                                                                               |
| `blowout`                                      | Won by 30 or more                                                                          |
| `upset`                                        | The moneyline underdog won at 30% or less; empty until odds history exists (see Upsets)    |
| `heavyweight_clash`                            | Both teams in the league's top 5 by record entering the game                               |
| `top_performer`                                | The game's best line. Every game with logs has one, so a quiet night still shows something |

Every threshold and weight is a `highlight_*` var in `services/dbt/dbt_project.yml`.

- **Score** is `base_weight * (1 + magnitude) * (1 + importance)`. `magnitude` (0-1) is how far past its threshold the event went. `importance` (0-1) is the subject: MVP rank for a player, league rank entering the game for a team, and a flat 1 outside the Regular Season.
- **Ranking** is one highlight per game. `game_rank` orders a game's candidates, the lead one from each game competes for `day_rank`, and the top three are `is_featured`. A single wild game cannot take every slot, and no player or team shows up twice in a day.
- **Guards**: season highs need 10 prior games for the player, league highs 10 prior game dates, and team rank 10 games played. Without them the first week of a season is all "season highs".
- **As-of caveat**: season highs, streaks, and team rank are computed as of the game. MVP rank and the elite-game percentile use the season as it stands today, so an old day's scores can drift as the season goes on.
- `lead_changes` counts direct lead flips only (`fct_game_flow` treats a pass through a tie as a tie), so it runs lower than a box score's number. That is why the bar is 20, not 30.

Served by REST (`GET /api/v1/games/highlights`, one lead highlight per game for a day), Cube (`daily_highlights`), and MCP (`get_daily_highlights`). The home page shows each game's lead headline under its score (from `lead_highlight` on `GET /api/v1/games`).

### Injuries

The scraper writes every injury scrape twice: an upsert into `source.player_injuries` (the current report, leavers deleted) and an append into `source.player_injuries_history`, one row per player, team, and scrape date. Basketball-Reference has no per-date archive, so the history only covers days the scrape ran: games before it began have no report, and that is not backfillable.

- **Status** is parsed from the note's lead by the `injury_status` macro: `Out`, `Day To Day`, `Out For Season`, or `Listed` for anything else, never a guess. `injury_detail` is the body part in the first parentheses.
- **Notable** (`int_player_notability`) means within the team's top `injury_notable_team_rank` (2) or the league's top `injury_notable_league_rank` (30) by average Regular Season game score, with at least `injury_notable_min_games` (3) games. Game score, not the MVP score, because the MVP score's availability penalty would demote exactly the injured stars this is for. A player notable this season or last counts, so opening night is not empty; a star who missed all of last season is not flagged until they have played this season.
- **`fct_player_injuries`** is the current report with status, body part, and `is_notable`.
- **`fct_game_injuries`** is one row per game and listed player for either team. A game reads the newest snapshot at most `injury_snapshot_max_age_days` (2) before the earlier of its date and today: a played game gets the report from that morning, an upcoming one today's, and a missed scrape does not leave a gap while a stale one is not trusted. Upcoming games only reach `injury_upcoming_days` (7) ahead. Once Final, `played` says whether the listed player logged minutes. It is the morning report, not the official inactive list: late scratches and returns are missed.

Served by REST: `GET /api/v1/injuries` (current, `team_id` and `notable` filters), `GET /api/v1/games/{id}/injuries`, injury fields on `GET /api/v1/players/{id}`, and `home_notable_out` / `away_notable_out` on the schedule and game rows (notable players `Out` or `Out For Season`). Cube and MCP still read the current report only.

### National TV

`fct_games_schedule.national_tv` lists a game's national TV and streaming networks, comma-separated (`ESPN, ABC`). It is null for a local-only game or one ESPN has not listed.

The source is ESPN's public scoreboard JSON, the only thing taken from ESPN: neither Basketball-Reference nor The Odds API carries a broadcaster. `scrape-broadcasts` (also a daily pipeline step) reads today plus 14 days, one request per day because the endpoint rejects date ranges, into `source.game_broadcasts`. Events are matched to `source.games` by both teams and the Eastern date, the same way odds are. The endpoint is undocumented and unkeyed, so treat a failure as a source that can change shape without notice. For that reason the step is optional in the daily run: a failure is logged and recorded against the source, but the run still goes on to dbt. The TV column is blank for games further out than the window. Preseason events are stored but match nothing, since preseason games are not on the schedule.

## Serving

**REST reads gold directly over SQL.** Games, players, teams, standings, schedule, game flow, and the predictions scorecard all work whether or not Cube is up.

`GET /api/v1/status` is the only endpoint that reads `source` — it reports scrape watermarks and coverage counts.

**Only `POST /api/v1/query` goes through Cube**, and only Ask and MCP depend on it. There is no gold-SQL fallback for those, by design.

Contracts and payroll have no route of their own: they arrive as columns on `dim_players` and `dim_teams`. Reddit is served by `/api/v1/social` and transactions by `/api/v1/transactions`, whose rows carry `linked_player_names`: only the players matched to a Baseline UUID, under Baseline's name, which are the only ones the UI links. Odds and predictions ride on `GET /api/v1/schedule`: the champion row from `fct_game_predictions`, plus a per-game consensus from `fct_game_odds` (average vig-free home WP, a moneyline converted back from the average implied WP per side, and the median home spread). Only rows with a matched `game_id` count. `GET /api/v1/predictions/scorecard` serves `fct_prediction_scorecard`. Injuries are under [Injuries](#injuries) above.

## Gotchas

`score_margin` on gold games is the **unsigned winner margin**; team-game REST signs it for the requested team.

Salary and payroll are Basketball-Reference **remaining-year snapshots**, not a paid ledger.

Player `position` is a full name ("Point Guard") from `stg_players` onward. `source.players` keeps the roster code, which may be `PG`, an older `G-F`, or the `1`–`5` sort key an earlier scrape stored; all of them map to the same label.

`fct_standings` derives what the source leaves out, in `int_standings_records`: `streak` and `last_10` from the team's own Regular Season Finals (Basketball-Reference's standings carry no form columns), `division_rank` (never scraped), `games_back` for a conference leader, which the source leaves empty, and the whole row (W–L, win %, `conference_rank`, games back) for any team-season with Finals but no scraped standings, marked `record_source = 'games'` with a null `as_of_date`. Derived ranks break ties with the NBA criteria the data can answer: head-to-head (or the record among the tied teams for three or more), division leader, division and conference win %, then point differential. Win % against playoff-eligible teams and the restart of a multi-team tie once some teams separate are not modeled; team name stands in for the random drawing. `int_playoff_seeds` reads the same ranks, so a season the scraper has not reached still gets its play-in bracket. The pages, Cube, and MCP all read those columns and none of them recomputes a record, so there is one definition. `fct_standings` is a season-to-date upsert. Joining it onto a past game does not give you the standings as of that night.

Transactions are keyed by `sha256(transaction_date|description)`, so a reworded Basketball-Reference entry arrives as a new row rather than an edit. Draft picks are prose with no link on the source page and never become participants; a player named inside a pick clause is linked and is kept. A transaction naming a player that `scrape-players` has not seen yet drops that participant and picks it up on a later run — transactions reference players, they never create or reactivate them.
