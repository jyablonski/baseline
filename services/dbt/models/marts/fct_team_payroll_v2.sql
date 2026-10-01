-- this is just a test model to practice dbt versioning

with payroll as (
    select * from {{ ref('stg_team_payroll') }}
),

cba_caps as (
    select * from {{ ref('nba_cba_caps') }}
)

select
    payroll.team_id,
    teams.abbreviation,
    teams.team_name,
    payroll.season,
    payroll.total_salary,
    payroll.remaining_guaranteed,
    cba_caps.salary_cap,
    cba_caps.luxury_tax,
    cba_caps.first_apron,
    cba_caps.second_apron,
    cba_caps.luxury_tax - payroll.total_salary as luxury_tax_room,
    -- Highest threshold crossed wins; v1 exposed these as three overlapping booleans.
    case
        when payroll.total_salary is null or cba_caps.salary_cap is null then null
        when payroll.total_salary > cba_caps.second_apron then 'over_second_apron'
        when payroll.total_salary > cba_caps.first_apron then 'over_first_apron'
        when payroll.total_salary > cba_caps.luxury_tax then 'over_luxury_tax'
        when payroll.total_salary > cba_caps.salary_cap then 'over_cap'
        else 'under_cap'
    end as cap_status
from payroll
left join cba_caps
    on payroll.season = cba_caps.season
left join {{ ref('stg_teams') }} as teams
    on payroll.team_id = teams.team_id
