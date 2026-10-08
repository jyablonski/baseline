-- Featuring is one highlight per game, capped per day. Either breaking means
-- the home page would repeat a game or overflow its row of cards.
with highlights as (
    select * from {{ ref('fct_daily_highlights') }}
    where is_featured
),

featured_days as (
    select
        highlights.game_date,
        count(*) as featured_highlights,
        count(distinct highlights.game_id) as featured_games
    from highlights
    group by highlights.game_date
)

select
    featured_days.game_date,
    featured_days.featured_highlights,
    featured_days.featured_games
from featured_days
where
    featured_days.featured_highlights > {{ var('highlight_featured_per_day') }}
    or featured_days.featured_highlights <> featured_days.featured_games
