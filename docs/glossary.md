# Glossary

Terms that mean something specific here, and where they live in code. When the product, the code and the database use different words for one thing, this is the map. Read it before renaming a column or writing copy.

## Seasons and games

| Term                       | Means                                                                                                           | In code                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Season                     | The current NBA season, the only one supported ([0001](decisions/0001-single-season.md)). Labelled `2026-27`    | `season` everywhere; resolved as the newest season present    |
| Career, by season, history | **The loaded season**, not a player's whole career. Tool and page names keep these words for historical reasons | `career_games_played`, `career_ppg`, `get_career_stats`       |
| Season type                | `Regular Season`, `PlayIn`, `Cup` (the Cup final only; earlier Cup games are Regular Season) or `Playoffs`      | `season_type` in `stg_games` and every mart built on it       |
| Final                      | A finished game. Most marts and every grade read only these                                                     | `status = 'Final'`; `fct_team_game_results` holds Finals only |
| Scheduled                  | A game not yet Final, including one in progress                                                                 | `status = 'Scheduled'`                                        |
| Game date                  | The Eastern calendar date of the tip. The account time zone moves only the displayed tip time                   | `game_date`; `start_time_et`                                  |
| Back-to-back (B2B)         | The second night of two games on consecutive days, for one team or one player                                   | `is_back_to_back`, `*_is_back_to_back`                        |
| DNP                        | A game log with no minutes. Not a game played: it counts toward no average                                      | `minutes > 0` filters                                         |

## Player value

| Term           | Means                                                                                                          | In code                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Game Score     | Hollinger's Game Score from one box score, without the foul term                                               | `mvp_box_score`                                      |
| MVP game score | Game Score scaled up for a win, down for a loss                                                                | `mvp_game_score`                                     |
| MVP score      | A season number: average MVP game score × availability. The house metric, not the official award vote          | `fct_player_mvp_scores.mvp_score`, `mvp_rank`        |
| Availability   | The penalty for missed team games behind MVP score; meaningless over a few games                               | `availability_multiplier`, `mvp_availability_*` vars |
| TS%            | True shooting: PTS / (2 × (FGA + 0.44 × FTA)), always from summed totals, never an average of game percentages | `true_shooting_pct`                                  |

## Player trends

| Term          | Means                                                                                                                       | In code                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Last 10       | A player's own 10 newest Regular Season games with minutes, not their team's                                                | `*_last_10`, `trend_window_games`                                             |
| Earlier games | The up to 20 games before the player's last 10, this season only. **Not** a season average, and never last season           | `*_baseline` (the column name predates this glossary), `trend_baseline_games` |
| Qualified     | Enough games and minutes for a trend to be shown                                                                            | `is_qualified`, `trend_min_*` vars                                            |
| Changed       | A trend stat whose change beats the player's usual game-to-game swings (Welch's z ≥ 2). Only these get an arrow or a colour | `*_z`, `*_changed`, `trend_noise_z`                                           |

## Injuries

| Term         | Means                                                                                                                                      | In code                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Report       | Basketball-Reference's current injury list. Our history is one snapshot per scrape day, the morning report, not the official inactive list | `source.player_injuries`, `source.player_injuries_history` |
| Notable      | A team's top 2 or the league's top 30 by game score. Feeds Elo v2, so widening it changes a model                                          | `is_notable`, `injury_notable_*` vars                      |
| Key          | Wider than notable (league top 100). Only decides the `/games` Injuries column                                                             | `is_key`, `injury_key_league_rank`                         |
| Injury score | Everyone missing from one side rolled into one number; Elo v3's input                                                                      | `fct_game_injury_scores`                                   |

## Models and odds

| Term              | Means                                                                                                             | In code                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Live model        | The one model the product shows. Also called the champion; product copy never names it, it reads it from the data | `source.model_artifacts.is_champion`                     |
| Shadow model      | Every other model: scored and graded, never shown outside Admin                                                   | every other `model_version` in `source.game_predictions` |
| WP                | Win probability. A model's is the **home** team's; away is 1 − WP                                                 | `model_wp`, `market_wp`                                  |
| Market WP, no-vig | The sportsbooks' probability with the bookmaker's margin removed                                                  | `market_wp`, `*_fair_moneyline`                          |
| Consensus         | The average across bookmakers of a game's retained line, vig left in. Picks settle at it                          | `int_game_moneylines`                                    |
| Upset             | The winner was the market underdog                                                                                | `is_upset`, `fct_game_upsets`                            |
| Value pick        | A game where a model beats the line by the `value_*` rules. Report only, not in the product                       | `fct_game_value.is_value_pick`                           |

## Product

| Term      | Means                                                                                                                                  | In code                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Baseline  | The product name. Not the trends comparison window (see Earlier games)                                                                 | —                                        |
| Pick      | A visitor's winner for one game, with an optional stake. There is no balance ([0003](decisions/0003-no-pick-bankroll.md))              | `source.picks`                           |
| Follow    | A team a signed-in visitor follows, in their chosen order                                                                              | `follows` on `GET /account/me`           |
| Ask, Chat | Ask is the public rules-based question box. Chat is the signed-in LLM chat behind the `chatbot` flag. The header shows one, never both | `NLP_BACKEND`, `chatbot` flag            |
| Highlight | A day's notable event (season high, streak, blown lead…), shown as the lead line under a score                                         | `fct_daily_highlights`, `lead_highlight` |
