"""SQL against gold.fct_reddit_posts and gold.fct_reddit_comments.

Grain is one row per post: the scraper upserts on reddit_id and overwrites every
non-key column, so score and num_comments are the latest snapshot rather than a
series. Only the top 10 comments per post are stored, so every comment aggregate
here describes that sample; num_comments is the real Reddit total and is always
the larger number.
"""

from __future__ import annotations

from sqlalchemy import text

# Reddit reports a floor, not a measurement: across the first 169 posts collected
# there are 23 posts at exactly 0 and no negative scores, and 21 of those 23 were
# over a day old when scraped — so 0 is not a score still waiting to be revealed.
# A post pinned at the floor with a crowded comment section is being argued over.
# Only 9 posts in that sample sit between 1 and 25, so the score bound is close to
# a no-op and the comment floor does the real filtering.
CONTESTED_MAX_SCORE = 25
CONTESTED_MIN_COMMENTS = 50

# flair is null on ~85% of posts; the usable taxonomy is the leading bracket in
# the title — "[Highlight]", "[Charania]", "[PTFO]".
POST_TAG = r"substring(btrim(posts.title) from '^\[([^\]]{1,60})\]')"

# Non-capturing groups are deliberately avoided: SQLAlchemy's text() reads the
# ":https" in "(?:https?" as a bind parameter.
POST_SOURCE = r"""
    CASE
        WHEN posts.is_self THEN 'self'
        WHEN nullif(btrim(coalesce(posts.url, '')), '') IS NULL THEN NULL
        ELSE lower(
            regexp_replace(btrim(posts.url), '^(https?://)?(www\.)?([^/?#]+).*$', '\3')
        )
    END
"""

# Four buckets the feed can filter on. A bracket tag is the strongest signal we
# have; below that, self-post versus link-post is the only split left.
POST_CONTENT_TYPE = f"""
    CASE
        WHEN {POST_TAG} ILIKE 'highlight%' OR {POST_TAG} ILIKE 'lowlight%' THEN 'highlight'
        WHEN {POST_TAG} IS NOT NULL THEN 'report'
        WHEN posts.is_self THEN 'discussion'
        ELSE 'link'
    END
"""

CONTENT_TYPES = ("highlight", "report", "discussion", "link")

IS_CONTESTED = f"""
    (posts.score <= {CONTESTED_MAX_SCORE} AND posts.num_comments >= {CONTESTED_MIN_COMMENTS})
"""

# Comments per upvote with the score floored at 1. The floor is deliberate here and
# not below: this is the feed's sort key, so a null at score 0 would drop exactly the
# contested posts it exists to surface, and the floored value stays monotonic in
# comment count. The two score-against-score ratios use nullif instead — dividing
# one score by a zero score is meaningless rather than merely floored.
DISCUSSION_RATIO = "round(posts.num_comments::numeric / greatest(posts.score, 1), 3)"
TOP_COMMENT_LEVERAGE = "round(comments.top_comment_score::numeric / nullif(posts.score, 0), 3)"

# Correlated, not a standalone GROUP BY joined on afterwards: an uncorrelated
# rollup makes Postgres aggregate the whole comment table even to serve one post.
COMMENT_ROLLUP = """
    SELECT
        count(*) AS captured_comment_count,
        max(post_comments.score) AS top_comment_score,
        sum(post_comments.score) AS captured_comment_score
    FROM gold.fct_reddit_comments AS post_comments
    WHERE post_comments.post_reddit_id = posts.reddit_id
"""

