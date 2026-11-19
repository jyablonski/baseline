-- The last scored play-by-play row of a Final game must carry its final score.
-- A mismatch is a truncated or misparsed play-by-play. Rows such as "End of
-- 4th quarter" have no score, so the check uses the last row that has one.
with play_by_play as (
    select * from {{ ref('fct_play_by_play') }}
    where score_home is not null and score_away is not null
),

results as (
    select * from {{ ref('fct_team_game_results') }}
),

ranked_scores as (
    select
        play_by_play.game_id,
        play_by_play.score_home,
        play_by_play.score_away,
        row_number() over (
            partition by play_by_play.game_id
            order by play_by_play.action_number desc
        ) as recency_rank
    from play_by_play
),

last_scores as (
    select * from ranked_scores
    where recency_rank = 1
)

select
    results.game_id,
    results.home_score,
    results.away_score,
    last_scores.score_home,
    last_scores.score_away
from results
inner join last_scores
    on results.game_id = last_scores.game_id
where
    last_scores.score_home <> results.home_score
    or last_scores.score_away <> results.away_score
