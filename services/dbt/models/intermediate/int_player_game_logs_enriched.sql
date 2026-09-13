{{
    config(
        materialized='table',
        indexes=[{'columns': ['player_id']}, {'columns': ['game_id']}],
    )
}}

-- Materialized rather than a view: four partitioned window functions feeding
-- four marts (dim_players, fct_player_game_logs, fct_player_season_stats,
-- fct_player_mvp_scores), so a view re-sorted every game log once per mart.
with game_logs as (
    select * from {{ ref('stg_player_game_logs') }}
),

games as (
    select * from {{ ref('stg_games') }}
),

with_prev_game as (
    select
        game_logs.*,
        lag(game_logs.game_date) over (
            partition by game_logs.player_id, game_logs.season
            order by game_logs.game_date
        ) as prev_game_date,
        lag(game_logs.game_date) over (
            partition by game_logs.player_id
            order by game_logs.game_date
        ) as prev_game_date_career
    from game_logs
),

-- MVP box score: Hollinger's Game Score with the terms the logs can feed. The
-- logs carry total rebounds and no fouls, so rebounds take a single 0.4 weight
-- (his 0.7 ORB / 0.3 DRB blended at the league's ~1:3 split) and the foul term
-- is dropped. A log with no minutes is a DNP and scores null, not zero.
with_box_score as (
    select
        with_prev_game.*,
        games.season_type,
        case
            when coalesce(with_prev_game.minutes, 0) > 0
                then
                    coalesce(with_prev_game.points, 0)
                    + 0.4 * coalesce(with_prev_game.field_goals_made, 0)
                    - 0.7 * coalesce(with_prev_game.field_goals_attempted, 0)
                    - 0.4 * (
                        coalesce(with_prev_game.free_throws_attempted, 0)
                        - coalesce(with_prev_game.free_throws_made, 0)
                    )
                    + 0.4 * coalesce(with_prev_game.rebounds, 0)
                    + coalesce(with_prev_game.steals, 0)
                    + 0.7 * coalesce(with_prev_game.assists, 0)
                    + 0.7 * coalesce(with_prev_game.blocks, 0)
                    - coalesce(with_prev_game.turnovers, 0)
        end as mvp_box_score
    from with_prev_game
    left join games
        on with_prev_game.game_id = games.game_id
)

select
    with_box_score.*,
    coalesce(with_box_score.game_date - with_box_score.prev_game_date_career = 1, false) as is_back_to_back,
    -- A win scales the box score up by mvp_win_weight and a loss scales it down.
    -- abs() keeps a win ahead of a loss when the box score itself is negative.
    with_box_score.mvp_box_score
    + case with_box_score.result
        when 'W' then 1
        when 'L' then -1
        else 0
    end * {{ var('mvp_win_weight') }} * abs(with_box_score.mvp_box_score) as mvp_game_score,
    row_number() over (
        partition by with_box_score.player_id, with_box_score.season
        order by with_box_score.game_date
    ) as season_game_number,
    row_number() over (
        partition by with_box_score.player_id
        order by with_box_score.game_date
    ) as career_game_number
from with_box_score