# Names per post, ordered by how often the post and its captured comments say
# them. array_agg keeps this one round trip instead of a second query per row.
MENTION_ROLLUP = """
    SELECT
        array_agg(counted.entity_name ORDER BY counted.mentions DESC, counted.entity_name)
            FILTER (WHERE counted.entity_type = 'player') AS player_mentions,
        array_agg(counted.entity_name ORDER BY counted.mentions DESC, counted.entity_name)
            FILTER (WHERE counted.entity_type = 'team') AS team_mentions
    FROM (
        SELECT
            post_mentions.entity_type,
            post_mentions.entity_name,
            count(*) AS mentions
        FROM gold.fct_reddit_entity_mentions AS post_mentions
        WHERE post_mentions.post_reddit_id = posts.reddit_id
        GROUP BY post_mentions.entity_type, post_mentions.entity_name
    ) AS counted
"""

# LEFT JOIN LATERAL … ON TRUE: an aggregate with no GROUP BY always yields one
# row, so a post with no comments or no mentions still comes back, with nulls.
POST_ROW_JOINS = f"""
    LEFT JOIN LATERAL ({COMMENT_ROLLUP}) AS comments ON TRUE
    LEFT JOIN LATERAL ({MENTION_ROLLUP}) AS mentions ON TRUE
    LEFT JOIN gold.fct_reddit_flair AS flair
        ON flair.author_flair = posts.author_flair
"""

POSTS_FROM = f"""
    FROM gold.fct_reddit_posts AS posts
    {POST_ROW_JOINS}
"""

POSTS_FILTER = f"""
    WHERE
        (:from_date IS NULL OR posts.created_utc >= CAST(:from_date AS date))
      AND (:to_date IS NULL OR posts.created_utc < CAST(:to_date AS date) + 1)
      AND (:subreddit IS NULL OR lower(posts.subreddit) = lower(:subreddit))
      AND (:tag IS NULL OR lower({POST_TAG}) = lower(:tag))
      AND (:source IS NULL OR {POST_SOURCE} = lower(:source))
      AND (:content_type IS NULL OR {POST_CONTENT_TYPE} = :content_type)
      AND (NOT :contested OR {IS_CONTESTED})
      AND (:search IS NULL OR posts.title ILIKE :search)
"""

POSTS_SELECT = f"""
    posts.reddit_id,
    posts.subreddit,
    posts.title,
    posts.author,
    posts.score,
    posts.num_comments,
    posts.created_utc,
    posts.permalink,
    posts.url,
    posts.flair,
    posts.is_self,
    posts.scraped_at,
    {POST_TAG} AS tag,
    {POST_SOURCE} AS source,
    {POST_CONTENT_TYPE} AS content_type,
    {IS_CONTESTED} AS is_contested,
    {DISCUSSION_RATIO} AS discussion_ratio,
    coalesce(comments.captured_comment_count, 0) AS captured_comment_count,
    comments.top_comment_score,
    comments.captured_comment_score,
    {TOP_COMMENT_LEVERAGE} AS top_comment_leverage,
    round(comments.captured_comment_score::numeric / nullif(posts.score, 0), 3)
        AS comment_concentration,
    coalesce(mentions.player_mentions, ARRAY[]::text[]) AS player_mentions,
    coalesce(mentions.team_mentions, ARRAY[]::text[]) AS team_mentions,
    posts.author_flair,
    flair.flair_scope,
    flair.flair_team_abbreviation,
    flair.flair_team_name
"""

# Whitelisted ORDER BY fragments — the `sort` query param picks a key, never
# interpolates one. Derived names are SELECT aliases, which Postgres allows here.
# Every entry ends in reddit_id. The sort keys above it tie often — 23 of the
# first 169 posts sat at score 0, which is both a null top_comment_leverage and a
# tied score — and OFFSET paging over a non-unique ordering repeats and skips rows.
#
# needs_comments marks the one sort whose ORDER BY reads the comment rollup; the
# rest order on post columns alone, which is what lets the page be chosen before
# either rollup runs.
POST_SORTS = {
    "recent": "posts.created_utc DESC, posts.reddit_id DESC",
    "score": "posts.score DESC, posts.created_utc DESC, posts.reddit_id DESC",
    "comments": "posts.num_comments DESC, posts.created_utc DESC, posts.reddit_id DESC",
    "discussion": "discussion_ratio DESC, posts.num_comments DESC, posts.reddit_id DESC",
    "leverage": ("top_comment_leverage DESC NULLS LAST, posts.score DESC, posts.reddit_id DESC"),
}

