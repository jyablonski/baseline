-- A trend label and rank exist exactly for qualified players.
with player_trends as (
    select * from {{ ref('fct_player_trends') }}
)

select
    player_trends.player_id,
    player_trends.is_qualified,
    player_trends.trend_direction,
    player_trends.trend_rank
from player_trends
where
    player_trends.is_qualified <> (player_trends.trend_direction is not null)
    or player_trends.is_qualified <> (player_trends.trend_rank is not null)
