---
summary: The Past Games tab — a day of results, and the season's comebacks, upsets, closest games and biggest margins.
status: current
code:
  - services/frontend/src/app/games/page.tsx
  - services/frontend/src/components/games/season-notables.tsx
  - services/frontend/src/components/games/result-tags.tsx
  - services/frontend/src/components/day-picker.tsx
  - services/frontend/src/lib/notables.ts
  - services/frontend/src/lib/results.ts
  - services/frontend/src/lib/calendar.ts
  - services/api/src/routers/games.py
  - services/api/src/queries/games.py
  - services/dbt/models/marts/fct_game_flow.*
related:
  - docs/features/upsets.md
  - docs/features/daily-highlights.md
  - docs/features/game-page.md
  - docs/features/schedule.md
---

# Results and season notables

## What users see

`/games` ("Past Games" in the nav) is finished games, the counterpart to `/schedule`; each links to the other in its intro.

- **A day of results**, opening on the newest day with a Final game (`?date=` for any other): a title ("Latest · Saturday, June 13"), a line with the shared stage and, for a lone series game, its number ("Finals · Game 5 · 1 game"), and a ← [date ▾] → picker whose arrows skip days off and whose month grid marks game days with dots. Each result reads winner first with logos, the margin and the game's lead highlight, and links to its game page.
- **Season notables** below, for the newest season with a finished game: Comebacks, Upsets ([upsets.md](upsets.md)), Closest games and Largest margins, every row with both teams' logos. Tab and team live in `?tab=` / `?team=`; with a team, rows read from its side ("Blew it" / "Came back", "Upset win" / "Upset loss"). Ten rows a page with ← Prev / Next →, ranks running on across pages. No season picker and no bars.

## How it works

The day view reads `GET /api/v1/games/dates` (every date with a Final game, newest first, unpaginated: the picker's dots and the season the notables use) and `GET /api/v1/games?game_date=` (that day's results with each side's conference, `series_game_number` in the playoffs, the `lead_highlight` headline, and `largest_lead_blown` from `gold.fct_game_flow`, the winner's biggest deficit, null without play-by-play). Comebacks, Closest games and Largest margins read `gold.fct_game_flow`; Upsets read `gold.fct_game_upsets`.

`/schedule` and `/games` share one `DayPicker` (`components/day-picker.tsx`) and `dayNavigation` (`lib/calendar.ts`), and both keep the day in `?date=`.

## Surfaces

- `GET /api/v1/games/dates`, `GET /api/v1/games?game_date=`.
- `GET /api/v1/games/upsets`, `/games/collapses`, `/games/closest`, `/games/largest-margins`: each with `team` (either side of the game) and `offset`.
- Cube `team_game_flow` (Ask's blown-leads and comebacks family).

## Invariants

- On the four notables routes `meta.total` is **the page's length, not a count**, so the UI asks for one row past the page to know there is a next.
- These routes are declared before `/games/{game_id}`.

## Gotchas

- A game without play-by-play has no flow, so it is missing from Comebacks, Closest games and Largest margins, and its `largest_lead_blown` is null.

## Out of scope

A season picker, multi-season notables ([0001](../decisions/0001-single-season.md)), and bar charts on the notables.
