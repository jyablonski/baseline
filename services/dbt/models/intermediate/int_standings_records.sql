{{ config(materialized='table') }}

-- Regular Season standings for every team-season with scraped standings or at
-- least one Final: scraped values where Basketball-Reference has them, the
-- rest derived from fct_team_game_results. int_playoff_seeds and fct_standings
-- both read the ranks here, so the play-in bracket works for a season the
-- scraper has not reached.
--
-- Derived ranks break ties with the NBA criteria our data can answer, in the
-- rulebook's order:
--   two teams:   head-to-head, division leader, division win % (same division
--                only), conference win %, point differential
--   three+:      division leader, win % among the tied teams, division win %
--                (all in one division only), conference win %, point differential
-- Not modeled: win % against playoff-eligible teams, the random drawing (team
-- name stands in), and the rule that a multi-team tie restarts from the top
-- once a criterion separates some of the teams.
with standings as (
    select * from {{ ref('stg_standings') }}
),

teams as (
    select * from {{ ref('stg_teams') }}
),

results as (
    select * from {{ ref('fct_team_game_results') }}
    where
        season_type = 'Regular Season'
        and winning_team_id is not null
),

-- One row per team per finished Regular Season game, home and away alike.
appearances as (
    select
        results.home_team_id as team_id,
        results.away_team_id as opponent_team_id,
        results.season,
        results.game_date,
        results.game_id,
        results.winning_team_id = results.home_team_id as is_win,
        results.home_score - results.away_score as point_margin
    from results

    union all

    select
        results.away_team_id as team_id,
        results.home_team_id as opponent_team_id,
        results.season,
        results.game_date,
        results.game_id,
        results.winning_team_id = results.away_team_id as is_win,
        results.away_score - results.home_score as point_margin
    from results
),

team_attributes as (
    select
        teams.team_id,
        teams.conference,
        teams.division
    from teams
),

opponent_attributes as (
    select
        teams.team_id,
        teams.conference,
        teams.division
    from teams
),

appearance_context as (
    select
        appearances.team_id,
        appearances.season,
        appearances.is_win,
        appearances.point_margin,
        team_attributes.division = opponent_attributes.division as is_division_game,
        team_attributes.conference = opponent_attributes.conference as is_conference_game
    from appearances
    inner join team_attributes
        on appearances.team_id = team_attributes.team_id
    inner join opponent_attributes
        on appearances.opponent_team_id = opponent_attributes.team_id
),

game_records as (
    select
        appearance_context.team_id,
        appearance_context.season,
        count(*) filter (where appearance_context.is_win) as wins,
        count(*) filter (where not appearance_context.is_win) as losses,
        count(*) filter (where appearance_context.is_division_game and appearance_context.is_win) as division_wins,
        count(*) filter (where appearance_context.is_division_game and not appearance_context.is_win) as division_losses,
        count(*) filter (where appearance_context.is_conference_game and appearance_context.is_win) as conference_wins,
        count(*) filter (
            where appearance_context.is_conference_game and not appearance_context.is_win
        ) as conference_losses,
        sum(appearance_context.point_margin) as point_differential
    from appearance_context
    group by
        appearance_context.team_id,
        appearance_context.season
),

-- game_number 1 is the team's most recent game of the season.
ordered as (
    select
        appearances.team_id,
        appearances.season,
        appearances.is_win,
        row_number() over (
            partition by appearances.team_id, appearances.season
            order by appearances.game_date desc, appearances.game_id desc
        ) as game_number
    from appearances
),

with_previous as (
    select
        ordered.team_id,
        ordered.season,
        ordered.is_win,
        ordered.game_number,
        lag(ordered.is_win) over (
            partition by ordered.team_id, ordered.season
            order by ordered.game_number
        ) as previous_is_win
    from ordered
),

-- streak_group 1 is the unbroken run of same results ending at the latest game.
marked as (
    select
        with_previous.team_id,
        with_previous.season,
        with_previous.is_win,
        with_previous.game_number,
        sum(
            case
                when
                    with_previous.game_number = 1
                    or with_previous.is_win is distinct from with_previous.previous_is_win
                    then 1
                else 0
            end
        ) over (
            partition by with_previous.team_id, with_previous.season
            order by with_previous.game_number
            rows between unbounded preceding and current row
        ) as streak_group
    from with_previous
),

