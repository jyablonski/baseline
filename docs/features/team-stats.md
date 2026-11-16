---
summary: Each team's ratings, pace and four factors in four splits, with league ranks.
status: current
code:
  - services/dbt/models/marts/fct_team_stat_splits.*
  - services/frontend/src/components/teams/team-stats.tsx
  - services/frontend/src/components/teams/team-overview.tsx
  - services/frontend/src/lib/team-ratings.ts
  - services/frontend/src/lib/team-page.ts
  - services/api/src/queries/teams.py
related:
  - docs/features/teams.md
---

# Team stats

## What users see

- **Team page, Overview:** net, offensive and defensive rating and pace as tiles with a rank meter and "3rd of 30", plus "2 of 7 games" while some games lack the rebound split. Under each, a Last 10 line: the `last_10` split's value and its change against the season so far, or "steady" within 2 rating points (1 possession for pace, which reads "faster" / "slower" instead of better or worse). No line until the team has played more than 10 games, since before that the two splits are the same games. These cutoffs are judgement, not a noise test: per-game team ratings are not stored ([0008](../decisions/0008-trend-baseline-and-noise.md)). `lastTenChange` in `lib/team-page.ts`.
- **Team page, Stats tab:** every stat grouped as Ratings, Scoring, Shooting and Possession, with a Season / Last 10 / Home / Away switch. Each row is a value, a bar that fills toward 1st (green top third, grey middle, red bottom, pace always grey) and its rank. A note says when the ratings cover fewer games than the split.
- **`/teams`:** the Net column in the standings and the offense-vs-defense plot.

## How it works

`fct_team_stat_splits` is one row per team per split of the current Regular Season: `season`, `last_10` (the newest ten games), `home` and `away`. It sums each side's player game logs into a team box score, so a game counts only when both teams' logs are in. Possessions are `FGA − OREB + TOV + 0.44 × FTA` averaged across both teams, so a team's offensive and defensive ratings share a denominator; pace is possessions per 48 minutes with overtime counted from team minutes. Ratings, pace, rebound rates and turnover rates use only games whose logs carry `orb` / `drb` (`games_with_possessions`); everything else uses every game. Each stat has a `_rank` within its split, 1 = best, ascending for the lower-is-better ones (defensive rating, opponent points and eFG%, turnover %); pace ranks fastest first and the UI shows it without a good/bad tone. A null stat has a null rank.

## Surfaces

REST only: `GET /api/v1/teams/{id}/stats` (Overview tiles and the Stats tab) and the three ratings on `GET /api/v1/standings` (the standings tables show Net). The roster tab's per-player numbers come from `fct_player_game_logs` directly (`GET /api/v1/teams/{id}/roster`).

## Invariants

- Ranks are within a split, 1 = best; a lower-is-better stat ranks ascending. A null stat has a null rank.
- Pace has no better direction: it ranks fastest first and the UI never colours it.

## Gotchas

`orb`, `drb` and `pf` arrived with migration 0028. The scraper treats a game as already loaded only once its logs have `orb`, so the next `scrape-all` (or `scrape-game-logs --season`) refetches every older game and fills them; until then those games drop out of the possession stats rather than skewing them, and the Stats tab says how many games the ratings cover.

## Out of scope

Cube / MCP access, and player-level splits.
