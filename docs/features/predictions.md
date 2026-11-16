---
summary: Pregame win probabilities, which model the product shows, and how the models are graded.
status: current
code:
  - services/ml/src/
  - services/dbt/models/marts/fct_game_predictions.*
  - services/dbt/models/marts/fct_prediction_*
  - services/api/src/queries/predictions.py
  - services/api/src/routers/predictions.py
  - services/frontend/src/lib/predictions.ts
  - services/frontend/src/lib/model-breakdown.ts
  - services/frontend/src/components/predictions/
related:
  - docs/ml.md
  - docs/decisions/0002-champion-set-by-admin.md
  - docs/features/injuries.md
  - docs/glossary.md
---

# Predictions

The product view. Model internals, training, backfill and the value report are in [ml.md](../ml.md).

## What users see

- **`/schedule`:** the live model's win % for each upcoming game in the coming week.
- **Game page:** the live model's number, split into points of spread ("What goes into the number": strength, home court, and for Elo v2 / v3 confidence, back-to-back and injuries).
- **Team page calendar:** the team's win % on each upcoming game.
- **`/picks`:** "vs. the model" compares a visitor's picks with the live model's favourite.
- **`/predictions`** (not in the nav): "How accurate is the model?", the live model against the sportsbook and always picking home, with calibration and its current settings.
- **Admin › Models:** every model compared, with Promote to live.

## How it works

The ml job scores every model on every game from today through `SCORE_HORIZON_DAYS` (7) ahead into `source.game_predictions`, one row per game and `model_version`, overwritten until tip. Models: Elo v0, v1, v2, v3, and logit v1 once `make ml-train` has stored an artifact. `source.model_artifacts.is_champion` picks the live one; `gold.fct_game_predictions` copies only that model's rows, and the schedule reads gold. Every Final game is graded per model in `gold.fct_prediction_results` and summarised in `gold.fct_prediction_scorecard`.

## Surfaces

- Champion WP as columns on `GET /api/v1/schedule`, `GET /api/v1/games/{id}` (with `prediction_breakdown`) and `GET /api/v1/teams/{id}/season-games`.
- `GET /api/v1/predictions/scorecard`, `/calibration` and `/games`: the live model only, newest season, from `gold.fct_prediction_results`. `/games` takes an optional `team` (either side), and its `meta.total` is the real match count.
- `GET /api/v1/predictions/weights`: the live model's settings from the `breakdown` on its newest stored prediction; null before one exists.
- `GET /api/v1/admin/models` (every model's comparison) and `PUT /api/v1/admin/models/champion`, behind Admin › Models. The PUT needs a scored model (404 unknown, 409 no predictions), writes the registry row and queues a `dbt` admin job; a busy queue is reported, not an error.
- MCP `get_game_predictions`. Not in Ask ("who wins tonight" isn't built).

## Knobs

None in `dbt_project.yml` for the predictions themselves; model constants live in `services/ml/src/config.py` and the model modules. The `value_*` vars tune only the value report.

## Invariants

- **The live model is set only from Admin**, never by the ml job ([0002](../decisions/0002-champion-set-by-admin.md)).
- **Never hardcode a model name in product copy.** Pages name the live model from the data.
- `model_wp` is the **home** team's probability; away is 1 − WP.
- A game whose tip has passed is never rescored, so the graded row is the last pregame one.
- A change to a model's behaviour needs a new `model_version`: backfill skips games with a live prediction for that version.
- `make ml-train`, `ml-eval`, `ml-value` and `ml-snapshot` are manual only, never on the daily cron.
- Odds are not a feature of any model, only the `market_wp` reference.

## Gotchas

- Promotion queues a `dbt` rebuild; the schedule shows the old model until it finishes.
- Logit makes no prediction until both teams have 10 Finals, and its scorecard counts only games it called.
- Elo v2 / v3 see only the morning injury report ([injuries.md](injuries.md)).
- A new model shown in the product needs an entry in `MODEL_NOTES` and, if it reads injuries, `usesInjuries` in `lib/predictions.ts`.
- Breakdowns are null for rows stored before the column existed, for backfilled replays, and for logit.
- `gold.fct_standings` holds current standings only; never join it onto a past game as a feature.

## Out of scope

Live in-game win probability, a per-game predictions endpoint beyond the schedule columns, odds as training features, and a betting product.
