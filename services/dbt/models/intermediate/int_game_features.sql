with schedule_source as (
    select * from {{ ref('stg_games_schedule') }}
),

schedule_games as (
    select
        schedule_source.game_id,
        schedule_source.season,
        schedule_source.season_type,
        schedule_source.game_date,
        schedule_source.home_team_id,
        schedule_source.away_team_id,
        schedule_source.home_score,
        schedule_source.away_score,
        schedule_source.status
    from schedule_source
    where schedule_source.season_type = 'Regular Season'
),

completed_games as (
    select
        schedule_games.game_id,
        schedule_games.season,
        schedule_games.game_date,
        schedule_games.home_team_id,
        schedule_games.away_team_id,
        schedule_games.home_score,
        schedule_games.away_score
    from schedule_games
    where schedule_games.status = 'Final'
      and schedule_games.home_score is not null
      and schedule_games.away_score is not null
),

completed_games_with_winner as (
    select
        completed_games.game_id,
        completed_games.game_date,
        completed_games.home_team_id,
        completed_games.away_team_id,
        case
            when completed_games.home_score > completed_games.away_score
                then completed_games.home_team_id
            else completed_games.away_team_id
        end as winning_team_id
    from completed_games
),

completed_team_games as (
    select
        completed_games.game_id,
        completed_games.season,
        completed_games.game_date,
        completed_games.home_team_id as team_id,
        completed_games.home_team_id as venue_team_id,
        completed_games.away_team_id as opponent_team_id,
        completed_games.home_score as points_for,
        completed_games.away_score as points_against,
        completed_games.home_score - completed_games.away_score as point_diff,
        completed_games.home_score > completed_games.away_score as won
    from completed_games

    union all

    select
        completed_games.game_id,
        completed_games.season,
        completed_games.game_date,
        completed_games.away_team_id as team_id,
        completed_games.home_team_id as venue_team_id,
        completed_games.home_team_id as opponent_team_id,
        completed_games.away_score as points_for,
        completed_games.home_score as points_against,
        completed_games.away_score - completed_games.home_score as point_diff,
        completed_games.away_score > completed_games.home_score as won
    from completed_games
),

current_team_games as (
    select
        schedule_games.game_id,
        schedule_games.season,
        schedule_games.game_date,
        schedule_games.home_team_id,
        schedule_games.away_team_id,
        schedule_games.home_team_id as team_id,
        schedule_games.away_team_id as opponent_team_id,
        true as is_home
    from schedule_games

    union all

    select
        schedule_games.game_id,
        schedule_games.season,
        schedule_games.game_date,
        schedule_games.home_team_id,
        schedule_games.away_team_id,
        schedule_games.away_team_id as team_id,
        schedule_games.home_team_id as opponent_team_id,
        false as is_home
    from schedule_games
),

team_history_ranked as (
    select
        current_team_games.game_id as current_game_id,
        current_team_games.team_id as current_team_id,
        current_team_games.game_date as current_game_date,
        completed_team_games.game_id as history_game_id,
        completed_team_games.game_date as history_game_date,
        completed_team_games.venue_team_id as history_venue_team_id,
        completed_team_games.point_diff,
        completed_team_games.won,
        row_number() over (
            partition by current_team_games.game_id, current_team_games.team_id
            order by completed_team_games.game_date desc, completed_team_games.game_id desc
        ) as history_rank
    from current_team_games
    -- The leakage guard: strictly earlier dates only, so a same-day game never
    -- feeds another. Same season only, so form resets each year; the left join
    -- keeps a team's first game with null history (cold start).
    left join completed_team_games
        on current_team_games.team_id = completed_team_games.team_id
        and current_team_games.season = completed_team_games.season
        and current_team_games.game_date > completed_team_games.game_date
),

team_context as (
    select
        team_history_ranked.current_game_id as game_id,
        team_history_ranked.current_team_id as team_id,
        count(team_history_ranked.history_game_id)::integer as games_before,
        avg(team_history_ranked.point_diff) as point_diff_per_game,
        avg(
            case
                when team_history_ranked.history_game_id is null then null
                when team_history_ranked.won then 1.0
                else 0.0
            end
        ) as win_pct,
        avg(
            case
                when team_history_ranked.history_rank <= 10 then team_history_ranked.point_diff
            end
        ) as last10_point_diff,
        max(team_history_ranked.history_game_date) as previous_game_date,
        -- Postgres has no max(uuid); round-trip through text to pick the most
        -- recent game's venue.
        (
            max(team_history_ranked.history_venue_team_id::text)
            filter (where team_history_ranked.history_rank = 1)
        )::uuid as previous_venue_team_id
    from team_history_ranked
    group by team_history_ranked.current_game_id, team_history_ranked.current_team_id
),

arena_seed as (
    select * from {{ ref('nba_team_arenas') }}
),

