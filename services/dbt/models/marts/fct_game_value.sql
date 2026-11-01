with predictions as (
    select * from {{ ref('stg_game_predictions') }}
),

champion_predictions as (
    select * from {{ ref('fct_game_predictions') }}
),

games as (
    select * from {{ ref('fct_games_schedule') }}
),

lines as (
    select * from {{ ref('int_game_moneylines') }}
),

results as (
    select * from {{ ref('fct_team_game_results') }}
),

features as (
    select * from {{ ref('int_game_features') }}
),

priced_games as (
    select
        predictions.game_id,
        games.season,
        games.season_type,
        games.game_date,
        games.status as game_status,
        games.home_team_id,
        games.home_team_abbreviation,
        games.away_team_id,
        games.away_team_abbreviation,
        predictions.model_name,
        predictions.model_version,
        predictions.as_of,
        lines.commence_time,
        lines.line_scraped_at,
        lines.bookmaker_count,
        lines.home_best_moneyline,
        lines.away_best_moneyline,
        lines.home_market_wp,
        lines.home_implied_wp,
        lines.away_implied_wp,
        predictions.model_wp as home_model_wp,
        results.winner_location,
        1 - lines.home_market_wp as away_market_wp,
        1 - predictions.model_wp as away_model_wp,
        champion_predictions.game_id is not null as is_champion,
        -- `ml backfill` stamps a replay at midnight; `score` runs after the
        -- morning scrape, so only a replay lands exactly on the day boundary.
        predictions.as_of = predictions.as_of::date as is_backfilled,
        -- Features cover the Regular Season only, so a playoff game reads 0.
        least(
            coalesce(features.home_games_before, 0),
            coalesce(features.away_games_before, 0)
        ) as min_team_games
    from predictions
    inner join games
        on predictions.game_id = games.game_id
    inner join lines
        on predictions.game_id = lines.game_id
    left join champion_predictions
        on
            predictions.game_id = champion_predictions.game_id
            and predictions.model_version = champion_predictions.model_version
    left join results
        on predictions.game_id = results.game_id
    left join features
        on predictions.game_id = features.game_id
    -- Schedule stores a date rather than a tip timestamp, so same-day
    -- snapshots are the latest available pregame representation.
    where predictions.as_of::date <= games.game_date
),

sided_games as (
    select
        priced_games.*,
        -- Payoff is 1 / implied per unit staked, so this is the model's expected
        -- profit at the consensus price. Using the vigged price rather than
        -- market WP means the vig has to be beaten, not just the market.
        case
            when
                priced_games.home_model_wp / priced_games.home_implied_wp
                >= priced_games.away_model_wp / priced_games.away_implied_wp
                then 'home'
            else 'away'
        end as value_location
    from priced_games
),

value_sides as (
    select
        sided_games.*,
        case sided_games.value_location
            when 'home' then sided_games.home_team_id
            else sided_games.away_team_id
        end as value_team_id,
        case sided_games.value_location
            when 'home' then sided_games.home_team_abbreviation
            else sided_games.away_team_abbreviation
        end as value_team_abbreviation,
        case sided_games.value_location
            when 'home' then sided_games.home_model_wp
            else sided_games.away_model_wp
        end as value_model_wp,
        case sided_games.value_location
            when 'home' then sided_games.home_market_wp
            else sided_games.away_market_wp
        end as value_market_wp,
        case sided_games.value_location
            when 'home' then sided_games.home_implied_wp
            else sided_games.away_implied_wp
        end as value_implied_wp,
        case sided_games.value_location
            when 'home' then sided_games.home_best_moneyline
            else sided_games.away_best_moneyline
        end as value_best_moneyline
    from sided_games
),

scored_games as (
    select
        value_sides.*,
        value_sides.value_model_wp - value_sides.value_market_wp as edge_wp,
        value_sides.value_model_wp / value_sides.value_implied_wp - 1 as expected_value,
        1 / value_sides.value_implied_wp as value_decimal_odds,
        value_sides.value_market_wp < 0.5 as is_market_underdog,
        value_sides.value_market_wp < 0.5 and value_sides.value_model_wp > 0.5
            as model_favors_underdog,
        case
            when value_sides.winner_location is not null
                then value_sides.winner_location = value_sides.value_location
        end as value_won
    from value_sides
),

flagged_games as (
    select
        scored_games.*,
        (
            scored_games.edge_wp >= {{ var('value_min_edge') }}
            and scored_games.edge_wp <= {{ var('value_max_edge') }}
            and scored_games.expected_value > 0
            and scored_games.min_team_games >= {{ var('value_min_team_games') }}
            and scored_games.bookmaker_count >= {{ var('value_min_bookmakers') }}
            {%- if var('value_underdog_only') %}
                and scored_games.is_market_underdog
            {%- endif %}
        ) as is_value_pick
    from scored_games
)

select
    flagged_games.game_id,
    flagged_games.season,
    flagged_games.season_type,
    flagged_games.game_date,
    flagged_games.game_status,
    flagged_games.commence_time,
    flagged_games.home_team_id,
    flagged_games.home_team_abbreviation,
    flagged_games.away_team_id,
    flagged_games.away_team_abbreviation,
    flagged_games.model_name,
    flagged_games.model_version,
    flagged_games.is_champion,
    flagged_games.is_backfilled,
    flagged_games.as_of,
    flagged_games.line_scraped_at,
    flagged_games.bookmaker_count,
    flagged_games.min_team_games,
    flagged_games.home_model_wp,
    flagged_games.home_market_wp,
    flagged_games.value_location,
    flagged_games.value_team_id,
    flagged_games.value_team_abbreviation,
    flagged_games.value_model_wp,
    flagged_games.value_market_wp,
    flagged_games.value_implied_wp,
    flagged_games.value_decimal_odds,
    flagged_games.value_best_moneyline,
    flagged_games.edge_wp,
    flagged_games.expected_value,
    flagged_games.is_market_underdog,
    flagged_games.model_favors_underdog,
    flagged_games.is_value_pick,
    flagged_games.value_won,
    case
        when flagged_games.is_value_pick
            then rank() over (
                partition by
                    flagged_games.game_date,
                    flagged_games.model_version,
                    flagged_games.is_value_pick
                order by flagged_games.expected_value desc
            )
    end as value_rank,
    case
        when flagged_games.value_won then flagged_games.value_decimal_odds - 1
        when not flagged_games.value_won then -1
    end as unit_profit
from flagged_games
