---
summary: Today's and upcoming days on the Games page, with model win %, market odds, injuries, back-to-backs, national TV and picks.
status: current
code:
  - services/frontend/src/app/games/page.tsx
  - services/frontend/src/components/games/schedule-table.tsx
  - services/frontend/src/components/games/week-strip.tsx
  - services/frontend/src/components/day-picker.tsx
  - services/frontend/src/components/games/b2b-badge.tsx
  - services/frontend/src/lib/calendar.ts
  - services/frontend/src/lib/back-to-back.ts
  - services/api/src/routers/schedule.py
  - services/api/src/queries/games.py
  - services/dbt/models/marts/fct_games_schedule.*
  - services/dbt/models/marts/fct_game_odds.*
  - services/scraper/src/scrapers/broadcasts.py
  - services/scraper/src/scrapers/odds.py
related:
  - docs/features/predictions.md
  - docs/features/injuries.md
  - docs/features/picks.md
  - docs/features/results-and-notables.md
---

# Schedule

## What users see

The **Schedule & results** view of `/games` ("Games" in the nav), one day at a time. This doc covers today and later days; finished days and the week strip are in [results-and-notables.md](results-and-notables.md). `/schedule` redirects here (307), keeping its query, so `/schedule?date=…` lands on that day.

- Opens on today's Eastern date (`?date=` for any other). The title is "Today · Sunday, November 22" or "Tomorrow · …", with "7 games · PST" beside it (the account's zone, ET by default). The day view renders in the browser only, since "today" is the visitor's clock.
- **Rows** for games not yet Final: Time, Matchup (away, then "@ home", each in its own track so the "@" lines up), TV, Win %, Odds, Injuries and, with picks on, Your pick. No scores. A day that is partly played lists its finals first (result rows), then live games, then the ones still to tip.
- **Status** sits under the tip time: "Live" for three hours from the scheduled tip and "Awaiting final" after that, by the clock alone (no live feed, so no score or game clock); a game with no tip time is never called live. Games still to finish are read from the Eastern date three hours ago, so a late game stays on today past midnight. From tip the pregame numbers dim and the pick cell locks ([picks.md](picks.md)).
- **Injuries** column ([injuries.md](injuries.md)).
- **B2B badge** beside a team that played last night, with last night's result in its popover and a "B2B Played last night" legend beside the day's summary, on today and later days only.
- **Time** gives the local tip time and links to the game page; a row only adds a date when the tip falls on another local day.
- **The live model's win %** (away / home) and a **sportsbook consensus moneyline** with the home spread under it. Copy labels them as a model estimate and market odds, not betting advice. Any missing side renders `—`. Links to `/predictions`.
- A muted footnote under the rows: "Picks lock at tip-off." (when picks are on) and "Win % from Baseline's model; injuries in red include a key player."
- **Followed teams** ([accounts-and-follows.md](accounts-and-follows.md)): their rows are tinted, and a "My teams" switch on the right of the day header keeps only their games, past and upcoming alike (`?mine=1`, ignored for anyone who follows none).
- **Layout:** the table is a CSS grid of subgrid rows (`.schedule-grid` in `globals.css`) with shrinkable `minmax` tracks, so it fits a 900px window without sideways scroll; TV and the pick cell may wrap, times, teams, odds and "Add stake" never do. Below 640px each game stacks into a card: time and matchup, then win %, odds, injuries and TV with their names, then the pick cell. The table's ARIA roles are explicit, since a changed `display` can strip them.
- The home page's slate shows matchups and national TV only; streaks and back-to-backs are left to `/games` and the game page.

## How it works

`gold.fct_games_schedule` holds every game, scheduled or Final, with the champion's pregame WP, back-to-back flags and national TV. The API adds a per-game consensus from `fct_game_odds`: the average vig-free home WP, a moneyline converted back from the average implied WP per side, and the median home spread. Only odds rows with a matched `game_id` count.

**Back-to-backs:** `home_is_back_to_back` / `away_is_back_to_back` mark the second night of a back-to-back: that team's previous game in the season was the day before, by Eastern game date. The `*_last_night_*` columns describe that game (opponent abbreviation, whether the team was at home, both scores) and are null unless the flag is set; the scores also stay null while it is not Final.

**National TV:** `national_tv` lists a game's national TV and streaming networks, comma-separated (`ESPN, ABC`), null for a local-only game or one ESPN has not listed. The source is ESPN's public scoreboard JSON, the only thing taken from ESPN: neither Basketball-Reference nor The Odds API carries a broadcaster. `scrape-broadcasts` (also a daily pipeline step) reads today plus 14 days, one request per day because the endpoint rejects date ranges, into `source.game_broadcasts`, matched to `source.games` by both teams and the Eastern date, the same way odds are.

## Surfaces

- `GET /api/v1/schedule`: the champion pregame WP, the consensus moneyline and spread, `national_tv`, injury counts, and each side's back-to-back flag with last night's opponent, venue and score (`*_is_back_to_back`, `*_last_night_*`). Shared SQL with `GET /api/v1/games/{id}`.
- `GET /api/v1/schedule/dates`: every date with a game still to play from `from_date` (default today), oldest first, unpaginated. `/games` asks from today for the calendar's dots and the empty day's "next games" link.
- MCP `get_games_schedule`, `get_game_odds`.

## Invariants

- **One back-to-back definition.** The schedule and game endpoints serve the columns as they are, and `GET /api/v1/teams/{id}/season-games` reads the flag from the team's side. It is not `fct_player_game_logs.is_back_to_back`, which is per player.
- The schedule reads gold only.
- Model and odds are labelled as estimates and market odds, never advice.
- Days are Eastern dates; an account's time zone moves only the displayed tip time.

## Gotchas

- The broadcasts endpoint is undocumented and unkeyed, so it can change shape without notice. The step is optional in the daily run: a failure is logged and recorded against the source, but the run still goes on to dbt. TV is blank for games beyond the 14-day window. Preseason events are stored but match nothing.
- Win % shows only for the coming week: the ml job deletes predictions beyond its horizon ([ml.md](../ml.md)).
- "Live" is a clock guess, not a feed.

## Out of scope

Live scores and game clocks, and betting features.
