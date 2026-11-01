with injuries as (
    select * from {{ ref('fct_game_injuries') }}
),

player_game_logs as (
    select * from {{ ref('fct_player_game_logs') }}
    where
        season_type = 'Regular Season'
        and mvp_box_score is not null
),

report_games as (
    select
        injuries.game_id,
        injuries.game_date,
        injuries.season,
        max(injuries.snapshot_date) as snapshot_date
    from injuries
    group by
        injuries.game_id,
        injuries.game_date,
        injuries.season
),

-- Strictly earlier games only, so a replayed game scores as it would have that
-- morning. mvp_box_score rather than mvp_game_score: the latter scales with
-- wins, which would charge a good team more for the same player.
listed_form as (
    select
        injuries.game_id,
        injuries.side,
        injuries.player_id,
        injuries.injury_status,
        avg(player_game_logs.mvp_box_score) as avg_production
    from injuries
    inner join player_game_logs
        on
            injuries.player_id = player_game_logs.player_id
            and injuries.season = player_game_logs.season
            and injuries.game_date > player_game_logs.game_date
    group by
        injuries.game_id,
        injuries.game_date,
        injuries.side,
        injuries.player_id,
        injuries.injury_status
    -- A longer absence is already in the team's results, so counting it would
    -- charge the team twice.
    having
        count(*) >= {{ var('injury_score_min_games') }}
        and max(player_game_logs.game_date)
        >= injuries.game_date - {{ var('injury_score_recent_days') }}
),

missing_players as (
    select
        listed_form.game_id,
        listed_form.side,
        listed_form.player_id,
        greatest(listed_form.avg_production, 0)
        * case
            when listed_form.injury_status in ('Out', 'Out For Season') then 1
            else {{ var('injury_score_day_to_day_weight') }}
        end as missing_production
    from listed_form
),

side_scores as (
    select
        missing_players.game_id,
        count(*) filter (where missing_players.side = 'home')::integer as home_players_counted,
        count(*) filter (where missing_players.side = 'away')::integer as away_players_counted,
        coalesce(
            sum(missing_players.missing_production) filter (where missing_players.side = 'home'),
            0
        ) as home_injury_score,
        coalesce(
            sum(missing_players.missing_production) filter (where missing_players.side = 'away'),
            0
        ) as away_injury_score
    from missing_players
    group by missing_players.game_id
)

select
    report_games.game_id,
    report_games.game_date,
    report_games.season,
    report_games.snapshot_date,
    coalesce(side_scores.home_players_counted, 0) as home_players_counted,
    coalesce(side_scores.away_players_counted, 0) as away_players_counted,
    coalesce(side_scores.home_injury_score, 0) as home_injury_score,
    coalesce(side_scores.away_injury_score, 0) as away_injury_score,
    coalesce(side_scores.home_injury_score, 0) - coalesce(side_scores.away_injury_score, 0)
        as injury_score_diff
from report_games
left join side_scores
    on report_games.game_id = side_scores.game_id
