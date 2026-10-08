{{
    config(
        indexes=[{'columns': ['game_date']}, {'columns': ['game_id']}],
    )
}}

{% set weights = var('highlight_weights') %}
{% set mvp_cutoff = var('highlight_mvp_rank_cutoff') %}
{% set min_team_games = var('highlight_min_team_games') %}
{% set streak_length = var('highlight_streak_length') %}
{% set duel_points = var('highlight_scoring_duel_points') %}
{% set big_points = var('highlight_big_scoring_points') %}
{% set heavyweight_rank = var('highlight_heavyweight_rank') %}

-- floor: the least that is worth a card. ceiling: where magnitude tops out.
{% set player_stats = [
    {'column': 'points', 'label': 'points', 'floor': 25, 'ceiling': 50},
    {'column': 'rebounds', 'label': 'rebounds', 'floor': 12, 'ceiling': 22},
    {'column': 'assists', 'label': 'assists', 'floor': 10, 'ceiling': 18},
    {'column': 'blocks', 'label': 'blocks', 'floor': 4, 'ceiling': 8},
    {'column': 'steals', 'label': 'steals', 'floor': 4, 'ceiling': 7},
    {'column': 'three_pointers_made', 'label': 'threes', 'floor': 5, 'ceiling': 10},
] %}

-- Candidate highlights for every Final game, scored and ranked. Each candidate
-- CTE below is one highlight type and emits the same columns; the tail scores
-- them (weight * (1 + magnitude) * (1 + importance)), ranks them within their
-- game, and features the best highlight of the day's top games.
--
-- "Season high" and streaks are as of the game. MVP rank and percentiles use
-- the season as it stands now, so an old day's importance can drift.
with games as (
    select * from {{ ref('fct_team_game_results') }}
),

game_flow as (
    select * from {{ ref('fct_game_flow') }}
),

upsets as (
    select * from {{ ref('fct_game_upsets') }}
),

logs as (
    select * from {{ ref('int_player_game_logs_enriched') }}
),

players as (
    select * from {{ ref('stg_players') }}
),

teams as (
    select * from {{ ref('stg_teams') }}
),

home_teams as (
    select * from {{ ref('stg_teams') }}
),

away_teams as (
    select * from {{ ref('stg_teams') }}
),

mvp_ranks as (
    select
        player_id,
        season,
        mvp_rank
    from {{ ref('fct_player_mvp_scores') }}
    where season_type = 'Regular Season'
),

home_team_games as (
    select
        games.game_id,
        games.season,
        games.game_date,
        games.home_team_id as team_id,
        games.away_team_id as opponent_team_id,
        games.winning_team_id = games.home_team_id as is_win
    from games
    where games.season_type = 'Regular Season'
),

away_team_games as (
    select
        games.game_id,
        games.season,
        games.game_date,
        games.away_team_id as team_id,
        games.home_team_id as opponent_team_id,
        games.winning_team_id = games.away_team_id as is_win
    from games
    where games.season_type = 'Regular Season'
),

team_games as (
    select * from home_team_games
    union all
    select * from away_team_games
),

prior_team_games as (
    select * from team_games
),

game_dates as (
    select distinct
        season,
        game_date
    from team_games
),

season_teams as (
    select distinct
        season,
        team_id
    from team_games
),

-- Every team's record entering each game date, so two teams can be ranked
-- against the whole league as it stood that morning.
records_entering as (
    select
        game_dates.season,
        game_dates.game_date,
        season_teams.team_id,
        count(prior_team_games.game_id) filter (where prior_team_games.is_win) as wins,
        count(prior_team_games.game_id) as games_played
    from game_dates
    inner join season_teams
        on game_dates.season = season_teams.season
    left join prior_team_games
        on
            season_teams.team_id = prior_team_games.team_id
            and season_teams.season = prior_team_games.season
            and game_dates.game_date > prior_team_games.game_date
    group by game_dates.season, game_dates.game_date, season_teams.team_id
),

