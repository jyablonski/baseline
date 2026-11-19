---
summary: The players directory and Production vs Salary plot, player pages, compare, and the MVP score behind them.
status: current
code:
  - services/frontend/src/app/players/
  - services/frontend/src/components/players/value-plot.tsx
  - services/frontend/src/components/charts/player-value-scatter.tsx
  - services/frontend/src/lib/player-value.ts
  - services/api/src/routers/players.py
  - services/api/src/queries/players.py
  - services/dbt/models/marts/fct_player_mvp_scores.*
  - services/dbt/models/marts/fct_player_game_logs.*
  - services/dbt/models/marts/fct_player_season_stats.*
  - services/dbt/models/marts/dim_players.*
  - services/dbt/models/intermediate/int_player_game_logs_enriched.*
related:
  - docs/features/player-trends.md
  - docs/features/injuries.md
  - docs/features/transactions-and-contracts.md
  - docs/glossary.md
---

# Players and MVP score

## What users see

- **`/players`:** a **Production vs Salary** scatter (MVP score by salary; players coloured as MVP candidates, undervalued, overpaid, or average, with teams and players you can highlight; labelled dashed lines at the median salary and MVP score; names laid out together so close dots do not print over each other, with a leader line when one has to move; a pick is ringed and bold; a caption under the heading says how to read it, and a "How it's scored" toggle opens MVP score in four steps (Game Score, win or loss, season average, availability) with the league median, beside each colour group's rule; each legend entry carries its rule in a few words). Below it the directory, ranked by Regular Season MVP score by default (name sort available), with search and a team filter.
- **`/players/[id]`:** an injury badge when listed, the season bar and season MVP rank, Form ([player-trends.md](player-trends.md)), the game log with per-game MVP score, contract snapshot, B2B splits, and a Transactions table (linking the teams involved) shown only when the player has any.
- **`/players/compare`:** up to N players, sortable, a difference row, Regular Season and Playoff MVP score for the season. With exactly two, a head-to-head toggle shows games they played on opposite teams. Reached by selecting players on `/players`, not from the nav.

## How it works: MVP score

A house metric, not an official award model ([glossary](../glossary.md) for the three related numbers).

- **Game level** (`fct_player_game_logs.mvp_box_score` / `mvp_game_score`): Hollinger's Game Score with the terms the logs carry — points, FG and FT efficiency, rebounds at a single 0.4 weight (kept to one weight so logs scraped before the ORB/DRB split still score the same way), assists, steals, blocks, turnovers; no foul term. A win scales it up by `mvp_win_weight` (0.2), a loss scales it down. A log with no minutes is a DNP and scores null.
- **Season level** (`fct_player_mvp_scores`, player × season × season type): average game score × availability multiplier, ranked per season and season type. Regular Season and Playoffs only — play-in and the Cup final are left out.
- **Availability** compares games played to the games the player's latest team has played so far. The first 10% missed are free; past that the penalty ramps quadratically until 50% missed, where it caps at a quarter of the score.

## Surfaces

- REST: `GET /api/v1/players` (directory, `sort=mvp|name`), `/players/{id}`, `/players/{id}/game-log`, `/players/{id}/season-stats`, `/players/{id}/back-to-backs`, `/players/compare`, `/players/compare/head-to-head`.
- `GET /api/v1/players/value`: every Regular Season MVP-ladder player with a salary on file (unpaginated), behind the Production vs Salary plot. Salary is the current contract season's, reported as `salary_season`.
- MVP score is also served by REST (players directory, profile, compare, game log), Cube (`player_mvp_scores`, plus `season_type` / `mvp_box_score` / `mvp_game_score` on `player_game_logs`), and MCP (`get_mvp_ladder`, `get_player_mvp_scores`).

## Knobs

The `mvp_*` vars in `services/dbt/dbt_project.yml`.

## Invariants

- "Career" in field and tool names (`career_ppg`, `get_career_stats`) means the loaded season ([0001](../decisions/0001-single-season.md)).
- A DNP is not a game: it scores null and counts toward no average.
- Never describe MVP score as the official award vote.

## Gotchas

- Player `position` is a full name ("Point Guard") from `stg_players` onward. `source.players` keeps the roster code, which may be `PG`, an older `G-F`, or the `1`–`5` sort key an earlier scrape stored; all of them map to the same label.
- Availability is measured against the schedule of the team a player finished with, so a mid-season trade is judged on the new team's games played.
- Locally, a database that still holds last season makes "everything loaded" counts (the season band's games) look wrong.

## Out of scope

Season-over-season or all-time views, a season-leaders API route or page, and an official awards model. Ask answers league leaders in PPG, RPG and APG (see [ask-and-chat.md](ask-and-chat.md)); that is the only leaders surface.
