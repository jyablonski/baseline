{{
    config(
        materialized='table',
        indexes=[{'columns': ['player_id', 'season']}],
    )
}}

-- Who counts as a notable absence, per season: one of their team's top
-- players, or near the top of the league. Ranked on average game score rather
-- than the MVP score, whose availability penalty would demote exactly the
-- injured stars this is for. Table rather than view: two window ranks, read by
-- both injury marts.
with player_game_logs as (
    select * from {{ ref('int_player_game_logs_enriched') }}
    where
        season_type = 'Regular Season'
        and mvp_game_score is not null
),

latest_teams as (
    select distinct on (player_game_logs.player_id, player_game_logs.season)
        player_game_logs.player_id,
        player_game_logs.season,
        player_game_logs.team_id
    from player_game_logs
    order by
        player_game_logs.player_id asc,
        player_game_logs.season asc,
        player_game_logs.game_date desc
),

player_seasons as (
    select
        player_game_logs.player_id,
        player_game_logs.season,
        count(*) as games_played,
        avg(player_game_logs.mvp_game_score) as avg_game_score
    from player_game_logs
    group by player_game_logs.player_id, player_game_logs.season
    having count(*) >= {{ var('injury_notable_min_games') }}
),

ranked as (
    select
        player_seasons.player_id,
        player_seasons.season,
        latest_teams.team_id,
        player_seasons.games_played,
        player_seasons.avg_game_score,
        rank() over (
            partition by player_seasons.season
            order by player_seasons.avg_game_score desc
        ) as league_rank,
        rank() over (
            partition by player_seasons.season, latest_teams.team_id
            order by player_seasons.avg_game_score desc
        ) as team_rank
    from player_seasons
    inner join latest_teams
        on
            player_seasons.player_id = latest_teams.player_id
            and player_seasons.season = latest_teams.season
)

select
    ranked.player_id,
    ranked.season,
    ranked.team_id,
    ranked.games_played,
    ranked.avg_game_score,
    ranked.league_rank,
    ranked.team_rank,
    (
        ranked.league_rank <= {{ var('injury_notable_league_rank') }}
        or ranked.team_rank <= {{ var('injury_notable_team_rank') }}
    ) as is_notable
from ranked
