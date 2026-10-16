with injuries as (
    select * from {{ ref('int_player_injuries_matched') }}
),

teams as (
    select * from {{ ref('stg_teams') }}
),

current_seasons as (
    select max(stg_games_schedule.season) as season
    from {{ ref('stg_games_schedule') }}
),

notability as (
    select * from {{ ref('int_player_notability') }}
),

-- Notable this season or last, so the flag holds before a new season has
-- enough games to rank anyone.
notable_players as (
    select distinct notability.player_id
    from notability
    cross join current_seasons
    where
        notability.is_notable
        and notability.season in (
            current_seasons.season, {{ previous_season('current_seasons.season') }}
        )
)

select
    injuries.player_id,
    injuries.team_id,
    teams.abbreviation as team_abbreviation,
    injuries.player_name,
    injuries.player_name_normalized,
    injuries.update_date,
    injuries.description,
    injuries.injury_status,
    injuries.injury_detail,
    injuries.source_url,
    injuries.scraped_at,
    injuries.match_method,
    notable_players.player_id is not null as is_notable
from injuries
left join teams
    on injuries.team_id = teams.team_id
left join notable_players
    on injuries.player_id = notable_players.player_id
