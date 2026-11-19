-- An injured player's team on the injury report must be his team on
-- dim_players. The two come from separate Basketball-Reference pages, so a
-- mismatch means one of them put him on the wrong roster.
with injuries as (
    select * from {{ ref('fct_player_injuries') }}
),

players as (
    select * from {{ ref('dim_players') }}
)

select
    injuries.player_id,
    injuries.player_name,
    injuries.team_id as injury_team_id,
    players.team_id as roster_team_id
from injuries
inner join players
    on injuries.player_id = players.player_id
where injuries.team_id is distinct from players.team_id
