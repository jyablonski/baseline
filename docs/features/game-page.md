---
summary: One page per game in any state — preview before tip, recap after the final.
status: current
code:
  - services/frontend/src/app/games/[id]/
  - services/frontend/src/components/games/
  - services/frontend/src/lib/game-story.ts
  - services/frontend/src/lib/game-flow.ts
  - services/frontend/src/components/charts/game-flow-chart.tsx
  - services/api/src/routers/games.py
  - services/api/src/queries/games.py
  - services/dbt/models/marts/fct_game_flow.*
  - services/dbt/models/marts/fct_play_by_play*
related:
  - docs/features/schedule.md
  - docs/features/predictions.md
  - docs/features/injuries.md
  - docs/features/upsets.md
  - docs/features/picks.md
---

# Game page

## What users see

`/games/[id]`, one page per game in any state. Schedule rows, the home page's upcoming times, team calendar cells and `/picks` rows link here.

- **Header:** logos, names, records (entering the game before it is Final, after it once Final, so the result is counted; outside the regular season they read "15–3 in playoffs"), a B2B badge before the final for a team that played last night, the score or the local tip time, and a meta line with the stage ("NBA Finals, Game 5", "Season opener"). Team brand colours come from the API.
- **Before the final:** "Who wins?" pick cards with the consensus price and implied %, an optional stake row (locked at tip-off; signed-out cards lead to sign-in), a Before tip-off panel (form, model win %, the injury report as an expandable row, national TV), and the series panel. Once tipped and before the Final lands, it says the score comes the morning after: there is no live data.
- **Once Final:** a headline from the series or the result ("Knicks win the NBA Finals, 4–1."); recap cards (the winner's star, a turning point from the flow and the same biggest run the chart shades, falling back to the winner's max lead and share of the game led when there was no decisive run or comeback, and the losing side's top scorer); a "Before tip-off" bar with the market's and the model's favourite and the visitor's graded pick (an "Upset" tag leads it when the market had the loser at 60% or better), whose Compare toggle opens one row each on a loser-to-winner axis; the flow chart; the box score (one team at a time, winner first, a Shooting % toggle, a team totals row); then the series panel beside This season (the other stages' records and the injury report).
- **In any state:** "Why the model says DAL 74%" splits the live model's number into points of spread ([predictions.md](predictions.md)); absent for a prediction stored without a breakdown.
- Regular-season game pages have no recap headline (the scoreboard says it); playoff, Finals, Cup and Play-In games keep theirs. The Finals is a playoff series between conferences; any other is "Playoffs".
- A "← Games" link returns to the game's day on `/games`, finished or not; "All games →" at the foot goes to `/games`.

## How it works

`GET /api/v1/games/{game_id}` returns the schedule row (shared SQL with `GET /api/v1/schedule`) plus scores, each team's record entering the game, current form before tip, the lead highlight, the upset fields and `prediction_breakdown`. The flow chart and turning points come from `gold.fct_game_flow` and the play-by-play marts; the box score from `/games/{id}/box-score`.

## Surfaces

- `GET /api/v1/games/{game_id}`, `/games/{id}/box-score`, `/games/{id}/flow`, `/games/{id}/play-by-play`, `/games/{id}/injuries`.
- MCP `get_play_by_play`.

## Invariants

- `/games/{game_id}` is declared after `/games/highlights`, `/games/collapses`, `/games/closest`, `/games/largest-margins`, `/games/dates` and `/games/upsets`, so those are not read as ids. A new static `/games/*` route goes above it.
- No live data: scores, box scores and play-by-play arrive with the morning scrape and the hourly catch-up ([operations.md](../operations.md)).

## Gotchas

- `GET_GAME` reuses the schedule's columns, so a schedule-row change shows up here too.
- `prediction_breakdown` is null for predictions stored before breakdowns, for backfilled replays and for logit.
- `fct_game_flow` needs play-by-play; a game without it has no flow, turning point or `largest_lead_blown`.
- `score_margin` on gold games is the **unsigned** winner margin; team-game REST signs it for the requested team.

## Out of scope

Live scores or in-game win probability, user game notes (deferred), and a page per play.