team_ranks as (
    select
        records_entering.season,
        records_entering.game_date,
        records_entering.team_id,
        records_entering.games_played,
        rank() over (
            partition by records_entering.season, records_entering.game_date
            order by
                records_entering.wins::numeric / nullif(records_entering.games_played, 0) desc nulls last,
                records_entering.wins desc
        ) as league_rank
    from records_entering
),

home_ranks as (
    select * from team_ranks
),

away_ranks as (
    select * from team_ranks
),

-- One row per Final game with both sides resolved to winner and loser. A game
-- outside the Regular Season always matters; otherwise a team's importance is
-- its league rank, once it has played enough for the rank to mean something.
game_context as (
    select
        games.game_id,
        games.season,
        games.season_type,
        games.game_date,
        games.home_team_id,
        games.away_team_id,
        games.home_team_abbreviation,
        games.away_team_abbreviation,
        games.home_score,
        games.away_score,
        games.score_margin,
        games.winning_team_id,
        games.winning_team_id = games.home_team_id as home_won,
        home_teams.nickname as home_nickname,
        away_teams.nickname as away_nickname,
        home_ranks.league_rank as home_rank,
        away_ranks.league_rank as away_rank,
        coalesce(home_ranks.games_played, 0) >= {{ min_team_games }}
        and coalesce(away_ranks.games_played, 0) >= {{ min_team_games }} as is_ranked,
        case
            when games.season_type <> 'Regular Season' then 1
            when coalesce(home_ranks.games_played, 0) >= {{ min_team_games }}
                then greatest(31 - home_ranks.league_rank, 0) / 30.0
            else 0
        end as home_importance,
        case
            when games.season_type <> 'Regular Season' then 1
            when coalesce(away_ranks.games_played, 0) >= {{ min_team_games }}
                then greatest(31 - away_ranks.league_rank, 0) / 30.0
            else 0
        end as away_importance,
        case
            when games.winning_team_id = games.home_team_id
                then
                    games.home_team_abbreviation || ' ' || games.home_score
                    || ', ' || games.away_team_abbreviation || ' ' || games.away_score
            else
                games.away_team_abbreviation || ' ' || games.away_score
                || ', ' || games.home_team_abbreviation || ' ' || games.home_score
        end as score_line
    from games
    inner join home_teams
        on games.home_team_id = home_teams.team_id
    inner join away_teams
        on games.away_team_id = away_teams.team_id
    left join home_ranks
        on
            games.home_team_id = home_ranks.team_id
            and games.season = home_ranks.season
            and games.game_date = home_ranks.game_date
    left join away_ranks
        on
            games.away_team_id = away_ranks.team_id
            and games.season = away_ranks.season
            and games.game_date = away_ranks.game_date
    where games.winning_team_id is not null
),

sided_games as (
    select
        game_context.*,
        (game_context.home_importance + game_context.away_importance) / 2 as game_importance,
        case when game_context.home_won then game_context.home_nickname else game_context.away_nickname end
            as winner_nickname,
        case when game_context.home_won then game_context.away_nickname else game_context.home_nickname end
            as loser_nickname,
        case when game_context.home_won then game_context.away_team_id else game_context.home_team_id end
            as loser_team_id,
        case when game_context.home_won then game_context.home_rank else game_context.away_rank end
            as winner_rank,
        case when game_context.home_won then game_context.away_rank else game_context.home_rank end
            as loser_rank
    from game_context
),

