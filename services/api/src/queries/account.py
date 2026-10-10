"""SQL for accounts, the chat ledger, picks, and feature flags.

These source tables are written by the API, not scraped. Picks are joined to
gold here for locking and grading; nothing flows the other way.
"""

from __future__ import annotations

from sqlalchemy import text

# The quota day rolls over at midnight Eastern, like the rest of the app.
USAGE_DAY = "(NOW() AT TIME ZONE 'America/New_York')::date"

# A pending row left behind by a crashed request would hold the user's single
# in-flight slot forever.
PENDING_TIMEOUT = "INTERVAL '5 minutes'"

USER_COLUMNS = """
    users.user_id,
    users.provider,
    users.display_name,
    users.status,
    users.timezone,
    users.created_at,
    users.last_seen_at
"""

UPSERT_USER = text(
    f"""
    INSERT INTO source.users (provider, provider_subject, display_name)
    VALUES (:provider, :provider_subject, :display_name)
    ON CONFLICT (provider, provider_subject) DO UPDATE
    SET
        display_name = EXCLUDED.display_name,
        last_seen_at = NOW()
    RETURNING
        {USER_COLUMNS}
    """
)

GET_USER = text(
    f"""
    SELECT
        {USER_COLUMNS}
    FROM source.users
    WHERE users.user_id = :user_id
    """
)

SET_USER_TIMEZONE = text(
    f"""
    UPDATE source.users
    SET timezone = :timezone
    WHERE users.user_id = :user_id
    RETURNING
        {USER_COLUMNS}
    """
)

DELETE_USER = text("DELETE FROM source.users WHERE users.user_id = :user_id")

EXPIRE_STALE_CHAT = text(
    f"""
    UPDATE source.chat_usage
    SET outcome = 'errored'
    WHERE
        chat_usage.user_id = :user_id
        AND chat_usage.outcome = 'pending'
        AND chat_usage.asked_at < NOW() - {PENDING_TIMEOUT}
    """
)

# Check and reserve in one statement: the row is only inserted while the day's
# count is under the limit. The single-pending unique index covers the gap two
# simultaneous requests would otherwise slip through.
RESERVE_CHAT = text(
    f"""
    INSERT INTO source.chat_usage (user_id, usage_day)
    SELECT
        :user_id,
        {USAGE_DAY}
    WHERE (
        SELECT count(*)
        FROM source.chat_usage
        WHERE
            chat_usage.user_id = :user_id
            AND chat_usage.usage_day = {USAGE_DAY}
    ) < :daily_limit
    RETURNING usage_id
    """
)

SETTLE_CHAT = text(
    """
    UPDATE source.chat_usage
    SET
        outcome = :outcome,
        backend = :backend,
        model = :model,
        input_tokens = :input_tokens,
        output_tokens = :output_tokens,
        tool_rounds = :tool_rounds,
        latency_ms = :latency_ms
    WHERE chat_usage.usage_id = :usage_id
    """
)

COUNT_CHAT_TODAY = text(
    f"""
    SELECT count(*)
    FROM source.chat_usage
    WHERE
        chat_usage.user_id = :user_id
        AND chat_usage.usage_day = {USAGE_DAY}
    """
)

COUNT_LLM_CHAT_TODAY = text(
    f"""
    SELECT count(*)
    FROM source.chat_usage
    WHERE
        chat_usage.backend = 'llm'
        AND chat_usage.usage_day = {USAGE_DAY}
    """
)

# Consensus price per side, the same way the schedule builds it: average the
# vigged implied probability across books, then convert back in the repository.
PICK_GAME = text(
    """
    WITH moneyline_odds AS (
        SELECT
            fct_game_odds.game_id,
            avg(fct_game_odds.home_implied_wp) AS home_implied_wp,
            avg(fct_game_odds.away_implied_wp) AS away_implied_wp
        FROM gold.fct_game_odds
        WHERE
            fct_game_odds.market = 'h2h'
            AND fct_game_odds.game_id = :game_id
        GROUP BY fct_game_odds.game_id
    )

    SELECT
        fct_games_schedule.game_id,
        fct_games_schedule.home_team_id,
        fct_games_schedule.away_team_id,
        -- With no tip time on file the lock falls back to the start of game
        -- day: early, but a pick can never be made after the result is known.
        (
            fct_games_schedule.status <> 'Scheduled'
            OR (
                fct_games_schedule.game_date
                + coalesce(fct_games_schedule.start_time_et, TIME '00:00')
            ) AT TIME ZONE 'America/New_York' <= NOW()
        ) AS is_locked,
        moneyline_odds.home_implied_wp,
        moneyline_odds.away_implied_wp
    FROM gold.fct_games_schedule
    LEFT JOIN moneyline_odds
        ON moneyline_odds.game_id = fct_games_schedule.game_id
    WHERE fct_games_schedule.game_id = :game_id
    """
)

