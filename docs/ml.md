# ML: pregame Elo and logit

One-shot jobs on Compose profile `tools`: not always-on services, not a betting product.

Five models score every game. **Elo v1** is the champion shown in production; **Elo v0**, **Elo v2**, **Elo v3** and **logit v1** run in shadow. `source.model_artifacts.is_champion` picks which one `gold.fct_game_predictions` surfaces. Promote from Admin › Models: it updates that row and queues a `dbt` job, and the schedule switches when the rebuild finishes, so promotion and rollback never need a backfill. The ml job scores every model and never changes the choice. A fresh database starts on Elo v0 (the migration seeds it).Plan and promotion criteria: `docs/plans/ml-v2.md`.

## The models in plain English

Each model answers one question before tip-off: **what's the chance the home team wins?** It stores that as `model_wp`; the away team gets the rest. Predictions only use games already finished.

### What is Elo?

A rating system from chess. Every team has one number for how good it is, starting at 1500.

- **Before a game:** the bigger the rating gap, the likelier the higher-rated team wins. A 400-point gap means the favourite wins about 10 times in 11.
- **After a game:** the loser gives points to the winner, more when the result was a surprise.
- **Between seasons:** ratings slide a quarter of the way back to 1500, because rosters change.

No training, no player data: just a running score of who beat whom, and how unexpectedly.

### The approaches

**Always pick the home team.** The naive baseline every model must beat: right 55% of the time in 2025-26. It gives no percentages, so it only has an accuracy score.

**Elo v0 (shadow; live on a fresh database).** Plain Elo. A 1-point win counts the same as a 30-point one. The fixed +100-point home head start means equal teams → home wins 64%, but home teams actually won ~55%. Ratings move slowly, so it needs a couple of months to learn who's good.

**Elo v1 (champion in production).** Elo v0 with three fixes:

- **Blowouts count more:** a 20-point win moves ratings about three times as much as a 3-point win, less when a heavy favourite was expected to win big.
- **Learned home edge:** tracks how often home teams actually win, starting from 55%.
- **Fast start:** ratings move twice as fast until each team has played 20 games that season.

**Elo v2 (shadow).** Elo v1's ratings, then three corrections it learns as the season goes:

- **Tempering:** if Elo v1's confident calls have been missing, its percentages are pulled toward 50%. Early in 2026-27 it put 24 of 68 games beyond 75/25 against the market's 14.
- **Back-to-backs:** how much a team on the second night of a back-to-back loses, learned from this season's back-to-backs.
- **Injured stars:** how much each notable player ruled out on the morning injury report costs their team. Only a fresh absence counts (the player played in the last two weeks); a long one is already in the team's rating.

Before each day's games it re-learns all three from that season's earlier results only. It starts the season as plain Elo v1 and needs a couple of hundred games before the corrections carry much weight, so the first few weeks look like v1.

**Elo v3 (shadow).** Elo v2 with a better injury input. Elo v2 counts notable players ruled out; Elo v3 adds up the production of everyone on the morning report who has been playing lately, so losing a star costs more than losing a bench player, and Day To Day players count for 70%. Everything else matches Elo v2, so any gap between them comes from that one input.

**Logit v1 (logistic regression, shadow). A standard statistics model that weighs 11 pregame facts: point differential, win %, last-10 form, rest days, travel distance, time zones crossed, and head-to-head record. It learns each fact's weight from past games, then a correction step keeps its percentages honest. Until both teams have 10 games of history it makes no prediction at all, so its scorecard row only counts games it actually called.

### Side by side

|                                    | Always home       | Elo v0                    | Elo v1               | Elo v2                                         | Logit v1                                       |
| ---------------------------------- | ----------------- | ------------------------- | -------------------- | ---------------------------------------------- | ---------------------------------------------- |
| Looks at                           | Nothing           | Wins and losses           | Wins, losses, margin | Elo v1 + back-to-backs + morning injury report | 11 pregame stats                               |
| Home advantage                     | Always picks home | Fixed (equal teams → 64%) | Learned (~55%)       | Elo v1's                                       | Learned                                        |
| Needs training?                    | No                | No                        | No                   | No (learns as the season goes)                 | Yes                                            |
| Start of season                    | Same all year     | Slow                      | Fast for 20 games    | Same as Elo v1 until games accumulate          | No prediction for 10 games                     |
| 2025-26 accuracy                   | 55%               | 64%                       | **69%**              | —                                              | 64%                                            |
| 2025-26 log loss (lower is better) | —                 | 0.623                     | **0.598**            | —                                              | 0.624                                          |
| Status                             | Baseline          | Shadow (code default)     | Champion in prod     | Shadow                                         | Shadow; scores live only after `make ml-train` |