-- Played logs only: a DNP row has no stat line to feature.
player_lines as (
    select
        logs.player_id,
        logs.game_id,
        logs.team_id,
        logs.season,
        logs.game_date,
        logs.mvp_game_score,
        players.full_name as player_name,
        sided_games.score_line,
        sided_games.game_importance,
        coalesce(logs.points, 0)::integer as points,
        coalesce(logs.rebounds, 0)::integer as rebounds,
        coalesce(logs.assists, 0)::integer as assists,
        coalesce(logs.steals, 0)::integer as steals,
        coalesce(logs.blocks, 0)::integer as blocks,
        coalesce(logs.three_pointers_made, 0)::integer as three_pointers_made,
        coalesce(greatest({{ mvp_cutoff }} + 1 - mvp_ranks.mvp_rank, 0)::numeric / {{ mvp_cutoff }}, 0)
            as player_importance,
        coalesce(mvp_ranks.mvp_rank <= {{ mvp_cutoff }}, false) as is_mvp_candidate,
        count(*) over (
            partition by logs.player_id, logs.season
            order by logs.game_date
            rows between unbounded preceding and 1 preceding
        ) as prior_games,
        percent_rank() over (
            partition by logs.season
            order by logs.mvp_game_score
        ) as game_score_percentile,
        row_number() over (
            partition by logs.game_id
            order by logs.mvp_game_score desc, logs.player_id asc
        ) as game_score_rank,
        row_number() over (
            partition by logs.game_id, logs.team_id
            order by logs.points desc nulls last, logs.player_id asc
        ) as team_points_rank
    from logs
    inner join sided_games
        on logs.game_id = sided_games.game_id
    inner join players
        on logs.player_id = players.player_id
    left join mvp_ranks
        on
            logs.player_id = mvp_ranks.player_id
            and logs.season = mvp_ranks.season
    where coalesce(logs.minutes, 0) > 0
),

stat_lines as (
    select
        player_lines.*,
        {% for stat in player_stats %}
            max(player_lines.{{ stat.column }}) over (
                partition by player_lines.player_id, player_lines.season
                order by player_lines.game_date
                rows between unbounded preceding and 1 preceding
            ) as prior_{{ stat.column }},
        {% endfor %}
        player_lines.points || ' pts, ' || player_lines.rebounds || ' reb, ' || player_lines.assists || ' ast'
            as stat_line,
        (player_lines.points >= 10)::integer
        + (player_lines.rebounds >= 10)::integer
        + (player_lines.assists >= 10)::integer
        + (player_lines.steals >= 10)::integer
        + (player_lines.blocks >= 10)::integer as double_digit_stats
    from player_lines
),

league_daily_highs as (
    select
        {% for stat in player_stats %}
            max(stat_lines.{{ stat.column }}) as {{ stat.column }},
        {% endfor %}
        stat_lines.season,
        stat_lines.game_date
    from stat_lines
    group by stat_lines.season, stat_lines.game_date
),

league_prior_highs as (
    select
        league_daily_highs.season,
        league_daily_highs.game_date,
        {% for stat in player_stats %}
            max(league_daily_highs.{{ stat.column }}) over (
                partition by league_daily_highs.season
                order by league_daily_highs.game_date
                rows between unbounded preceding and 1 preceding
            ) as prior_{{ stat.column }},
        {% endfor %}
        count(*) over (
            partition by league_daily_highs.season
            order by league_daily_highs.game_date
            rows between unbounded preceding and 1 preceding
        ) as prior_dates
    from league_daily_highs
),

-- One row per player x game x stat that beat the player's own best of the
-- season, flagged when it also beat everyone else's.
stat_highs as (
    {% for stat in player_stats %}
        select
            stat_lines.game_id,
            stat_lines.player_id,
            stat_lines.team_id,
            stat_lines.player_name,
            stat_lines.stat_line,
            stat_lines.score_line,
            stat_lines.player_importance,
            stat_lines.game_importance,
            '{{ stat.label }}' as stat_name,
            stat_lines.{{ stat.column }} as stat_value,
            stat_lines.prior_{{ stat.column }} as prior_value,
            league_prior_highs.prior_{{ stat.column }} as league_prior_value,
            least(
                (stat_lines.{{ stat.column }} - {{ stat.floor }})::numeric / ({{ stat.ceiling }} - {{ stat.floor }}),
                1
            ) as magnitude,
            league_prior_highs.prior_dates >= {{ var('highlight_min_league_dates') }}
            and stat_lines.{{ stat.column }} > league_prior_highs.prior_{{ stat.column }} as is_league_high,
            stat_lines.is_mvp_candidate
            and stat_lines.prior_games >= {{ var('highlight_min_player_games') }}
            and stat_lines.{{ stat.column }} > stat_lines.prior_{{ stat.column }} as is_season_high
        from stat_lines
        inner join league_prior_highs
            on
                stat_lines.season = league_prior_highs.season
                and stat_lines.game_date = league_prior_highs.game_date
        where stat_lines.{{ stat.column }} >= {{ stat.floor }}
        {{ "union all" if not loop.last }}
    {% endfor %}
),