form as (
    select
        marked.team_id,
        marked.season,
        concat(
            case when bool_or(marked.is_win) filter (where marked.streak_group = 1) then 'W' else 'L' end,
            count(*) filter (where marked.streak_group = 1)
        ) as streak,
        concat(
            count(*) filter (where marked.game_number <= 10 and marked.is_win),
            '-',
            count(*) filter (where marked.game_number <= 10 and not marked.is_win)
        ) as last_10
    from marked
    group by
        marked.team_id,
        marked.season
),

-- A season can have Finals before (or without) a standings scrape, so every
-- team-season with either one gets a row.
team_seasons as (
    select
        standings.team_id,
        standings.season
    from standings

    union

    select
        game_records.team_id,
        game_records.season
    from game_records
),

-- Scraped values win field by field; the rest comes from our own results.
records as (
    select
        team_seasons.team_id,
        teams.abbreviation,
        teams.team_name,
        teams.city,
        teams.nickname,
        team_seasons.season,
        'Regular Season' as season_type,
        standings.as_of_date,
        coalesce(standings.conference, teams.conference) as conference,
        coalesce(standings.division, teams.division) as division,
        standings.conference_rank as scraped_conference_rank,
        coalesce(standings.wins, game_records.wins) as wins,
        coalesce(standings.losses, game_records.losses) as losses,
        coalesce(
            standings.win_pct,
            round(game_records.wins::numeric / nullif(game_records.wins + game_records.losses, 0), 3)
        ) as win_pct,
        standings.games_back as scraped_games_back,
        -- A scraped streak may be spelled 'W 3'; the derived one is 'W3'.
        coalesce(nullif(nullif(replace(standings.streak, ' ', ''), ''), '—'), form.streak) as streak,
        coalesce(nullif(nullif(btrim(standings.last_10), ''), '—'), form.last_10) as last_10,
        game_records.division_wins,
        game_records.division_losses,
        game_records.conference_wins,
        game_records.conference_losses,
        game_records.point_differential,
        case when standings.team_id is not null then 'official' else 'games' end as record_source
    from team_seasons
    inner join teams
        on team_seasons.team_id = teams.team_id
    left join standings
        on team_seasons.team_id = standings.team_id
        and team_seasons.season = standings.season
    left join game_records
        on team_seasons.team_id = game_records.team_id
        and team_seasons.season = game_records.season
    left join form
        on team_seasons.team_id = form.team_id
        and team_seasons.season = form.season
),

-- Unrounded, so 2-1 and 4-2 tie and .6667 does not.
with_pct as (
    select
        records.*,
        records.wins::numeric / nullif(records.wins + records.losses, 0) as exact_win_pct,
        records.division_wins::numeric / nullif(records.division_wins + records.division_losses, 0)
            as division_win_pct,
        records.conference_wins::numeric / nullif(records.conference_wins + records.conference_losses, 0)
            as conference_win_pct
    from records
),

tied_teams as (
    select
        with_pct.team_id,
        with_pct.season,
        with_pct.conference,
        with_pct.division,
        with_pct.exact_win_pct
    from with_pct
),

tied_opponents as (
    select
        with_pct.team_id,
        with_pct.season,
        with_pct.conference,
        with_pct.division,
        with_pct.exact_win_pct
    from with_pct
),

-- Win % in games between teams with the same record: head-to-head for a
-- two-team tie, the among-tied-teams record for a larger one.
tied_games as (
    select
        appearances.team_id,
        appearances.season,
        tied_teams.division = tied_opponents.division as is_division_tie,
        appearances.is_win
    from appearances
    inner join tied_teams
        on appearances.team_id = tied_teams.team_id
        and appearances.season = tied_teams.season
    inner join tied_opponents
        on appearances.opponent_team_id = tied_opponents.team_id
        and appearances.season = tied_opponents.season
    where
        tied_teams.conference = tied_opponents.conference
        and tied_teams.exact_win_pct = tied_opponents.exact_win_pct
),

