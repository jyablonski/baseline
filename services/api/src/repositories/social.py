from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from queries.social import (
    GET_POST,
    GET_SUMMARY,
    LIST_ENTITIES,
    LIST_FACETS,
    LIST_FANBASES,
    LIST_POST_COMMENTS,
    LIST_POSTS,
    LIST_POSTS_COUNT,
    LIST_SOURCES,
    LIST_TAGS,
    POST_EXISTS,
    POST_SORTS,
)
from repositories.status import as_utc

DEFAULT_SORT = "recent"

_TIMESTAMP_COLUMNS = (
    "created_utc",
    "scraped_at",
    "first_post_at",
    "last_post_at",
    "last_scraped_at",
)


def _stamp_utc(row: dict) -> dict:
    """Tag the naive warehouse timestamps as UTC — the scraper stores UTC."""
    for column in _TIMESTAMP_COLUMNS:
        if column in row:
            row[column] = as_utc(row[column])
    return row


class SocialRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_posts(
        self,
        *,
        from_date: date | None,
        to_date: date | None,
        subreddit: str | None,
        tag: str | None,
        source: str | None,
        content_type: str | None,
        contested: bool,
        search: str | None,
        sort: str,
        limit: int,
        offset: int,
    ) -> tuple[int, list[dict]]:
        params = {
            "from_date": from_date,
            "to_date": to_date,
            "subreddit": subreddit,
            "tag": tag,
            "source": source,
            "content_type": content_type,
            "contested": contested,
            "search": f"%{search}%" if search else None,
            "limit": limit,
            "offset": offset,
        }
        total = self.db.execute(LIST_POSTS_COUNT, params).scalar_one()
        rows = self.db.execute(LIST_POSTS[sort if sort in POST_SORTS else DEFAULT_SORT], params)
        return int(total), [_stamp_utc(dict(row._mapping)) for row in rows]

    def get_post(self, reddit_id: str) -> dict | None:
        row = self.db.execute(GET_POST, {"reddit_id": reddit_id}).first()
        return _stamp_utc(dict(row._mapping)) if row is not None else None

    def post_exists(self, reddit_id: str) -> bool:
        value = self.db.execute(POST_EXISTS, {"reddit_id": reddit_id}).scalar()
        return bool(value)

    def list_post_comments(self, reddit_id: str) -> list[dict]:
        rows = self.db.execute(LIST_POST_COMMENTS, {"reddit_id": reddit_id})
        return [_stamp_utc(dict(row._mapping)) for row in rows]

    def get_summary(
        self,
        *,
        from_date: date | None,
        to_date: date | None,
        subreddit: str | None,
    ) -> dict:
        row = dict(
            self.db.execute(
                GET_SUMMARY,
                {"from_date": from_date, "to_date": to_date, "subreddit": subreddit},
            )
            .mappings()
            .one()
        )
        return _stamp_utc(row)

    def _leaderboard(
        self,
        statement,
        *,
        from_date: date | None,
        to_date: date | None,
        subreddit: str | None,
        limit: int,
    ) -> list[dict]:
        rows = self.db.execute(
            statement,
            {
                "from_date": from_date,
                "to_date": to_date,
                "subreddit": subreddit,
                "limit": limit,
            },
        )
        return [dict(row._mapping) for row in rows]

    def list_tags(self, **kwargs) -> list[dict]:
        return self._leaderboard(LIST_TAGS, **kwargs)

    def list_sources(self, **kwargs) -> list[dict]:
        return self._leaderboard(LIST_SOURCES, **kwargs)

    def _windowed(
        self,
        statement,
        *,
        from_date: date | None,
        to_date: date | None,
        subreddit: str | None,
    ) -> list[dict]:
        rows = self.db.execute(
            statement,
            {"from_date": from_date, "to_date": to_date, "subreddit": subreddit},
        )
        return [dict(row._mapping) for row in rows]

    def list_facets(self, **kwargs) -> list[dict]:
        return self._windowed(LIST_FACETS, **kwargs)

    def list_fanbases(
        self,
        *,
        scope: str | None,
        from_date: date | None,
        to_date: date | None,
        subreddit: str | None,
        limit: int,
    ) -> list[dict]:
        rows = self.db.execute(
            LIST_FANBASES,
            {
                "scope": scope,
                "from_date": from_date,
                "to_date": to_date,
                "subreddit": subreddit,
                "limit": limit,
            },
        )
        return [dict(row._mapping) for row in rows]

    def list_entities(
        self,
        *,
        entity_type: str,
        from_date: date | None,
        to_date: date | None,
        limit: int,
    ) -> list[dict]:
        rows = self.db.execute(
            LIST_ENTITIES,
            {
                "entity_type": entity_type,
                "from_date": from_date,
                "to_date": to_date,
                "limit": limit,
            },
        )
        return [dict(row._mapping) for row in rows]