league_season_highs as (
    select
        stat_highs.game_id,
        'league_season_high' as highlight_type,
        'player' as subject_type,
        stat_highs.player_id,
        stat_highs.team_id,
        stat_highs.stat_name,
        stat_highs.stat_value::numeric as stat_value,
        stat_highs.magnitude,
        greatest(stat_highs.player_importance, stat_highs.game_importance) as importance,
        'Most ' || stat_highs.stat_name || ' in a game this season: '
        || stat_highs.player_name || ', ' || stat_highs.stat_value as headline,
        stat_highs.stat_line || '. ' || stat_highs.score_line
        || '. Previous league high: ' || stat_highs.league_prior_value || '.' as detail
    from stat_highs
    where stat_highs.is_league_high
),

season_highs as (
    select
        stat_highs.game_id,
        'season_high' as highlight_type,
        'player' as subject_type,
        stat_highs.player_id,
        stat_highs.team_id,
        stat_highs.stat_name,
        stat_highs.stat_value::numeric as stat_value,
        stat_highs.magnitude,
        stat_highs.player_importance as importance,
        stat_highs.player_name || ': season-high ' || stat_highs.stat_value || ' ' || stat_highs.stat_name
            as headline,
        stat_highs.stat_line || '. ' || stat_highs.score_line
        || '. Previous high: ' || stat_highs.prior_value || '.' as detail
    from stat_highs
    where
        stat_highs.is_season_high
        and not stat_highs.is_league_high
),

elite_games as (
    select
        stat_lines.game_id,
        'elite_game' as highlight_type,
        'player' as subject_type,
        stat_lines.player_id,
        stat_lines.team_id,
        'game score' as stat_name,
        round(stat_lines.mvp_game_score, 1) as stat_value,
        least(
            (stat_lines.game_score_percentile - {{ var('highlight_elite_percentile') }})
            / (1 - {{ var('highlight_elite_percentile') }}),
            1
        )::numeric as magnitude,
        greatest(stat_lines.player_importance, stat_lines.game_importance) as importance,
        stat_lines.player_name || ': ' || stat_lines.stat_line as headline,
        'Game score ' || round(stat_lines.mvp_game_score, 1)
        || ', one of the best individual games this season. ' || stat_lines.score_line || '.' as detail
    from stat_lines
    where
        stat_lines.game_score_percentile >= {{ var('highlight_elite_percentile') }}
        and stat_lines.prior_games >= {{ var('highlight_min_player_games') }}
),

big_scoring_nights as (
    select
        stat_lines.game_id,
        'big_scoring_night' as highlight_type,
        'player' as subject_type,
        stat_lines.player_id,
        stat_lines.team_id,
        'points' as stat_name,
        stat_lines.points::numeric as stat_value,
        least((stat_lines.points - {{ big_points }}) / 20.0, 1) as magnitude,
        greatest(stat_lines.player_importance, stat_lines.game_importance) as importance,
        stat_lines.player_name || ' scores ' || stat_lines.points as headline,
        stat_lines.stat_line || '. ' || stat_lines.score_line || '.' as detail
    from stat_lines
    where stat_lines.points >= {{ big_points }}
),

triple_doubles as (
    select
        stat_lines.game_id,
        'triple_double' as highlight_type,
        'player' as subject_type,
        stat_lines.player_id,
        stat_lines.team_id,
        'points + rebounds + assists' as stat_name,
        (stat_lines.points + stat_lines.rebounds + stat_lines.assists)::numeric as stat_value,
        least(greatest((stat_lines.points + stat_lines.rebounds + stat_lines.assists - 40) / 30.0, 0), 1)
            as magnitude,
        greatest(stat_lines.player_importance, stat_lines.game_importance) as importance,
        stat_lines.player_name || ' triple-double: ' || stat_lines.stat_line as headline,
        stat_lines.score_line || '.' as detail
    from stat_lines
    where stat_lines.double_digit_stats >= 3
),

