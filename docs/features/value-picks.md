---
summary: Every model's edge and expected value against the moneyline, graded by a manual report. Not in the product.
status: current
code:
  - services/dbt/models/marts/fct_game_value.*
  - services/ml/src/value.py
related:
  - docs/ml.md
  - docs/features/predictions.md
  - docs/features/upsets.md
---

# Value picks

## What users see

Nothing. `gold.fct_game_value` and `make ml-value` are an operator's report; no page or route reads them yet.

## How it works

`fct_game_value` has one row per game per model, scheduled or Final, wherever a pregame prediction and a captured moneyline both exist. It holds shadow models too, and carries the side with the higher expected profit at the consensus price, the edge against the de-vigged market, and the one-unit result. `is_value_pick` applies the `value_*` vars. How to read the report, tune the vars and judge the result: [ml.md](../ml.md) under Value against the moneyline.

## Surfaces

`make ml-value` (production: `make prod-ml-value`), read-only and manual. `MODEL=` details one model, `LIVE_ONLY=1` drops backfilled replays, `SINCE=` limits to games after a change.

## Knobs

The `value_*` vars in `dbt_project.yml`: `value_min_edge`, `value_max_edge`, `value_min_team_games`, `value_min_bookmakers`, `value_underdog_only`.

## Invariants

- `make ml-value` is manual only, never on the daily cron, and writes nothing.
- Changing a var re-flags past games: the games that suggested a threshold cannot also prove it. Grade a change only on games after it (`SINCE=`).
- `unit_profit` is one unit at the consensus price, not the best price.

## Gotchas

- The line is the morning one and closing line value cannot be measured ([0004](../decisions/0004-ingest-cadence-daily.md)).
- ROI noise is about 1 / sqrt(n) per unit, so telling a 5% edge from zero takes around 1,000 bets.

## Out of scope

Showing value picks in the product, and betting features.