Elo v1 is the most accurate. Logit v1 is the best calibrated (its 70% means about 70%) but no more accurate than Elo v0, because most of its inputs repeat what Elo learns from results. Only Elo v2 knows who's out tonight, and only from the morning report: late scratches and rest days announced near tip are still a blind spot. Elo v2 was added during 2026-27, so it has no 2025-26 numbers.

## Technical detail

**Elo v0** walks forward over Regular Season **Final** rows in `gold.fct_team_game_results`: start 1500, home advantage +100, K=20, regress 25% toward 1500 each season. It scores unplayed games from `gold.fct_games_schedule` dated today through `SCORE_HORIZON_DAYS` ahead (default 7) into `source.game_predictions`:

- `model_name=elo`, `model_version=elo-v0`
- grain is `game_id` + `model_version`: each run overwrites the row in place, so the table holds one prediction per game per model and the last pregame run is the one that gets graded. There is no history of how a number moved
- a game whose `start_time_et` has passed is not rescored, so the hourly catch-up (`docs/operations.md`) can rerun `score` during game time without replacing a graded pregame row. A game with no published tip-off time falls back to the date window
- nothing is kept past the horizon: `score` deletes rows for games dated beyond it, so `/schedule` shows a win probability only for the coming week. A number for a game months out is just today's ratings, and it would be rewritten every day until tip anyway
- `model_wp` is the **home** win probability; away is `1 - model_wp`
- `market_wp` is copied from matching odds when present: a calibration reference, not the label

**Elo v1** (`src/elo_v1.py`, `model_version=elo-v1`) adds FiveThirtyEight's margin-of-victory multiplier on K, a home edge from the league home win rate so far (prior: 60 games at 55%), and K=40 until both teams have played 20 games that season. With settings fixed on Oct–Jan 2025-26 and graded on Feb–Apr, log loss fell 0.562 → 0.535 against v0 (full season 0.623 → 0.598; calibration error 0.078 → 0.030). That's one season, and the variants were chosen after seeing +100 was too high, so treat it as optimistic until live results agree. It was promoted in production on 2026-10-05, ahead of 2026-27, because v0's fixed +100 home edge put evenly matched teams at 36% / 64%. Promote it from Admin › Models; `score` registers the `source.model_artifacts` row promotion needs. Roll back by setting `elo-v0` and re-running.

**Elo v2** (`src/elo_v2.py`, `model_version=elo-v2`) keeps Elo v1's ratings and puts a three-weight logistic layer on its pregame probability: `sigmoid(a · logit(v1) + b · back_to_back_diff + c · notable_out_diff)`, both differences home minus away. Back-to-back is one day of rest in `silver.int_game_features`; notable out counts `fct_game_injuries` rows that are `is_notable` and `Out` / `Out For Season`, the same rule as the schedule's injury chip, but only while the absence is new: the player must have logged minutes in the `RECENT_ABSENCE_DAYS` (14) before the game (`SELECT_GAME_CONTEXT`). A longer absence is already in the team's rating, so counting it would charge the team twice. Before each game date the weights are refit on the earlier Finals by Newton's method, with a Gaussian prior at (1, 0, 0) (plain Elo v1) of strength `PRIOR_STRENGTH` = 20. Nothing is fitted to the game being predicted, so `make ml-backfill` is a fair replay of what it would have published. Two caveats on that replay: a game with no injury snapshot (before the history began, or a missed scrape older than two days) counts as nobody out, and `is_notable` ranks players on the season's average game score to date, not as of that game, so a player who became a star later in the season reads as notable for earlier games too. Ratings still update on Elo v1's expectation, so v2 never changes v1's numbers. Promote it like v1: Admin › Models and a re-run.

**Elo v3** (`src/elo_v3.py`, `model_version=elo-v3`) is Elo v2's layer with one input swapped: `sigmoid(a · logit(v1) + b · back_to_back_diff + c · injury_score_diff / 10)`. `injury_score_diff` comes from `gold.fct_game_injury_scores` ([data.md](data.md) under Injuries) and is built only from games before the one scored, so it avoids the `is_notable` caveat above. The fit, the prior and the replay rules are Elo v2's, so a game with no report counts as healthy, and the first week of a season scores 0 for everyone. It has the morning report's blind spot too. Promote it the same way, but add it to `MODEL_NOTES` and `usesInjuries` in `services/frontend/src/lib/predictions.ts` first.

Playoffs are excluded from training and holdout. Odds are ingested daily but are **not** a feature of any model; they are only the `market_wp` reference.