top_performers as (
    select
        stat_lines.game_id,
        'top_performer' as highlight_type,
        'player' as subject_type,
        stat_lines.player_id,
        stat_lines.team_id,
        'game score' as stat_name,
        round(stat_lines.mvp_game_score, 1) as stat_value,
        least(greatest(stat_lines.mvp_game_score / 40, 0), 1)::numeric as magnitude,
        greatest(stat_lines.player_importance, stat_lines.game_importance) as importance,
        stat_lines.player_name || ': ' || stat_lines.stat_line as headline,
        stat_lines.score_line || '.' as detail
    from stat_lines
    where stat_lines.game_score_rank = 1
),

home_top_scorers as (
    select stat_lines.*
    from stat_lines
    inner join sided_games
        on
            stat_lines.game_id = sided_games.game_id
            and stat_lines.team_id = sided_games.home_team_id
    where stat_lines.team_points_rank = 1
),

away_top_scorers as (
    select stat_lines.*
    from stat_lines
    inner join sided_games
        on
            stat_lines.game_id = sided_games.game_id
            and stat_lines.team_id = sided_games.away_team_id
    where stat_lines.team_points_rank = 1
),

scoring_duels as (
    select
        sided_games.game_id,
        'scoring_duel' as highlight_type,
        'game' as subject_type,
        null::uuid as player_id,
        null::uuid as team_id,
        'combined points' as stat_name,
        (home_top_scorers.points + away_top_scorers.points)::numeric as stat_value,
        least(
            (home_top_scorers.points + away_top_scorers.points - 2 * {{ duel_points }}) / 30.0, 1
        ) as magnitude,
        greatest(
            home_top_scorers.player_importance,
            away_top_scorers.player_importance,
            sided_games.game_importance
        ) as importance,
        case
            when sided_games.home_won
                then
                    home_top_scorers.player_name || ' ' || home_top_scorers.points
                    || ', ' || away_top_scorers.player_name || ' ' || away_top_scorers.points
            else
                away_top_scorers.player_name || ' ' || away_top_scorers.points
                || ', ' || home_top_scorers.player_name || ' ' || home_top_scorers.points
        end as headline,
        'Opposing {{ duel_points }}-point games. ' || sided_games.score_line || '.' as detail
    from sided_games
    inner join home_top_scorers
        on sided_games.game_id = home_top_scorers.game_id
    inner join away_top_scorers
        on sided_games.game_id = away_top_scorers.game_id
    where
        home_top_scorers.points >= {{ duel_points }}
        and away_top_scorers.points >= {{ duel_points }}
),

-- Gaps and islands: a new streak starts wherever the result flips.
streak_starts as (
    select
        team_games.*,
        coalesce(
            team_games.is_win <> lag(team_games.is_win) over (
                partition by team_games.team_id, team_games.season
                order by team_games.game_date, team_games.game_id
            ),
            true
        ) as starts_streak
    from team_games
),

streak_groups as (
    select
        streak_starts.*,
        sum(streak_starts.starts_streak::integer) over (
            partition by streak_starts.team_id, streak_starts.season
            order by streak_starts.game_date, streak_starts.game_id
        ) as streak_group
    from streak_starts
),

streak_lengths as (
    select
        streak_groups.*,
        row_number() over (
            partition by streak_groups.team_id, streak_groups.season, streak_groups.streak_group
            order by streak_groups.game_date, streak_groups.game_id
        ) as streak_length
    from streak_groups
),

streaks as (
    select
        streak_lengths.*,
        lag(streak_lengths.streak_length) over (
            partition by streak_lengths.team_id, streak_lengths.season
            order by streak_lengths.game_date, streak_lengths.game_id
        ) as prior_streak_length
    from streak_lengths
),

