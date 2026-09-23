# ML: pregame Elo and logit

Both models are one-shot jobs on Compose profile `tools`, not always-on services and not a betting product.

Three models score every game. **Elo v0** is the champion the product shows; **Elo v1** and **logit v1** run in shadow beside it. `CHAMPION_MODEL_VERSION` decides which one `gold.fct_game_predictions` surfaces, so promotion and rollback are an env change plus a re-run, never a backfill. Plan and promotion criteria: `docs/plans/ml-v2.md`.

## What it does

Reads Regular Season **Final** rows from `gold.fct_team_game_results` and walk-forwards ratings: start 1500, home advantage +100, K=20, regress 25% toward 1500 at each season boundary.

Scores upcoming games from `gold.fct_games_schedule` and writes `source.game_predictions`:

- `model_name=elo`, `model_version=elo-v0`
- grain is `game_id` + `as_of` + `model_version`, so a game can be rescored later
- `model_wp` is the **home** win probability; the away side is `1 - model_wp`
- `market_wp` is copied from matching odds when present — a calibration reference, not the label

**Elo v1** (`src/elo_v1.py`, `model_version=elo-v1`) is the same walk-forward with three changes: a margin-of-victory multiplier on K (FiveThirtyEight's), a home edge learned from the league home win rate so far (prior: 60 games at 55%) instead of +100, and K=40 until both teams have played 20 games that season. On 2025-26, with settings fixed on Oct–Jan and graded on Feb–Apr, log loss went 0.562 → 0.535 against v0; over the full season 0.623 → 0.598, with calibration error 0.078 → 0.030. Those are one season of evidence, and the variant list was chosen after seeing that +100 was too high, so treat them as optimistic until live shadow results agree. Promote with `CHAMPION_MODEL_VERSION=elo-v1` and a re-run of `make ml`; `score` registers the `elo-v1` row in `source.model_artifacts` that promotion needs.

Playoffs are excluded from training and holdout. Injuries and odds are ingested daily but are **not** Elo features.

## Running it

Needs gold Finals and schedule to exist, so run it after scrape + dbt.

```bash
make ml         # score both models, then the dbt copy into gold.fct_game_predictions
make ml-train   # fit logit v1 and persist its artifact
make ml-eval    # expanding-window logit metrics vs the Elo and always-home baselines

# or directly
docker compose --profile tools run --rm --no-deps ml python -m main eval
docker compose --profile tools run --rm --no-deps ml python -m main score
```

`score` writes a logit row only when a trained artifact exists in `source.model_artifacts`; with no artifact the run is silently Elo-only. Run `make ml-train` once before expecting a second model in the table.

**Never train on the daily cron.** `make ml-train` is deliberate and manual: training beside the always-on stack is how the refresh starts OOMing, and a model that retrains nightly cannot be reproduced. `refresh-daily.sh` runs `score` only.

Per-season head-to-head metrics (log loss, Brier, accuracy, calibration error, market baselines) land in `gold.fct_prediction_scorecard`.

`eval` prints holdout log loss, Brier, accuracy, and the always-pick-home baseline. It writes nothing.

`score` fits on all loaded Regular Season Finals and upserts a new `as_of` batch. `make refresh` already runs it after dbt; an ml failure fails the whole script.

Unit tests: `make test-ml` (90% coverage gate, no Docker).

### Backfill

`make ml-backfill` runs `backfill`: walk-forward pregame WP for each loaded Regular Season Final, with `as_of` at midnight of game day, then rebuilds everything downstream of `source.game_predictions` so the scorecard grades it. `make prod-ml-backfill` is the production equivalent.

- `SEASON=2025-26` limits what is written. Both Elos still walk every loaded season so ratings carry over (regressed); a season with no prior season loaded starts every team at 1500 and its early months grade poorly.
- Elo only by default (seconds). `LOGIT=1` adds logit via the same expanding-window blocks `eval-logit` scores (refit before each 50-game block, so no stored artifact is needed and the first block gets no row). The refits are pure Python and cost roughly 2 minutes a season, growing faster than linearly with seasons loaded; with `SEASON` set, blocks outside that season are not refit.
- **Live predictions win.** A game that already has a real pregame prediction for a model version (anything the daily `score` wrote on or before game day) is skipped for that version, so the scorecard never grades a replay in place of what was published, and logit's replay never mixes with its stored-artifact predictions. This is what makes the production target safe; in practice it fills gaps, such as a new shadow model's history.
- Idempotent otherwise: it upserts on `(game_id, as_of, model_version)`. `market_wp` is attached only where retained odds exist.

### Local demo data

In the off-season `/schedule` is empty. `make seed-demo` (local only, no `prod-` variant) writes fake data into the latest season in `source.games` via `scripts/demo/seed.sql`, then runs `make dbt`, `make ml`, and `make ml-backfill`:

- two weeks of Scheduled games from today (ids `0000de30-…`)
- two-book h2h and spread odds for the first week of those games (`odds_event_id` `demo-…`)

The win % on those games and the whole scorecard are real Elo output; only the games and odds are fake. Rerun `make seed-demo` to roll the schedule forward to today. `make seed-demo-clean` deletes exactly the demo games, their odds and predictions, and rebuilds gold; backfilled predictions on real games stay.

## Not built

No standalone per-game predictions endpoint (the champion WP ships as columns on `GET /api/v1/schedule` and `/schedule`), no "who wins tonight" in Ask, no live in-game WP, and no historical odds backfill as training features.

`gold.fct_prediction_scorecard` is served by `GET /api/v1/predictions/scorecard` and rendered on `/predictions`. The champion is inferred from `gold.fct_game_predictions`, which only ever holds the champion's rows. It still has no Cube member or admin view.

One trap worth naming: **do not join `gold.fct_standings` onto a past game and call it "rank that night."** That table is a season-to-date upsert, so doing so leaks the future into the past.
