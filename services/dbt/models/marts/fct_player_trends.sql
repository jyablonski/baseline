{% set window_games = var('trend_window_games') %}
{% set baseline_games = var('trend_baseline_games') %}
{% set min_baseline_games = var('trend_min_baseline_games') %}
{% set min_minutes = var('trend_min_minutes') %}
{% set noise_z = var('trend_noise_z') %}

{#- Output stat name -> per-game column. Every stat's window value is the
    per-game average, except TS%, which is computed from the window's totals. -#}
{% set game_stats = {
    'points': 'points',
    'rebounds': 'rebounds',
    'assists': 'assists',
    'steals': 'steals',
    'blocks': 'blocks',
    'three_pointers_made': 'three_pointers_made',
    'turnovers': 'turnovers',
    'minutes': 'minutes',
    'plus_minus': 'plus_minus',
    'game_score': 'mvp_box_score',
    'mvp_game_score': 'mvp_game_score',
    'true_shooting_pct': 'game_true_shooting_pct',
} %}

{#- Each window as a filter on games_ago (1 = the player's newest game). -#}
{% set windows = {
    'last_10': 'counted_games.games_ago <= ' ~ window_games,
    'baseline': 'counted_games.games_ago between ' ~ (window_games + 1) ~ ' and ' ~ (window_games + baseline_games),
    'season': 'true',
} %}

-- Each player's newest trend_window_games Regular Season games against the up to
-- trend_baseline_games before them ("baseline", "earlier games" in the product),
-- current season only: never reaching into a previous one (docs/decisions 0001,
-- 0008). The baseline excludes the window, because early in a season the window
-- is most of the season. The season average is carried for display only.
--
-- A change counts (`<stat>_changed`) only when it beats the player's normal
-- game-to-game swings: z = change / sqrt(var_window / n_window + var_baseline /
-- n_baseline) over the per-game values (Welch's statistic), at trend_noise_z.
-- The overall direction is that test on MVP game score.
--
-- mvp_game_score is averaged with no availability multiplier: that measures
-- missed games across a season and means nothing over ten games.
with player_game_logs as (
    select * from {{ ref('int_player_game_logs_enriched') }}
),

current_season as (
    select max(player_game_logs.season) as season
    from player_game_logs
    where player_game_logs.season_type = 'Regular Season'
),

-- A DNP is not a game, so the window is the player's own newest games played,
-- not their team's.
counted_games as (
    select
        player_game_logs.*,
        row_number() over (
            partition by player_game_logs.player_id
            order by player_game_logs.game_date desc, player_game_logs.game_id desc
        ) as games_ago,
        -- Per game, for the swing and the sparkline; null without a shot attempt.
        player_game_logs.points::numeric / nullif(
            2 * (player_game_logs.field_goals_attempted + 0.44 * player_game_logs.free_throws_attempted),
            0
        ) as game_true_shooting_pct
    from player_game_logs
    inner join current_season
        on player_game_logs.season = current_season.season
    where
        player_game_logs.season_type = 'Regular Season'
        and player_game_logs.minutes > 0
),

latest_teams as (
    select
        counted_games.player_id,
        counted_games.team_id
    from counted_games
    where counted_games.games_ago = 1
),

player_windows as (
    select
        counted_games.player_id,
        counted_games.season,
        count(*) as games_played,
        count(*) filter (where {{ windows['last_10'] }}) as window_games,
        count(*) filter (where {{ windows['baseline'] }}) as baseline_games,
        min(counted_games.game_date) filter (where {{ windows['last_10'] }}) as window_start_date,
        max(counted_games.game_date) filter (where {{ windows['last_10'] }}) as window_end_date,
        {%- for window, condition in windows.items() %}
            {%- for stat, column in game_stats.items() if stat != 'true_shooting_pct' %}
        avg(counted_games.{{ column }}) filter (where {{ condition }}) as {{ stat }}_{{ window }},
            {%- endfor %}
        -- PTS / (2 * (FGA + 0.44 * FTA)) over the window's totals; null without a shot attempt.
        sum(counted_games.points) filter (where {{ condition }})::numeric / nullif(
            2 * (
                sum(counted_games.field_goals_attempted) filter (where {{ condition }})
                + 0.44 * sum(counted_games.free_throws_attempted) filter (where {{ condition }})
            ),
            0
        ) as true_shooting_pct_{{ window }},
        {%- endfor %}
        {%- for stat, column in game_stats.items() %}
            {%- for window in ['last_10', 'baseline'] %}
        var_samp(counted_games.{{ column }}) filter (where {{ windows[window] }}) as {{ stat }}_var_{{ window }},
        count(counted_games.{{ column }}) filter (where {{ windows[window] }}) as {{ stat }}_n_{{ window }},
            {%- endfor %}
        array_agg(
            round(counted_games.{{ column }}::numeric, {{ 3 if stat == 'true_shooting_pct' else 1 }})
            order by counted_games.game_date, counted_games.game_id
        ) filter (where {{ windows['last_10'] }}) as {{ stat }}_games{{ ',' if not loop.last }}
        {%- endfor %}
    from counted_games
    group by
        counted_games.player_id,
        counted_games.season
),

-- z is null when either window has fewer than two values or neither varies:
-- no test, so no change.
scored as (
    select
        player_windows.*,
        coalesce(
            player_windows.window_games >= {{ window_games }}
            and player_windows.baseline_games >= {{ min_baseline_games }}
            and player_windows.minutes_last_10 >= {{ min_minutes }}
            and player_windows.minutes_baseline >= {{ min_minutes }},
            false
        ) as is_qualified,
        {%- for stat in game_stats.keys() %}
        case
            when player_windows.{{ stat }}_n_last_10 >= 2 and player_windows.{{ stat }}_n_baseline >= 2
                then (player_windows.{{ stat }}_last_10 - player_windows.{{ stat }}_baseline) / nullif(
                    sqrt(
                        player_windows.{{ stat }}_var_last_10 / player_windows.{{ stat }}_n_last_10
                        + player_windows.{{ stat }}_var_baseline / player_windows.{{ stat }}_n_baseline
                    ),
                    0
                )
        end as {{ stat }}_z{{ ',' if not loop.last }}
        {%- endfor %}
    from player_windows
)

select
    scored.player_id,
    scored.season,
    latest_teams.team_id,
    scored.games_played,
    scored.window_games,
    scored.baseline_games,
    scored.window_start_date,
    scored.window_end_date,
    {%- for stat in game_stats.keys() %}
        {%- set digits = 3 if stat == 'true_shooting_pct' else 1 %}
    round(scored.{{ stat }}_last_10::numeric, {{ digits }}) as {{ stat }}_last_10,
    round(scored.{{ stat }}_baseline::numeric, {{ digits }}) as {{ stat }}_baseline,
    round(scored.{{ stat }}_season::numeric, {{ digits }}) as {{ stat }}_season,
    round((scored.{{ stat }}_last_10 - scored.{{ stat }}_baseline)::numeric, {{ digits }}) as {{ stat }}_change,
    round(scored.{{ stat }}_z::numeric, 2) as {{ stat }}_z,
    coalesce(abs(scored.{{ stat }}_z) >= {{ noise_z }}, false) as {{ stat }}_changed,
    scored.{{ stat }}_games,
    {%- endfor %}
    scored.is_qualified,
    case
        when not scored.is_qualified then null
        when scored.mvp_game_score_z >= {{ noise_z }} then 'up'
        when scored.mvp_game_score_z <= -{{ noise_z }} then 'down'
        else 'steady'
    end as trend_direction,
    -- 1 = the biggest riser among qualified players.
    case
        when scored.is_qualified
            then rank() over (
                partition by scored.is_qualified
                order by scored.mvp_game_score_last_10 - scored.mvp_game_score_baseline desc
            )
    end as trend_rank
from scored
inner join latest_teams
    on scored.player_id = latest_teams.player_id