-- The seed holds current arenas only, so a past season played in a since-replaced
-- building still gets today's coordinates.
arenas as (
    select
        arena_seed.team_id::uuid as team_id,
        arena_seed.arena_latitude::double precision as latitude,
        arena_seed.arena_longitude::double precision as longitude
    from arena_seed
),

home_team_context as (
    select * from team_context
),

away_team_context as (
    select * from team_context
),

current_arenas as (
    select * from arenas
),

home_previous_arenas as (
    select * from arenas
),

away_previous_arenas as (
    select * from arenas
),

head_to_head as (
    select
        schedule_games.game_id,
        count(completed_games_with_winner.game_id)::integer as games_before,
        count(completed_games_with_winner.game_id) filter (
            where completed_games_with_winner.winning_team_id = schedule_games.home_team_id
        )::integer as home_wins_before
    from schedule_games
    left join completed_games_with_winner
        on schedule_games.game_date > completed_games_with_winner.game_date
        and (
            (
                schedule_games.home_team_id = completed_games_with_winner.home_team_id
                and schedule_games.away_team_id = completed_games_with_winner.away_team_id
            )
            or (
                schedule_games.home_team_id = completed_games_with_winner.away_team_id
                and schedule_games.away_team_id = completed_games_with_winner.home_team_id
            )
        )
        -- Rolling 365 days rather than the season (unlike team_history_ranked),
        -- so early-season games still see last year's meetings.
        and completed_games_with_winner.game_date >= schedule_games.game_date - interval '365 days'
    group by schedule_games.game_id, schedule_games.home_team_id
),

feature_rows as (
    select
        schedule_games.game_id,
        schedule_games.season,
        schedule_games.season_type,
        schedule_games.game_date,
        schedule_games.home_team_id,
        schedule_games.away_team_id,
        home_team_context.games_before as home_games_before,
        away_team_context.games_before as away_games_before,
        home_team_context.point_diff_per_game as home_point_diff_per_game,
        away_team_context.point_diff_per_game as away_point_diff_per_game,
        home_team_context.win_pct as home_win_pct,
        away_team_context.win_pct as away_win_pct,
        home_team_context.last10_point_diff as home_last10_point_diff,
        away_team_context.last10_point_diff as away_last10_point_diff,
        home_team_context.previous_game_date as home_previous_game_date,
        away_team_context.previous_game_date as away_previous_game_date,
        home_team_context.previous_venue_team_id as home_previous_venue_team_id,
        away_team_context.previous_venue_team_id as away_previous_venue_team_id,
        coalesce(head_to_head.games_before, 0) as h2h_games_before,
        current_arenas.latitude as current_latitude,
        current_arenas.longitude as current_longitude,
        home_previous_arenas.latitude as home_previous_latitude,
        home_previous_arenas.longitude as home_previous_longitude,
        away_previous_arenas.latitude as away_previous_latitude,
        away_previous_arenas.longitude as away_previous_longitude,
        case
            when schedule_games.status = 'Final'
                and schedule_games.home_score > schedule_games.away_score then true
            when schedule_games.status = 'Final'
                and schedule_games.home_score < schedule_games.away_score then false
        end as home_won,
        case
            when coalesce(head_to_head.games_before, 0) = 0 then null
            else head_to_head.home_wins_before::double precision
                / head_to_head.games_before
        end as h2h_home_win_pct
    from schedule_games
    left join home_team_context
        on schedule_games.game_id = home_team_context.game_id
        and schedule_games.home_team_id = home_team_context.team_id
    left join away_team_context
        on schedule_games.game_id = away_team_context.game_id
        and schedule_games.away_team_id = away_team_context.team_id
    left join head_to_head
        on schedule_games.game_id = head_to_head.game_id
    left join current_arenas
        on schedule_games.home_team_id = current_arenas.team_id
    left join home_previous_arenas
        on home_team_context.previous_venue_team_id = home_previous_arenas.team_id
    left join away_previous_arenas
        on away_team_context.previous_venue_team_id = away_previous_arenas.team_id
),

-- Haversine great-circle distance, Earth radius 3958.8 miles, from each team's
-- previous venue to tonight's home arena.
travel_features as (
    select
        feature_rows.*,
        case
            when feature_rows.current_latitude is null
                or feature_rows.current_longitude is null
                or feature_rows.home_previous_latitude is null
                or feature_rows.home_previous_longitude is null
            then null
            else 3958.8 * 2 * asin(
                sqrt(
                    power(
                        sin(
                            radians(
                                feature_rows.current_latitude
                                - feature_rows.home_previous_latitude
                            ) / 2
                        ),
                        2
                    )
                    + cos(radians(feature_rows.current_latitude))
                    * cos(radians(feature_rows.home_previous_latitude))
                    * power(
                        sin(
                            radians(
                                feature_rows.current_longitude
                                - feature_rows.home_previous_longitude
                            ) / 2
                        ),
                        2
                    )
                )
            )
        end as home_travel_miles,
        case
            when feature_rows.current_latitude is null
                or feature_rows.current_longitude is null
                or feature_rows.away_previous_latitude is null
                or feature_rows.away_previous_longitude is null
            then null
            else 3958.8 * 2 * asin(
                sqrt(
                    power(
                        sin(
                            radians(
                                feature_rows.current_latitude
                                - feature_rows.away_previous_latitude
                            ) / 2
                        ),
                        2
                    )
                    + cos(radians(feature_rows.current_latitude))
                    * cos(radians(feature_rows.away_previous_latitude))
                    * power(
                        sin(
                            radians(
                                feature_rows.current_longitude
                                - feature_rows.away_previous_longitude
                            ) / 2
                        ),
                        2
                    )
                )
            )
        end as away_travel_miles
    from feature_rows
)

