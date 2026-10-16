with history as (
    select * from {{ ref('stg_player_injuries_history') }}
)

select
    history.player_id,
    history.team_id,
    history.player_name,
    history.update_date,
    history.description,
    {{ injury_status('history.description') }} as injury_status,
    {{ injury_detail('history.description') }} as injury_detail,
    history.snapshot_date
from history
