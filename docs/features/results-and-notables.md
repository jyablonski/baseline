---
summary: The Games tab — a week strip of days, a day's results with settled picks, and the season's comebacks, upsets, closest games and biggest margins.
status: current
code:
  - services/frontend/src/app/games/page.tsx
  - services/frontend/src/app/past-games/page.tsx
  - services/frontend/src/components/games/week-strip.tsx
  - services/frontend/src/components/games/result-row.tsx
  - services/frontend/src/components/games/season-notables.tsx
  - services/frontend/src/components/games/result-tags.tsx
  - services/frontend/src/components/day-picker.tsx
  - services/frontend/src/lib/notables.ts
  - services/frontend/src/lib/results.ts
  - services/frontend/src/lib/calendar.ts
  - services/frontend/src/hooks/use-day-param.ts
  - services/frontend/next.config.ts
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

`/games` ("Games" in the nav) is one page for every game of the season: a "Games" title with two underline view tabs, **Schedule & results** (the default) and **Season notables** (`?view=notables`), and "Your picks →" on the right for a signed-in visitor with picks on. Today and later days are described in [schedule.md](schedule.md); this doc covers the strip, finished days and the notables.

- **Week strip:** ← , seven days, → and "Calendar ▾". Each day reads "Thu 19" over one line: "Today · 7", "6 final", "3 games" or "No games". The day on screen is filled dark; today, when it is not on screen, is shaded. Weeks are counted from today, which sits mid-strip, so picking a day already on the strip never moves it, and the arrows move the day on screen by a whole week. The calendar is a month grid with only game days pickable and a "Today" button. On phones the days scroll sideways with the one on screen kept in view, and the calendar is an icon.
- **A finished day** ("Last night · Saturday, November 21", or just the date further back) says "6 games · final" and lists each result winner first with logos, the score, tags, the lead highlight and →, linking to its game page. For a signed-in visitor with picks, a right-hand cell shows their settled pick on that game: "✓ You: DAL" in green for a win, "✗ You: BOS" in red for a loss, the side alone while it grades, empty when they made none. Footnote: "Tags and notes from play-by-play. Your settled picks show on the right. Click a game for the box score."
- **A day with no games** says "No games on this date." with a link to the next date that has games (or the latest one, after the last).
- **Season notables** for the newest season with a finished game: Comebacks, Upsets ([upsets.md](upsets.md)), Closest games and Largest margins as tabs, with the Team filter on their right. Ten rows, then "Show next 10 →" appends ten more, ranks running on. In the Game cell, "PHI beat CLE, 114–106" sits on one line and the note ("trailed by 29 in Q2") on its own line under it; neither wraps. Tab and team live in `?tab=` / `?team=`; with a team, rows read from its side ("Blew it" / "Came back", "Upset win" / "Upset loss"). No season picker and no bars.
- **URL state:** `?date=YYYY-MM-DD` (today drops it), `?view=notables&tab=comebacks|upsets|closest|margins&team=BOS`, and `?mine=1`. Day changes and view changes are pushed, so back and forward step through them; the My teams switch and the notables tabs and team replace.
- **Old addresses:** `/schedule` redirects to `/games` with its query (`next.config.ts`). `/past-games` is a small page that sends the visitor to `/games?date=<latest day with finals>`, or the `?date=` they asked for, keeping other params, and replaces itself in history.

## How it works

The week strip reads `GET /api/v1/games/days?from=&to=` once per visible week: each date with games in the range, counted as `total`, `final`, `live` (tipped by the Eastern clock but not Final, which includes awaiting a final) and `scheduled` (not yet tipped). A finished day reads `GET /api/v1/games?game_date=` (that day's results with each side's conference, `series_game_number` in the playoffs, the `lead_highlight` headline, and `largest_lead_blown` from `gold.fct_game_flow`, the winner's biggest deficit, null without play-by-play). Results are requested for dates up to today, games still to finish for dates from the Eastern date three hours ago, so today can carry both. The calendar's dots join `GET /api/v1/games/dates` (every date with a Final game, also the season the notables use) with `GET /api/v1/schedule/dates` from today. Comebacks, Closest games and Largest margins read `gold.fct_game_flow`; Upsets read `gold.fct_game_upsets`.

Settled picks come from the visitor's pick sheet, already loaded through the picks server action, matched to rows by `game_id`. `GET /api/v1/games` stays public and user-free: the browser calls it with no identity, and account data only travels through server actions with `ACCOUNTS_API_TOKEN`.

"Today" is the league's Eastern date (`isoDateET`), not the visitor's or UTC.

## Surfaces

- `GET /api/v1/games/days?from=&to=`: `[{date, total, final, live, scheduled}]`, oldest first, dates with no games left out, at most 31 days per request (422 otherwise, and when `to` is before `from`).
- `GET /api/v1/games/dates`, `GET /api/v1/games?game_date=`.
- `GET /api/v1/games/upsets`, `/games/collapses`, `/games/closest`, `/games/largest-margins`: each with `team` (either side of the game) and `offset`.
- Cube `team_game_flow` (Ask's blown-leads and comebacks family).

## Invariants

- On the four notables routes `meta.total` is **the page's length, not a count**, so the UI asks for one row past each batch of ten to know whether to offer the next.
- These routes are declared before `/games/{game_id}`.

## Gotchas

- A game without play-by-play has no flow, so it is missing from Comebacks, Closest games and Largest margins, and its `largest_lead_blown` is null.

## Out of scope

A season picker, multi-season notables ([0001](../decisions/0001-single-season.md)), and bar charts on the notables.
