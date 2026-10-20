-- Final playoff seeding, which is not the same thing as the standings.
-- Regular-season standings rank by record; the play-in tournament then decides
-- seeds 7-10, so a team can finish ahead of a better record (POR 42-40 seeded
-- 7th over PHX 45-37 in 2025-26).
--
-- Bracket, per conference:
--   A: record 7 vs record 8   -> winner takes seed 7, loser drops to game C
--   B: record 9 vs record 10  -> loser is eliminated and holds seed 10
--   C: loser(A) vs winner(B)  -> winner takes seed 8, loser holds seed 9
-- Seeds 1-6 are locked on record. Nothing is emitted for a conference until all
-- three of its play-in games are final, so a mid-season run yields no seeds.
with play_in_games as (
    select * from {{ ref('fct_team_game_results') }}
    where season_type = 'PlayIn'
),

-- Record ranks from scraped standings, or derived with NBA tiebreakers for a
-- season the scraper has not reached.
standings as (
    select * from {{ ref('int_standings_records') }}
),

home_standings as (
    select
        standings.team_id,
        standings.season,
        standings.conference,
        standings.conference_rank
    from standings
),

away_standings as (
    select
        standings.team_id,
        standings.season,
        standings.conference,
        standings.conference_rank
    from standings
),

matchups as (
    select
        play_in_games.game_id,
        play_in_games.season,
        home_standings.conference,
        play_in_games.winning_team_id,
        case
            when play_in_games.winning_team_id = play_in_games.home_team_id
                then play_in_games.away_team_id
            else play_in_games.home_team_id
        end as losing_team_id,
        least(home_standings.conference_rank, away_standings.conference_rank) as better_rank,
        greatest(home_standings.conference_rank, away_standings.conference_rank) as worse_rank
    from play_in_games
    inner join home_standings
        on play_in_games.home_team_id = home_standings.team_id
        and play_in_games.season = home_standings.season
    inner join away_standings
        on play_in_games.away_team_id = away_standings.team_id
        and play_in_games.season = away_standings.season
),

-- The 7/8 and 9/10 games are identifiable by their participants' record ranks;
-- whatever is left in the conference is the deciding 8-seed game.
classified as (
    select
        matchups.season,
        matchups.conference,
        matchups.winning_team_id,
        matchups.losing_team_id,
        case
            when matchups.better_rank = 7 and matchups.worse_rank = 8 then 'seven_eight'
            when matchups.better_rank = 9 and matchups.worse_rank = 10 then 'nine_ten'
            else 'eight_nine'
        end as bracket_game
    from matchups
),

complete_conferences as (
    select
        classified.season,
        classified.conference
    from classified
    group by classified.season, classified.conference
    having count(distinct classified.bracket_game) = 3
),

play_in_seeds as (
    select classified.season, classified.conference, classified.winning_team_id as team_id, 7 as playoff_seed
    from classified
    where classified.bracket_game = 'seven_eight'

    union all

    select classified.season, classified.conference, classified.losing_team_id, 10
    from classified
    where classified.bracket_game = 'nine_ten'

    union all

    select classified.season, classified.conference, classified.winning_team_id, 8
    from classified
    where classified.bracket_game = 'eight_nine'

    union all

    select classified.season, classified.conference, classified.losing_team_id, 9
    from classified
    where classified.bracket_game = 'eight_nine'
),

locked_seeds as (
    select
        standings.season,
        standings.conference,
        standings.team_id,
        standings.conference_rank as playoff_seed
    from standings
    where standings.conference_rank <= 6
)

select
    locked_seeds.season,
    locked_seeds.conference,
    locked_seeds.team_id,
    locked_seeds.playoff_seed
from locked_seeds
inner join complete_conferences
    on locked_seeds.season = complete_conferences.season
    and locked_seeds.conference = complete_conferences.conference

union all

select
    play_in_seeds.season,
    play_in_seeds.conference,
    play_in_seeds.team_id,
    play_in_seeds.playoff_seed
from play_in_seeds
inner join complete_conferences
    on play_in_seeds.season = complete_conferences.season
    and play_in_seeds.conference = complete_conferences.conference
