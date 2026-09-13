from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SocialPost(BaseModel):
    """An r/nba submission with the discourse metrics derived from it.

    Comment aggregates cover the top-10 sample the scraper stores, not the whole
    thread: compare `captured_comment_count` against `num_comments` before
    presenting either one.
    """

    model_config = ConfigDict(from_attributes=True)

    reddit_id: str
    subreddit: str
    title: str
    author: str | None = None
    score: int
    num_comments: int
    created_utc: datetime
    permalink: str
    url: str | None = None
    flair: str | None = None
    is_self: bool
    scraped_at: datetime
    tag: str | None = None
    source: str | None = None
    content_type: str
    is_contested: bool
    discussion_ratio: float
    captured_comment_count: int
    top_comment_score: int | None = None
    captured_comment_score: int | None = None
    top_comment_leverage: float | None = None
    comment_concentration: float | None = None
    player_mentions: list[str] = Field(default_factory=list)
    team_mentions: list[str] = Field(default_factory=list)
    # User flair — the r/nba team badge on the author, resolved by
    # fct_reddit_flair. Null when the author has none, which is about half of
    # posts. flair_team_* is set only when flair_scope is "team".
    author_flair: str | None = None
    flair_scope: str | None = None
    flair_team_abbreviation: str | None = None
    flair_team_name: str | None = None


class SocialPostDetail(SocialPost):
    selftext: str | None = None


class SocialComment(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    reddit_id: str
    post_reddit_id: str
    parent_id: str | None = None
    author: str | None = None
    body: str | None = None
    score: int
    created_utc: datetime
    permalink: str
    is_top_level: bool
    is_removed: bool
    # User flair — the r/nba team badge on the author, resolved by
    # fct_reddit_flair. Null when the author has none, which is about half of
    # posts. flair_team_* is set only when flair_scope is "team".
    author_flair: str | None = None
    flair_scope: str | None = None
    flair_team_abbreviation: str | None = None
    flair_team_name: str | None = None


class SocialFanbase(BaseModel):
    """One fanbase, counted from user flair across posts and comments."""

    model_config = ConfigDict(from_attributes=True)

    flair_scope: str
    flair_team_id: UUID | None = None
    flair_team_abbreviation: str | None = None
    # Short form for narrow layouts; null unless the flair resolved to a club.
    flair_team_nickname: str | None = None
    label: str
    document_count: int
    post_count: int
    comment_count: int
    author_count: int
    primary_color: str | None = None
    alternate_color: str | None = None


class SocialSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    post_count: int
    author_count: int
    reported_comment_count: int
    captured_comment_count: int
    contested_post_count: int
    total_score: int
    top_score: int | None = None
    first_post_at: datetime | None = None
    last_post_at: datetime | None = None
    last_scraped_at: datetime | None = None


class SocialLeader(BaseModel):
    """One row of the tag, source, poster, or self-against-link rollup."""

    model_config = ConfigDict(from_attributes=True)

    key: str
    post_count: int
    self_post_count: int
    link_post_count: int
    total_score: int
    top_score: int
    avg_score: float
    median_score: float
    total_comments: int
    median_comments: float
    median_discussion_ratio: float


class SocialFacet(BaseModel):
    """Post counts per content type, for the filter chips."""

    model_config = ConfigDict(from_attributes=True)

    key: str
    post_count: int
    contested_post_count: int


class SocialHour(BaseModel):
    """One UTC hour of the posting-rhythm strip. Quiet hours are zeroes, not gaps."""

    model_config = ConfigDict(from_attributes=True)

    hour_utc: int
    post_count: int
    total_comments: int
    median_score: float | None = None


class SocialEntity(BaseModel):
    """A player or team named in posts and their captured comments.

    Players are matched on full name only, so a surname- or nickname-only
    reference is not counted here. Brand colours are present for teams only.
    """

    model_config = ConfigDict(from_attributes=True)

    entity_id: UUID
    entity_name: str
    entity_abbreviation: str | None = None
    entity_nickname: str | None = None
    post_count: int
    comment_count: int
    total_post_score: int
    top_post_score: int | None = None
    primary_color: str | None = None
    alternate_color: str | None = None