# Deliberately not POSTS_FROM: counting posts does not need the comment or
# mention rollups, and both are per-post left joins that cannot change the total.
LIST_POSTS_COUNT = text(
    f"""
    SELECT count(*) AS total
    FROM gold.fct_reddit_posts AS posts
    {POSTS_FILTER}
    """
)


# A sort on a derived column has to compute it in the page CTE as well, and
# top_comment_leverage needs the comment rollup there to do it.
PAGE_SORT_SELECT = {
    "discussion": f", {DISCUSSION_RATIO} AS discussion_ratio",
    "leverage": f", {TOP_COMMENT_LEVERAGE} AS top_comment_leverage",
}
SORTS_NEEDING_COMMENTS = frozenset({"leverage"})


def _list_posts(key: str, order: str) -> str:
    """Pick the page first, then roll up only the rows on it.

    A lateral in the main query runs once per row that survives the filter, not
    once per row returned, so an unwindowed feed paid for every post in the table
    to return twenty-five. Narrowing to the page first turns that into a fixed
    twenty-five lookups however large the window is.
    """
    page_rollup = (
        f"LEFT JOIN LATERAL ({COMMENT_ROLLUP}) AS comments ON TRUE"
        if key in SORTS_NEEDING_COMMENTS
        else ""
    )
    return f"""
        WITH page AS (
            SELECT posts.reddit_id{PAGE_SORT_SELECT.get(key, "")}
            FROM gold.fct_reddit_posts AS posts
            {page_rollup}
            {POSTS_FILTER}
            ORDER BY {order}
            LIMIT :limit OFFSET :offset
        )
        SELECT
            {POSTS_SELECT}
        FROM page
        INNER JOIN gold.fct_reddit_posts AS posts
            ON posts.reddit_id = page.reddit_id
        {POST_ROW_JOINS}
        ORDER BY {order}
    """


LIST_POSTS = {key: text(_list_posts(key, order)) for key, order in POST_SORTS.items()}

GET_POST = text(
    f"""
    SELECT
        {POSTS_SELECT},
        posts.selftext
    {POSTS_FROM}
    WHERE posts.reddit_id = :reddit_id
    """
)

POST_EXISTS = text(
    """
    SELECT 1
    FROM gold.fct_reddit_posts
    WHERE reddit_id = :reddit_id
    """
)

LIST_POST_COMMENTS = text(
    """
    SELECT
        fct_reddit_comments.reddit_id,
        fct_reddit_comments.post_reddit_id,
        fct_reddit_comments.parent_id,
        fct_reddit_comments.author,
        fct_reddit_comments.body,
        fct_reddit_comments.score,
        fct_reddit_comments.created_utc,
        fct_reddit_comments.permalink,
        left(fct_reddit_comments.parent_id, 3) = 't3_' AS is_top_level,
        fct_reddit_comments.body IN ('[removed]', '[deleted]') AS is_removed,
        fct_reddit_comments.author_flair,
        fct_reddit_flair.flair_scope,
        fct_reddit_flair.flair_team_abbreviation,
        fct_reddit_flair.flair_team_name
    FROM gold.fct_reddit_comments
    LEFT JOIN gold.fct_reddit_flair
        ON fct_reddit_flair.author_flair = fct_reddit_comments.author_flair
    WHERE fct_reddit_comments.post_reddit_id = :reddit_id
    ORDER BY
        fct_reddit_comments.score DESC,
        fct_reddit_comments.reddit_id
    """
)

