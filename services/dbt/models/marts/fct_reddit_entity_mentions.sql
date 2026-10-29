with documents as (
    select * from {{ ref('int_reddit_documents') }}
),

players as (
    select * from {{ ref('dim_players') }}
),

teams as (
    select * from {{ ref('dim_teams') }}
),

team_aliases as (
    select * from {{ ref('nba_team_aliases') }}
),

-- Full name only. dim_players covers current players, so a single-token rule
-- would read "Jordan" as DeAndre Jordan and "Bryant" as Thomas Bryant on the
-- r/nba nostalgia posts that actually mean Michael Jordan and Kobe Bryant — the
-- dimension cannot rule out a collision with somebody it does not contain.
player_needles as (
    select
        'player' as entity_type,
        players.player_id as entity_id,
        players.full_name as entity_name,
        cast(null as varchar) as entity_abbreviation,
        'full_name' as match_method,
        1 as match_priority,
        concat(' ', {{ normalize_player_name('players.full_name') }}, ' ') as needle
    from players
    where
        players.full_name is not null
        and length({{ normalize_player_name('players.full_name') }}) > 0
),

team_name_needles as (
    select
        'team' as entity_type,
        teams.team_id as entity_id,
        teams.team_name as entity_name,
        teams.abbreviation as entity_abbreviation,
        'team_name' as match_method,
        1 as match_priority,
        concat(' ', {{ normalize_player_name('teams.team_name') }}, ' ') as needle
    from teams
    where teams.team_name is not null
),

team_nickname_needles as (
    select
        'team' as entity_type,
        teams.team_id as entity_id,
        teams.team_name as entity_name,
        teams.abbreviation as entity_abbreviation,
        'nickname' as match_method,
        2 as match_priority,
        concat(' ', {{ normalize_player_name('teams.nickname') }}, ' ') as needle
    from teams
    where teams.nickname is not null
),

team_alias_needles as (
    select
        'team' as entity_type,
        teams.team_id as entity_id,
        teams.team_name as entity_name,
        teams.abbreviation as entity_abbreviation,
        'alias' as match_method,
        3 as match_priority,
        concat(' ', {{ normalize_player_name('team_aliases.alias') }}, ' ') as needle
    from team_aliases
    inner join teams
        on teams.team_id = team_aliases.team_id::uuid
),

needles as (
    select * from player_needles
    union all
    select * from team_name_needles
    union all
    select * from team_nickname_needles
    union all
    select * from team_alias_needles
),

-- Nested loop over (documents x needles). No index helps a substring predicate,
-- but both sides are small: one day is ~40 posts and ~400 comments against ~800
-- needles.
matches as (
    select
        needles.entity_type,
        needles.entity_id,
        needles.entity_name,
        needles.entity_abbreviation,
        needles.match_method,
        needles.match_priority,
        documents.document_type,
        documents.document_reddit_id,
        documents.post_reddit_id,
        documents.created_utc
    from documents
    inner join needles
        on strpos(documents.search_text, needles.needle) > 0
),

-- A team matches its full name, nickname and alias at once; keep the most
-- specific so the grain is one mention per entity per document.
ranked as (
    select
        matches.*,
        row_number() over (
            partition by
                matches.entity_type,
                matches.entity_id,
                matches.document_reddit_id
            order by matches.match_priority
        ) as match_rank
    from matches
)

select
    ranked.entity_type,
    ranked.entity_id,
    ranked.entity_name,
    ranked.entity_abbreviation,
    ranked.match_method,
    ranked.document_type,
    ranked.document_reddit_id,
    ranked.post_reddit_id,
    ranked.created_utc
from ranked
where ranked.match_rank = 1
