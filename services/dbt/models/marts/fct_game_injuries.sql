{% set max_age = var('injury_snapshot_max_age_days') %}

-- Who was on the injury report for each game, from the daily snapshots. A game
-- reads the newest snapshot at most max_age days before the earlier of its date
-- and today: a past game gets the report from that morning, an upcoming one
-- today's. Upcoming games only reach injury_upcoming_days ahead.
with games as (
    select * from {{ ref('fct_games_schedule') }}
),

history as (
    select * from {{ ref('int_player_injury_history') }}
),

notability as (
    select * from {{ ref('int_player_notability') }}
),

player_game_logs as (
    select * from {{ ref('fct_player_game_logs') }}
),

todays as (
    select (now() at time zone 'America/New_York')::date as today
),

snapshot_dates as (
    select distinct history.snapshot_date
    from history
),

reported_games as (
    select
        games.game_id,
        games.season,
        games.game_date,
        games.status,
        games.home_team_id,
        games.away_team_id,
        least(games.game_date, todays.today) as report_date
    from games
    cross join todays
    where games.game_date <= todays.today + {{ var('injury_upcoming_days') }}
),

game_snapshots as (
    select
        reported_games.game_id,
        max(snapshot_dates.snapshot_date) as snapshot_date
    from reported_games
    inner join snapshot_dates
        on
            reported_games.report_date >= snapshot_dates.snapshot_date
            and reported_games.report_date - {{ max_age }} <= snapshot_dates.snapshot_date
    group by reported_games.game_id
),

home_sides as (
    select
        reported_games.game_id,
        reported_games.season,
        reported_games.game_date,
        reported_games.status,
        reported_games.home_team_id as team_id,
        'home' as side
    from reported_games
),

away_sides as (
    select
        reported_games.game_id,
        reported_games.season,
        reported_games.game_date,
        reported_games.status,
        reported_games.away_team_id as team_id,
        'away' as side
    from reported_games
),

game_sides as (
    select * from home_sides
    union all
    select * from away_sides
),

-- Every listed player on each game's report.
listed as (
    select
        game_sides.game_id,
        game_sides.game_date,
        game_sides.season,
        game_sides.status,
        game_sides.team_id,
        game_sides.side,
        history.player_id,
        history.player_name,
        history.injury_status,
        history.injury_detail,
        history.description,
        history.update_date,
        history.snapshot_date
    from game_sides
    inner join game_snapshots
        on game_sides.game_id = game_snapshots.game_id
    inner join history
        on
            game_snapshots.snapshot_date = history.snapshot_date
            and game_sides.team_id = history.team_id
),

-- Notable this season or last, so opening night still flags last year's stars.
-- Looked up for listed players only; distinct because both seasons can match.
notable_listed as (
    select distinct
        listed.game_id,
        listed.player_id
    from listed
    inner join notability
        on
            listed.player_id = notability.player_id
            and notability.season in (listed.season, {{ previous_season('listed.season') }})
            and notability.is_notable
),

key_listed as (
    select distinct
        listed.game_id,
        listed.player_id
    from listed
    inner join notability
        on
            listed.player_id = notability.player_id
            and notability.season in (listed.season, {{ previous_season('listed.season') }})
            and notability.is_key
),

minutes_played as (
    select
        player_game_logs.game_id,
        player_game_logs.player_id,
        bool_or(coalesce(player_game_logs.minutes, 0) > 0) as played
    from player_game_logs
    group by player_game_logs.game_id, player_game_logs.player_id
)

select
    listed.game_id,
    listed.game_date,
    listed.season,
    listed.team_id,
    listed.side,
    listed.player_id,
    listed.player_name,
    listed.injury_status,
    listed.injury_detail,
    listed.description,
    listed.update_date,
    listed.snapshot_date,
    notable_listed.player_id is not null as is_notable,
    key_listed.player_id is not null as is_key,
    -- Only known once the game is Final; no log at all means they sat.
    case
        when listed.status = 'Final' then coalesce(minutes_played.played, false)
    end as played
from listed
left join notable_listed
    on
        listed.game_id = notable_listed.game_id
        and listed.player_id = notable_listed.player_id
left join key_listed
    on
        listed.game_id = key_listed.game_id
        and listed.player_id = key_listed.player_id
left join minutes_played
    on
        listed.game_id = minutes_played.game_id
        and listed.player_id = minutes_played.player_id
