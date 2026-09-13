with source as (
    select * from {{ source('source', 'players') }}
)

select
    player_id,
    first_name,
    last_name,
    full_name,
    is_active,
    jersey_number,
    -- Basketball-Reference rosters show PG/SG/SF/PF/C but sort the column on a
    -- 1-5 key, which an older scrape stored instead of the label. Older rosters
    -- use G / F / C and hybrids. Anything unrecognised passes through as-is.
    case upper(btrim(position))
        when '1' then 'Point Guard'
        when 'PG' then 'Point Guard'
        when '2' then 'Shooting Guard'
        when 'SG' then 'Shooting Guard'
        when '3' then 'Small Forward'
        when 'SF' then 'Small Forward'
        when '4' then 'Power Forward'
        when 'PF' then 'Power Forward'
        when '5' then 'Center'
        when 'C' then 'Center'
        when 'G' then 'Guard'
        when 'F' then 'Forward'
        when 'G-F' then 'Guard-Forward'
        when 'F-G' then 'Forward-Guard'
        when 'F-C' then 'Forward-Center'
        when 'C-F' then 'Center-Forward'
        else nullif(btrim(position), '')
    end as position,
    height,
    weight,
    birth_date,
    team_id,
    from_year,
    to_year
from source
