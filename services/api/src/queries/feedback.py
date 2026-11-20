from sqlalchemy import text

from queries.account import USAGE_DAY

FEEDBACK_COLUMNS = """
    feedback.feedback_id,
    feedback.kind,
    feedback.message,
    feedback.reply_email,
    feedback.page_path,
    feedback.user_id IS NOT NULL AS signed_in,
    feedback.created_at,
    feedback.resolved_at
"""

# Held until the insert commits (or the request's session rolls back), so two
# sends at once cannot both pass the limit checks. Volume is tiny, so one lock
# for the whole table costs nothing.
LOCK_FEEDBACK_LIMITS = text("SELECT pg_advisory_xact_lock(hashtext('source.feedback'))")

COUNT_FEEDBACK_FROM_IP_LAST_HOUR = text(
    """
    SELECT count(*)
    FROM source.feedback
    WHERE
        feedback.ip_hash = :ip_hash
        AND feedback.created_at > NOW() - INTERVAL '1 hour'
    """
)

# The same Eastern day the chat budget uses, so every daily limit turns over together.
COUNT_FEEDBACK_TODAY = text(
    f"""
    SELECT count(*)
    FROM source.feedback
    WHERE (feedback.created_at AT TIME ZONE 'America/New_York')::date = {USAGE_DAY}
    """
)

INSERT_FEEDBACK = text(
    f"""
    INSERT INTO source.feedback (kind, message, reply_email, page_path, user_id, ip_hash)
    VALUES (:kind, :message, :reply_email, :page_path, :user_id, :ip_hash)
    RETURNING
        {FEEDBACK_COLUMNS}
    """
)

LIST_FEEDBACK = text(
    f"""
    SELECT
        {FEEDBACK_COLUMNS}
    FROM source.feedback
    WHERE
        :include_resolved
        OR feedback.resolved_at IS NULL
    ORDER BY
        feedback.resolved_at IS NOT NULL,
        feedback.created_at DESC
    LIMIT :limit
    OFFSET :offset
    """
)

COUNT_FEEDBACK = text(
    """
    SELECT count(*)
    FROM source.feedback
    WHERE
        :include_resolved
        OR feedback.resolved_at IS NULL
    """
)

# Resolving twice keeps the first time; reopening clears it.
SET_FEEDBACK_RESOLVED = text(
    f"""
    UPDATE source.feedback
    SET resolved_at = CASE
        WHEN :resolved THEN coalesce(feedback.resolved_at, NOW())
    END
    WHERE feedback.feedback_id = :feedback_id
    RETURNING
        {FEEDBACK_COLUMNS}
    """
)
