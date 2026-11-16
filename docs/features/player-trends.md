---
summary: Who is trending up or down, from each player's last 10 games against up to 20 before them, counting only changes past their usual swings.
status: current
code:
  - services/dbt/models/marts/fct_player_trends.*
  - services/api/src/queries/players.py
  - services/api/src/queries/teams.py
  - services/frontend/src/lib/player-trends.ts
  - services/frontend/src/components/players/player-trend.tsx
  - services/frontend/src/components/teams/team-trends.tsx
  - services/frontend/src/components/charts/sparkline.tsx
related:
  - docs/decisions/0007-trends-against-earlier-games.md
  - docs/decisions/0008-trend-baseline-and-noise.md
  - docs/glossary.md
---

# Player trends

## What users see

- **Player page, "Form"**, under the season band: a Trending up / Trending down / Steady tag; a sentence ("Last 10 games: 31.2 points a game, against 26.0 in the 20 games before."); the window's dates; four tiles (MVP game score, then the three box stats that moved most past their usual swings, filled out with points, rebounds and assists), each with the last-10 value, "▲ +5.5" or "steady", "prior 20: 22.6" and a sparkline of each game over a dashed line at the earlier average; and "All stats · 5 of 12 changed", a folded table of every stat (last 10, earlier, change, season).
- **Team page, Overview, "Who's trending"**: up to three rising and three falling players on the current roster, each row naming one stat ("Points 31.2 · was 26.0") with its sparkline and change. The rows are grouped by each player's overall label (the same as their page); the stat is the one that moved most past its swings, or MVP game score when no box stat did. Steady players are in neither list.
- **Before a player qualifies, nothing.** No heading, empty state or "check back later". The same when the API errors. In 2026-27 the first players qualify around 15 games in.

## How it works

`gold.fct_player_trends` holds one row per player with a game played in the current Regular Season. It numbers each player's games with minutes newest first: the newest `trend_window_games` are the last 10, and the up to `trend_baseline_games` before them are the baseline ("earlier games"), this season only. Every stat gets `_last_10`, `_baseline`, `_season`, `_change` (last 10 minus earlier), `_z`, `_changed` and `_games` (the window's per-game values, oldest first, for the sparkline). TS% averages come from each window's totals; its swing and sparkline use per-game TS%.

**Noise test.** `_z` is the change over its standard error, from the per-game values in both windows: `change / sqrt(var_last10 / n_last10 + var_baseline / n_baseline)` (Welch's statistic). `_changed` is `|z| >= trend_noise_z`. `trend_direction` is that test on MVP game score (up, down, otherwise steady), so the tag and the per-stat arrows never disagree. `trend_rank` ranks the MVP game score change league-wide among qualified players (1 = biggest riser).

The API folds the wide columns into a `stats` list (`trend_from_row` in `queries/players.py`), MVP game score first. The frontend picks tiles and the team-list stat in `lib/player-trends.ts`.

## Surfaces

- `GET /api/v1/players/{player_id}/trend`: `data` is null until the player qualifies; 404 only for an unknown player.
- `GET /api/v1/teams/{team_id}/trends`: qualified players whose `dim_players.team_id` is the team, biggest riser first; empty until any qualify.
- Each stat: `{stat, last_10, baseline, season, change, z, changed, games}`.
- Not in Cube, MCP or Ask.

## Knobs

`dbt_project.yml`: `trend_window_games` (10), `trend_baseline_games` (20), `trend_min_baseline_games` (5), `trend_min_minutes` (15 per game, in both windows), `trend_noise_z` (2.0). At 2.0 on 2026-11-16 data, about a fifth of qualified players read up or down, with 1–2 changed box stats each on average.

## Invariants

- The baseline is the games **before** the last 10, capped at 20, and **never last season** ([0007](../decisions/0007-trends-against-earlier-games.md), [0008](../decisions/0008-trend-baseline-and-noise.md), [0001](../decisions/0001-single-season.md)).
- Only a `changed` stat gets an arrow or a colour; everything else reads "steady".
- `trend_direction` and `trend_rank` are set exactly when `is_qualified` (singular test `assert_player_trends_label_only_when_qualified`); the dbt unit test `player_trends_change_must_beat_game_to_game_swings` pins the noise test and the baseline cap.
- The routes serve qualified players only; an unqualified row never reaches the UI.
- MVP game score here has no availability multiplier: missed games mean nothing over 10 games.

## Gotchas

- `_baseline` in column names means "earlier games", not a season baseline, and not the product name.
- The arrow shows which way the number moved; the colour says whether that is good. Fewer turnovers is a green ▼. Minutes show their change when it beats the swings but are never coloured.
- A stat needs two values in each window to be tested; with fewer, `z` is null and it reads steady (true of every stat in the dbt e2e seed).
- The team list uses the current roster (`dim_players.team_id`), while a trend's `team_id` is the team of the player's newest game. A just-traded player shows on the new team with games from the old one.
- The team Overview tiles' Last 10 line is not part of this: it compares team ratings with the season so far ([team-stats.md](team-stats.md)).

## Out of scope

A Last 5 window (five games almost always read steady under the noise test, and it would double the mart), reaching into last season, league-wide risers and fallers, a per-player trends table on the team Stats tab, sparklines on the team rating tiles (per-game team ratings aren't stored), playoff trends, and Cube / MCP access.
