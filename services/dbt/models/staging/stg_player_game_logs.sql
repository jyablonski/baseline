with source as (
    select * from {{ source('source', 'player_game_logs') }}
)

select
    player_id,
    game_id,
    team_id,
    game_date,
    season,
    matchup,
    wl as result,
    min as minutes,
    pts as points,
    reb as rebounds,
    orb as offensive_rebounds,
    drb as defensive_rebounds,
    ast as assists,
    stl as steals,
    blk as blocks,
    tov as turnovers,
    fgm as field_goals_made,
    fga as field_goals_attempted,
    fg_pct as field_goal_pct,
    fg3m as three_pointers_made,
    fg3a as three_pointers_attempted,
    fg3_pct as three_point_pct,
    ftm as free_throws_made,
    fta as free_throws_attempted,
    ft_pct as free_throw_pct,
    pf as personal_fouls,
    plus_minus,
    case
        when matchup like '% vs. %' then 'home'
        when matchup like '% @ %' then 'away'
    end as location,
    case
        when matchup like '% vs. %' then split_part(matchup, ' vs. ', 2)
        when matchup like '% @ %' then split_part(matchup, ' @ ', 2)
    end as opponent_abbreviation
from source
