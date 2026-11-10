with predictions as (
    select * from {{ ref('stg_game_predictions') }}
),

games as (
    select * from {{ ref('stg_games_schedule') }}
),

model_artifacts as (
    select * from {{ source('source', 'model_artifacts') }}
),

champion_model as (
    select model_artifacts.model_version
    from model_artifacts
    where model_artifacts.is_champion
    order by model_artifacts.trained_at desc
    limit 1
),

champion_model_count as (
    select count(*)::integer as n
    from champion_model
),

configured_champion as (
    select champion_model.model_version
    from champion_model

    union all

    select 'elo-v0' as model_version
    from champion_model_count
    where champion_model_count.n = 0
),

champion_predictions as (
    select
        predictions.game_id,
        predictions.as_of,
        predictions.model_name,
        predictions.model_version,
        predictions.home_team_id,
        predictions.away_team_id,
        predictions.model_wp,
        predictions.market_wp,
        predictions.breakdown,
        games.game_date,
        games.season,
        games.season_type,
        games.status as game_status,
        predictions.scraped_at,
        row_number() over (
            partition by predictions.game_id, predictions.model_version
            order by predictions.as_of desc
        ) as prediction_rank
    from predictions
    inner join games
        on predictions.game_id = games.game_id
    cross join configured_champion
    -- Schedule stores a date rather than a tip timestamp, so same-day
    -- snapshots are the latest available pregame representation.
    where predictions.model_version = configured_champion.model_version
        and predictions.as_of::date <= games.game_date
)

select
    champion_predictions.game_id,
    champion_predictions.as_of,
    champion_predictions.model_name,
    champion_predictions.model_version,
    champion_predictions.home_team_id,
    champion_predictions.away_team_id,
    champion_predictions.model_wp,
    1 - champion_predictions.model_wp as away_wp,
    champion_predictions.market_wp,
    champion_predictions.breakdown,
    champion_predictions.game_date,
    champion_predictions.season,
    champion_predictions.season_type,
    champion_predictions.game_status,
    champion_predictions.scraped_at
from champion_predictions
where champion_predictions.prediction_rank = 1