-- The streak this game extended (streak_length > 1) or ended (streak_length
-- = 1, with the ended run in prior_streak_length), from the team's side.
team_streaks as (
    select
        streaks.game_id,
        streaks.team_id,
        streaks.is_win,
        streaks.streak_length,
        streaks.prior_streak_length,
        teams.nickname,
        sided_games.score_line,
        case
            when streaks.team_id = sided_games.home_team_id then sided_games.away_nickname
            else sided_games.home_nickname
        end as opponent_nickname,
        case
            when streaks.team_id = sided_games.home_team_id then sided_games.home_importance
            else sided_games.away_importance
        end as team_importance
    from streaks
    inner join sided_games
        on streaks.game_id = sided_games.game_id
    inner join teams
        on streaks.team_id = teams.team_id
),

streak_highlights as (
    select
        team_streaks.game_id,
        case
            when team_streaks.is_win and team_streaks.streak_length >= {{ streak_length }} then 'win_streak'
            when team_streaks.is_win then 'losing_streak_snapped'
            when team_streaks.streak_length >= {{ streak_length }} then 'losing_streak'
            else 'win_streak_snapped'
        end as highlight_type,
        'team' as subject_type,
        null::uuid as player_id,
        team_streaks.team_id,
        'games' as stat_name,
        case
            when team_streaks.streak_length >= {{ streak_length }} then team_streaks.streak_length
            else team_streaks.prior_streak_length
        end::numeric as stat_value,
        least(
            (
                case
                    when team_streaks.streak_length >= {{ streak_length }} then team_streaks.streak_length
                    else team_streaks.prior_streak_length
                end - {{ streak_length }}
            ) / 10.0,
            1
        ) as magnitude,
        team_streaks.team_importance as importance,
        case
            when team_streaks.is_win and team_streaks.streak_length >= {{ streak_length }}
                then team_streaks.nickname || ' win ' || {{ ordinal("team_streaks.streak_length") }} || ' straight'
            when team_streaks.is_win
                then
                    team_streaks.nickname || ' end ' || team_streaks.prior_streak_length
                    || '-game losing streak'
            when team_streaks.streak_length >= {{ streak_length }}
                then team_streaks.nickname || ' drop ' || {{ ordinal("team_streaks.streak_length") }} || ' straight'
            else
                team_streaks.opponent_nickname || ' snap ' || team_streaks.nickname
                || case when team_streaks.nickname like '%s' then '''' else '''s' end
                || ' ' || team_streaks.prior_streak_length || '-game win streak'
        end as headline,
        team_streaks.score_line || '.' as detail
    from team_streaks
    where
        team_streaks.streak_length >= {{ streak_length }}
        or (team_streaks.streak_length = 1 and team_streaks.prior_streak_length >= {{ streak_length }})
),

flow_percentiles as (
    select
        game_flow.game_id,
        game_flow.largest_lead_blown,
        game_flow.blown_lead_period,
        game_flow.lead_changes,
        game_flow.overtime_periods,
        percent_rank() over (
            partition by game_flow.season
            order by game_flow.largest_lead_blown
        ) as blown_lead_percentile
    from game_flow
),

blown_leads as (
    select
        sided_games.game_id,
        'blown_lead' as highlight_type,
        'team' as subject_type,
        null::uuid as player_id,
        sided_games.loser_team_id as team_id,
        'points' as stat_name,
        flow_percentiles.largest_lead_blown::numeric as stat_value,
        least(
            greatest((flow_percentiles.largest_lead_blown - {{ var('highlight_blown_lead') }}) / 15.0, 0), 1
        ) as magnitude,
        sided_games.game_importance as importance,
        sided_games.loser_nickname || ' blow a ' || flow_percentiles.largest_lead_blown || '-point lead'
            as headline,
        sided_games.winner_nickname || ' came back to win. ' || sided_games.score_line || '.' as detail
    from sided_games
    inner join flow_percentiles
        on sided_games.game_id = flow_percentiles.game_id
    where
        flow_percentiles.largest_lead_blown >= {{ var('highlight_blown_lead') }}
        or (
            flow_percentiles.largest_lead_blown >= {{ var('highlight_blown_lead_floor') }}
            and flow_percentiles.blown_lead_percentile >= {{ var('highlight_blown_lead_percentile') }}
        )
),