SOCIAL_SUMMARY = f"""
    WITH filtered AS (
        SELECT
            posts.reddit_id,
            posts.author,
            posts.score,
            posts.num_comments,
            posts.created_utc,
            posts.scraped_at,
            {IS_CONTESTED} AS is_contested
        FROM gold.fct_reddit_posts AS posts
        WHERE
            (:from_date IS NULL OR posts.created_utc >= CAST(:from_date AS date))
          AND (:to_date IS NULL OR posts.created_utc < CAST(:to_date AS date) + 1)
          AND (:subreddit IS NULL OR lower(posts.subreddit) = lower(:subreddit))
    )
    SELECT
        (SELECT count(*) FROM filtered) AS post_count,
        (SELECT count(DISTINCT author) FROM filtered WHERE author IS NOT NULL) AS author_count,
        (SELECT coalesce(sum(num_comments), 0) FROM filtered) AS reported_comment_count,
        (
            SELECT count(*)
            FROM gold.fct_reddit_comments AS window_comments
            INNER JOIN filtered ON filtered.reddit_id = window_comments.post_reddit_id
        ) AS captured_comment_count,
        (SELECT count(*) FROM filtered WHERE is_contested) AS contested_post_count,
        (SELECT coalesce(sum(score), 0) FROM filtered) AS total_score,
        (SELECT max(score) FROM filtered) AS top_score,
        (SELECT min(created_utc) FROM filtered) AS first_post_at,
        (SELECT max(created_utc) FROM filtered) AS last_post_at,
        (SELECT max(scraped_at) FROM filtered) AS last_scraped_at
"""

GET_SUMMARY = text(SOCIAL_SUMMARY)


def _leaderboard(key_expression: str) -> str:
    """GROUP BY rollup shared by the tag, source, author, and composition boards.

    The FROM alias must stay `posts`: every fragment spliced in here, including
    the caller's key_expression, is written against that name.
    """
    return f"""
        WITH filtered AS (
            SELECT
                {key_expression} AS key,
                posts.score,
                posts.num_comments,
                posts.is_self,
                {DISCUSSION_RATIO} AS discussion_ratio
            FROM gold.fct_reddit_posts AS posts
            WHERE
                (:from_date IS NULL OR posts.created_utc >= CAST(:from_date AS date))
              AND (:to_date IS NULL OR posts.created_utc < CAST(:to_date AS date) + 1)
              AND (:subreddit IS NULL OR lower(posts.subreddit) = lower(:subreddit))
        )
        SELECT
            key,
            count(*) AS post_count,
            count(*) FILTER (WHERE is_self) AS self_post_count,
            count(*) FILTER (WHERE NOT is_self) AS link_post_count,
            sum(score) AS total_score,
            max(score) AS top_score,
            round(avg(score)) AS avg_score,
            round(
                percentile_cont(0.5) WITHIN GROUP (ORDER BY score)::numeric
            ) AS median_score,
            sum(num_comments) AS total_comments,
            round(
                percentile_cont(0.5) WITHIN GROUP (ORDER BY num_comments)::numeric
            ) AS median_comments,
            round(
                percentile_cont(0.5) WITHIN GROUP (ORDER BY discussion_ratio)::numeric, 2
            ) AS median_discussion_ratio
        FROM filtered
        WHERE key IS NOT NULL
        GROUP BY key
        ORDER BY
            post_count DESC,
            total_score DESC,
            key
        LIMIT :limit
    """


LIST_TAGS = text(_leaderboard(POST_TAG))
LIST_SOURCES = text(_leaderboard(POST_SOURCE))
LIST_AUTHORS = text(_leaderboard("posts.author"))
# Self posts against links. Same rollup, two buckets, so the medians the UI
# compares are computed the same way as everywhere else on the page.
LIST_COMPOSITION = text(_leaderboard("CASE WHEN posts.is_self THEN 'self' ELSE 'link' END"))

