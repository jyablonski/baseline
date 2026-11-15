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

# Only teams can be followed so far; the table also allows players.
LIST_FOLLOWS = text(
    """
    SELECT
        user_follows.entity_type,
        user_follows.entity_id,
        dim_teams.team_name AS name,
        dim_teams.abbreviation,
        user_follows.created_at
    FROM source.user_follows
    LEFT JOIN gold.dim_teams
        ON
            dim_teams.team_id = user_follows.entity_id
            AND user_follows.entity_type = 'team'
    WHERE user_follows.user_id = :user_id
    ORDER BY
        user_follows.position,
        user_follows.created_at
    """
)

TEAM_EXISTS = text(
    """
    SELECT count(*) > 0
    FROM gold.dim_teams
    WHERE dim_teams.team_id = :entity_id
    """
)

# Check the cap and insert in one statement. No row back means either the cap
# is reached or it was already followed; the repository tells the two apart.
# The cap is soft: unlike RESERVE_CHAT there is no index behind it, so two
# follows sent at the same moment at the cap can both land. It only limits
# clutter, so that is not worth a lock.
ADD_FOLLOW = text(
    """
    INSERT INTO source.user_follows (user_id, entity_type, entity_id, position)
    SELECT
        :user_id,
        :entity_type,
        :entity_id,
        (
            SELECT coalesce(max(user_follows.position) + 1, 0)
            FROM source.user_follows
            WHERE
                user_follows.user_id = :user_id
                AND user_follows.entity_type = :entity_type
        )
    WHERE (
        SELECT count(*)
        FROM source.user_follows
        WHERE
            user_follows.user_id = :user_id
            AND user_follows.entity_type = :entity_type
    ) < :max_follows
    ON CONFLICT (user_id, entity_type, entity_id) DO NOTHING
    RETURNING entity_id
    """
)

IS_FOLLOWING = text(
    """
    SELECT count(*) > 0
    FROM source.user_follows
    WHERE
        user_follows.user_id = :user_id
        AND user_follows.entity_type = :entity_type
        AND user_follows.entity_id = :entity_id
    """
)

# The new order is the full list of ids, first to last. Ids the account does
# not follow match no row; the repository checks the list first.
REORDER_FOLLOWS = text(
    """
    UPDATE source.user_follows
    SET position = new_order.position - 1
    FROM unnest(CAST(:entity_ids AS uuid[])) WITH ORDINALITY AS new_order (entity_id, position)
    WHERE
        user_follows.user_id = :user_id
        AND user_follows.entity_type = :entity_type
        AND user_follows.entity_id = new_order.entity_id
    """
)

DELETE_FOLLOW = text(
    """
    DELETE FROM source.user_follows
    WHERE
        user_follows.user_id = :user_id
        AND user_follows.entity_type = :entity_type
        AND user_follows.entity_id = :entity_id
    """
)

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
#
# market_wp is the picked side's no-vig consensus from the line fct_game_odds
# keeps for each game, the last pregame pull once it has tipped. Not derived
# from picks.moneyline: that is one vigged side, which can't be de-vigged alone.
LIST_PICKS = text(
    f"""
    WITH market_lines AS (
        SELECT
            fct_game_odds.game_id,
            avg(fct_game_odds.home_market_wp) AS home_market_wp
        FROM gold.fct_game_odds
        WHERE
            fct_game_odds.market = 'h2h'
            AND fct_game_odds.game_id IN (
                SELECT picks.game_id
                FROM source.picks
                WHERE picks.user_id = :user_id
            )
        GROUP BY fct_game_odds.game_id
    )

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
        END AS model_correct,
        -- Null when the game had no captured pregame line, so it can't be graded as one.
        fct_game_upsets.is_upset,
        CASE
            WHEN fct_games_schedule.game_id IS NULL THEN NULL
            WHEN picks.picked_team_id = fct_games_schedule.home_team_id
                THEN market_lines.home_market_wp
            ELSE 1 - market_lines.home_market_wp
        END AS market_wp
    FROM source.picks
    LEFT JOIN gold.fct_games_schedule
        ON fct_games_schedule.game_id = picks.game_id
    LEFT JOIN market_lines
        ON market_lines.game_id = picks.game_id
    -- One row per game: the mart keeps only the champion model's latest as_of.
    LEFT JOIN gold.fct_game_predictions
        ON fct_game_predictions.game_id = picks.game_id
    LEFT JOIN gold.fct_game_upsets
        ON fct_game_upsets.game_id = picks.game_id
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