tied_records as (
    select
        tied_games.team_id,
        tied_games.season,
        avg(case when tied_games.is_win then 1.0 else 0.0 end) as conference_tied_win_pct,
        avg(case when tied_games.is_win then 1.0 else 0.0 end) filter (where tied_games.is_division_tie)
            as division_tied_win_pct
    from tied_games
    group by
        tied_games.team_id,
        tied_games.season
),

-- Inside a division the division-leader criterion cannot apply.
division_ranked as (
    select
        with_pct.*,
        tied_records.conference_tied_win_pct,
        row_number() over (
            partition by with_pct.season, with_pct.division
            order by
                with_pct.exact_win_pct desc nulls last,
                tied_records.division_tied_win_pct desc nulls last,
                with_pct.division_win_pct desc nulls last,
                with_pct.conference_win_pct desc nulls last,
                with_pct.point_differential desc nulls last,
                with_pct.team_name asc
        ) as division_rank
    from with_pct
    left join tied_records
        on with_pct.team_id = tied_records.team_id
        and with_pct.season = tied_records.season
),

conference_ties as (
    select
        division_ranked.season,
        division_ranked.conference,
        division_ranked.exact_win_pct,
        count(*) as tied_team_count,
        count(distinct division_ranked.division) as tied_division_count
    from division_ranked
    group by
        division_ranked.season,
        division_ranked.conference,
        division_ranked.exact_win_pct
),

-- The first two criteria swap places between a two-team and a larger tie.
tiebreak_keys as (
    select
        division_ranked.*,
        case
            when conference_ties.tied_team_count = 2 then division_ranked.conference_tied_win_pct
            else (division_ranked.division_rank = 1)::int::numeric
        end as first_tiebreak,
        case
            when conference_ties.tied_team_count = 2 then (division_ranked.division_rank = 1)::int::numeric
            else division_ranked.conference_tied_win_pct
        end as second_tiebreak,
        case
            when conference_ties.tied_division_count = 1 then division_ranked.division_win_pct
        end as division_tiebreak
    from division_ranked
    inner join conference_ties
        on division_ranked.season = conference_ties.season
        and division_ranked.conference = conference_ties.conference
        and division_ranked.exact_win_pct is not distinct from conference_ties.exact_win_pct
),

conference_ranked as (
    select
        tiebreak_keys.*,
        row_number() over conference_order as derived_conference_rank,
        first_value(tiebreak_keys.wins) over conference_order as leader_wins,
        first_value(tiebreak_keys.losses) over conference_order as leader_losses
    from tiebreak_keys
    window conference_order as (
        partition by tiebreak_keys.season, tiebreak_keys.conference
        order by
            tiebreak_keys.exact_win_pct desc nulls last,
            tiebreak_keys.first_tiebreak desc nulls last,
            tiebreak_keys.second_tiebreak desc nulls last,
            tiebreak_keys.division_tiebreak desc nulls last,
            tiebreak_keys.conference_win_pct desc nulls last,
            tiebreak_keys.point_differential desc nulls last,
            tiebreak_keys.team_name asc
    )
)

select
    conference_ranked.team_id,
    conference_ranked.abbreviation,
    conference_ranked.team_name,
    conference_ranked.city,
    conference_ranked.nickname,
    conference_ranked.season,
    conference_ranked.season_type,
    conference_ranked.as_of_date,
    conference_ranked.conference,
    conference_ranked.division,
    coalesce(conference_ranked.scraped_conference_rank, conference_ranked.derived_conference_rank)
        as conference_rank,
    conference_ranked.division_rank,
    conference_ranked.wins,
    conference_ranked.losses,
    conference_ranked.win_pct,
    -- The source leaves games_back empty for a conference leader.
    coalesce(
        conference_ranked.scraped_games_back,
        (
            (conference_ranked.leader_wins - conference_ranked.wins)
            + (conference_ranked.losses - conference_ranked.leader_losses)
        ) / 2.0
    ) as games_back,
    conference_ranked.streak,
    conference_ranked.last_10,
    conference_ranked.division_wins,
    conference_ranked.division_losses,
    conference_ranked.conference_wins,
    conference_ranked.conference_losses,
    conference_ranked.point_differential,
    conference_ranked.record_source
from conference_ranked
