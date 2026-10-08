with source as (
    select * from {{ source('source', 'game_broadcasts') }}
)

select
    source.espn_event_id,
    source.commence_time,
    source.home_team_name,
    source.away_team_name,
    source.game_id,
    source.national_tv,
    source.scraped_at
from source