lead_change_games as (
    select
        sided_games.game_id,
        'lead_changes' as highlight_type,
        'game' as subject_type,
        null::uuid as player_id,
        null::uuid as team_id,
        'lead changes' as stat_name,
        flow_percentiles.lead_changes::numeric as stat_value,
        least((flow_percentiles.lead_changes - {{ var('highlight_lead_changes') }}) / 15.0, 1) as magnitude,
        sided_games.game_importance as importance,
        flow_percentiles.lead_changes || ' lead changes in '
        || sided_games.away_team_abbreviation || ' @ ' || sided_games.home_team_abbreviation as headline,
        sided_games.score_line || '.' as detail
    from sided_games
    inner join flow_percentiles
        on sided_games.game_id = flow_percentiles.game_id
    where flow_percentiles.lead_changes >= {{ var('highlight_lead_changes') }}
),

overtime_games as (
    select
        sided_games.game_id,
        'overtime' as highlight_type,
        'game' as subject_type,
        null::uuid as player_id,
        null::uuid as team_id,
        'overtime periods' as stat_name,
        flow_percentiles.overtime_periods::numeric as stat_value,
        least((flow_percentiles.overtime_periods - 1) / 2.0, 1) as magnitude,
        sided_games.game_importance as importance,
        sided_games.winner_nickname || ' beat ' || sided_games.loser_nickname || ' in '
        || case flow_percentiles.overtime_periods
            when 1 then 'overtime'
            when 2 then 'double overtime'
            when 3 then 'triple overtime'
            else flow_percentiles.overtime_periods || ' overtimes'
        end as headline,
        sided_games.score_line || '.' as detail
    from sided_games
    inner join flow_percentiles
        on sided_games.game_id = flow_percentiles.game_id
    where flow_percentiles.overtime_periods >= 1
),

blowouts as (
    select
        sided_games.game_id,
        'blowout' as highlight_type,
        'team' as subject_type,
        null::uuid as player_id,
        sided_games.winning_team_id as team_id,
        'points' as stat_name,
        sided_games.score_margin::numeric as stat_value,
        least((sided_games.score_margin - {{ var('highlight_blowout_margin') }}) / 20.0, 1) as magnitude,
        sided_games.game_importance as importance,
        sided_games.winner_nickname || ' win by ' || sided_games.score_margin as headline,
        sided_games.score_line || '.' as detail
    from sided_games
    where sided_games.score_margin >= {{ var('highlight_blowout_margin') }}
),

upset_games as (
    select
        sided_games.game_id,
        'upset' as highlight_type,
        'team' as subject_type,
        null::uuid as player_id,
        sided_games.winning_team_id as team_id,
        'underdog win probability' as stat_name,
        round(upsets.underdog_market_wp::numeric, 3) as stat_value,
        least(
            ({{ var('highlight_upset_max_wp') }} - upsets.underdog_market_wp)::numeric / 0.2, 1
        ) as magnitude,
        sided_games.game_importance as importance,
        sided_games.winner_nickname || ' upset ' || sided_games.loser_nickname
        || ' as a +' || upsets.underdog_fair_moneyline || ' underdog' as headline,
        sided_games.score_line || '.' as detail
    from sided_games
    inner join upsets
        on sided_games.game_id = upsets.game_id
    where
        upsets.is_upset
        and upsets.underdog_market_wp <= {{ var('highlight_upset_max_wp') }}
),

