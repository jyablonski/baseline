with players as (
    select * from {{ ref('stg_players') }}
),

player_game_logs as (
    select * from {{ ref('int_player_game_logs_enriched') }}
),

matched_contracts as (
    select * from {{ ref('int_player_contracts_matched') }}
),

career_stats as (
    select
        player_game_logs.player_id,
        count(*) as career_games_played,
        min(player_game_logs.game_date) as first_game_date,
        max(player_game_logs.game_date) as last_game_date,
        count(distinct player_game_logs.season) as seasons_played,
        min(player_game_logs.season) as first_season,
        max(player_game_logs.season) as last_season,
        round(avg(player_game_logs.points)::numeric, 1) as career_ppg,
        round(avg(player_game_logs.rebounds)::numeric, 1) as career_rpg,
        round(avg(player_game_logs.assists)::numeric, 1) as career_apg
    from player_game_logs
    group by player_game_logs.player_id
),

current_contract_season as (
    select min(matched_contracts.season) as season
    from matched_contracts
),

current_player_contracts as (
    select
        matched_contracts.player_id,
        min(matched_contracts.season) as current_contract_season,
        min(matched_contracts.team_id::text)::uuid as current_contract_team_id,
        sum(matched_contracts.salary) as current_season_salary,
        max(matched_contracts.remaining_guaranteed) as current_remaining_guaranteed
    from matched_contracts
    inner join current_contract_season
        on matched_contracts.season = current_contract_season.season
    where matched_contracts.player_id is not null
    group by matched_contracts.player_id
)

select
    players.player_id,
    players.first_name,
    players.last_name,
    players.full_name,
    unaccent(players.full_name) as full_name_ascii,
    players.is_active,
    players.jersey_number,
    players.position,
    players.height,
    players.weight,
    players.birth_date,
    players.team_id,
    players.from_year,
    players.to_year,
    career_stats.first_game_date,
    career_stats.last_game_date,
    career_stats.first_season,
    career_stats.last_season,
    career_stats.career_ppg,
    career_stats.career_rpg,
    career_stats.career_apg,
    current_player_contracts.current_contract_season,
    current_player_contracts.current_contract_team_id,
    current_player_contracts.current_season_salary,
    current_player_contracts.current_remaining_guaranteed,
    coalesce(career_stats.career_games_played, 0) as career_games_played,
    coalesce(career_stats.seasons_played, 0) as seasons_played
from players
left join career_stats
    on players.player_id = career_stats.player_id
left join current_player_contracts
    on players.player_id = current_player_contracts.player_id