# Counts for the type chips. One pass, so the chips cannot disagree with the feed.
LIST_FACETS = text(
    f"""
    WITH filtered AS (
        SELECT
            {POST_CONTENT_TYPE} AS content_type,
            {IS_CONTESTED} AS is_contested
        FROM gold.fct_reddit_posts AS posts
        WHERE
            (:from_date IS NULL OR posts.created_utc >= CAST(:from_date AS date))
          AND (:to_date IS NULL OR posts.created_utc < CAST(:to_date AS date) + 1)
          AND (:subreddit IS NULL OR lower(posts.subreddit) = lower(:subreddit))
    )
    SELECT
        content_type AS key,
        count(*) AS post_count,
        count(*) FILTER (WHERE is_contested) AS contested_post_count
    FROM filtered
    GROUP BY content_type
    ORDER BY
        post_count DESC,
        content_type
    """
)

# generate_series so a quiet hour is a zero rather than a gap the strip has to
# guess at. Hours are UTC, matching created_utc.
LIST_RHYTHM = text(
    """
    WITH hours AS (
        SELECT generate_series(0, 23) AS hour_utc
    ),
    filtered AS (
        SELECT
            extract(hour FROM fct_reddit_posts.created_utc)::int AS hour_utc,
            fct_reddit_posts.score,
            fct_reddit_posts.num_comments
        FROM gold.fct_reddit_posts
        WHERE
            (:from_date IS NULL OR fct_reddit_posts.created_utc >= CAST(:from_date AS date))
          AND (:to_date IS NULL OR fct_reddit_posts.created_utc < CAST(:to_date AS date) + 1)
          AND (:subreddit IS NULL OR lower(fct_reddit_posts.subreddit) = lower(:subreddit))
    ),
    rolled AS (
        SELECT
            hour_utc,
            count(*) AS post_count,
            sum(num_comments) AS total_comments,
            round(
                percentile_cont(0.5) WITHIN GROUP (ORDER BY score)::numeric
            ) AS median_score
        FROM filtered
        GROUP BY hour_utc
    )
    SELECT
        hours.hour_utc,
        coalesce(rolled.post_count, 0) AS post_count,
        coalesce(rolled.total_comments, 0) AS total_comments,
        rolled.median_score
    FROM hours
    LEFT JOIN rolled ON rolled.hour_utc = hours.hour_utc
    ORDER BY hours.hour_utc
    """
)

ENTITY_TYPES = ("player", "team")

# Player and team social. post_count counts a post once however many times it is
# named; comment_count is mentions in the stored top-10 sample, never the thread.
LIST_ENTITIES = text(
    """
    WITH filtered AS (
        SELECT
            fct_reddit_entity_mentions.entity_id,
            fct_reddit_entity_mentions.entity_name,
            fct_reddit_entity_mentions.entity_abbreviation,
            fct_reddit_entity_mentions.document_type,
            fct_reddit_entity_mentions.post_reddit_id
        FROM gold.fct_reddit_entity_mentions
        WHERE fct_reddit_entity_mentions.entity_type = :entity_type
          AND (:from_date IS NULL OR fct_reddit_entity_mentions.created_utc >= CAST(:from_date AS date))
          AND (:to_date IS NULL OR fct_reddit_entity_mentions.created_utc < CAST(:to_date AS date) + 1)
    ),
    rolled AS (
        SELECT
            entity_id,
            max(entity_name) AS entity_name,
            max(entity_abbreviation) AS entity_abbreviation,
            count(DISTINCT post_reddit_id) AS post_count,
            count(*) FILTER (WHERE document_type = 'comment') AS comment_count
        FROM filtered
        GROUP BY entity_id
    ),
    -- A post counts once toward the entity's score whether the name appeared in
    -- the title or in five of its comments.
    entity_posts AS (
        SELECT DISTINCT
            entity_id,
            post_reddit_id
        FROM filtered
    ),
    scored AS (
        SELECT
            entity_posts.entity_id,
            sum(fct_reddit_posts.score) AS total_post_score,
            max(fct_reddit_posts.score) AS top_post_score
        FROM entity_posts
        INNER JOIN gold.fct_reddit_posts
            ON fct_reddit_posts.reddit_id = entity_posts.post_reddit_id
        GROUP BY entity_posts.entity_id
    )
    SELECT
        rolled.entity_id,
        rolled.entity_name,
        rolled.entity_abbreviation,
        rolled.post_count,
        rolled.comment_count,
        coalesce(scored.total_post_score, 0) AS total_post_score,
        scored.top_post_score,
        -- Null for players. The rail shows "Lakers", matching the fanbase board.
        dim_teams.nickname AS entity_nickname,
        dim_teams.primary_color,
        dim_teams.alternate_color
    FROM rolled
    LEFT JOIN scored ON scored.entity_id = rolled.entity_id
    LEFT JOIN gold.dim_teams ON dim_teams.team_id = rolled.entity_id
    ORDER BY
        rolled.post_count DESC,
        rolled.comment_count DESC,
        rolled.entity_name
    LIMIT :limit
    """
)