select
    travel_features.game_id,
    travel_features.season,
    travel_features.season_type,
    travel_features.game_date,
    travel_features.home_team_id,
    travel_features.away_team_id,
    travel_features.home_won,
    travel_features.home_games_before,
    travel_features.away_games_before,
    travel_features.home_point_diff_per_game,
    travel_features.away_point_diff_per_game,
    travel_features.home_win_pct,
    travel_features.away_win_pct,
    travel_features.home_last10_point_diff,
    travel_features.away_last10_point_diff,
    travel_features.home_travel_miles,
    travel_features.away_travel_miles,
    travel_features.h2h_games_before,
    travel_features.h2h_home_win_pct,
    case
        when travel_features.home_previous_game_date is null then null
        else travel_features.game_date - travel_features.home_previous_game_date
    end as home_rest_days,
    case
        when travel_features.away_previous_game_date is null then null
        else travel_features.game_date - travel_features.away_previous_game_date
    end as away_rest_days,
    -- Timezones approximated as 15-degree longitude bands, not real tz
    -- boundaries; close enough to count coast-to-coast hops.
    case
        when travel_features.home_previous_longitude is null then null
        else abs(
            floor((travel_features.current_longitude + 180) / 15)
            - floor((travel_features.home_previous_longitude + 180) / 15)
        )
    end as home_timezone_crossings,
    case
        when travel_features.away_previous_longitude is null then null
        else abs(
            floor((travel_features.current_longitude + 180) / 15)
            - floor((travel_features.away_previous_longitude + 180) / 15)
        )
    end as away_timezone_crossings,
    case
        when travel_features.home_point_diff_per_game is null
            or travel_features.away_point_diff_per_game is null
        then null
        else travel_features.home_point_diff_per_game
            - travel_features.away_point_diff_per_game
    end as point_diff_diff,
    case
        when travel_features.home_win_pct is null or travel_features.away_win_pct is null
        then null
        else travel_features.home_win_pct - travel_features.away_win_pct
    end as win_pct_diff,
    case
        when travel_features.home_last10_point_diff is null
            or travel_features.away_last10_point_diff is null
        then null
        else travel_features.home_last10_point_diff
            - travel_features.away_last10_point_diff
    end as last10_point_diff_diff,
    case
        when travel_features.home_previous_game_date is null
            or travel_features.away_previous_game_date is null
        then null
        else least(travel_features.game_date - travel_features.home_previous_game_date, 4)
            - least(travel_features.game_date - travel_features.away_previous_game_date, 4)
    end as rest_days_diff,
    case
        when travel_features.home_previous_game_date is null
            or travel_features.away_previous_game_date is null
        then null
        else least(
            least(travel_features.game_date - travel_features.home_previous_game_date, 4),
            least(travel_features.game_date - travel_features.away_previous_game_date, 4)
        )
    end as min_rest_days,
    case
        when travel_features.home_travel_miles is null
            or travel_features.away_travel_miles is null
        then null
        else travel_features.home_travel_miles - travel_features.away_travel_miles
    end as travel_miles_diff,
    case
        when travel_features.home_travel_miles is null
            or travel_features.away_travel_miles is null
        then null
        else travel_features.home_travel_miles + travel_features.away_travel_miles
    end as total_travel_miles,
    case
        when travel_features.home_previous_longitude is null
            or travel_features.away_previous_longitude is null
        then null
        else abs(
            floor((travel_features.current_longitude + 180) / 15)
            - floor((travel_features.home_previous_longitude + 180) / 15)
        )
            - abs(
                floor((travel_features.current_longitude + 180) / 15)
                - floor((travel_features.away_previous_longitude + 180) / 15)
            )
    end as timezone_crossings_diff,
    case
        when travel_features.home_previous_longitude is null
            or travel_features.away_previous_longitude is null
        then null
        else abs(
            floor((travel_features.current_longitude + 180) / 15)
            - floor((travel_features.home_previous_longitude + 180) / 15)
        )
            + abs(
                floor((travel_features.current_longitude + 180) / 15)
                - floor((travel_features.away_previous_longitude + 180) / 15)
            )
    end as total_timezone_crossings
from travel_features
