-- A team's active players must fit an NBA roster: 15 standard and 3 two-way
-- contracts, with room for hardship signings. More means players who left
-- (waived, traded) still count as active on this team, so its roster page
-- lists them. There is no floor: nothing ever marks a player inactive, so a
-- failed roster scrape leaves the old players in place rather than fewer.
with players as (
    select * from {{ ref('dim_players') }}
    where is_active
),

teams as (
    select * from {{ ref('dim_teams') }}
),

active_counts as (
    select
        teams.team_id,
        teams.abbreviation,
        count(players.player_id) as active_players
    from teams
    left join players
        on teams.team_id = players.team_id
    group by teams.team_id, teams.abbreviation
)

select
    active_counts.team_id,
    active_counts.abbreviation,
    active_counts.active_players
from active_counts
where active_counts.active_players > 21