heavyweight_clashes as (
    select
        sided_games.game_id,
        'heavyweight_clash' as highlight_type,
        'game' as subject_type,
        null::uuid as player_id,
        null::uuid as team_id,
        'combined league rank' as stat_name,
        (sided_games.winner_rank + sided_games.loser_rank)::numeric as stat_value,
        least(
            greatest(
                (2 * {{ heavyweight_rank }} - sided_games.winner_rank - sided_games.loser_rank)
                / (2.0 * {{ heavyweight_rank }} - 3),
                0
            ),
            1
        ) as magnitude,
        sided_games.game_importance as importance,
        'No. ' || sided_games.winner_rank || ' ' || sided_games.winner_nickname
        || ' beat No. ' || sided_games.loser_rank || ' ' || sided_games.loser_nickname as headline,
        'Two of the league''s top {{ heavyweight_rank }} by record. ' || sided_games.score_line || '.' as detail
    from sided_games
    where
        sided_games.is_ranked
        and sided_games.season_type = 'Regular Season'
        and sided_games.winner_rank <= {{ heavyweight_rank }}
        and sided_games.loser_rank <= {{ heavyweight_rank }}
),

candidates as (
    select * from league_season_highs
    union all
    select * from season_highs
    union all
    select * from elite_games
    union all
    select * from big_scoring_nights
    union all
    select * from triple_doubles
    union all
    select * from top_performers
    union all
    select * from scoring_duels
    union all
    select * from streak_highlights
    union all
    select * from blown_leads
    union all
    select * from lead_change_games
    union all
    select * from overtime_games
    union all
    select * from blowouts
    union all
    select * from upset_games
    union all
    select * from heavyweight_clashes
),

scored as (
    select
        candidates.*,
        case candidates.highlight_type
            {% for highlight_type, weight in weights.items() %}
                when '{{ highlight_type }}' then {{ weight }}
            {% endfor %}
        end::numeric as base_weight
    from candidates
),

ranked_in_game as (
    select
        scored.*,
        round(scored.base_weight * (1 + scored.magnitude) * (1 + scored.importance), 2) as score,
        row_number() over (
            partition by scored.game_id
            order by
                scored.base_weight * (1 + scored.magnitude) * (1 + scored.importance) desc,
                scored.highlight_type asc,
                scored.stat_name asc,
                scored.player_id asc nulls last
        ) as game_rank
    from scored
),

-- Featured highlights are one per game, so a single wild game cannot take
-- every slot and no player or team appears twice in a day.
game_leaders as (
    select
        ranked_in_game.game_id,
        row_number() over (
            partition by sided_games.game_date
            order by ranked_in_game.score desc, ranked_in_game.game_id asc
        ) as day_rank
    from ranked_in_game
    inner join sided_games
        on ranked_in_game.game_id = sided_games.game_id
    where ranked_in_game.game_rank = 1
)

select
    md5(
        ranked_in_game.game_id::text || '|' || ranked_in_game.highlight_type
        || '|' || coalesce(ranked_in_game.player_id::text, ranked_in_game.team_id::text, '')
        || '|' || ranked_in_game.stat_name
    ) as highlight_id,
    sided_games.game_date,
    sided_games.season,
    sided_games.season_type,
    ranked_in_game.game_id,
    ranked_in_game.highlight_type,
    ranked_in_game.subject_type,
    ranked_in_game.player_id,
    players.full_name as player_name,
    ranked_in_game.team_id,
    teams.abbreviation as team_abbreviation,
    sided_games.home_team_abbreviation,
    sided_games.away_team_abbreviation,
    sided_games.home_score,
    sided_games.away_score,
    ranked_in_game.headline,
    ranked_in_game.detail,
    ranked_in_game.stat_name,
    ranked_in_game.stat_value,
    ranked_in_game.base_weight,
    round(ranked_in_game.magnitude, 3) as magnitude,
    round(ranked_in_game.importance, 3) as importance,
    ranked_in_game.score,
    ranked_in_game.game_rank,
    case when ranked_in_game.game_rank = 1 then game_leaders.day_rank end as day_rank,
    ranked_in_game.game_rank = 1
    and game_leaders.day_rank <= {{ var('highlight_featured_per_day') }} as is_featured
from ranked_in_game
inner join sided_games
    on ranked_in_game.game_id = sided_games.game_id
inner join game_leaders
    on ranked_in_game.game_id = game_leaders.game_id
left join players
    on ranked_in_game.player_id = players.player_id
left join teams
    on ranked_in_game.team_id = teams.team_id