## Running it

Run after scrape + dbt; it needs gold Finals and schedule.

```bash
make ml         # score all models, then the dbt copy into gold.fct_game_predictions
make ml-train   # fit logit v1 and persist its artifact
make ml-snapshot # persist Elo v0/v1 ratings so they survive deleting past seasons
make ml-eval    # expanding-window logit metrics vs the Elo and always-home baselines

# or directly
docker compose --profile tools run --rm --no-deps ml python -m main eval
docker compose --profile tools run --rm --no-deps ml python -m main score
```

- `score` fits on all loaded Regular Season Finals and upserts a new `as_of` batch. `make refresh` runs it after dbt; an ml failure fails the whole script.
- `score` writes logit rows only once a trained artifact exists; otherwise it is silently Elo-only. Even then, a game where either team has fewer than `LOGIT_COLD_START_GAMES` (10) Finals gets no logit row, and `score` deletes any logit row stored for such a game, including ones from before this rule, when the cold start copied Elo v0. That delete runs against the current threshold, so raising it would also delete real, already-graded logit predictions: change it only alongside a new `LOGIT_MODEL_VERSION`.
- `eval` prints holdout log loss, Brier, accuracy, and the always-home baseline, and writes nothing.
- Per-season metrics land in `gold.fct_prediction_scorecard`.
- Unit tests: `make test-ml` (90% coverage gate, no Docker).

**Never train on the daily cron.** `make ml-train` is manual: training beside the always-on stack is how the refresh starts OOMing, and a nightly retrain can't be reproduced. `refresh-daily.sh` runs `score` only.

### Keeping models without their history

Elo is refit from the loaded Finals on every run, so deleting a season would otherwise reset every team to 1500. `make ml-snapshot` (production: `make prod-ml-snapshot`) stores both Elos' end state in `source.model_artifacts` (`elo-v0`: ratings; `elo-v1`: ratings, games played this season, and the home win tally), with the season, date, and game count it runs through. Logit's artifact from `make ml-train` already persists. Elo v2 and v3 need no snapshot: they read Elo v1's, and their layers are relearned from the loaded Finals, starting from plain Elo v1 when there are none.

- **Order:** load the season, `make dbt`, `make ml-train`, `make ml-snapshot`, then delete the season and rebuild.
- **Used only when needed.** While every game behind a snapshot is still loaded, `score` and `backfill` walk the full history as before and ignore it. Once those games are gone they resume from the snapshot and walk only Finals dated after it, so the next season still starts from regressed ratings.
- **Rerunnable.** A later `ml-snapshot` rolls the stored state forward over newer Finals; it never restarts from 1500 because the old games are missing. Take it after a completed slate: Finals dated on the snapshot's last day are treated as already counted.
- **Don't rerun `ml-train` after the delete** unless you mean to: logit would be refit on whatever is left.

### Backfill

`make ml-backfill` (production: `make prod-ml-backfill`) writes each loaded Regular Season Final's walk-forward pregame WP, stamped at midnight of game day, then rebuilds everything downstream of `source.game_predictions` so the scorecard grades it.

- **`SEASON=2025-26`** limits what is written. Ratings still carry over from every loaded season; with no prior season, every team starts at 1500 and early months grade poorly.
- **Elo only by default** (seconds): v0, v1, v2 and v3. `LOGIT=1` adds logit via `eval-logit`'s blocks: refit before each 50-game block, no stored artifact, no row for the first block or for cold-start games. Refits cost ~2 minutes a season and grow faster than linearly; blocks outside `SEASON` are skipped.
- **Live predictions win.** A game with a real pregame prediction for a model version is skipped for that version, so the scorecard never grades a replay over what was published. That makes the production target safe: it only fills gaps, such as a new shadow model's history. It also means a change to a model's behaviour needs a new `model_version`: replaying under the old name leaves every live row in place.
- **Idempotent:** upserts on `(game_id, model_version)`. `market_wp` is attached only where retained odds exist.

### Local demo data

`/schedule` is empty in the off-season. `make seed-demo` (local only) writes fake data into the latest season via `scripts/demo/seed.sql`, then runs `make dbt`, `make ml`, and `make ml-backfill`:

- two weeks of Scheduled games from today (ids `0000de30-…`)
- two-book h2h and spread odds for the first week (`odds_event_id` `demo-…`)

Only the games and odds are fake; win % and scorecard are real model output. Rerun to roll the schedule forward. `make seed-demo-clean` removes the demo rows and rebuilds gold; backfilled predictions on real games stay.

## Value against the moneyline

