-- Team box-score totals and league ranks for the current season's Regular
-- Season, in four splits: the whole season, the last 10 games, home, and away.
-- Ranks are within a split (a team's home Net rating ranks among home Net
-- ratings), 1 = best, so a lower-is-better stat (defensive rating, turnover %)
-- ranks ascending. Pace has no better direction; 1 is the fastest.
with player_game_logs as (
    select * from {{ ref('int_player_game_logs_enriched') }}
),

team_game_results as (
    select * from {{ ref('fct_team_game_results') }}
),

current_season as (
    select max(team_game_results.season) as season
    from team_game_results
    where team_game_results.season_type = 'Regular Season'
),

team_boxes as (
    select
        player_game_logs.game_id,
        player_game_logs.team_id,
        sum(player_game_logs.minutes) as minutes,
        sum(player_game_logs.points) as points,
        sum(player_game_logs.field_goals_made) as field_goals_made,
        sum(player_game_logs.field_goals_attempted) as field_goals_attempted,
        sum(player_game_logs.three_pointers_made) as three_pointers_made,
        sum(player_game_logs.three_pointers_attempted) as three_pointers_attempted,
        sum(player_game_logs.free_throws_attempted) as free_throws_attempted,
        sum(player_game_logs.offensive_rebounds) as offensive_rebounds,
        sum(player_game_logs.defensive_rebounds) as defensive_rebounds,
        sum(player_game_logs.assists) as assists,
        sum(player_game_logs.turnovers) as turnovers
    from player_game_logs
    inner join current_season
        on player_game_logs.season = current_season.season
    where player_game_logs.season_type = 'Regular Season'
    group by
        player_game_logs.game_id,
        player_game_logs.team_id
),

opponent_boxes as (
    select * from team_boxes
),

team_games as (
    select
        team_boxes.*,
        team_game_results.season,
        team_game_results.game_date,
        case
            when team_boxes.team_id = team_game_results.home_team_id then 'home'
            else 'away'
        end as location,
        team_boxes.team_id = team_game_results.winning_team_id as is_win,
        opponent_boxes.points as opponent_points,
        opponent_boxes.field_goals_made as opponent_field_goals_made,
        opponent_boxes.field_goals_attempted as opponent_field_goals_attempted,
        opponent_boxes.three_pointers_made as opponent_three_pointers_made,
        opponent_boxes.offensive_rebounds as opponent_offensive_rebounds,
        opponent_boxes.defensive_rebounds as opponent_defensive_rebounds,
        opponent_boxes.turnovers as opponent_turnovers,
        -- Possessions averaged over both sides (FGA - ORB + TOV + 0.44 * FTA), so
        -- a team's offensive and defensive ratings share one denominator. Null
        -- when either box lacks the rebound split, which drops the game from
        -- every possession-based stat rather than skewing it.
        0.5 * (
            team_boxes.field_goals_attempted - team_boxes.offensive_rebounds
            + team_boxes.turnovers + 0.44 * team_boxes.free_throws_attempted
            + opponent_boxes.field_goals_attempted - opponent_boxes.offensive_rebounds
            + opponent_boxes.turnovers + 0.44 * opponent_boxes.free_throws_attempted
        ) as possessions,
        row_number() over (
            partition by team_boxes.team_id
            order by team_game_results.game_date desc, team_boxes.game_id desc
        ) as games_ago
    from team_boxes
    inner join opponent_boxes
        on
            team_boxes.game_id = opponent_boxes.game_id
            and team_boxes.team_id <> opponent_boxes.team_id
    inner join team_game_results
        on team_boxes.game_id = team_game_results.game_id
),

split_games as (
    select
        'season' as split,
        team_games.*
    from team_games
    union all
    select
        'last_10' as split,
        team_games.*
    from team_games
    where team_games.games_ago <= 10
    union all
    select
        team_games.location as split,
        team_games.*
    from team_games
),

