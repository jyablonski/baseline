"""SQL against gold.fct_transactions and gold.fct_transaction_participants."""

from __future__ import annotations

from sqlalchemy import text

# Participants arrive as arrays rather than a second round trip per row: the
# grain is one transaction, and the UI always wants both sides together.
PARTICIPANT_ROLLUP = """
    SELECT
        array_agg(
            participants.display_name ORDER BY participants.direction, participants.display_name
        ) FILTER (WHERE participants.participant_type = 'team') AS team_names,
        array_agg(
            participants.team_abbreviation
            ORDER BY participants.direction, participants.display_name
        ) FILTER (
            WHERE participants.participant_type = 'team'
              AND participants.team_abbreviation IS NOT NULL
        ) AS team_abbreviations,
        array_agg(
            participants.display_name ORDER BY participants.display_name
        ) FILTER (WHERE participants.participant_type = 'player') AS player_names,
        -- Baseline's own name for each player matched to a UUID: the only ones
        -- a player page can be found by.
        array_agg(
            participants.player_name ORDER BY participants.player_name
        ) FILTER (
            WHERE participants.participant_type = 'player'
              AND participants.player_id IS NOT NULL
              AND participants.player_name IS NOT NULL
        ) AS linked_player_names
    FROM gold.fct_transaction_participants AS participants
    WHERE participants.transaction_key = transactions.transaction_key
"""

TRANSACTIONS_FILTER = """
    WHERE
        (:season IS NULL OR transactions.season = :season)
      AND (:search IS NULL OR transactions.description ILIKE :search)
      AND (
            :team_abbreviation IS NULL
            OR EXISTS (
                SELECT 1
                FROM gold.fct_transaction_participants AS team_filter
                WHERE team_filter.transaction_key = transactions.transaction_key
                  AND team_filter.team_abbreviation = :team_abbreviation
            )
        )
      AND (
            :player_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM gold.fct_transaction_participants AS player_filter
                WHERE player_filter.transaction_key = transactions.transaction_key
                  AND player_filter.player_id = CAST(:player_id AS uuid)
            )
        )
"""

LIST_TRANSACTIONS = text(
    f"""
    SELECT
        transactions.transaction_key,
        transactions.transaction_date,
        transactions.season,
        transactions.description,
        transactions.team_count,
        transactions.player_count,
        transactions.source_url,
        coalesce(rollup.team_names, ARRAY[]::text[]) AS team_names,
        coalesce(rollup.team_abbreviations, ARRAY[]::text[]) AS team_abbreviations,
        coalesce(rollup.player_names, ARRAY[]::text[]) AS player_names,
        coalesce(rollup.linked_player_names, ARRAY[]::text[]) AS linked_player_names
    FROM gold.fct_transactions AS transactions
    LEFT JOIN LATERAL ({PARTICIPANT_ROLLUP}) AS rollup ON TRUE
    {TRANSACTIONS_FILTER}
    ORDER BY
        transactions.transaction_date DESC,
        transactions.transaction_key
    LIMIT :limit OFFSET :offset
    """
)

# No rollup join: counting transactions cannot be changed by a per-row lateral.
LIST_TRANSACTIONS_COUNT = text(
    f"""
    SELECT count(*) AS total
    FROM gold.fct_transactions AS transactions
    {TRANSACTIONS_FILTER}
    """
)

LIST_TRANSACTION_PARTICIPANTS = text(
    """
    SELECT
        participants.transaction_key,
        participants.transaction_date,
        participants.season,
        participants.participant_type,
        participants.direction,
        participants.display_name,
        participants.bref_slug,
        participants.player_id,
        participants.team_id,
        participants.team_abbreviation,
        participants.player_name,
        participants.match_method
    FROM gold.fct_transaction_participants AS participants
    WHERE participants.transaction_key = :transaction_key
    ORDER BY
        participants.participant_type,
        participants.direction,
        participants.display_name
    """
)

GET_TRANSACTION = text(
    f"""
    SELECT
        transactions.transaction_key,
        transactions.transaction_date,
        transactions.season,
        transactions.description,
        transactions.team_count,
        transactions.player_count,
        transactions.source_url,
        coalesce(rollup.team_names, ARRAY[]::text[]) AS team_names,
        coalesce(rollup.team_abbreviations, ARRAY[]::text[]) AS team_abbreviations,
        coalesce(rollup.player_names, ARRAY[]::text[]) AS player_names,
        coalesce(rollup.linked_player_names, ARRAY[]::text[]) AS linked_player_names
    FROM gold.fct_transactions AS transactions
    LEFT JOIN LATERAL ({PARTICIPANT_ROLLUP}) AS rollup ON TRUE
    WHERE transactions.transaction_key = :transaction_key
    """
)

LIST_TRANSACTION_SEASONS = text(
    """
    SELECT DISTINCT transactions.season
    FROM gold.fct_transactions AS transactions
    ORDER BY transactions.season DESC
    """
)