`gold.fct_game_value` compares every model to the line on every game, and `make ml-value` (production: `make prod-ml-value`) grades it. The report is read-only and manual; nothing in the product reads either yet.

- **Value side:** the team with the higher expected profit at the consensus price, vig included. Every game has one, even a bad bet. `edge_wp` is model minus de-vigged market; `expected_value` is model WP over the vigged price, minus 1, and ranks the picks.
- **Picks:** `is_value_pick` applies the `value_*` vars in `dbt_project.yml`: edge between `value_min_edge` and `value_max_edge`, positive expected value, `value_min_team_games` for both teams, `value_min_bookmakers`, and market underdogs only while `value_underdog_only` is set. `model_favors_underdog` is the stricter old rule, the model above 50% on the underdog.
- **Grading:** `unit_profit` is one unit at the consensus price, not the best price, because nobody holds every book. `value_best_moneyline` is reporting only.

To tune, run the report, change the vars, rebuild with `make dbt`, and use `SINCE=<date of the change>` from then on. The vars apply to the whole table, so a change re-flags past games: the games that suggested a threshold cannot also prove it. `MODEL=elo-v2` details a shadow model, and `LIVE_ONLY=1` drops backfilled replays, which never existed before the game they grade.

Read the report in this order:

1. **Slope.** Fits `logit(win) = logit(market) + b * (logit(model) - logit(market))` over every graded game. Near 0, the market already holds what the model knows; near 1, the model should replace the market. It uses every game, so it answers sooner than ROI.
2. **By edge.** A real edge earns more as it grows. Flat or falling means the big gaps are model misses.
3. **Sweep and out of sample.** The best of 171 rules always looks good on the games that chose it. The out-of-sample block picks a rule on the earlier dates and grades it on the later ones, and that is the number to trust.

ROI noise is about 1 / sqrt(n) per unit staked, so telling a 5% edge from zero takes around 1,000 bets, more than one season of picks. The line is the morning one and `source.game_odds` keeps only the latest row per event, so closing line value, the usual faster signal, cannot be measured. It would need a pre-tip scrape that keeps history.

As of 2026-11-01, Elo v1 on 88 games: log loss 0.622 against the market's 0.569, slope -0.23 (standard error 0.40), and no swept rule with 20 or more bets was profitable. That is early-season Elo, which cannot see the offseason.

## Why a prediction came out the way it did

Every Elo row written by `score` carries `breakdown` (JSONB on `source.game_predictions`, through `gold.fct_game_predictions`): the prediction split into parts in points of spread, positive for the home team, plus the model's settings on that run. Elo is a sum on the log-odds scale, so the split is exact, not an attribution estimate (`src/breakdown.py`):

- **Parts:** `strength` (rating gap) and `home_court` for every Elo; Elo v2 / v3 add `confidence` ((a − 1) × logit(v1), the tempering), `back_to_back` and `injuries`. They add up to the model's log-odds.
- **Settings:** `home_court_points`, and for Elo v1 and its layers the raw home tally it learned from (`home_games`, `home_win_rate`, across every game the walk has seen, so not "this season" once a snapshot carries last season); for Elo v2 / v3 the layer's `confidence` and points per back-to-back and per injury unit (`injury_unit`: a notable player for v2, ten points of injury score for v3).
- **Points:** `POINTS_PER_LOGIT` (8.0) turns log-odds into points. It was read off the sportsbooks' own spread and de-vigged moneyline on 2026-11-10's slate (7.9–8.6 on the lopsided games). No probability depends on it, so refining it changes words, not predictions.
- **Gaps:** rows written before the column existed, backfilled replays and logit have none, and the product shows nothing for them. Changing the constant does not rewrite stored rows.

The game page shows a game's breakdown; `/predictions` shows the live model's newest settings via `GET /api/v1/predictions/weights`.

## Current surface and gaps

`gold.fct_prediction_results` holds each model's final call on each Final game, and `gold.fct_prediction_scorecard` aggregates it. The public `GET /api/v1/predictions/*` routes serve the live model only (inferred from `gold.fct_game_predictions`, which only holds the champion's rows) for `/predictions`. `GET /api/v1/admin/models` serves every model for Admin › Models, including the comparison on shared games and the rolling log loss.

Not built: a per-game predictions endpoint (the champion WP ships as columns on `GET /api/v1/schedule`), "who wins tonight" in Ask, live in-game WP, historical odds as training features, and a Cube member for the scorecard.

**`gold.fct_standings` only holds current standings**, overwritten on every scrape. Joined onto a past game, it shows where teams finished, not where they stood that night, so a model would be learning from the future. Derive as-of rank from `gold.fct_team_game_results` instead.