totals as (
    select
        split_games.team_id,
        split_games.season,
        split_games.split,
        count(*) as games,
        count(*) filter (where split_games.is_win) as wins,
        count(*) filter (where not split_games.is_win) as losses,
        count(split_games.possessions) as games_with_possessions,
        sum(split_games.possessions) as possessions,
        -- Team minutes / 5 is game length, so overtime counts toward pace.
        sum(split_games.minutes::numeric) filter (where split_games.possessions is not null) / 5.0
            as possession_minutes,
        sum(split_games.points) as points,
        sum(split_games.opponent_points) as opponent_points,
        sum(split_games.points) filter (where split_games.possessions is not null)
            as possession_points,
        sum(split_games.opponent_points) filter (where split_games.possessions is not null)
            as possession_opponent_points,
        sum(split_games.turnovers) filter (where split_games.possessions is not null)
            as possession_turnovers,
        sum(split_games.opponent_turnovers) filter (where split_games.possessions is not null)
            as possession_opponent_turnovers,
        sum(split_games.field_goals_made) as field_goals_made,
        sum(split_games.field_goals_attempted) as field_goals_attempted,
        sum(split_games.three_pointers_made) as three_pointers_made,
        sum(split_games.three_pointers_attempted) as three_pointers_attempted,
        sum(split_games.free_throws_attempted) as free_throws_attempted,
        sum(split_games.opponent_field_goals_made) as opponent_field_goals_made,
        sum(split_games.opponent_field_goals_attempted) as opponent_field_goals_attempted,
        sum(split_games.opponent_three_pointers_made) as opponent_three_pointers_made,
        sum(split_games.offensive_rebounds) filter (where split_games.possessions is not null)
            as offensive_rebounds,
        sum(split_games.defensive_rebounds) filter (where split_games.possessions is not null)
            as defensive_rebounds,
        sum(split_games.opponent_offensive_rebounds)
            filter (where split_games.possessions is not null) as opponent_offensive_rebounds,
        sum(split_games.opponent_defensive_rebounds)
            filter (where split_games.possessions is not null) as opponent_defensive_rebounds,
        sum(split_games.assists) as assists
    from split_games
    group by
        split_games.team_id,
        split_games.season,
        split_games.split
),

metrics as (
    select
        totals.team_id,
        totals.season,
        totals.split,
        totals.games,
        totals.wins,
        totals.losses,
        totals.games_with_possessions,
        round(100.0 * totals.possession_points / nullif(totals.possessions, 0), 1)
            as offensive_rating,
        round(100.0 * totals.possession_opponent_points / nullif(totals.possessions, 0), 1)
            as defensive_rating,
        round(
            100.0 * (totals.possession_points - totals.possession_opponent_points)
            / nullif(totals.possessions, 0),
            1
        ) as net_rating,
        round(48.0 * totals.possessions / nullif(totals.possession_minutes, 0), 1) as pace,
        round(totals.points::numeric / totals.games, 1) as points_per_game,
        round(totals.opponent_points::numeric / totals.games, 1) as opponent_points_per_game,
        round(
            (totals.field_goals_made + 0.5 * totals.three_pointers_made)
            / nullif(totals.field_goals_attempted, 0),
            3
        ) as effective_fg_pct,
        round(
            (totals.opponent_field_goals_made + 0.5 * totals.opponent_three_pointers_made)
            / nullif(totals.opponent_field_goals_attempted, 0),
            3
        ) as opponent_effective_fg_pct,
        round(totals.three_pointers_made::numeric / totals.games, 1)
            as three_pointers_made_per_game,
        round(
            totals.three_pointers_made::numeric / nullif(totals.three_pointers_attempted, 0), 3
        ) as three_point_pct,
        round(
            totals.three_pointers_attempted::numeric / nullif(totals.field_goals_attempted, 0), 3
        ) as three_point_attempt_rate,
        round(
            totals.free_throws_attempted::numeric / nullif(totals.field_goals_attempted, 0), 3
        ) as free_throw_rate,
        round(
            totals.offensive_rebounds::numeric
            / nullif(totals.offensive_rebounds + totals.opponent_defensive_rebounds, 0),
            3
        ) as offensive_rebound_pct,
        round(
            totals.defensive_rebounds::numeric
            / nullif(totals.defensive_rebounds + totals.opponent_offensive_rebounds, 0),
            3
        ) as defensive_rebound_pct,
        round(totals.possession_turnovers / nullif(totals.possessions, 0), 3) as turnover_pct,
        round(totals.possession_opponent_turnovers / nullif(totals.possessions, 0), 3)
            as opponent_turnover_pct,
        round(totals.assists::numeric / nullif(totals.field_goals_made, 0), 3) as assist_rate
    from totals
)

select
    metrics.*,
    count(*) over (partition by metrics.split) as team_count,
    {% for metric, direction in [
        ('offensive_rating', 'desc'),
        ('defensive_rating', 'asc'),
        ('net_rating', 'desc'),
        ('pace', 'desc'),
        ('points_per_game', 'desc'),
        ('opponent_points_per_game', 'asc'),
        ('effective_fg_pct', 'desc'),
        ('opponent_effective_fg_pct', 'asc'),
        ('three_pointers_made_per_game', 'desc'),
        ('three_point_pct', 'desc'),
        ('three_point_attempt_rate', 'desc'),
        ('free_throw_rate', 'desc'),
        ('offensive_rebound_pct', 'desc'),
        ('defensive_rebound_pct', 'desc'),
        ('turnover_pct', 'asc'),
        ('opponent_turnover_pct', 'desc'),
        ('assist_rate', 'desc'),
    ] %}
    -- A null stat gets a null rank, not last place.
    case
        when metrics.{{ metric }} is not null
            then rank() over (
                partition by metrics.split, metrics.{{ metric }} is null
                order by metrics.{{ metric }} {{ direction }}
            )
    end as {{ metric }}_rank{{ "," if not loop.last }}
    {% endfor %}
from metrics
