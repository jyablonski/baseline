"""Ingest Reddit submissions and comments via PRAW into source tables.

Posts: hot + top for ``--time-filter`` (default day) → ``source.reddit_posts``.
Author flair (the r/nba team badge) is captured on both posts and comments as
``author_flair``; it is the author's flair as of the scrape and is not
backfillable.
Comments: top-N by score per ingested post (already-loaded forest;
``replace_more(limit=0)`` so we do not walk "load more") →
``source.reddit_comments``, associated by ``post_reddit_id``. Default
subreddit is ``nba`` (r/nba). Daily pipeline calls this as r/nba whenever
the pipeline is enabled (or ``--force``); it does not follow
``season_active`` and does not scrape team subs. Missing ``REDDIT_*``
skips HTTP. ``scrape-all`` skips it unless ``--with-reddit``.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

import praw

from config import Settings, require_reddit_settings
from db import get_session, upsert_rows
from models import RedditComment, RedditPost

logger = logging.getLogger(__name__)

DEFAULT_SUBREDDIT = "nba"
DEFAULT_LIMIT = 100
DEFAULT_COMMENTS_PER_POST = 250
SELFTEXT_MAX_CHARS = 4000
FLAIR_MAX_CHARS = 200
TIME_FILTERS = ("day", "week", "month")


def _reddit_client(cfg: Settings) -> praw.Reddit:
    """Build a PRAW client. Call only after ``require_reddit_settings``."""
    kwargs: dict[str, Any] = {
        "client_id": cfg.reddit_client_id.strip(),
        "client_secret": cfg.reddit_client_secret.strip(),
        "user_agent": cfg.reddit_user_agent.strip(),
        "check_for_updates": False,
    }
    username = (cfg.reddit_username or "").strip()
    password = (cfg.reddit_password or "").strip()
    if username and password:
        kwargs["username"] = username
        kwargs["password"] = password
    reddit = praw.Reddit(**kwargs)
    if not (username and password):
        reddit.read_only = True
    return reddit


def _subreddit_name(submission: Any) -> str:
    subreddit = getattr(submission, "subreddit", None)
    display = getattr(subreddit, "display_name", None)
    if display:
        return str(display)
    text = str(subreddit or "").strip()
    return text


def _author_name(submission: Any) -> str | None:
    author = getattr(submission, "author", None)
    if author is None:
        return None
    name = str(author).strip()
    if not name or name == "[deleted]":
        return None
    return name[:50]


def _author_flair(item: Any) -> str | None:
    """User flair on the author, e.g. ``":lal-1: Lakers"``.

    This is the team badge; ``link_flair_text`` is the post's own flair and is a
    content tag ("Highlight"), unset on roughly nine posts in ten. Reddit reports
    the author's *current* flair, so this is as-of scrape and cannot be backfilled
    for posts already stored.
    """
    raw = getattr(item, "author_flair_text", None)
    if raw is None:
        return None
    text = str(raw).strip()
    return text[:FLAIR_MAX_CHARS] or None


def _created_utc(submission: Any, *, fallback: datetime) -> datetime:
    raw = getattr(submission, "created_utc", None)
    if raw is None or raw == "":
        return fallback
    try:
        return datetime.fromtimestamp(float(raw), tz=UTC).replace(tzinfo=None)
    except TypeError, ValueError, OSError:
        return fallback


def _permalink(submission: Any) -> str:
    raw = str(getattr(submission, "permalink", "") or "").strip()
    if not raw:
        reddit_id = str(getattr(submission, "id", "") or "").strip()
        return f"https://www.reddit.com/comments/{reddit_id}" if reddit_id else ""
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw[:500]
    if not raw.startswith("/"):
        raw = "/" + raw
    return ("https://www.reddit.com" + raw)[:500]


def _truncate_selftext(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value)
    if not text:
        return None
    if len(text) > SELFTEXT_MAX_CHARS:
        return text[:SELFTEXT_MAX_CHARS]
    return text


def submission_to_row(
    submission: Any, *, scraped_at: datetime | None = None
) -> dict[str, Any] | None:
    """Map a PRAW Submission (or test double) to a source.reddit_posts row."""
    reddit_id = str(getattr(submission, "id", "") or "").strip()
    if not reddit_id:
        return None
    scraped = scraped_at or datetime.now()
    title = str(getattr(submission, "title", "") or "")
    url = str(getattr(submission, "url", "") or "").strip() or None
    flair = getattr(submission, "link_flair_text", None)
    flair_text = str(flair).strip()[:200] if flair else None
    return {
        "reddit_id": reddit_id[:16],
        "subreddit": _subreddit_name(submission)[:50] or DEFAULT_SUBREDDIT,
        "title": title,
        "author": _author_name(submission),
        "score": int(getattr(submission, "score", 0) or 0),
        "num_comments": int(getattr(submission, "num_comments", 0) or 0),
        "created_utc": _created_utc(submission, fallback=scraped),
        "permalink": _permalink(submission),
        "url": url,
        "selftext": _truncate_selftext(getattr(submission, "selftext", None)),
        "flair": flair_text or None,
        "author_flair": _author_flair(submission),
        "is_self": bool(getattr(submission, "is_self", False)),
        "scraped_at": scraped,
    }


def _iter_submissions(subreddit: Any, *, limit: int, time_filter: str) -> list[Any]:
    """Fetch ``hot`` plus ``top`` for ``time_filter``, de-duplicated by submission id."""
    seen: set[str] = set()
    ordered: list[Any] = []
    streams = (
        subreddit.hot(limit=limit),
        subreddit.top(time_filter=time_filter, limit=limit),
    )
    for stream in streams:
        for submission in stream:
            reddit_id = str(getattr(submission, "id", "") or "").strip()
            if not reddit_id or reddit_id in seen:
                continue
            seen.add(reddit_id)
            ordered.append(submission)
    return ordered


def _parent_id(comment: Any) -> str | None:
    raw = str(getattr(comment, "parent_id", "") or "").strip()
    return raw[:20] or None


def comment_to_row(
    comment: Any,
    *,
    post_reddit_id: str,
    scraped_at: datetime | None = None,
) -> dict[str, Any] | None:
    """Map a PRAW Comment (or test double) to a source.reddit_comments row."""
    reddit_id = str(getattr(comment, "id", "") or "").strip()
    post_id = (post_reddit_id or "").strip()
    if not reddit_id or not post_id:
        return None
    scraped = scraped_at or datetime.now()
    return {
        "reddit_id": reddit_id[:16],
        "post_reddit_id": post_id[:16],
        "parent_id": _parent_id(comment),
        "author": _author_name(comment),
        "body": _truncate_selftext(getattr(comment, "body", None)),
        "author_flair": _author_flair(comment),
        "score": int(getattr(comment, "score", 0) or 0),
        "created_utc": _created_utc(comment, fallback=scraped),
        "permalink": _permalink(comment),
        "scraped_at": scraped,
    }


def _comment_sort_key(comment: Any) -> int:
    return int(getattr(comment, "score", 0) or 0)


def _iter_comments(submission: Any, *, limit: int) -> list[Any]:
    """Top-N comments already on ``submission``, by score. No ``replace_more`` walk."""
    if limit < 1:
        return []
    forest = getattr(submission, "comments", None)
    if forest is None:
        return []
    replace_more = getattr(forest, "replace_more", None)
    if callable(replace_more):
        replace_more(limit=0)
    listed = getattr(forest, "list", None)
    raw = listed() if callable(listed) else forest
    seen: set[str] = set()
    candidates: list[Any] = []
    for comment in raw:
        reddit_id = str(getattr(comment, "id", "") or "").strip()
        if not reddit_id or reddit_id in seen:
            continue
        if getattr(comment, "body", None) is None and type(comment).__name__ == "MoreComments":
            continue
        seen.add(reddit_id)
        candidates.append(comment)
    candidates.sort(key=_comment_sort_key, reverse=True)
    return candidates[:limit]


def scrape_reddit(
    subreddit: str = DEFAULT_SUBREDDIT,
    limit: int = DEFAULT_LIMIT,
    time_filter: str = "day",
    *,
    comments_per_post: int = DEFAULT_COMMENTS_PER_POST,
    client: praw.Reddit | None = None,
    cfg: Settings | None = None,
) -> int:
    """Upsert hot + top posts and top-N comments into source reddit tables."""
    name = (subreddit or DEFAULT_SUBREDDIT).strip()
    if name.lower().startswith("r/"):
        name = name[2:].strip()
    if not name:
        name = DEFAULT_SUBREDDIT
    if time_filter not in TIME_FILTERS:
        raise ValueError(f"time_filter must be one of {TIME_FILTERS}, got {time_filter!r}")
    if limit < 1:
        raise ValueError("limit must be >= 1")
    if comments_per_post < 0:
        raise ValueError("comments_per_post must be >= 0")

    settings = require_reddit_settings(cfg)
    reddit = client if client is not None else _reddit_client(settings)
    scraped_at = datetime.now()
    submissions = _iter_submissions(
        reddit.subreddit(name),
        limit=limit,
        time_filter=time_filter,
    )
    rows = [
        row
        for row in (submission_to_row(item, scraped_at=scraped_at) for item in submissions)
        if row is not None
    ]
    comment_rows: list[dict[str, Any]] = []
    if comments_per_post:
        for submission in submissions:
            post_id = str(getattr(submission, "id", "") or "").strip()
            if not post_id:
                continue
            for comment in _iter_comments(submission, limit=comments_per_post):
                mapped = comment_to_row(comment, post_reddit_id=post_id, scraped_at=scraped_at)
                if mapped is not None:
                    comment_rows.append(mapped)
    with get_session() as session:
        written = upsert_rows(session, RedditPost, rows, ["reddit_id"])
        comments_written = 0
        if comment_rows:
            comments_written = upsert_rows(session, RedditComment, comment_rows, ["reddit_id"])
    logger.info(
        "Upserted %s reddit posts and %s comments from r/%s "
        "(limit=%s time_filter=%s comments_per_post=%s)",
        written,
        comments_written,
        name,
        limit,
        time_filter,
        comments_per_post,
    )
    return written