# Fanbase board: which team's fans are posting and commenting, from user flair.
# Posts and comments are unioned so a fanbase that only ever replies still shows.
LIST_FANBASES = text(
    """
    WITH flaired AS (
        SELECT
            fct_reddit_posts.author_flair,
            fct_reddit_posts.author,
            'post' AS document_type,
            fct_reddit_posts.created_utc
        FROM gold.fct_reddit_posts
        WHERE fct_reddit_posts.author_flair IS NOT NULL
          AND (:from_date IS NULL OR fct_reddit_posts.created_utc >= CAST(:from_date AS date))
          AND (:to_date IS NULL OR fct_reddit_posts.created_utc < CAST(:to_date AS date) + 1)
          AND (:subreddit IS NULL OR lower(fct_reddit_posts.subreddit) = lower(:subreddit))
        UNION ALL
        SELECT
            fct_reddit_comments.author_flair,
            fct_reddit_comments.author,
            'comment',
            fct_reddit_comments.created_utc
        FROM gold.fct_reddit_comments
        WHERE fct_reddit_comments.author_flair IS NOT NULL
          AND (:from_date IS NULL OR fct_reddit_comments.created_utc >= CAST(:from_date AS date))
          AND (:to_date IS NULL OR fct_reddit_comments.created_utc < CAST(:to_date AS date) + 1)
    ),
    resolved AS (
        SELECT
            fct_reddit_flair.flair_scope,
            fct_reddit_flair.flair_team_id,
            coalesce(fct_reddit_flair.flair_team_name, fct_reddit_flair.flair_label) AS label,
            fct_reddit_flair.flair_team_abbreviation,
            flaired.author,
            flaired.document_type
        FROM flaired
        INNER JOIN gold.fct_reddit_flair
            ON fct_reddit_flair.author_flair = flaired.author_flair
        WHERE
            (:scope IS NULL OR fct_reddit_flair.flair_scope = :scope)
    )
    SELECT
        resolved.flair_scope,
        resolved.flair_team_id,
        resolved.flair_team_abbreviation,
        resolved.label,
        -- The nickname, so a 320px rail is not rendering
        -- "Minnesota Timberw…". Null for non-team flair.
        dim_teams.nickname AS flair_team_nickname,
        count(*) AS document_count,
        count(*) FILTER (WHERE resolved.document_type = 'post') AS post_count,
        count(*) FILTER (WHERE resolved.document_type = 'comment') AS comment_count,
        count(DISTINCT resolved.author) AS author_count,
        dim_teams.primary_color,
        dim_teams.alternate_color
    FROM resolved
    LEFT JOIN gold.dim_teams
        ON dim_teams.team_id = resolved.flair_team_id
    GROUP BY
        resolved.flair_scope,
        resolved.flair_team_id,
        resolved.flair_team_abbreviation,
        resolved.label,
        dim_teams.nickname,
        dim_teams.primary_color,
        dim_teams.alternate_color
    ORDER BY
        document_count DESC,
        resolved.label
    LIMIT :limit
    """
)

FLAIR_SCOPES = ("team", "league", "other")
