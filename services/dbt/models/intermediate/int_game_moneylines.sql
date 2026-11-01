with odds as (
    select * from {{ ref('stg_game_odds') }}
)

-- source.game_odds keeps the last pregame line per event x book x market, so
-- every row for a Final game is already its closing-ish line.
select
    odds.game_id,
    avg(odds.home_market_wp) as home_market_wp,
    -- Vig still in: what a bettor actually pays, unlike home_market_wp.
    avg(odds.home_implied_wp) as home_implied_wp,
    avg(odds.away_implied_wp) as away_implied_wp,
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
