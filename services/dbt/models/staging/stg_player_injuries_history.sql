with source as (
    select * from {{ source('source', 'player_injuries_history') }}
)

select
    source.player_id,
    source.team_id,
    source.player_name,
    source.update_date,
    source.description,
    source.snapshot_date,
    source.scraped_at
from source
