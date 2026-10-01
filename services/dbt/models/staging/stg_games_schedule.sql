with source as (
    select * from {{ source('source', 'games') }}
)

select
    source.game_id,
    source.season,
    source.season_type,
    source.game_date,
    source.start_time_et,
    source.home_team_id,
    source.away_team_id,
    source.home_score,
    source.away_score,
    source.arena,
    source.city as arena_city,
    source.state as arena_state,
    source.status,
    source.scraped_at
from source