PICK_COLUMNS = """
    picks.game_id,
    picks.picked_team_id,
    picks.stake,
    picks.moneyline,
    picks.created_at,
    picks.updated_at
"""

UPSERT_PICK = text(
    """
    INSERT INTO source.picks (user_id, game_id, picked_team_id, stake, moneyline)
    VALUES (:user_id, :game_id, :picked_team_id, :stake, :moneyline)
    ON CONFLICT (user_id, game_id) DO UPDATE
    SET
        picked_team_id = EXCLUDED.picked_team_id,
        stake = EXCLUDED.stake,
        moneyline = EXCLUDED.moneyline,
        updated_at = NOW()
    """
)

DELETE_PICK = text(
    """
    DELETE FROM source.picks
    WHERE
        picks.user_id = :user_id
        AND picks.game_id = :game_id
    """
)

# Graded at read time from gold rather than stored: 'void' is a game that left
# the schedule, which counts for nothing and returns its stake.
LIST_PICKS = text(
    f"""
    SELECT
        {PICK_COLUMNS},
        fct_games_schedule.game_date,
        fct_games_schedule.start_time_et,
        fct_games_schedule.status AS game_status,
        fct_games_schedule.home_team_id,
        fct_games_schedule.home_team_abbreviation,
        fct_games_schedule.home_score,
        fct_games_schedule.away_team_id,
        fct_games_schedule.away_team_abbreviation,
        fct_games_schedule.away_score,
        CASE
            WHEN fct_games_schedule.game_id IS NULL THEN 'void'
            WHEN
                fct_games_schedule.status <> 'Final'
                OR fct_games_schedule.home_score IS NULL
                OR fct_games_schedule.away_score IS NULL
                THEN 'pending'
            WHEN
                picks.picked_team_id = CASE
                    WHEN fct_games_schedule.home_score > fct_games_schedule.away_score
                        THEN fct_games_schedule.home_team_id
                    ELSE fct_games_schedule.away_team_id
                END
                THEN 'won'
            ELSE 'lost'
        END AS result,
        -- Whether the champion model's favourite won. Null until the game is
        -- final, and for games the model never scored.
        CASE
            WHEN
                fct_games_schedule.status = 'Final'
                AND fct_games_schedule.home_score IS NOT NULL
                AND fct_games_schedule.away_score IS NOT NULL
                THEN (fct_game_predictions.model_wp >= 0.5)
                = (fct_games_schedule.home_score > fct_games_schedule.away_score)
        END AS model_correct
    FROM source.picks
    LEFT JOIN gold.fct_games_schedule
        ON fct_games_schedule.game_id = picks.game_id
    -- One row per game: the mart keeps only the champion model's latest as_of.
    LEFT JOIN gold.fct_game_predictions
        ON fct_game_predictions.game_id = picks.game_id
    WHERE picks.user_id = :user_id
    ORDER BY
        fct_games_schedule.game_date DESC NULLS LAST,
        picks.created_at DESC
    """
)

LIST_FLAGS = text(
    """
    SELECT
        feature_flags.flag_key,
        feature_flags.enabled,
        feature_flags.description,
        feature_flags.updated_at,
        feature_flags.updated_by
    FROM source.feature_flags
    ORDER BY feature_flags.flag_key
    """
)

SET_FLAG = text(
    """
    UPDATE source.feature_flags
    SET
        enabled = :enabled,
        updated_at = NOW(),
        updated_by = :updated_by
    WHERE feature_flags.flag_key = :flag_key
    RETURNING
        flag_key,
        enabled,
        description,
        updated_at,
        updated_by
    """
)

FLAG_ENABLED = text(
    """
    SELECT feature_flags.enabled
    FROM source.feature_flags
    WHERE feature_flags.flag_key = :flag_key
    """
)
