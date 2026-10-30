with scored_predictions as (
    select * from {{ ref('fct_prediction_results') }}
),

model_metrics as (
    select
        scored_predictions.season,
        scored_predictions.model_name,
        scored_predictions.model_version,
        count(*)::integer as n,
        -avg(
            case
                when scored_predictions.home_won
                    then ln(greatest(least(scored_predictions.model_wp, 0.999999), 0.000001))
                else ln(
                    1 - greatest(least(scored_predictions.model_wp, 0.999999), 0.000001)
                )
            end
        ) as logloss,
        avg(
            power(
                scored_predictions.model_wp
                - case when scored_predictions.home_won then 1.0 else 0.0 end,
                2
            )
        ) as brier,
        avg(
            case
                when (scored_predictions.model_wp >= 0.5) = scored_predictions.home_won
                    then 1.0
                else 0.0
            end
        ) as accuracy,
        avg(case when scored_predictions.home_won then 1.0 else 0.0 end)
            as home_always_accuracy
    from scored_predictions
    group by
        scored_predictions.season,
        scored_predictions.model_name,
        scored_predictions.model_version
),

calibration_bins as (
    select
        scored_predictions.season,
        scored_predictions.model_name,
        scored_predictions.model_version,
        floor(greatest(0.0, least(scored_predictions.model_wp, 0.999999)) * 10)::integer
            as probability_bin,
        count(*)::double precision as bin_n,
        avg(scored_predictions.model_wp) as bin_predicted,
        avg(case when scored_predictions.home_won then 1.0 else 0.0 end) as bin_actual
    from scored_predictions
    group by
        scored_predictions.season,
        scored_predictions.model_name,
        scored_predictions.model_version,
        floor(greatest(0.0, least(scored_predictions.model_wp, 0.999999)) * 10)::integer
),

calibration_metrics as (
    select
        calibration_bins.season,
        calibration_bins.model_name,
        calibration_bins.model_version,
        sum(
            calibration_bins.bin_n / model_metrics.n
            * abs(calibration_bins.bin_predicted - calibration_bins.bin_actual)
        ) as calibration_error
    from calibration_bins
    inner join model_metrics
        on calibration_bins.season = model_metrics.season
        and calibration_bins.model_name = model_metrics.model_name
        and calibration_bins.model_version = model_metrics.model_version
    group by
        calibration_bins.season,
        calibration_bins.model_name,
        calibration_bins.model_version
),

market_predictions as (
    select distinct on (scored_predictions.season, scored_predictions.game_id)
        scored_predictions.season,
        scored_predictions.game_id,
        scored_predictions.home_won,
        scored_predictions.market_wp
    from scored_predictions
    where scored_predictions.market_wp is not null
    order by scored_predictions.season, scored_predictions.game_id, scored_predictions.model_version
),

market_metrics as (
    select
        market_predictions.season,
        count(*)::integer as market_n,
        -avg(
            case
                when market_predictions.home_won
                    then ln(greatest(least(market_predictions.market_wp, 0.999999), 0.000001))
                else ln(
                    1 - greatest(least(market_predictions.market_wp, 0.999999), 0.000001)
                )
            end
        ) as market_logloss,
        avg(
            power(
                market_predictions.market_wp
                - case when market_predictions.home_won then 1.0 else 0.0 end,
                2
            )
        ) as market_brier
    from market_predictions
    group by market_predictions.season
)

select
    model_metrics.season,
    model_metrics.model_name,
    model_metrics.model_version,
    model_metrics.n,
    model_metrics.logloss,
    model_metrics.brier,
    model_metrics.accuracy,
    model_metrics.home_always_accuracy,
    calibration_metrics.calibration_error,
    market_metrics.market_n,
    market_metrics.market_logloss,
    market_metrics.market_brier
from model_metrics
left join calibration_metrics
    on model_metrics.season = calibration_metrics.season
    and model_metrics.model_name = calibration_metrics.model_name
    and model_metrics.model_version = calibration_metrics.model_version
left join market_metrics
    on model_metrics.season = market_metrics.season
