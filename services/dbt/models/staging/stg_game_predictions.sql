with source as (
    select * from {{ source('source', 'game_predictions') }}
)

select
    source.game_id,
    source.as_of,
    source.model_name,
    source.model_version,
    source.home_team_id,
    source.away_team_id,
    source.model_wp,
    source.market_wp,
    source.breakdown,
    source.scraped_at
from source
