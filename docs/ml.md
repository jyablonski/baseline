# ML: pregame Elo and logit

One-shot jobs on Compose profile `tools`: not always-on services, not a betting product.

Four models score every game. **Elo v1** is the champion shown in production; **Elo v0**, **Elo v2** and **logit v1** run in shadow. `CHAMPION_MODEL_VERSION` picks which one `gold.fct_game_predictions` surfaces, so promotion and rollback are an env change plus a re-run, never a backfill. The code default is still `elo-v0`: production sets `CHAMPION_MODEL_VERSION=elo-v1` in the server's `.env`, so a checkout without it (local, or a rebuilt box) shows Elo v0. Plan and promotion criteria: `docs/plans/ml-v2.md`.

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

**Elo v0 (shadow; the default when `CHAMPION_MODEL_VERSION` is unset).** Plain Elo. A 1-point win counts the same as a 30-point one. The fixed +100-point home head start means equal teams → home wins 64%, but home teams actually won ~55%. Ratings move slowly, so it needs a couple of months to learn who's good.

**Elo v1 (champion in production).** Elo v0 with three fixes:

- **Blowouts count more:** a 20-point win moves ratings about three times as much as a 3-point win, less when a heavy favourite was expected to win big.
- **Learned home edge:** tracks how often home teams actually win, starting from 55%.
- **Fast start:** ratings move twice as fast until each team has played 20 games that season.

**Elo v2 (shadow).** Elo v1's ratings, then three corrections it learns as the season goes:

- **Tempering:** if Elo v1's confident calls have been missing, its percentages are pulled toward 50%. Early in 2026-27 it put 24 of 68 games beyond 75/25 against the market's 14.
- **Back-to-backs:** how much a team on the second night of a back-to-back loses, learned from this season's back-to-backs.
- **Injured stars:** how much each notable player ruled out on the morning injury report costs their team. Only a fresh absence counts (the player played in the last two weeks); a long one is already in the team's rating.

Before each day's games it re-learns all three from that season's earlier results only. It starts the season as plain Elo v1 and needs a couple of hundred games before the corrections carry much weight, so the first few weeks look like v1.

**Logit v1 (logistic regression, shadow).** A standard statistics model that weighs 11 pregame facts: point differential, win %, last-10 form, rest days, travel distance, time zones crossed, and head-to-head record. It learns each fact's weight from past games, then a correction step keeps its percentages honest. Until both teams have 10 games of history it makes no prediction at all, so its scorecard row only counts games it actually called.

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

**Elo v1** (`src/elo_v1.py`, `model_version=elo-v1`) adds FiveThirtyEight's margin-of-victory multiplier on K, a home edge from the league home win rate so far (prior: 60 games at 55%), and K=40 until both teams have played 20 games that season. With settings fixed on Oct–Jan 2025-26 and graded on Feb–Apr, log loss fell 0.562 → 0.535 against v0 (full season 0.623 → 0.598; calibration error 0.078 → 0.030). That's one season, and the variants were chosen after seeing +100 was too high, so treat it as optimistic until live results agree. It was promoted in production on 2026-10-05, ahead of 2026-27, because v0's fixed +100 home edge put evenly matched teams at 36% / 64%. Promote with `CHAMPION_MODEL_VERSION=elo-v1` and a re-run of `make ml` (production: add it to the server's `.env`, then `make prod-ml`); `score` registers the `source.model_artifacts` row promotion needs. Roll back by setting `elo-v0` and re-running.

**Elo v2** (`src/elo_v2.py`, `model_version=elo-v2`) keeps Elo v1's ratings and puts a three-weight logistic layer on its pregame probability: `sigmoid(a · logit(v1) + b · back_to_back_diff + c · notable_out_diff)`, both differences home minus away. Back-to-back is one day of rest in `silver.int_game_features`; notable out counts `fct_game_injuries` rows that are `is_notable` and `Out` / `Out For Season`, the same rule as the schedule's injury chip, but only while the absence is new: the player must have logged minutes in the `RECENT_ABSENCE_DAYS` (14) before the game (`SELECT_GAME_CONTEXT`). A longer absence is already in the team's rating, so counting it would charge the team twice. Before each game date the weights are refit on the earlier Finals by Newton's method, with a Gaussian prior at (1, 0, 0) (plain Elo v1) of strength `PRIOR_STRENGTH` = 20. Nothing is fitted to the game being predicted, so `make ml-backfill` is a fair replay of what it would have published. Two caveats on that replay: a game with no injury snapshot (before the history began, or a missed scrape older than two days) counts as nobody out, and `is_notable` ranks players on the season's average game score to date, not as of that game, so a player who became a star later in the season reads as notable for earlier games too. Ratings still update on Elo v1's expectation, so v2 never changes v1's numbers. Promote it like v1: `CHAMPION_MODEL_VERSION=elo-v2` and a re-run.

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

