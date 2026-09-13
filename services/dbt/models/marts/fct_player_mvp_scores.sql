{{
    config(
        indexes=[
            {'columns': ['player_id']},
            {'columns': ['season', 'season_type', 'mvp_rank']},
        ],
    )
}}

{% set grace = var('mvp_availability_grace_missed_pct') %}
{% set full_penalty = var('mvp_availability_full_penalty_missed_pct') %}
{% set max_penalty = var('mvp_availability_max_penalty') %}

-- Season-wide MVP scores. Only the Regular Season and Playoffs are scored:
-- play-in games and the Cup final sit outside the 82-game season.
--
-- mvp_score = average mvp_game_score * availability_multiplier. The win factor
-- is already inside each game score, so a player is credited for producing in
-- wins rather than for their team's record in games they missed.
with player_game_logs as (
    select * from {{ ref('int_player_game_logs_enriched') }}
    where
        season_type in ('Regular Season', 'Playoffs')
        and mvp_game_score is not null
),

games as (
    select * from {{ ref('stg_games') }}
    where season_type in ('Regular Season', 'Playoffs')
),

home_games as (
    select
        games.home_team_id as team_id,
        games.season,
        games.season_type
    from games
),

away_games as (
    select
        games.away_team_id as team_id,
        games.season,
        games.season_type
    from games
),

team_games as (
    select * from home_games
    union all
    select * from away_games
),

team_game_counts as (
    select
        team_games.team_id,
        team_games.season,
        team_games.season_type,
        count(*) as team_games
    from team_games
    group by team_games.team_id, team_games.season, team_games.season_type
),

-- Availability is measured against the schedule of the team a player finished
-- with, so a mid-season trade is judged on the new team's games played.
latest_teams as (
    select distinct on (player_game_logs.player_id, player_game_logs.season, player_game_logs.season_type)
        player_game_logs.player_id,
        player_game_logs.season,
        player_game_logs.season_type,
        player_game_logs.team_id
    from player_game_logs
    order by
        player_game_logs.player_id,
        player_game_logs.season,
        player_game_logs.season_type,
        player_game_logs.game_date desc
),

player_seasons as (
    select
        player_game_logs.player_id,
        player_game_logs.season,
        player_game_logs.season_type,
        count(*) as games_played,
        count(*) filter (where player_game_logs.result = 'W') as wins,
        count(*) filter (where player_game_logs.result = 'L') as losses,
        avg(player_game_logs.mvp_box_score) as avg_box_score,
        avg(player_game_logs.mvp_game_score) as avg_game_score
    from player_game_logs
    group by player_game_logs.player_id, player_game_logs.season, player_game_logs.season_type
),

availability as (
    select
        player_seasons.player_id,
        player_seasons.season,
        player_seasons.season_type,
        latest_teams.team_id,
        player_seasons.games_played,
        team_game_counts.team_games,
        player_seasons.wins,
        player_seasons.losses,
        player_seasons.avg_box_score,
        player_seasons.avg_game_score,
        -- A traded player can log more games than their final team has played.
        coalesce(
            greatest(1 - player_seasons.games_played::numeric / nullif(team_game_counts.team_games, 0), 0),
            0
        ) as games_missed_pct
    from player_seasons
    inner join latest_teams
        on player_seasons.player_id = latest_teams.player_id
        and player_seasons.season = latest_teams.season
        and player_seasons.season_type = latest_teams.season_type
    left join team_game_counts
        on latest_teams.team_id = team_game_counts.team_id
        and latest_teams.season = team_game_counts.season
        and latest_teams.season_type = team_game_counts.season_type
),

-- No penalty up to the grace share missed, then a quadratic ramp to the cap at
-- the full-penalty share, flat after that.
scored as (
    select
        availability.*,
        1 - {{ max_penalty }} * power(
            least(greatest((availability.games_missed_pct - {{ grace }}) / ({{ full_penalty }} - {{ grace }}), 0), 1),
            2
        ) as availability_multiplier
    from availability
)

select
    scored.player_id,
    scored.season,
    scored.season_type,
    scored.team_id,
    scored.games_played,
    scored.team_games,
    scored.wins,
    scored.losses,
    round(scored.wins::numeric / nullif(scored.wins + scored.losses, 0), 3) as win_pct,
    round(scored.games_missed_pct, 3) as games_missed_pct,
    round(scored.avg_box_score, 1) as avg_box_score,
    round(scored.avg_game_score, 1) as avg_game_score,
    round(scored.availability_multiplier, 3) as availability_multiplier,
    round(scored.avg_game_score * scored.availability_multiplier, 1) as mvp_score,
    rank() over (
        partition by scored.season, scored.season_type
        order by scored.avg_game_score * scored.availability_multiplier desc
    ) as mvp_rank
from scored
