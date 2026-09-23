with odds as (
    select * from {{ ref('stg_game_odds') }}
),

results as (
    select * from {{ ref('fct_team_game_results') }}
),

predictions as (
    select * from {{ ref('fct_game_predictions') }}
),

-- source.game_odds keeps the last pregame line per event x book x market, so
-- every row for a Final game is already its closing-ish line.
consensus_lines as (
    select
        odds.game_id,
        avg(odds.home_market_wp) as home_market_wp,
        max(odds.home_price) as home_best_moneyline,
        max(odds.away_price) as away_best_moneyline,
        count(distinct odds.bookmaker)::integer as bookmaker_count,
        min(odds.commence_time) as commence_time,
        max(odds.scraped_at) as line_scraped_at
    from odds
    where
        odds.market = 'h2h'
        and odds.game_id is not null
        and odds.home_market_wp is not null
    group by odds.game_id
),

lined_games as (
    select
        results.game_id,
        results.season,
        results.season_type,
        results.game_date,
        results.home_team_id,
        results.home_team_abbreviation,
        results.away_team_id,
        results.away_team_abbreviation,
        results.home_score,
        results.away_score,
        results.winning_team_id,
        results.winner_location,
        consensus_lines.home_market_wp,
        consensus_lines.home_best_moneyline,
        consensus_lines.away_best_moneyline,
        consensus_lines.bookmaker_count,
        consensus_lines.commence_time,
        consensus_lines.line_scraped_at,
        1 - consensus_lines.home_market_wp as away_market_wp,
        case
            when consensus_lines.home_market_wp > 0.5 then 'home'
            when consensus_lines.home_market_wp < 0.5 then 'away'
        end as favorite_location
    from results
    inner join consensus_lines
        on results.game_id = consensus_lines.game_id
),

sided_games as (
    select
        lined_games.*,
        case lined_games.favorite_location
            when 'home' then lined_games.home_team_id
            when 'away' then lined_games.away_team_id
        end as favorite_team_id,
        case lined_games.favorite_location
            when 'home' then lined_games.away_team_id
            when 'away' then lined_games.home_team_id
        end as underdog_team_id,
        case lined_games.favorite_location
            when 'home' then lined_games.away_team_abbreviation
            when 'away' then lined_games.home_team_abbreviation
        end as underdog_team_abbreviation,
        least(lined_games.home_market_wp, lined_games.away_market_wp) as underdog_market_wp,
        case lined_games.favorite_location
            when 'home' then lined_games.away_best_moneyline
            when 'away' then lined_games.home_best_moneyline
        end as underdog_best_moneyline,
        case lined_games.winner_location
            when 'home' then lined_games.home_market_wp
            else lined_games.away_market_wp
        end as winner_market_wp,
        coalesce(lined_games.favorite_location <> lined_games.winner_location, false) as is_upset
    from lined_games
),

scored_games as (
    select
        sided_games.*,
        predictions.model_version,
        predictions.model_wp as model_home_wp,
        -- De-vigged consensus probability back to a no-vig American price.
        round(100 * (1 - sided_games.underdog_market_wp) / sided_games.underdog_market_wp)::integer
            as underdog_fair_moneyline,
        -- Surprisal of the actual result in nats: 0.69 for a coin flip,
        -- 1.61 for a 20% winner. Comparable across games, unlike raw price.
        -ln(greatest(sided_games.winner_market_wp, 0.000001)) as upset_magnitude,
        case sided_games.winner_location
            when 'home' then predictions.model_wp
            else 1 - predictions.model_wp
        end as model_winner_wp
    from sided_games
    left join predictions
        on sided_games.game_id = predictions.game_id
)

select
    scored_games.game_id,
    scored_games.season,
    scored_games.season_type,
    scored_games.game_date,
    scored_games.commence_time,
    scored_games.home_team_id,
    scored_games.home_team_abbreviation,
    scored_games.away_team_id,
    scored_games.away_team_abbreviation,
    scored_games.home_score,
    scored_games.away_score,
    scored_games.winning_team_id,
    scored_games.winner_location,
    scored_games.favorite_team_id,
    scored_games.underdog_team_id,
    scored_games.underdog_team_abbreviation,
    scored_games.home_market_wp,
    scored_games.away_market_wp,
    scored_games.underdog_market_wp,
    scored_games.winner_market_wp,
    scored_games.home_best_moneyline,
    scored_games.away_best_moneyline,
    scored_games.underdog_best_moneyline,
    scored_games.underdog_fair_moneyline,
    scored_games.bookmaker_count,
    scored_games.line_scraped_at,
    scored_games.is_upset,
    scored_games.upset_magnitude,
    scored_games.model_version,
    scored_games.model_home_wp,
    scored_games.model_winner_wp,
    case
        when scored_games.is_upset
            then rank() over (
                partition by scored_games.season, scored_games.season_type, scored_games.is_upset
                order by scored_games.upset_magnitude desc
            )
    end as upset_rank,
    -- Did the model see this coming when the market did not?
    scored_games.is_upset and scored_games.model_winner_wp > 0.5 as model_called_upset
from scored_games
