with schedule_games as (
    select * from {{ ref('fct_games_schedule') }}
),

completed_games as (
    select * from {{ ref('fct_team_game_results') }}
),

source_predictions as (
    select * from {{ source('source', 'game_predictions') }}
),

predictions_on_or_before_game_date as (
    select
        source_predictions.game_id,
        source_predictions.model_name,
        source_predictions.model_version,
        source_predictions.model_wp,
        source_predictions.market_wp,
        schedule_games.season,
        schedule_games.game_date,
        schedule_games.home_team_abbreviation,
        schedule_games.away_team_abbreviation,
        completed_games.winner_location = 'home' as home_won,
        row_number() over (
            partition by source_predictions.game_id, source_predictions.model_version
            order by source_predictions.as_of desc
        ) as prediction_rank
    from source_predictions
    inner join schedule_games
        on source_predictions.game_id = schedule_games.game_id
    inner join completed_games
        on source_predictions.game_id = completed_games.game_id
    -- Schedule stores a date rather than a tip timestamp; retain same-day
    -- morning snapshots instead of dropping the daily pregame run.
    where source_predictions.as_of::date <= schedule_games.game_date
)

select
    predictions_on_or_before_game_date.game_id,
    predictions_on_or_before_game_date.model_name,
    predictions_on_or_before_game_date.model_version,
    predictions_on_or_before_game_date.model_wp,
    predictions_on_or_before_game_date.market_wp,
    predictions_on_or_before_game_date.season,
    predictions_on_or_before_game_date.game_date,
    predictions_on_or_before_game_date.home_team_abbreviation,
    predictions_on_or_before_game_date.away_team_abbreviation,
    predictions_on_or_before_game_date.home_won
from predictions_on_or_before_game_date
where predictions_on_or_before_game_date.prediction_rank = 1
