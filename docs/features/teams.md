---
summary: Standings, the offense-vs-defense plot, and each team's page with its tabs, roster and season calendar.
status: current
code:
  - services/frontend/src/app/teams/
  - services/frontend/src/components/teams/
  - services/frontend/src/components/charts/team-ratings-scatter.tsx
  - services/frontend/src/lib/team-page.ts
  - services/frontend/src/lib/team-form.ts
  - services/frontend/src/lib/calendar.ts
  - services/api/src/routers/teams.py
  - services/api/src/routers/standings.py
  - services/api/src/queries/teams.py
  - services/api/src/queries/standings.py
  - services/dbt/models/marts/fct_standings.*
  - services/dbt/models/intermediate/int_standings_records.*
  - services/dbt/models/intermediate/int_playoff_seeds.*
related:
  - docs/features/team-stats.md
  - docs/features/player-trends.md
  - docs/features/injuries.md
  - docs/features/transactions-and-contracts.md
  - docs/features/accounts-and-follows.md
---

# Teams and standings

## What users see

**`/teams`** (the home page's "Teams →" on Standings lands here):

- **Standings**, one table per conference ranked by seed (W-L, Win %, GB, Strk, L10, Net), with a rule under the 6th seed (playoffs) and the 10th (play-in). A followed team's rows are tinted. No division view, since seeding is by conference. Net is the only rating column so both conferences fit side by side without scrolling; offense and defense are on each team page.
- **"Offense vs defense"**: each team's logo by points scored and allowed per game (up and right are better), league-average lines, the four quadrants named ("Good on both ends" tinted), dashed Net −10 / +10 lines, a Highlight picker that rings one team and dims the rest, and a tooltip with the team's record and its league rank on offense, defense and net.
- Current season only, no previous-season fallback.

**`/teams/[id]`**:

- **Header:** logo, name, abbreviation · conference · arena, and a Follow / "Following ✓" button beside the name ("Sign in to follow" when signed out). On the right: the Regular Season record with conference rank, Play-in only for a team that played or is scheduled for it, Playoffs once there are playoff games or from April of the season's second year, the streak, and the next game linking to its page.
- **Tabs on `?tab=`** (no param is Overview), like `/admin`:
  - **Overview:** the rating tiles ([team-stats.md](team-stats.md)), the last five Regular Season results, "Who's trending" ([player-trends.md](player-trends.md)), and the injury report ([injuries.md](injuries.md)), with links to the full schedule and the roster.
  - **Stats:** [team-stats.md](team-stats.md).
  - **Roster** (badge: players ruled out): the current roster per game with this team (GP, MIN, PTS, REB, AST, STL, BLK, TOV, 3PM, TS%, +/-, Game Score, MVP score with its league rank) and injury status, most minutes first; TS%, +/-, GmSc and MVP explain themselves in a popover.
  - **Schedule:** the season calendar, a month grid of the whole season opening on the month of the next game (or the last one once the season is over), paged with "← Oct | Dec →". Played cells show W/L and the score, upcoming ones the local tip time and the team's model win %, B2B marks the second night of a back-to-back, and every game links to its game page. Days are Eastern dates; the account time zone only moves the tip time. It is the only games view, on phones too.
  - **Cap** and **Moves:** [transactions-and-contracts.md](transactions-and-contracts.md).

## How it works

Standings come from `fct_standings`: scraped values where they exist, otherwise derived in dbt from Regular Season Finals (`record_source` is `official` or `games`).

`fct_standings` derives what the source leaves out, in `int_standings_records`: `streak` and `last_10` from the team's own Regular Season Finals (Basketball-Reference's standings carry no form columns), `division_rank` (never scraped), `games_back` for a conference leader, which the source leaves empty, and the whole row (W–L, win %, `conference_rank`, games back) for any team-season with Finals but no scraped standings, marked `record_source = 'games'` with a null `as_of_date`. Derived ranks break ties with the NBA criteria the data can answer: head-to-head (or the record among the tied teams for three or more), division leader, division and conference win %, then point differential. Win % against playoff-eligible teams and the restart of a multi-team tie once some teams separate are not modeled; team name stands in for the random drawing. `int_playoff_seeds` reads the same ranks, so a season the scraper has not reached still gets its play-in bracket. The pages, Cube, and MCP all read those columns and none of them recomputes a record, so there is one definition. `fct_standings` is a season-to-date upsert. Joining it onto a past game does not give you the standings as of that night.

## Surfaces

- `GET /api/v1/standings`: rows carry the season `offensive_rating` / `defensive_rating` / `net_rating` from `fct_team_stat_splits`.
- `GET /api/v1/teams/{team_id}/roster`: players whose `dim_players.team_id` is the team, with per-game averages from their Regular Season games for it (TS%, +/-, Game Score included) plus each player's league-wide Regular Season `mvp_score` / `mvp_rank` from `fct_player_mvp_scores`, most minutes first.
- `GET /api/v1/teams/{team_id}/season-games`: every game of one team's season in any state, from that team's side (result, score, the champion's WP for that team, back-to-back flag read from `fct_games_schedule`), unpaginated. No `season` means the team's newest on the schedule.
- `GET /api/v1/teams/{team_id}/record`, `/teams/{team_id}/games`.
- Cube `standings`, `team_game_results`; MCP `get_standings`, `get_team_record`.

## Invariants

- **One standings definition.** The pages, Cube and MCP all read `fct_standings` columns; none of them recomputes a record.
- The roster's per-game numbers count only games **for this team**; its MVP score is league-wide, across every team the player played for this season.

## Gotchas

- `fct_standings` is a season-to-date upsert. Joining it onto a past game does not give the standings as of that night.
- A player traded in brings only the games played here; one yet to play (or with only DNPs) shows 0 games and every average null.

## Out of scope

A division view, a previous-season fallback, and a followed-team module on `/teams` ([0005](../decisions/0005-no-follow-modules-on-hubs.md)).