Elo is refit from the loaded Finals on every run, so deleting a season would otherwise reset every team to 1500. `make ml-snapshot` (production: `make prod-ml-snapshot`) stores both Elos' end state in `source.model_artifacts` (`elo-v0`: ratings; `elo-v1`: ratings, games played this season, and the home win tally), with the season, date, and game count it runs through. Logit's artifact from `make ml-train` already persists. Elo v2 needs no snapshot: it reads Elo v1's, and its layer is relearned from the loaded Finals, starting from plain Elo v1 when there are none.

- **Order:** load the season, `make dbt`, `make ml-train`, `make ml-snapshot`, then delete the season and rebuild.
- **Used only when needed.** While every game behind a snapshot is still loaded, `score` and `backfill` walk the full history as before and ignore it. Once those games are gone they resume from the snapshot and walk only Finals dated after it, so the next season still starts from regressed ratings.
- **Rerunnable.** A later `ml-snapshot` rolls the stored state forward over newer Finals; it never restarts from 1500 because the old games are missing. Take it after a completed slate: Finals dated on the snapshot's last day are treated as already counted.
- **Don't rerun `ml-train` after the delete** unless you mean to: logit would be refit on whatever is left.

### Backfill

`make ml-backfill` (production: `make prod-ml-backfill`) writes each loaded Regular Season Final's walk-forward pregame WP, stamped at midnight of game day, then rebuilds everything downstream of `source.game_predictions` so the scorecard grades it.

- **`SEASON=2025-26`** limits what is written. Ratings still carry over from every loaded season; with no prior season, every team starts at 1500 and early months grade poorly.
- **Elo only by default** (seconds): v0, v1 and v2. `LOGIT=1` adds logit via `eval-logit`'s blocks: refit before each 50-game block, no stored artifact, no row for the first block or for cold-start games. Refits cost ~2 minutes a season and grow faster than linearly; blocks outside `SEASON` are skipped.
- **Live predictions win.** A game with a real pregame prediction for a model version is skipped for that version, so the scorecard never grades a replay over what was published. That makes the production target safe: it only fills gaps, such as a new shadow model's history. It also means a change to a model's behaviour needs a new `model_version`: replaying under the old name leaves every live row in place.
- **Idempotent:** upserts on `(game_id, model_version)`. `market_wp` is attached only where retained odds exist.

### Local demo data

`/schedule` is empty in the off-season. `make seed-demo` (local only) writes fake data into the latest season via `scripts/demo/seed.sql`, then runs `make dbt`, `make ml`, and `make ml-backfill`:

- two weeks of Scheduled games from today (ids `0000de30-…`)
- two-book h2h and spread odds for the first week (`odds_event_id` `demo-…`)

Only the games and odds are fake; win % and scorecard are real model output. Rerun to roll the schedule forward. `make seed-demo-clean` removes the demo rows and rebuilds gold; backfilled predictions on real games stay.

## Current surface and gaps

`gold.fct_prediction_scorecard` is served by `GET /api/v1/predictions/scorecard` and rendered on `/predictions`. The champion is inferred from `gold.fct_game_predictions`, which only holds the champion's rows.

Not built: a per-game predictions endpoint (the champion WP ships as columns on `GET /api/v1/schedule`), "who wins tonight" in Ask, live in-game WP, historical odds as training features, and a Cube member or admin view for the scorecard.

**`gold.fct_standings` only holds current standings**, overwritten on every scrape. Joined onto a past game, it shows where teams finished, not where they stood that night, so a model would be learning from the future. Derive as-of rank from `gold.fct_team_game_results` instead.
