---
summary: The lead line under each score — the day's notable events, scored and ranked from templates.
status: current
code:
  - services/dbt/models/marts/fct_daily_highlights.*
  - services/cube/model/cubes/daily_highlights.yml
  - services/api/src/queries/games.py
related:
  - docs/features/home.md
  - docs/features/results-and-notables.md
  - docs/features/upsets.md
---

# Daily highlights

## What users see

The headline under each score on the home page and on `/games` ("Stephen Curry: 32 pts, 4 reb, 8 ast"). Every game with logs has one, so a quiet night still shows something.

## How it works

`fct_daily_highlights` is one row per candidate highlight for every Final game, scored and ranked. Text is generated from a template per type, not by a model, so every card traces back to numbers in the row.

| Type                                           | Trigger                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `league_season_high`                           | Most of a stat (points, rebounds, assists, blocks, steals, threes) by anyone this season            |
| `season_high`                                  | A personal season high in one of those stats by a top-30 MVP-ladder player                          |
| `elite_game`                                   | Game score in the season's top 1%                                                                   |
| `big_scoring_night`                            | 40 or more points                                                                                   |
| `triple_double`                                | Double digits in three box-score stats                                                              |
| `scoring_duel`                                 | Both teams' top scorers at 30 or more                                                               |
| `win_streak` / `losing_streak`                 | A streak reaches 5 or more                                                                          |
| `win_streak_snapped` / `losing_streak_snapped` | A streak of 5 or more ends                                                                          |
| `blown_lead`                                   | A lead of 20 or more lost, or one in the season's top 5% that is at least 15                        |
| `lead_changes`                                 | 20 or more lead changes                                                                             |
| `overtime`                                     | Any overtime                                                                                        |
| `blowout`                                      | Won by 30 or more                                                                                   |
| `upset`                                        | The moneyline underdog won at 30% or less; empty until odds history exists ([upsets.md](upsets.md)) |
| `heavyweight_clash`                            | Both teams in the league's top 5 by record entering the game                                        |
| `top_performer`                                | The game's best line. Every game with logs has one, so a quiet night still shows something          |

- **Score** is `base_weight * (1 + magnitude) * (1 + importance)`. `magnitude` (0-1) is how far past its threshold the event went. `importance` (0-1) is the subject: MVP rank for a player, league rank entering the game for a team, and a flat 1 outside the Regular Season.
- **Ranking** is one highlight per game. `game_rank` orders a game's candidates, the lead one from each game competes for `day_rank`, and the top three are `is_featured`. A single wild game cannot take every slot, and no player or team shows up twice in a day.
- **Guards**: season highs need 10 prior games for the player, league highs 10 prior game dates, and team rank 10 games played. Without them the first week of a season is all "season highs".
- **As-of caveat**: season highs, streaks, and team rank are computed as of the game. MVP rank and the elite-game percentile use the season as it stands today, so an old day's scores can drift as the season goes on.
- `lead_changes` counts direct lead flips only (`fct_game_flow` treats a pass through a tie as a tie), so it runs lower than a box score's number. That is why the bar is 20, not 30.

## Surfaces

- `lead_highlight` on `GET /api/v1/games` (what the frontend reads) and `GET /api/v1/games/{id}`.
- `GET /api/v1/games/highlights`: each game's lead highlight for one day (default: the newest day with games). Not called by the frontend.
- Cube `daily_highlights`, MCP `get_daily_highlights`.

## Knobs

Every threshold and weight is a `highlight_*` var in `services/dbt/dbt_project.yml`.

## Invariants

- One highlight per game leads, and no player or team leads twice in a day.
- Text comes from templates over the row's numbers, never from an LLM.

## Gotchas

- Without the guards the first week of a season would be all "season highs".
- An old day's lead line can change as the season goes on (see the as-of caveat above).

## Out of scope

Model-written recaps, and highlights for games without box scores.
