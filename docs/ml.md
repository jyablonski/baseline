# ML: pregame Elo and logit

One-shot jobs on Compose profile `tools`: not always-on services, not a betting product.

Three models score every game. **Elo v0** is the champion shown in the product; **Elo v1** and **logit v1** run in shadow. `CHAMPION_MODEL_VERSION` picks which one `gold.fct_game_predictions` surfaces, so promotion and rollback are an env change plus a re-run, never a backfill. Plan and promotion criteria: `docs/plans/ml-v2.md`.

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

**Elo v0 (champion).** Plain Elo. A 1-point win counts the same as a 30-point one. The fixed +100-point home head start means equal teams → home wins 64%, but home teams actually won ~55%. Ratings move slowly, so it needs a couple of months to learn who's good.

**Elo v1 (shadow).** Elo v0 with three fixes:

- **Blowouts count more:** a 20-point win moves ratings about three times as much as a 3-point win, less when a heavy favourite was expected to win big.
- **Learned home edge:** tracks how often home teams actually win, starting from 55%.
- **Fast start:** ratings move twice as fast until each team has played 20 games that season.

**Logit v1 (logistic regression, shadow).** A standard statistics model that weighs 11 pregame facts: point differential, win %, last-10 form, rest days, travel distance, time zones crossed, and head-to-head record. It learns each fact's weight from past games, then a correction step keeps its percentages honest. Until both teams have 10 games of history, it uses Elo v0's answer.

### Side by side

|                                    | Always home       | Elo v0                    | Elo v1               | Logit v1                                       |
| ---------------------------------- | ----------------- | ------------------------- | -------------------- | ---------------------------------------------- |
| Looks at                           | Nothing           | Wins and losses           | Wins, losses, margin | 11 pregame stats                               |
| Home advantage                     | Always picks home | Fixed (equal teams → 64%) | Learned (~55%)       | Learned                                        |
| Needs training?                    | No                | No                        | No                   | Yes                                            |
| Start of season                    | Same all year     | Slow                      | Fast for 20 games    | Uses Elo v0 for 10 games                       |
| 2025-26 accuracy                   | 55%               | 64%                       | **69%**              | 64%                                            |
| 2025-26 log loss (lower is better) | —                 | 0.623                     | **0.598**            | 0.624                                          |
| Status                             | Baseline          | Champion (`/schedule`)    | Shadow               | Shadow; scores live only after `make ml-train` |

Elo v1 is the most accurate. Logit v1 is the best calibrated (its 70% means about 70%) but no more accurate than Elo v0, because most of its inputs repeat what Elo learns from results. None of them knows who's playing tonight, so injuries and resting stars are their biggest blind spot.

## Technical detail

**Elo v0** walks forward over Regular Season **Final** rows in `gold.fct_team_game_results`: start 1500, home advantage +100, K=20, regress 25% toward 1500 each season. It scores upcoming games from `gold.fct_games_schedule` into `source.game_predictions`:

- `model_name=elo`, `model_version=elo-v0`
- grain is `game_id` + `as_of` + `model_version`, so a game can be rescored
- `model_wp` is the **home** win probability; away is `1 - model_wp`
- `market_wp` is copied from matching odds when present: a calibration reference, not the label

**Elo v1** (`src/elo_v1.py`, `model_version=elo-v1`) adds FiveThirtyEight's margin-of-victory multiplier on K, a home edge from the league home win rate so far (prior: 60 games at 55%), and K=40 until both teams have played 20 games that season. With settings fixed on Oct–Jan 2025-26 and graded on Feb–Apr, log loss fell 0.562 → 0.535 against v0 (full season 0.623 → 0.598; calibration error 0.078 → 0.030). That's one season, and the variants were chosen after seeing +100 was too high, so treat it as optimistic until live shadow results agree. Promote with `CHAMPION_MODEL_VERSION=elo-v1` and a re-run of `make ml`; `score` registers the `source.model_artifacts` row promotion needs.

Playoffs are excluded from training and holdout. Injuries and odds are ingested daily but are **not** Elo features.

## Running it

Run after scrape + dbt; it needs gold Finals and schedule.

```bash
make ml         # score all models, then the dbt copy into gold.fct_game_predictions
make ml-train   # fit logit v1 and persist its artifact
make ml-eval    # expanding-window logit metrics vs the Elo and always-home baselines

# or directly
docker compose --profile tools run --rm --no-deps ml python -m main eval
docker compose --profile tools run --rm --no-deps ml python -m main score
```

- `score` fits on all loaded Regular Season Finals and upserts a new `as_of` batch. `make refresh` runs it after dbt; an ml failure fails the whole script.
- `score` writes logit rows only once a trained artifact exists; otherwise it is silently Elo-only.
- `eval` prints holdout log loss, Brier, accuracy, and the always-home baseline, and writes nothing.
- Per-season metrics land in `gold.fct_prediction_scorecard`.
- Unit tests: `make test-ml` (90% coverage gate, no Docker).

**Never train on the daily cron.** `make ml-train` is manual: training beside the always-on stack is how the refresh starts OOMing, and a nightly retrain can't be reproduced. `refresh-daily.sh` runs `score` only.

### Backfill

`make ml-backfill` (production: `make prod-ml-backfill`) writes each loaded Regular Season Final's walk-forward pregame WP, stamped at midnight of game day, then rebuilds everything downstream of `source.game_predictions` so the scorecard grades it.

- **`SEASON=2025-26`** limits what is written. Ratings still carry over from every loaded season; with no prior season, every team starts at 1500 and early months grade poorly.
- **Elo only by default** (seconds). `LOGIT=1` adds logit via `eval-logit`'s blocks: refit before each 50-game block, no stored artifact, no row for the first block. Refits cost ~2 minutes a season and grow faster than linearly; blocks outside `SEASON` are skipped.
- **Live predictions win.** A game with a real pregame prediction for a model version is skipped for that version, so the scorecard never grades a replay over what was published. That makes the production target safe: it only fills gaps, such as a new shadow model's history.
- **Idempotent:** upserts on `(game_id, as_of, model_version)`. `market_wp` is attached only where retained odds exist.

### Local demo data

`/schedule` is empty in the off-season. `make seed-demo` (local only) writes fake data into the latest season via `scripts/demo/seed.sql`, then runs `make dbt`, `make ml`, and `make ml-backfill`:

- two weeks of Scheduled games from today (ids `0000de30-…`)
- two-book h2h and spread odds for the first week (`odds_event_id` `demo-…`)

Only the games and odds are fake; win % and scorecard are real model output. Rerun to roll the schedule forward. `make seed-demo-clean` removes the demo rows and rebuilds gold; backfilled predictions on real games stay.

## Current surface and gaps

`gold.fct_prediction_scorecard` is served by `GET /api/v1/predictions/scorecard` and rendered on `/predictions`. The champion is inferred from `gold.fct_game_predictions`, which only holds the champion's rows.

Not built: a per-game predictions endpoint (the champion WP ships as columns on `GET /api/v1/schedule`), "who wins tonight" in Ask, live in-game WP, historical odds as training features, and a Cube member or admin view for the scorecard.

**`gold.fct_standings` only holds current standings**, overwritten on every scrape. Joined onto a past game, it shows where teams finished, not where they stood that night, so a model would be learning from the future. Derive as-of rank from `gold.fct_team_game_results` instead.
